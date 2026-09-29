import type {
  ModelInfo,
  ProviderId,
  Result,
  SttProviderId,
  SummarizeRequest,
  SummarizeResponse,
  TranscribeRequest,
  TranscribeResponse,
  TranscribeTranslateResponse,
  TranslateRequest,
  TranslateResponse
} from '@shared/types'
import { PROVIDER_LABELS } from '@shared/defaults'
import { getApiKey, getSettings } from '../settings'
import { fail, Provider, ProviderContext } from './base'
import { openAiProvider } from './openai'
import { geminiProvider } from './gemini'
import { anthropicProvider } from './anthropic'

const registry: Record<ProviderId, Provider> = {
  openai: openAiProvider,
  gemini: geminiProvider,
  anthropic: anthropicProvider
}

export type TestTarget = 'stt' | 'translation'

/**
 * STT와 번역은 서로 다른 제공자를 쓸 수 있다.
 * (예: Claude는 오디오 입력을 지원하지 않으므로 STT는 Gemini, 번역은 Claude)
 */
function contextFor(role: TestTarget): Result<{ provider: Provider; ctx: ProviderContext }> {
  const settings = getSettings()
  const id: ProviderId = role === 'stt' ? settings.sttProvider : settings.translationProvider
  const provider = registry[id]

  if (role === 'stt' && !provider.supportsStt) {
    return {
      ok: false,
      error: fail(
        'NOT_CONFIGURED',
        `${PROVIDER_LABELS[id]}는 음성 인식을 지원하지 않습니다.`,
        '설정에서 음성 인식 제공자를 OpenAI 또는 Gemini로 지정하세요.'
      )
    }
  }

  const apiKey = getApiKey(id)
  if (!apiKey) {
    return {
      ok: false,
      error: fail(
        'NO_KEY',
        `${PROVIDER_LABELS[id]} API Key가 설정되지 않았습니다.`,
        `설정 화면에서 ${PROVIDER_LABELS[id]} API Key를 입력하세요.`
      )
    }
  }

  return { ok: true, value: { provider, ctx: { apiKey, settings } } }
}

/**
 * 429는 여기 넣지 않는다.
 *
 * 한도 초과를 지수 백오프로 3회 재시도하면 "한도를 넘긴 바로 그 순간"에 요청을
 * 4배로 늘려 상황을 악화시킨다. 429는 아래에서 별도로 처리한다.
 */
const RETRYABLE = new Set(['NETWORK', 'TIMEOUT'])
const BACKOFF_MS = [1000, 2000, 4000]

/** 429 재시도 대기 상한. 이보다 길게 기다리라고 하면 회의 흐름상 포기하는 게 낫다. */
const MAX_QUOTA_WAIT_MS = 20_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* --------------------------------------------------- 클라이언트 측 속도 제한 */

/**
 * 제공자별 요청 간격 제한.
 *
 * 발화 하나마다 STT 1회 + 번역 1회가 나가고, 동시 실행까지 겹치면 무료 등급의
 * 분당 한도를 쉽게 넘는다. 서버가 429를 주기 전에 이쪽에서 간격을 벌린다.
 */
const lastSentAt = new Map<ProviderId, number>()
/** 429를 받은 뒤 이 시각까지는 새 요청을 보내지 않는다. */
const cooldownUntil = new Map<ProviderId, number>()

async function acquireRateSlot(id: ProviderId, requestsPerMinute: number): Promise<void> {
  const minInterval = requestsPerMinute > 0 ? 60_000 / requestsPerMinute : 0

  const cooldown = cooldownUntil.get(id) ?? 0
  const now = Date.now()
  if (cooldown > now) await sleep(cooldown - now)

  const last = lastSentAt.get(id) ?? 0
  const wait = last + minInterval - Date.now()
  if (wait > 0) await sleep(wait)

  lastSentAt.set(id, Date.now())
}

export function quotaCooldownRemainingMs(id: ProviderId): number {
  return Math.max(0, (cooldownUntil.get(id) ?? 0) - Date.now())
}

/**
 * 일시적 오류에만 지수 백오프로 재시도한다.
 * 429는 서버가 알려준 대기 시간만큼 한 번만 기다린 뒤 재시도하고, 그 사이
 * 같은 제공자의 다른 요청도 함께 멈춘다(쿨다운).
 */
async function withRetry<T>(
  id: ProviderId,
  requestsPerMinute: number,
  run: () => Promise<Result<T>>
): Promise<Result<T>> {
  const attempt = async () => {
    await acquireRateSlot(id, requestsPerMinute)
    return run()
  }

  let last: Result<T> = await attempt()

  for (let i = 0; i < BACKOFF_MS.length; i++) {
    if (last.ok) return last

    if (last.error.code === 'QUOTA') {
      // 일일 한도는 기다려도 복구되지 않으므로 즉시 포기한다.
      if (last.error.quotaScope === 'day') return last

      const wait = Math.min(last.error.retryAfterMs ?? 5000, MAX_QUOTA_WAIT_MS)
      // 쿨다운을 걸어 이 제공자로 향하는 다른 요청도 함께 멈춘다.
      cooldownUntil.set(id, Date.now() + wait)
      await sleep(wait)
      const retried = await attempt()
      // 429 재시도는 1회로 제한한다.
      return retried
    }

    if (!RETRYABLE.has(last.error.code)) return last

    await sleep(BACKOFF_MS[i])
    last = await attempt()
  }

  return last
}

export async function transcribe(req: TranscribeRequest): Promise<Result<TranscribeResponse>> {
  const c = contextFor('stt')
  if (!c.ok) return c
  const settings = c.value.ctx.settings
  // EMPTY(무음)는 재시도해도 결과가 같으므로 그대로 반환된다.
  return withRetry(settings.sttProvider, settings.limits.requestsPerMinute, () =>
    c.value.provider.transcribe(req, c.value.ctx)
  )
}

/**
 * 발화 처리 진입점.
 *
 * 음성 인식·번역 제공자가 같고 그 제공자가 통합 호출을 지원하면 1회 요청으로
 * 전사와 번역을 함께 받는다. 그렇지 않으면 전사만 수행하고 번역은 렌더러가
 * 이어서 요청한다(원문을 먼저 보여주는 UX를 유지하기 위함).
 */
export async function transcribeTranslate(
  req: TranscribeRequest
): Promise<Result<TranscribeTranslateResponse>> {
  const settings = getSettings()
  const combinable =
    settings.limits.combineRequests &&
    settings.sttProvider === settings.translationProvider &&
    typeof registry[settings.sttProvider].transcribeAndTranslate === 'function'

  if (!combinable) {
    const result = await transcribe(req)
    if (!result.ok) return result
    return {
      ok: true,
      value: { ...result.value, translatedText: undefined, requests: 1 }
    }
  }

  const c = contextFor('stt')
  if (!c.ok) return c

  const combined = await withRetry(
    settings.sttProvider,
    settings.limits.requestsPerMinute,
    () => c.value.provider.transcribeAndTranslate!(req, c.value.ctx)
  )
  if (combined.ok) return combined

  // 통합 호출이 스키마/모델 문제로 실패하면 기존 2단계 경로로 폴백한다.
  if (combined.error.code === 'BAD_REQUEST' || combined.error.code === 'UNKNOWN') {
    console.warn('[providers] 통합 호출 실패, 2단계 경로로 폴백:', combined.error.code)
    const result = await transcribe(req)
    if (!result.ok) return result
    return { ok: true, value: { ...result.value, translatedText: undefined, requests: 2 } }
  }
  return combined
}

/* ------------------------------------------------------------- 번역 캐시 */

const translationCache = new Map<string, string>()
const CACHE_LIMIT = 500

/** 제공자를 바꾸면 번역 품질이 달라지므로 캐시 키에 제공자를 포함한다. */
const cacheKey = (req: TranslateRequest, id: ProviderId) => `${id}:${req.from}>${req.to}:${req.text}`

export async function translate(req: TranslateRequest): Promise<Result<TranslateResponse>> {
  const providerId = getSettings().translationProvider
  const key = cacheKey(req, providerId)
  const hit = translationCache.get(key)
  if (hit) return { ok: true, value: { text: hit, cached: true } }

  const c = contextFor('translation')
  if (!c.ok) return c

  const result = await withRetry(
    providerId,
    c.value.ctx.settings.limits.requestsPerMinute,
    () => c.value.provider.translate(req, c.value.ctx)
  )
  if (result.ok) {
    if (translationCache.size >= CACHE_LIMIT) {
      translationCache.delete(translationCache.keys().next().value as string)
    }
    translationCache.set(key, result.value.text)
  }
  return result
}

/**
 * 회의록 생성. 번역 제공자가 담당한다.
 *
 * 요청이 한 번뿐이고 대화 전체를 넣기 때문에 번역보다 훨씬 무겁다. 캐시는 두지
 * 않는다 — 같은 회의를 두 번 요약하는 일은 없고, 캐시해 두면 오히려 수정 후
 * 재생성이 막힌다.
 */
export async function summarize(req: SummarizeRequest): Promise<Result<SummarizeResponse>> {
  const c = contextFor('translation')
  if (!c.ok) return c
  const settings = c.value.ctx.settings
  return withRetry(settings.translationProvider, settings.limits.requestsPerMinute, () =>
    c.value.provider.summarize(req, c.value.ctx)
  )
}

/** 16kHz mono 무음 WAV. STT 모델명·엔드포인트를 실제 경로로 검증하는 데 쓴다. */
function silentWav(durationMs = 400): ArrayBuffer {
  const sampleRate = 16000
  const samples = Math.round((sampleRate * durationMs) / 1000)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples * 2, true)
  // 샘플은 0으로 두어 무음으로 만든다.
  return buffer
}

export async function testConnection(target: TestTarget): Promise<Result<string>> {
  const c = contextFor(target)
  if (!c.ok) return c

  if (target === 'stt') {
    // 채팅 경로로 테스트하면 STT 모델명 오류를 못 잡는다. 실제 전사 경로를 쓴다.
    const result = await c.value.provider.transcribe(
      { requestId: 'diag-stt', wav: silentWav(), durationMs: 400, languageHint: 'auto' },
      c.value.ctx
    )
    if (result.ok) {
      return { ok: true, value: `전사 경로 정상 (인식 결과: "${result.value.text}")` }
    }
    // 무음이므로 "인식된 음성 없음"은 정상 응답이다 — 모델과 인증이 모두 유효하다는 뜻.
    if (result.error.code === 'EMPTY') {
      return { ok: true, value: '전사 경로 정상 (무음 샘플이라 인식 결과 없음)' }
    }
    return result
  }

  return c.value.provider.testConnection(c.value.ctx)
}

export async function listModels(id: ProviderId): Promise<Result<ModelInfo[]>> {
  const apiKey = getApiKey(id)
  if (!apiKey) {
    return {
      ok: false,
      error: fail(
        'NO_KEY',
        `${PROVIDER_LABELS[id]} API Key가 없어 모델 목록을 조회할 수 없습니다.`,
        '먼저 API Key를 저장하세요.'
      )
    }
  }
  return registry[id].listModels({ apiKey, settings: getSettings() })
}

/** 해당 제공자가 STT를 지원하는지 (UI에서 선택 가능 여부 판단용) */
export function supportsStt(id: ProviderId): boolean {
  return registry[id].supportsStt
}

export type { SttProviderId }
