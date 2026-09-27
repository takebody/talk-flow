/** Talk-Flow 공용 타입 — Main / Preload / Renderer가 모두 참조한다. */

export type ProviderId = 'openai' | 'gemini' | 'anthropic'

/**
 * 음성 인식(STT)을 제공할 수 있는 제공자.
 * Claude(Anthropic) API는 오디오 입력을 받지 않으므로 STT 후보에서 제외된다.
 */
export type SttProviderId = Exclude<ProviderId, 'anthropic'>
export type Lang = 'en' | 'ko'
export type DetectedLang = Lang | 'unknown'
export type CaptureMode = 'online' | 'offline'
export type Direction = 'incoming' | 'outgoing'
export type EntrySource = 'loopback' | 'mic' | 'text'
export type EntryStatus = 'transcribing' | 'translating' | 'final' | 'error'
export type VadSensitivity = 'low' | 'medium' | 'high'

/* ------------------------------------------------------------------ 오류 모델 */

export type AiErrorCode =
  | 'NO_KEY'
  | 'NOT_CONFIGURED'
  | 'AUTH'
  | 'QUOTA'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'EMPTY'
  | 'UNKNOWN'

export interface AiError {
  code: AiErrorCode
  message: string
  hint?: string
  status?: number
  /**
   * 제공자가 응답 본문에 담아 보낸 원문 설명.
   *
   * "모델을 찾을 수 없다"는 앱 메시지만으로는 모델명 오타인지, 그 키로 권한이
   * 없는 모델인지, 해당 메서드를 지원하지 않는 모델인지 구분할 수 없다.
   * 제공자의 설명에는 그 구분이 들어 있으므로 버리지 않고 함께 보여 준다.
   */
  detail?: string
  /** 제공자가 알려준 재시도 대기 시간 (429의 RetryInfo / Retry-After) */
  retryAfterMs?: number
  /** 초과한 한도의 종류. 'day'면 기다려도 당일에는 복구되지 않는다. */
  quotaScope?: 'minute' | 'day' | 'unknown'
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AiError }

/* -------------------------------------------------------------------- 사용량 */

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  audioSeconds?: number
}

export interface SessionUsage {
  audioSeconds: number
  sttRequests: number
  translateRequests: number
  inputTokens: number
  outputTokens: number
}

export const emptyUsage = (): SessionUsage => ({
  audioSeconds: 0,
  sttRequests: 0,
  translateRequests: 0,
  inputTokens: 0,
  outputTokens: 0
})

/* ---------------------------------------------------------------- 대화 데이터 */

/** MVP 미사용. 후속 용어집 기능을 위해 인터페이스만 확보한다. */
export interface GlossaryEntry {
  term: string
  translation: string
  note?: string
}

export interface ConversationEntry {
  id: string
  timestamp: string
  direction: Direction
  source: EntrySource
  sourceLanguage: DetectedLang
  targetLanguage: Lang
  sourceText: string
  translatedText?: string
  status: EntryStatus
  errorMessage?: string
  /** 발화 종료(또는 전송) → 번역 표시까지의 종단 지연 */
  latencyMs?: number
  languageConfidence?: number
  /** 언어 판정이 불확실해 사용자 확인이 필요한 항목 */
  needsReview?: boolean
  audioSeconds?: number
}

export interface SessionMeta {
  sessionId: string
  startedAt: string
  endedAt?: string
  mode: CaptureMode
  sttProvider: SttProviderId
  translationProvider: ProviderId
  entryCount: number
  usage: SessionUsage
}

export interface SessionRecord extends SessionMeta {
  entries: ConversationEntry[]
}

/* ------------------------------------------------------------------ 설정 모델 */

export interface PricingRates {
  /** STT 오디오 1분당 USD. 0이면 비용을 표시하지 않는다. */
  sttPerMinuteUsd: number
  /** 번역 입력 토큰 100만개당 USD */
  inputPer1MUsd: number
  /** 번역 출력 토큰 100만개당 USD */
  outputPer1MUsd: number
}

export interface ProviderConfig {
  openai: { sttModel: string; chatModel: string }
  gemini: { sttModel: string; chatModel: string }
  /** Claude는 번역 전용이므로 채팅 모델만 갖는다. */
  anthropic: { chatModel: string }
}

export interface Settings {
  consent: { accepted: boolean; acceptedAt?: string }
  /** 음성 인식 담당 제공자 */
  sttProvider: SttProviderId
  /** 번역 담당 제공자 */
  translationProvider: ProviderId
  providerConfig: ProviderConfig
  pricing: Record<ProviderId, PricingRates>
  audio: {
    defaultMode: CaptureMode
    micDeviceId: string
    micGroupId: string
    micLabel: string
    echoCancellation: boolean
    noiseSuppression: boolean
    autoGainControl: boolean
    vadSensitivity: VadSensitivity
    /** 발화 종료로 판정하는 침묵 길이(ms) */
    silenceMs: number
    /** 강제 분할 전 최대 발화 길이(ms) */
    maxUtteranceMs: number
  }
  display: {
    theme: 'system' | 'light' | 'dark'
    /** 0=작게 1=보통 2=크게 3=아주 크게 */
    fontScale: 0 | 1 | 2 | 3
    alwaysOnTop: boolean
    compact: boolean
  }
  limits: {
    /**
     * 제공자별 분당 최대 요청 수. 무료 등급의 RPM 한도보다 낮게 두어야
     * 429가 나기 전에 앱이 스스로 간격을 벌린다. 0이면 제한하지 않는다.
     */
    requestsPerMinute: number
    /** 동시에 진행할 AI 요청 수 */
    maxConcurrent: number
    /**
     * 전사와 번역을 한 번의 호출로 합친다.
     * 음성 인식·번역 제공자가 같고 해당 제공자가 지원할 때만 적용된다.
     * 발화당 요청 수가 2 → 1로 줄어든다.
     */
    combineRequests: boolean
  }
  history: {
    autoSave: boolean
    /** 0 = 무기한 */
    retentionDays: 0 | 7 | 30 | 90
  }
  window: { width: number; height: number; x?: number; y?: number }
}

/* ------------------------------------------------------------- IPC 요청/응답 */

export interface TranscribeRequest {
  requestId: string
  /** 16kHz / 16-bit / mono WAV */
  wav: ArrayBuffer
  durationMs: number
  languageHint?: Lang | 'auto'
}

export interface TranscribeResponse {
  text: string
  detectedLanguage: DetectedLang
  languageConfidence: number
  usage?: Usage
}

/** 전사와 번역을 한 번의 호출로 처리한 결과 */
export interface TranscribeTranslateResponse {
  text: string
  detectedLanguage: DetectedLang
  languageConfidence: number
  /** 통합 호출이 불가능한 제공자면 undefined. 렌더러가 별도 번역을 요청한다. */
  translatedText?: string
  usage?: Usage
  /** 실제로 발생한 AI 요청 수 (사용량 미터용) */
  requests: number
}

export interface TranslateRequest {
  requestId: string
  text: string
  from: Lang
  to: Lang
  context?: { role: 'peer' | 'user'; text: string }[]
  glossary?: GlossaryEntry[]
}

export interface TranslateResponse {
  text: string
  usage?: Usage
  cached?: boolean
}

export interface CredentialStatus {
  provider: ProviderId
  /** 이 제공자용 키가 사용 가능한 상태인지 */
  hasKey: boolean
  /** 디스크에 암호화 저장되어 있는지 (false = 이번 실행에서만 유효) */
  persisted: boolean
  /** 마스킹된 미리보기 (예: sk-…4f2a) */
  preview?: string
  /** OS 보안 저장소를 쓸 수 없는 환경이면 false */
  secureStorageAvailable: boolean
}

export interface ModelInfo {
  /** 요청에 그대로 쓰는 모델 ID */
  id: string
  /** 사람이 읽는 이름 (제공자가 주는 경우) */
  label?: string
  /** 오디오 입력을 받을 수 있는지 (제공자가 알려주는 경우에만) */
  supportsAudioInput?: boolean
}

export interface DiagnosticsItem {
  id: string
  label: string
  ok: boolean
  detail: string
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  osVersion: string
  platform: string
  userDataPath: string
}
