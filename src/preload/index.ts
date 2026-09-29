import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/defaults'
import type {
  AppInfo,
  ModelInfo,
  CaptureMode,
  ConversationEntry,
  CredentialStatus,
  Minutes,
  ProviderId,
  Result,
  SessionMeta,
  SessionRecord,
  SessionUsage,
  Settings,
  TranscribeRequest,
  TranscribeResponse,
  TranscribeTranslateResponse,
  TranslateRequest,
  TranslateResponse
} from '@shared/types'

/**
 * 렌더러에 노출하는 유일한 표면.
 * API Key를 읽는 채널은 존재하지 않는다 — 키는 Main 프로세스에서만 사용된다.
 */
const api = {
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(IPC.settingsSet, patch)
  },

  credentials: {
    status: (provider: ProviderId): Promise<CredentialStatus> =>
      ipcRenderer.invoke(IPC.credentialStatus, provider),
    set: (provider: ProviderId, apiKey: string, remember: boolean): Promise<CredentialStatus> =>
      ipcRenderer.invoke(IPC.credentialSet, { provider, apiKey, remember }),
    clear: (provider: ProviderId): Promise<CredentialStatus> =>
      ipcRenderer.invoke(IPC.credentialClear, provider)
  },

  ai: {
    test: (target: 'stt' | 'translation'): Promise<Result<string>> =>
      ipcRenderer.invoke(IPC.aiTest, target),
    listModels: (provider: ProviderId): Promise<Result<ModelInfo[]>> =>
      ipcRenderer.invoke(IPC.aiListModels, provider),
    transcribe: (
      req: Omit<TranscribeRequest, 'wav'> & { wav: Uint8Array }
    ): Promise<Result<TranscribeResponse>> => ipcRenderer.invoke(IPC.aiTranscribe, req),
    /** 전사 + 번역을 한 번에. translatedText가 없으면 별도 번역이 필요하다. */
    transcribeTranslate: (
      req: Omit<TranscribeRequest, 'wav'> & { wav: Uint8Array }
    ): Promise<Result<TranscribeTranslateResponse>> =>
      ipcRenderer.invoke(IPC.aiTranscribeTranslate, req),
    translate: (req: TranslateRequest): Promise<Result<TranslateResponse>> =>
      ipcRenderer.invoke(IPC.aiTranslate, req)
  },

  session: {
    start: (mode: CaptureMode): Promise<SessionMeta> => ipcRenderer.invoke(IPC.sessionStart, mode),
    append: (sessionId: string, entry: ConversationEntry): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.sessionAppend, { sessionId, entry }),
    end: (sessionId: string, usage: SessionUsage, entryCount: number): Promise<SessionMeta[]> =>
      ipcRenderer.invoke(IPC.sessionEnd, { sessionId, usage, entryCount }),
    list: (): Promise<SessionMeta[]> => ipcRenderer.invoke(IPC.sessionList),
    load: (sessionId: string): Promise<SessionRecord | null> =>
      ipcRenderer.invoke(IPC.sessionLoad, sessionId),
    remove: (sessionId: string): Promise<SessionMeta[]> =>
      ipcRenderer.invoke(IPC.sessionDelete, sessionId),
    clearAll: (): Promise<SessionMeta[]> => ipcRenderer.invoke(IPC.sessionClearAll),
    export: (
      sessionId: string,
      format: 'json' | 'txt'
    ): Promise<{ ok: boolean; path?: string; message?: string; canceled?: boolean }> =>
      ipcRenderer.invoke(IPC.sessionExport, { sessionId, format })
  },

  minutes: {
    /** 대화록을 회의록으로 요약하고, 저장한 뒤 별도 창에 띄운다. */
    generate: (args: {
      sessionId: string
      transcript: string
      truncated: boolean
      meta: { startedAt: string; endedAt?: string; mode: CaptureMode; entryCount: number }
    }): Promise<Result<Minutes>> => ipcRenderer.invoke(IPC.minutesGenerate, args),
    /** 회의록 창이 표시할 내용 */
    current: (): Promise<Minutes | null> => ipcRenderer.invoke(IPC.minutesCurrent),
    saveAs: (): Promise<{
      ok: boolean
      path?: string
      message?: string
      canceled?: boolean
    }> => ipcRenderer.invoke(IPC.minutesSaveAs),
    reveal: (): Promise<boolean> => ipcRenderer.invoke(IPC.minutesReveal)
  },

  window: {
    setAlwaysOnTop: (value: boolean): Promise<boolean> =>
      ipcRenderer.invoke(IPC.windowAlwaysOnTop, value),
    setCompact: (compact: boolean): Promise<boolean> =>
      ipcRenderer.invoke(IPC.windowResizeCompact, compact)
  },

  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
    copyToClipboard: (text: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.clipboardWrite, text),
    openUserDataFolder: (): Promise<string> => ipcRenderer.invoke(IPC.openUserData)
  }
}

export type TalkFlowApi = typeof api

contextBridge.exposeInMainWorld('talkflow', api)
