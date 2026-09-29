import { BrowserWindow, app, clipboard, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  CaptureMode,
  ConversationEntry,
  Minutes,
  ProviderId,
  Result,
  SessionUsage,
  Settings,
  TranscribeRequest,
  TranslateRequest
} from '@shared/types'
import { IPC } from '@shared/defaults'
import { minutesFileName, renderMinutesAsText } from '@shared/minutes'
import {
  clearApiKey,
  credentialStatus,
  getSettings,
  setApiKey,
  updateSettings
} from './settings'
import * as sessions from './sessions'
import {
  autoSaveMinutes,
  getCurrentMinutes,
  minutesDir,
  openMinutesWindow,
  setCurrentMinutes
} from './minutes'
import {
  TestTarget,
  listModels,
  summarize,
  testConnection,
  transcribe,
  transcribeTranslate,
  translate
} from './providers'

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  /* -------------------------------------------------------------- 설정 */

  ipcMain.handle(IPC.settingsGet, () => getSettings())

  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<Settings>) => {
    const next = updateSettings(patch)
    const win = getWindow()
    if (win && patch.display?.alwaysOnTop !== undefined) {
      win.setAlwaysOnTop(next.display.alwaysOnTop)
    }
    return next
  })

  /* ------------------------------------------------------- API Key 관리 */

  ipcMain.handle(IPC.credentialStatus, (_e, provider: ProviderId) => credentialStatus(provider))

  ipcMain.handle(
    IPC.credentialSet,
    (_e, args: { provider: ProviderId; apiKey: string; remember: boolean }) => {
      setApiKey(args.provider, args.apiKey, args.remember)
      return credentialStatus(args.provider)
    }
  )

  ipcMain.handle(IPC.credentialClear, (_e, provider: ProviderId) => {
    clearApiKey(provider)
    return credentialStatus(provider)
  })

  /* ------------------------------------------------------------- AI 호출 */

  ipcMain.handle(IPC.aiTest, (_e, target: TestTarget) => testConnection(target))

  ipcMain.handle(IPC.aiListModels, (_e, provider: ProviderId) => listModels(provider))

  ipcMain.handle(
    IPC.aiTranscribe,
    (_e, req: Omit<TranscribeRequest, 'wav'> & { wav: Uint8Array }) => {
      // 렌더러에서 온 Uint8Array를 그대로 ArrayBuffer로 넘긴다.
      const wav = req.wav.buffer.slice(
        req.wav.byteOffset,
        req.wav.byteOffset + req.wav.byteLength
      ) as ArrayBuffer
      return transcribe({ ...req, wav })
    }
  )

  ipcMain.handle(
    IPC.aiTranscribeTranslate,
    (_e, req: Omit<TranscribeRequest, 'wav'> & { wav: Uint8Array }) => {
      const wav = req.wav.buffer.slice(
        req.wav.byteOffset,
        req.wav.byteOffset + req.wav.byteLength
      ) as ArrayBuffer
      return transcribeTranslate({ ...req, wav })
    }
  )

  ipcMain.handle(IPC.aiTranslate, (_e, req: TranslateRequest) => translate(req))

  /* --------------------------------------------------------- 세션 기록 */

  ipcMain.handle(IPC.sessionStart, (_e, mode: CaptureMode) => {
    const s = getSettings()
    return sessions.startSession(mode, s.sttProvider, s.translationProvider, s.languagePair)
  })

  ipcMain.handle(
    IPC.sessionAppend,
    (_e, args: { sessionId: string; entry: ConversationEntry }) => {
      if (!getSettings().history.autoSave) return { ok: false }
      try {
        sessions.appendEntry(args.sessionId, args.entry)
        return { ok: true }
      } catch (err) {
        console.error('[session] append 실패:', (err as Error).message)
        return { ok: false }
      }
    }
  )

  ipcMain.handle(
    IPC.sessionEnd,
    (_e, args: { sessionId: string; usage: SessionUsage; entryCount: number }) => {
      sessions.endSession(args.sessionId, args.usage, args.entryCount)
      return sessions.listSessions()
    }
  )

  ipcMain.handle(IPC.sessionList, () => sessions.listSessions())
  ipcMain.handle(IPC.sessionLoad, (_e, id: string) => sessions.loadSession(id))

  ipcMain.handle(IPC.sessionDelete, (_e, id: string) => {
    sessions.deleteSession(id)
    return sessions.listSessions()
  })

  ipcMain.handle(IPC.sessionClearAll, () => {
    sessions.clearAllSessions()
    return sessions.listSessions()
  })

  ipcMain.handle(
    IPC.sessionExport,
    async (_e, args: { sessionId: string; format: 'json' | 'txt' }) => {
      const record = sessions.loadSession(args.sessionId)
      if (!record) return { ok: false, message: '세션을 찾을 수 없습니다.' }

      const stamp = record.startedAt.slice(0, 19).replace(/[:T]/g, '-')
      const win = getWindow()
      const picked = await dialog.showSaveDialog(win ?? undefined!, {
        title: '대화 기록 내보내기',
        defaultPath: join(app.getPath('documents'), `talk-flow-${stamp}.${args.format}`),
        filters:
          args.format === 'json'
            ? [{ name: 'JSON', extensions: ['json'] }]
            : [{ name: '텍스트', extensions: ['txt'] }]
      })
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }

      const body =
        args.format === 'json'
          ? JSON.stringify(record, null, 2)
          : sessions.renderSessionAsText(record)

      try {
        // .txt는 Windows 메모장 호환을 위해 BOM을 붙인다.
        await writeFile(picked.filePath, args.format === 'txt' ? `﻿${body}` : body, 'utf-8')
        return { ok: true, path: picked.filePath }
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }
    }
  )

  /* --------------------------------------------------------------- 회의록 */

  /**
   * 대화록을 회의록으로 요약하고, 저장한 뒤 별도 창에 띄운다.
   *
   * 대화록은 렌더러가 만들어 보낸다. 세션 파일에서 다시 읽지 않는 이유는
   * 기록 자동 저장이 꺼져 있으면 파일이 비어 있기 때문이다.
   */
  ipcMain.handle(
    IPC.minutesGenerate,
    async (
      _e,
      args: {
        sessionId: string
        transcript: string
        truncated: boolean
        meta: { startedAt: string; endedAt?: string; mode: CaptureMode; entryCount: number }
      }
    ): Promise<Result<Minutes>> => {
      if (!args.transcript.trim()) {
        return {
          ok: false,
          error: {
            code: 'EMPTY',
            message: '회의록을 만들 대화 내용이 없습니다.',
            hint: '통역된 발화가 한 건 이상 있어야 합니다.'
          }
        }
      }

      const result = await summarize({
        requestId: randomUUID(),
        transcript: args.transcript,
        meta: args.meta
      })
      if (!result.ok) return result

      const minutes: Minutes = {
        ...result.value.minutes,
        sessionId: args.sessionId,
        generatedAt: new Date().toISOString(),
        startedAt: args.meta.startedAt,
        endedAt: args.meta.endedAt,
        mode: args.meta.mode,
        entryCount: args.meta.entryCount,
        provider: getSettings().translationProvider,
        model: result.value.model,
        truncated: args.truncated
      }

      minutes.savedPath = (await autoSaveMinutes(minutes)) ?? undefined
      setCurrentMinutes(minutes)
      openMinutesWindow(getWindow())

      return { ok: true, value: minutes }
    }
  )

  /** 회의록 창이 표시할 내용을 읽어 가는 채널 */
  ipcMain.handle(IPC.minutesCurrent, () => getCurrentMinutes())

  ipcMain.handle(IPC.minutesSaveAs, async () => {
    const minutes = getCurrentMinutes()
    if (!minutes) return { ok: false, message: '저장할 회의록이 없습니다.' }

    const picked = await dialog.showSaveDialog({
      title: '회의록 저장',
      defaultPath: join(minutesDir(), minutesFileName(minutes)),
      filters: [{ name: '텍스트', extensions: ['txt'] }]
    })
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }

    try {
      await writeFile(picked.filePath, `﻿${renderMinutesAsText(minutes)}`, 'utf-8')
      return { ok: true, path: picked.filePath }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  })

  /** 자동 저장된 파일을 탐색기에서 선택된 상태로 보여 준다. */
  ipcMain.handle(IPC.minutesReveal, () => {
    const path = getCurrentMinutes()?.savedPath
    if (!path) return false
    shell.showItemInFolder(path)
    return true
  })

  /* ------------------------------------------------------------- 창/시스템 */

  ipcMain.handle(IPC.windowAlwaysOnTop, (_e, value: boolean) => {
    getWindow()?.setAlwaysOnTop(value)
    updateSettings({ display: { ...getSettings().display, alwaysOnTop: value } })
    return value
  })

  ipcMain.handle(IPC.windowResizeCompact, (_e, compact: boolean) => {
    const win = getWindow()
    if (!win) return false
    const [, height] = win.getSize()
    win.setSize(compact ? 360 : Math.max(getSettings().window.width, 480), height)
    return true
  })

  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    osVersion: `${process.platform} ${process.getSystemVersion?.() ?? ''}`.trim(),
    platform: process.platform,
    userDataPath: app.getPath('userData')
  }))

  ipcMain.handle(IPC.clipboardWrite, (_e, text: string) => {
    clipboard.writeText(text)
    return true
  })

  ipcMain.handle(IPC.openUserData, () => shell.openPath(app.getPath('userData')))
}
