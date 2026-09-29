import { create } from 'zustand'
import type {
  AiError,
  CaptureMode,
  ConversationEntry,
  CredentialStatus,
  Direction,
  Lang,
  ProviderId,
  SessionMeta,
  SessionUsage,
  Settings,
  SttProviderId
} from '@shared/types'
import { emptyUsage } from '@shared/types'
import {
  MAX_INPUT_CHARS,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  TRANSLATION_CONTEXT_ENTRIES,
  defaultSettings
} from '@shared/defaults'
import { detectLanguage, isNoiseTranscript } from '@shared/lang'
import { buildTranscript, usableEntries } from '@shared/minutes'
import { CaptureEngine, type Utterance } from './audio/CaptureEngine'

export type AppStatus = 'idle' | 'capturing' | 'paused' | 'error'

export interface Banner {
  kind: 'error' | 'warn' | 'info'
  message: string
  hint?: string
}

interface State {
  ready: boolean
  settings: Settings
  /** 현재 선택된 제공자의 키 상태 */
  credential: CredentialStatus | null
  /** 제공자별 키 상태 — 어디에 키가 등록됐는지 한눈에 보기 위함 */
  credentials: Partial<Record<ProviderId, CredentialStatus>>
  mode: CaptureMode
  status: AppStatus
  session: SessionMeta | null
  entries: ConversationEntry[]
  usage: SessionUsage
  latencies: number[]
  level: number
  speaking: boolean
  banner: Banner | null
  busyCount: number
  sessionList: SessionMeta[]
  settingsOpen: boolean
  /** 회의록 생성이 진행 중인지. 요청 한 번이 수십 초 걸릴 수 있다. */
  minutesBusy: boolean

  init(): Promise<void>
  patchSettings(patch: Partial<Settings>): Promise<void>
  refreshCredential(provider?: ProviderId): Promise<void>
  refreshAllCredentials(): Promise<void>
  switchProvider(provider: ProviderId): Promise<void>
  switchSttProvider(provider: SttProviderId): Promise<void>
  acceptConsent(): Promise<void>
  setMode(mode: CaptureMode): void
  start(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  /** 통역을 끝내고 회의록을 작성한다. */
  stopAndSummarize(): Promise<void>
  submitText(text: string): Promise<void>
  retryEntry(id: string): Promise<void>
  reclassify(id: string, direction: Direction): Promise<void>
  dismissBanner(): void
  openSettings(open: boolean): void
  refreshSessions(): Promise<void>
  setBanner(banner: Banner | null): void
}

const engine = new CaptureEngine()

/** 동시에 진행할 AI 요청 수. 발화가 몰려도 순서와 비용을 통제한다. */
let maxConcurrent = 2
let inFlight = 0
const waiting: (() => void)[] = []

export function setMaxConcurrent(value: number): void {
  maxConcurrent = Math.max(1, Math.min(8, value))
}

async function acquireSlot(): Promise<() => void> {
  if (inFlight >= maxConcurrent) await new Promise<void>((r) => waiting.push(r))
  inFlight++
  return () => {
    inFlight--
    waiting.shift()?.()
  }
}

const nowIso = () => new Date().toISOString()
const newId = () => crypto.randomUUID()

function bannerFromError(error: AiError): Banner {
  return { kind: error.code === 'QUOTA' ? 'warn' : 'error', message: error.message, hint: error.hint }
}

/** STT 결과를 방향과 번역 언어쌍으로 라우팅한다 (오프라인 양방향 통역의 핵심). */
function route(text: string, detected: { language: string; confidence: number }) {
  let from: Lang
  if (detected.language === 'ko') from = 'ko'
  else if (detected.language === 'en') from = 'en'
  else from = /[가-힣]/.test(text) ? 'ko' : 'en'

  const needsReview = detected.language === 'unknown' || detected.confidence < 0.7
  const direction: Direction = from === 'en' ? 'incoming' : 'outgoing'
  return { from, to: (from === 'en' ? 'ko' : 'en') as Lang, direction, needsReview }
}

export const useStore = create<State>((set, get) => {
  /* ------------------------------------------------------- 내부 헬퍼 */

  const updateEntry = (id: string, patch: Partial<ConversationEntry>) => {
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e))
    }))
  }

  const persist = (id: string) => {
    const { session, entries, settings } = get()
    if (!session || !settings.history.autoSave) return
    const entry = entries.find((e) => e.id === id)
    if (entry) void window.talkflow.session.append(session.sessionId, entry)
  }

  const addUsage = (patch: Partial<SessionUsage>) => {
    set((s) => ({
      usage: {
        audioSeconds: s.usage.audioSeconds + (patch.audioSeconds ?? 0),
        sttRequests: s.usage.sttRequests + (patch.sttRequests ?? 0),
        translateRequests: s.usage.translateRequests + (patch.translateRequests ?? 0),
        inputTokens: s.usage.inputTokens + (patch.inputTokens ?? 0),
        outputTokens: s.usage.outputTokens + (patch.outputTokens ?? 0)
      }
    }))
  }

  const ensureSession = async (mode: CaptureMode): Promise<SessionMeta> => {
    const existing = get().session
    if (existing) return existing
    const session = await window.talkflow.session.start(mode)
    set({ session, usage: emptyUsage() })
    return session
  }

  /**
   * 캡처를 멈추고 세션을 닫는다.
   * 회의록 생성에 필요한 정보(세션, 항목, 종료 시각)를 그대로 돌려준다 —
   * 상태를 초기화한 뒤에는 store에서 다시 읽을 수 없기 때문이다.
   */
  const finishSession = async () => {
    engine.flush()
    await engine.stop()
    const { session, usage, entries, mode } = get()
    const endedAt = nowIso()
    if (session) {
      const sessionList = await window.talkflow.session.end(
        session.sessionId,
        usage,
        entries.length
      )
      set({ sessionList })
    }
    set({ status: 'idle', session: null, level: 0, speaking: false })
    return { session, entries, endedAt, mode }
  }

  const translationContext = (): { role: 'peer' | 'user'; text: string }[] =>
    get()
      .entries.filter((e) => e.status === 'final')
      .slice(-TRANSLATION_CONTEXT_ENTRIES)
      .map((e) => ({
        role: e.direction === 'incoming' ? ('peer' as const) : ('user' as const),
        text: e.sourceText
      }))

  /** 번역 → 항목 확정. 지연은 startedAt 기준으로 계산한다. */
  const runTranslation = async (
    id: string,
    text: string,
    from: Lang,
    to: Lang,
    startedAt: number
  ) => {
    updateEntry(id, { status: 'translating', sourceLanguage: from, targetLanguage: to })

    const release = await acquireSlot()
    set((s) => ({ busyCount: s.busyCount + 1 }))
    try {
      const result = await window.talkflow.ai.translate({
        requestId: newId(),
        text,
        from,
        to,
        context: translationContext()
      })

      if (!result.ok) {
        updateEntry(id, { status: 'error', errorMessage: result.error.message })
        set({ banner: bannerFromError(result.error) })
      } else {
        addUsage({
          translateRequests: result.value.cached ? 0 : 1,
          inputTokens: result.value.usage?.inputTokens ?? 0,
          outputTokens: result.value.usage?.outputTokens ?? 0
        })
        updateEntry(id, {
          translatedText: result.value.text,
          status: 'final',
          latencyMs: Date.now() - startedAt
        })
        set((s) => ({ latencies: [...s.latencies, Date.now() - startedAt].slice(-10) }))
      }
    } finally {
      set((s) => ({ busyCount: Math.max(0, s.busyCount - 1) }))
      release()
      persist(id)
    }
  }

  /** 발화 하나에 대한 전체 파이프라인: STT → 언어 판정 → 번역 */
  const handleUtterance = async (utterance: Utterance) => {
    const mode = get().mode
    const id = newId()

    set((s) => ({
      entries: [
        ...s.entries,
        {
          id,
          timestamp: nowIso(),
          direction: 'incoming',
          source: mode === 'online' ? 'loopback' : 'mic',
          sourceLanguage: 'unknown',
          targetLanguage: 'ko',
          sourceText: '',
          status: 'transcribing',
          audioSeconds: utterance.durationMs / 1000
        }
      ]
    }))

    const release = await acquireSlot()
    set((s) => ({ busyCount: s.busyCount + 1 }))
    let transcript: string | null = null
    let detected = { language: 'unknown' as string, confidence: 0 }

    // 통합 호출: 전사와 번역을 한 요청으로 받는다(가능한 경우).
    let combinedTranslation: string | undefined

    try {
      const result = await window.talkflow.ai.transcribeTranslate({
        requestId: newId(),
        wav: utterance.wav,
        durationMs: utterance.durationMs,
        // 온라인 모드는 상대방 영어 발화가 대부분이므로 힌트를 준다.
        languageHint: mode === 'online' ? 'en' : 'auto'
      })

      if (!result.ok) {
        // 실패한 요청도 한도를 소모하므로 사용량에 반영한다.
        addUsage({ sttRequests: 1, audioSeconds: utterance.durationMs / 1000 })

        if (result.error.code === 'EMPTY') {
          // 무음/잡음 구간이었다. 조용히 항목을 제거한다.
          set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
        } else {
          updateEntry(id, { status: 'error', errorMessage: result.error.message, sourceText: '' })
          set({ banner: bannerFromError(result.error) })
          persist(id)
          // 일일 한도를 소진했으면 캡처를 멈춘다. 계속 두면 실패 항목만 쌓인다.
          if (result.error.quotaScope === 'day') void get().pause()
        }
        return
      }

      addUsage({
        sttRequests: result.value.requests,
        audioSeconds: utterance.durationMs / 1000,
        inputTokens: result.value.usage?.inputTokens ?? 0,
        outputTokens: result.value.usage?.outputTokens ?? 0
      })

      if (isNoiseTranscript(result.value.text)) {
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
        return
      }

      transcript = result.value.text
      detected = {
        language: result.value.detectedLanguage,
        confidence: result.value.languageConfidence
      }
      combinedTranslation = result.value.translatedText
    } finally {
      set((s) => ({ busyCount: Math.max(0, s.busyCount - 1) }))
      release()
    }

    if (!transcript) return

    const routed = route(transcript, detected)
    updateEntry(id, {
      sourceText: transcript,
      sourceLanguage: routed.from,
      targetLanguage: routed.to,
      direction: routed.direction,
      needsReview: routed.needsReview,
      languageConfidence: detected.confidence
    })

    if (combinedTranslation) {
      // 통합 호출로 번역까지 받았다. 추가 요청 없이 확정한다.
      updateEntry(id, {
        translatedText: combinedTranslation,
        status: 'final',
        latencyMs: Date.now() - utterance.endedAt
      })
      set((s) => ({ latencies: [...s.latencies, Date.now() - utterance.endedAt].slice(-10) }))
      persist(id)
      return
    }

    await runTranslation(id, transcript, routed.from, routed.to, utterance.endedAt)
  }

  const captureCallbacks = {
    onUtterance: (u: Utterance) => void handleUtterance(u),
    onLevel: (level: number, speaking: boolean) => set({ level, speaking }),
    onError: (message: string, fatal: boolean) => {
      set({ banner: { kind: 'error', message }, ...(fatal ? { status: 'error' as const } : {}) })
    },
    onStreamEnded: () => {
      void (async () => {
        await engine.stop()
        set({
          status: 'error',
          level: 0,
          speaking: false,
          banner: {
            kind: 'error',
            message: '오디오 입력이 끊겼습니다.',
            hint: '장치 연결을 확인한 뒤 통역 시작을 다시 누르세요.'
          }
        })
      })()
    }
  }

  return {
    ready: false,
    settings: defaultSettings(),
    credential: null,
    credentials: {},
    mode: 'online',
    status: 'idle',
    session: null,
    entries: [],
    usage: emptyUsage(),
    latencies: [],
    level: 0,
    speaking: false,
    banner: null,
    busyCount: 0,
    sessionList: [],
    settingsOpen: false,
    minutesBusy: false,

    async init() {
      const settings = await window.talkflow.settings.get()
      setMaxConcurrent(settings.limits.maxConcurrent)
      const sessionList = await window.talkflow.session.list()
      set({ settings, sessionList, mode: settings.audio.defaultMode, ready: true })
      await get().refreshAllCredentials()
    },

    async patchSettings(patch) {
      const settings = await window.talkflow.settings.set(patch)
      setMaxConcurrent(settings.limits.maxConcurrent)
      set({ settings })
      if (patch.translationProvider) await get().refreshCredential(patch.translationProvider)
    },

    async refreshCredential(provider) {
      const target = provider ?? get().settings.translationProvider
      const status = await window.talkflow.credentials.status(target)
      set((s) => ({
        credentials: { ...s.credentials, [target]: status },
        credential: target === s.settings.translationProvider ? status : s.credential
      }))
    },

    async refreshAllCredentials() {
      const entries = await Promise.all(
        PROVIDER_IDS.map(async (id) => [id, await window.talkflow.credentials.status(id)] as const)
      )
      const map = Object.fromEntries(entries) as Record<ProviderId, CredentialStatus>
      set((s) => ({ credentials: map, credential: map[s.settings.translationProvider] ?? null }))
    },

    /** 번역 제공자 전환. 키는 제공자별로 따로 보관되므로 전환해도 다른 키가 지워지지 않는다. */
    async switchProvider(provider) {
      if (provider === get().settings.translationProvider) return
      await get().patchSettings({ translationProvider: provider })
      const status = get().credentials[provider]
      set({
        banner: status?.hasKey
          ? { kind: 'info', message: `번역을 ${PROVIDER_LABELS[provider]}로 전환했습니다.` }
          : {
              kind: 'warn',
              message: `${PROVIDER_LABELS[provider]}에 등록된 API Key가 없습니다.`,
              hint: '설정에서 키를 입력하세요.'
            }
      })
    },

    /** 음성 인식 제공자 전환 */
    async switchSttProvider(provider) {
      if (provider === get().settings.sttProvider) return
      await get().patchSettings({ sttProvider: provider })
      await get().refreshCredential(provider)
      const status = get().credentials[provider]
      set({
        banner: status?.hasKey
          ? { kind: 'info', message: `음성 인식을 ${PROVIDER_LABELS[provider]}로 전환했습니다.` }
          : {
              kind: 'warn',
              message: `${PROVIDER_LABELS[provider]}에 등록된 API Key가 없습니다.`,
              hint: '설정에서 키를 입력하세요.'
            }
      })
    },

    async acceptConsent() {
      await get().patchSettings({ consent: { accepted: true, acceptedAt: nowIso() } })
    },

    setMode(mode) {
      if (get().status === 'capturing') return
      set({ mode })
    },

    async start() {
      const { settings, mode, credentials } = get()
      if (!settings.consent.accepted) {
        set({ banner: { kind: 'warn', message: '먼저 클라우드 전송 안내에 동의해야 합니다.' } })
        return
      }

      // 통역에는 음성 인식과 번역 두 제공자의 키가 모두 필요하다.
      const missing = ([settings.sttProvider, settings.translationProvider] as ProviderId[])
        .filter((id, i, arr) => arr.indexOf(id) === i)
        .filter((id) => !credentials[id]?.hasKey)

      if (missing.length > 0) {
        set({
          banner: {
            kind: 'warn',
            message: `${missing.map((id) => PROVIDER_LABELS[id]).join(', ')} API Key가 없습니다.`,
            hint: '설정에서 API Key를 입력하세요.'
          },
          settingsOpen: true
        })
        return
      }

      try {
        await ensureSession(mode)
        await engine.start(mode, settings, captureCallbacks)
        set({ status: 'capturing', banner: null })
      } catch (err) {
        const message = (err as Error).message || '오디오 캡처를 시작할 수 없습니다.'
        const denied = /Permission denied|NotAllowedError/i.test(message)
        set({
          status: 'error',
          banner: {
            kind: 'error',
            message: denied ? '오디오 캡처 권한이 거부되었습니다.' : message,
            hint: denied
              ? mode === 'online'
                ? '시스템 오디오 공유 요청을 허용해야 합니다. 다시 시도하세요.'
                : 'Windows 설정 > 개인 정보 및 보안 > 마이크에서 앱 접근을 허용하세요.'
              : undefined
          }
        })
      }
    },

    async pause() {
      engine.flush()
      await engine.stop()
      set({ status: 'paused', level: 0, speaking: false })
    },

    async resume() {
      try {
        await engine.start(get().mode, get().settings, captureCallbacks)
        set({ status: 'capturing', banner: null })
      } catch (err) {
        set({ status: 'error', banner: { kind: 'error', message: (err as Error).message } })
      }
    },

    async stop() {
      await finishSession()
    },

    /**
     * 통역 종료 → 회의록 작성.
     *
     * 캡처를 먼저 완전히 멈춘 뒤 요약을 시작한다. 캡처가 돌아가는 동안 요약하면
     * 요약 중에 들어온 발화가 회의록에 빠진다.
     */
    async stopAndSummarize() {
      const { session, entries, endedAt, mode } = await finishSession()

      const usable = usableEntries(entries)
      if (usable.length === 0) {
        set({
          banner: {
            kind: 'info',
            message: '통역된 대화가 없어 회의록을 만들지 않았습니다.'
          }
        })
        return
      }

      const { credential, settings } = get()
      if (!credential?.hasKey) {
        set({
          banner: {
            kind: 'warn',
            message: `${PROVIDER_LABELS[settings.translationProvider]} API Key가 없어 회의록을 만들 수 없습니다.`,
            hint: '설정에서 API Key를 입력하세요.'
          },
          settingsOpen: true
        })
        return
      }

      const { text, truncated } = buildTranscript(entries)

      set({
        minutesBusy: true,
        banner: { kind: 'info', message: '회의록을 작성하고 있습니다… 잠시 기다려 주세요.' }
      })

      try {
        const result = await window.talkflow.minutes.generate({
          sessionId: session?.sessionId ?? '',
          transcript: text,
          truncated,
          meta: {
            startedAt: session?.startedAt ?? usable[0].timestamp,
            endedAt,
            mode,
            entryCount: usable.length
          }
        })

        if (!result.ok) {
          set({ banner: bannerFromError(result.error) })
          return
        }

        set({
          banner: result.value.savedPath
            ? {
                kind: 'info',
                message: '회의록을 작성해 별도 창에 열었습니다.',
                hint: `저장 위치: ${result.value.savedPath}`
              }
            : {
                kind: 'warn',
                message: '회의록을 작성했지만 자동 저장에 실패했습니다.',
                hint: '회의록 창에서 "다른 이름으로 저장"을 눌러 직접 저장하세요.'
              }
        })
      } finally {
        set({ minutesBusy: false })
      }
    },

    async submitText(raw) {
      const text = raw.trim()
      if (!text) return
      if (text.length > MAX_INPUT_CHARS) {
        set({
          banner: { kind: 'warn', message: `입력은 최대 ${MAX_INPUT_CHARS}자까지 가능합니다.` }
        })
        return
      }

      const { entries, settings, credential, mode } = get()
      if (!settings.consent.accepted || !credential?.hasKey) {
        set({
          banner: {
            kind: 'warn',
            message: 'API Key와 클라우드 전송 동의가 필요합니다.',
            hint: '설정에서 확인하세요.'
          },
          settingsOpen: true
        })
        return
      }

      // 직전 항목과 동일한 문장의 중복 전송을 막는다.
      const last = [...entries].reverse().find((e) => e.direction === 'outgoing')
      if (last && last.sourceText === text && last.status !== 'error') {
        set({ banner: { kind: 'info', message: '직전과 동일한 문장입니다.' } })
        return
      }

      await ensureSession(mode)

      const detected = detectLanguage(text)
      // 입력창은 한국어 전용이지만, 영어를 붙여넣는 경우도 자연스럽게 처리한다.
      const from: Lang = detected.language === 'en' ? 'en' : 'ko'
      const id = newId()
      const startedAt = Date.now()

      set((s) => ({
        entries: [
          ...s.entries,
          {
            id,
            timestamp: nowIso(),
            direction: 'outgoing',
            source: 'text',
            sourceLanguage: from,
            targetLanguage: from === 'ko' ? 'en' : 'ko',
            sourceText: text,
            status: 'translating'
          }
        ],
        banner: null
      }))

      await runTranslation(id, text, from, from === 'ko' ? 'en' : 'ko', startedAt)
    },

    async retryEntry(id) {
      const entry = get().entries.find((e) => e.id === id)
      if (!entry || !entry.sourceText) return
      const from = entry.sourceLanguage === 'ko' ? 'ko' : 'en'
      await runTranslation(id, entry.sourceText, from, from === 'ko' ? 'en' : 'ko', Date.now())
    },

    async reclassify(id, direction) {
      const entry = get().entries.find((e) => e.id === id)
      if (!entry || !entry.sourceText) return
      // 방향을 바꾸면 번역 언어쌍도 반대가 된다.
      const from: Lang = direction === 'incoming' ? 'en' : 'ko'
      updateEntry(id, { direction, needsReview: false, translatedText: undefined })
      await runTranslation(id, entry.sourceText, from, from === 'en' ? 'ko' : 'en', Date.now())
    },

    dismissBanner() {
      set({ banner: null })
    },

    setBanner(banner) {
      set({ banner })
    },

    openSettings(open) {
      set({ settingsOpen: open })
    },

    async refreshSessions() {
      set({ sessionList: await window.talkflow.session.list() })
    }
  }
})

/**
 * 설정에 단가가 입력된 경우에만 추정 비용을 계산한다.
 * STT와 번역이 서로 다른 제공자일 수 있으므로 각각의 단가 표를 사용한다.
 */
export function estimateCostUsd(usage: SessionUsage, settings: Settings): number | null {
  const stt = settings.pricing[settings.sttProvider]
  const mt = settings.pricing[settings.translationProvider]
  if (!stt || !mt) return null
  if (!stt.sttPerMinuteUsd && !mt.inputPer1MUsd && !mt.outputPer1MUsd) return null
  return (
    (usage.audioSeconds / 60) * stt.sttPerMinuteUsd +
    (usage.inputTokens / 1_000_000) * mt.inputPer1MUsd +
    (usage.outputTokens / 1_000_000) * mt.outputPer1MUsd
  )
}

export function averageLatencyMs(latencies: number[]): number | null {
  if (latencies.length === 0) return null
  return latencies.reduce((a, b) => a + b, 0) / latencies.length
}
