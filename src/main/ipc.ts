import { BrowserWindow, app, clipboard, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CaptureMode,
  ConversationEntry,
  ProviderId,
  SessionUsage,
  Settings,
  TranscribeRequest,
  TranslateRequest
} from '@shared/types'
import { IPC } from '@shared/defaults'
import {
  clearApiKey,
  credentialStatus,
  getSettings,
  setApiKey,
  updateSettings
} from './settings'
import * as sessions from './sessions'
import {
  TestTarget,
  listModels,
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
    return sessions.startSession(mode, s.sttProvider, s.translationProvider)
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
