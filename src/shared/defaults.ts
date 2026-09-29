import type { LanguagePair, ProviderId, Settings, SttProviderId, VadSensitivity } from './types'

/** 지원하는 AI 제공자 전체 목록 (번역 기준) */
export const PROVIDER_IDS: ProviderId[] = ['openai', 'gemini', 'anthropic']

/** STT를 지원하는 제공자. Claude는 오디오 입력을 받지 않아 제외된다. */
export const STT_PROVIDER_IDS: SttProviderId[] = ['openai', 'gemini']

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude'
}

/** 지원하는 회의 언어 쌍 목록 */
export const LANGUAGE_PAIRS: { id: LanguagePair; label: string; partnerLabel: string }[] = [
  { id: 'en-ko', label: '영어 ⇄ 한국어', partnerLabel: '영어' },
  { id: 'ja-ko', label: '일본어 ⇄ 한국어', partnerLabel: '일본어' }
]

export const IPC = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  credentialStatus: 'cred:status',
  credentialSet: 'cred:set',
  credentialClear: 'cred:clear',
  aiTest: 'ai:test',
  aiListModels: 'ai:listModels',
  aiTranscribe: 'ai:transcribe',
  aiTranscribeTranslate: 'ai:transcribeTranslate',
  aiTranslate: 'ai:translate',
  sessionStart: 'session:start',
  sessionAppend: 'session:append',
  sessionEnd: 'session:end',
  sessionList: 'session:list',
  sessionLoad: 'session:load',
  sessionDelete: 'session:delete',
  sessionClearAll: 'session:clearAll',
  sessionExport: 'session:export',
  minutesGenerate: 'minutes:generate',
  minutesCurrent: 'minutes:current',
  minutesSaveAs: 'minutes:saveAs',
  minutesReveal: 'minutes:reveal',
  windowAlwaysOnTop: 'window:alwaysOnTop',
  windowResizeCompact: 'window:resizeCompact',
  appInfo: 'app:info',
  clipboardWrite: 'clipboard:write',
  openUserData: 'shell:openUserData'
} as const

/** VAD 발화 시작 임계 = 노이즈 플로어 × 배수 */
export const VAD_MULTIPLIER: Record<VadSensitivity, number> = {
  low: 6.0,
  medium: 4.0,
  high: 2.8
}

/** 순수 무음에서 오검출되지 않도록 하는 절대 하한 RMS */
export const VAD_ABSOLUTE_FLOOR = 0.0045

export const VAD_FRAME_MS = 20
export const CAPTURE_SAMPLE_RATE = 16000
export const VAD_PREROLL_MS = 300
export const VAD_MIN_UTTERANCE_MS = 500
export const VAD_ONSET_FRAMES = 3
export const MAX_INPUT_CHARS = 1000
export const TRANSLATION_CONTEXT_ENTRIES = 6

export function defaultSettings(): Settings {
  return {
    /*
     * 선택 키(acceptedAt, window.x/y)도 반드시 여기에 있어야 한다.
     * settings 병합기가 "기본값에 있는 키만" 복사하므로, 여기 없는 키는
     * 저장은 되지만 다시 읽을 때 조용히 버려진다.
     */
    consent: { accepted: false, acceptedAt: undefined },
    languagePair: 'en-ko',
    sttProvider: 'gemini',
    translationProvider: 'gemini',
    providerConfig: {
      openai: { sttModel: 'gpt-4o-transcribe', chatModel: 'gpt-4.1-mini' },
      gemini: { sttModel: 'gemini-flash-latest', chatModel: 'gemini-flash-latest' },
      anthropic: { chatModel: 'claude-opus-5' }
    },
    // 요금은 네트워크에서 조회하지 않는다. 0이면 추정 비용을 표시하지 않는다.
    pricing: {
      openai: { sttPerMinuteUsd: 0, inputPer1MUsd: 0, outputPer1MUsd: 0 },
      gemini: { sttPerMinuteUsd: 0, inputPer1MUsd: 0, outputPer1MUsd: 0 },
      anthropic: { sttPerMinuteUsd: 0, inputPer1MUsd: 0, outputPer1MUsd: 0 }
    },
    audio: {
      defaultMode: 'online',
      micDeviceId: '',
      micGroupId: '',
      micLabel: '',
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      vadSensitivity: 'medium',
      silenceMs: 900,
      maxUtteranceMs: 20000
    },
    display: {
      theme: 'system',
      fontScale: 1,
      alwaysOnTop: false,
      compact: false
    },
    // Gemini 무료 등급은 분당 요청 한도가 낮다. 기본값을 보수적으로 잡는다.
    limits: {
      requestsPerMinute: 12,
      maxConcurrent: 2,
      combineRequests: true
    },
    history: {
      autoSave: true,
      retentionDays: 30
    },
    window: { width: 480, height: 760, x: undefined, y: undefined }
  }
}
