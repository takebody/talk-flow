import { net } from 'electron'
import type {
  AiError,
  AiErrorCode,
  ModelInfo,
  Result,
  Settings,
  TranscribeRequest,
  TranscribeResponse,
  TranscribeTranslateResponse,
  TranslateRequest,
  TranslateResponse
} from '@shared/types'
import { scrubSecrets } from '../settings'

/**
 * 모든 외부 HTTP 요청은 Electron의 `net.fetch`(Chromium 네트워크 스택)로 보낸다.
 *
 * Node의 전역 `fetch`(undici)는 Node가 내장한 CA 목록만 신뢰하므로, 사내 TLS 검사
 * 프록시가 있는 환경에서 SELF_SIGNED_CERT_IN_CHAIN 으로 실패한다. `net.fetch`는
 * Windows 인증서 저장소와 시스템 프록시 설정을 그대로 사용한다.
 */
export const httpFetch: typeof globalThis.fetch = (input, init) =>
  net.fetch(input as never, init as never) as unknown as Promise<Response>

export interface ProviderContext {
  apiKey: string
  settings: Settings
}

export interface Provider {
  readonly id: string
  /** 오디오 입력을 받아 전사할 수 있는지. Claude는 false. */
  readonly supportsStt: boolean
  transcribe(req: TranscribeRequest, ctx: ProviderContext): Promise<Result<TranscribeResponse>>
  /**
   * 전사와 번역을 한 번의 호출로 처리한다.
   * 오디오 입력과 구조화 출력을 함께 지원하는 제공자만 구현한다.
   */
  transcribeAndTranslate?(
    req: TranscribeRequest,
    ctx: ProviderContext
  ): Promise<Result<TranscribeTranslateResponse>>
  translate(req: TranslateRequest, ctx: ProviderContext): Promise<Result<TranslateResponse>>
  /** 최소 비용으로 인증/설정을 검증한다. */
  testConnection(ctx: ProviderContext): Promise<Result<string>>
  /** 이 키로 호출할 수 있는 모델 목록. 모델명 오입력을 사용자가 직접 고칠 수 있게 한다. */
  listModels(ctx: ProviderContext): Promise<Result<ModelInfo[]>>
}

/**
 * 404를 "어떤 모델이 없는지"까지 말해 주도록 보강한다.
 * 모델명 오타는 가장 흔한 설정 실수이고, 원래 메시지만으로는 어느 필드를 고칠지 알 수 없다.
 *
 * 제공자가 보낸 설명(`detail`)은 덮어쓰지 않는다. 모델명이 틀린 것인지,
 * 이 키로는 쓸 수 없는 모델인지는 그 설명에만 들어 있다.
 */
export function annotateModel<T>(result: Result<T>, model: string): Result<T> {
  if (result.ok || result.error.code !== 'NOT_FOUND') return result
  return {
    ok: false,
    error: {
      ...result.error,
      message: `모델 '${model}' 을(를) 찾을 수 없습니다.`,
      hint: '설정에서 모델명을 확인하세요. "모델 목록 조회"를 누르면 이 키로 쓸 수 있는 모델을 볼 수 있습니다.'
    }
  }
}

export const REQUEST_TIMEOUT_MS = 45_000

export function fail(code: AiErrorCode, message: string, hint?: string, status?: number): AiError {
  return { code, message: scrubSecrets(message), hint, status }
}

/**
 * 오류 응답 본문에서 제공자가 쓴 설명만 뽑아낸다.
 *
 * OpenAI·Gemini·Anthropic 모두 `{ "error": { "message": … } }` 형태를 쓴다.
 * JSON이 아니거나 형태가 다르면 본문 앞부분으로 대체한다.
 */
function providerDetail(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string }
    const err = parsed.error
    const message = typeof err === 'string' ? err : err?.message
    if (message && message.trim()) return scrubSecrets(message.trim()).slice(0, 400)
  } catch {
    // JSON이 아닌 오류 본문도 있다. 아래에서 원문 앞부분을 쓴다.
  }
  const trimmed = body.trim()
  return trimmed ? scrubSecrets(trimmed).slice(0, 400) : undefined
}

/**
 * 응답이 AI 서비스가 아니라 사내 웹 필터의 차단 페이지인지 판별한다.
 * 차단 페이지는 보통 HTML이며, 그대로 노출하면 사용자에게 아무 도움이 되지 않는다.
 */
function blockPageError(status: number, body: string, contentType?: string | null): AiError | null {
  const looksHtml = /text\/html/i.test(contentType ?? '') || /^\s*<(!doctype|html|script)/i.test(body)
  if (!looksHtml) return null
  return fail(
    'NETWORK',
    '사내 네트워크 정책으로 차단된 요청입니다.',
    'AI 서비스 대신 차단 페이지가 돌아왔습니다. 관리자에게 해당 API 도메인 허용을 요청하거나, 설정에서 사내망에서 허용된 다른 제공자를 선택하세요.',
    status
  )
}

/**
 * 429 응답에서 "무엇을 얼마나 초과했는지"를 뽑아낸다.
 *
 * 분당 한도(RPM)라면 몇 초만 기다리면 되지만, 일일 한도라면 기다려도 복구되지
 * 않는다. 둘을 구분하지 않으면 사용자는 무엇을 해야 할지 알 수 없고, 앱은
 * 무의미한 재시도로 한도를 더 소모한다.
 */
export function parseQuotaError(body: string, status = 429): AiError {
  let retryAfterMs: number | undefined
  let quotaScope: 'minute' | 'day' | 'unknown' = 'unknown'
  let quotaId = ''

  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: string
        details?: { '@type'?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[]
      }
    }
    for (const detail of parsed.error?.details ?? []) {
      // google.rpc.RetryInfo → "38s"
      if (detail.retryDelay) {
        const seconds = Number.parseFloat(String(detail.retryDelay).replace(/s$/, ''))
        if (Number.isFinite(seconds)) retryAfterMs = Math.round(seconds * 1000)
      }
      // google.rpc.QuotaFailure → violations[].quotaId
      for (const violation of detail.violations ?? []) {
        if (violation.quotaId) quotaId = violation.quotaId
      }
    }
  } catch {
    // 제공자에 따라 JSON이 아닐 수 있다. 아래 문자열 검사로 대체한다.
  }

  const haystack = `${quotaId} ${body}`
  if (/PerMinute|per minute|RPM/i.test(haystack)) quotaScope = 'minute'
  else if (/PerDay|per day|daily|RPD/i.test(haystack)) quotaScope = 'day'

  if (quotaScope === 'day') {
    return {
      code: 'QUOTA',
      status,
      quotaScope,
      message: '일일 요청 한도를 모두 소진했습니다.',
      hint: '기다려도 오늘은 복구되지 않습니다. 요금제를 올리거나 다른 제공자로 전환하세요.'
    }
  }

  const waitText = retryAfterMs ? ` 약 ${Math.ceil(retryAfterMs / 1000)}초 후 재시도합니다.` : ''
  return {
    code: 'QUOTA',
    status,
    quotaScope,
    retryAfterMs,
    message:
      quotaScope === 'minute'
        ? '분당 요청 한도를 초과했습니다.'
        : '요청 한도 또는 할당량을 초과했습니다.',
    hint: `설정 > AI 제공자에서 "분당 최대 요청 수"를 낮추거나 요금제를 확인하세요.${waitText}`
  }
}

/** 제공자별 HTTP 상태 코드를 공통 오류 모델로 정규화한다. */
export function normalizeHttpError(
  status: number,
  body: string,
  contentType?: string | null
): AiError {
  const blocked = blockPageError(status, body, contentType)
  if (blocked) return blocked

  const snippet = scrubSecrets(body).slice(0, 400)
  const detail = providerDetail(body)
  const withDetail = (error: AiError): AiError => (detail ? { ...error, detail } : error)

  if (status === 401 || status === 403) {
    return withDetail(
      fail('AUTH', 'API 인증에 실패했습니다.', 'API Key가 올바른지 설정에서 확인하세요.', status)
    )
  }
  if (status === 429) return withDetail(parseQuotaError(body, status))
  if (status === 404) {
    return withDetail(
      fail(
        'NOT_FOUND',
        '모델 또는 배포명을 찾을 수 없습니다.',
        '설정에서 해당 제공자의 모델명을 확인하세요.',
        status
      )
    )
  }
  if (status === 400 || status === 415 || status === 422) {
    return withDetail(fail('BAD_REQUEST', `요청이 거부되었습니다. (${snippet})`, undefined, status))
  }
  if (status >= 500) {
    return withDetail(
      fail('NETWORK', `AI 서비스 오류(${status})가 발생했습니다.`, '잠시 후 재시도합니다.', status)
    )
  }
  return withDetail(fail('UNKNOWN', `예상치 못한 응답(${status}): ${snippet}`, undefined, status))
}

interface ErrorLike {
  name?: string
  message?: string
  code?: string
  cause?: ErrorLike
}

/** 원인 체인을 펼쳐 실제 실패 지점을 찾는다. `fetch failed` 만 보고 끝나지 않도록. */
function flattenCauses(err: unknown): { names: string[]; codes: string[]; messages: string[] } {
  const names: string[] = []
  const codes: string[] = []
  const messages: string[] = []
  let cur = err as ErrorLike | undefined
  for (let depth = 0; cur && depth < 6; depth++) {
    if (cur.name) names.push(cur.name)
    if (cur.code) codes.push(cur.code)
    if (cur.message) messages.push(cur.message)
    cur = cur.cause
  }
  return { names, codes, messages }
}

const CERT_CODES = [
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
  'ERR_TLS_CERT_ALTNAME_INVALID'
]

const DNS_CODES = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT']

export function normalizeThrown(err: unknown): AiError {
  const { names, codes, messages } = flattenCauses(err)
  const all = [...codes, ...messages].join(' | ')

  if (names.includes('AbortError') || names.includes('TimeoutError') || /ERR_TIMED_OUT/.test(all)) {
    return fail('TIMEOUT', '응답 시간이 초과되었습니다.', '네트워크 상태를 확인하세요.')
  }

  // 사내 TLS 검사 프록시 환경에서 가장 흔한 실패.
  if (CERT_CODES.some((c) => all.includes(c)) || /ERR_CERT_/.test(all)) {
    return fail(
      'NETWORK',
      'TLS 인증서를 검증할 수 없습니다.',
      '사내 네트워크의 TLS 검사 프록시일 수 있습니다. 회사 루트 인증서가 Windows 인증서 저장소에 설치되어 있는지 확인하세요.'
    )
  }

  if (/ERR_PROXY|ERR_TUNNEL_CONNECTION_FAILED/.test(all)) {
    return fail('NETWORK', '프록시 연결에 실패했습니다.', 'Windows 프록시 설정을 확인하세요.')
  }

  if (/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_/.test(all)) {
    return fail('NETWORK', '네트워크에 연결할 수 없습니다.', '인터넷 연결과 프록시 설정을 확인하세요.')
  }

  if (DNS_CODES.some((c) => codes.includes(c))) {
    return fail('NETWORK', '네트워크에 연결할 수 없습니다.', '인터넷 연결과 프록시 설정을 확인하세요.')
  }

  // 원인 체인을 메시지에 남겨 진단 리포트에서 바로 확인할 수 있게 한다.
  return fail('NETWORK', `요청 실패: ${scrubSecrets(messages.join(' <= ') || String(err))}`)
}

export async function httpJson(
  url: string,
  init: RequestInit
): Promise<Result<{ status: number; json: unknown }>> {
  try {
    const res = await httpFetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    const text = await res.text()
    const contentType = res.headers.get('content-type')
    if (!res.ok) return { ok: false, error: normalizeHttpError(res.status, text, contentType) }
    try {
      return { ok: true, value: { status: res.status, json: JSON.parse(text) } }
    } catch {
      // 일부 필터는 차단 페이지를 200으로 돌려준다.
      const blocked = blockPageError(res.status, text, contentType)
      return { ok: false, error: blocked ?? fail('UNKNOWN', '응답을 해석할 수 없습니다.') }
    }
  } catch (err) {
    return { ok: false, error: normalizeThrown(err) }
  }
}

/* ------------------------------------------------------- 공통 번역 프롬프트 */

const LANG_NAME = { en: '영어', ko: '한국어' } as const

export function buildTranslationPrompt(req: TranslateRequest): { system: string; user: string } {
  const from = LANG_NAME[req.from]
  const to = LANG_NAME[req.to]

  const glossary =
    req.glossary && req.glossary.length > 0
      ? `\n\n다음 용어는 반드시 지정된 대로 번역하세요:\n${req.glossary
          .map((g) => `- ${g.term} → ${g.translation}`)
          .join('\n')}`
      : ''

  const system = [
    `당신은 비즈니스 화상회의 실시간 통역사입니다. ${from} 문장을 자연스러운 ${to}로 번역합니다.`,
    '규칙:',
    '1. 번역문만 출력하고 설명, 따옴표, 접두어를 붙이지 마세요.',
    '2. 회의에서 바로 쓸 수 있는 자연스러운 비즈니스 어투를 사용하세요.',
    '3. 고유명사, 제품명, 약어, 숫자, 단위는 원형을 유지하세요.',
    '4. 문장이 불완전하거나 잘려 있으면 추측해 채우지 말고 있는 그대로 번역하세요.',
    '5. 입력이 이미 목표 언어라면 그대로 반환하세요.',
    req.to === 'ko'
      ? '6. 한국어는 격식체(-습니다/-니다)를 기본으로 하세요.'
      : '6. 영어는 명확하고 간결한 문장으로 쓰세요.'
  ].join('\n')

  const context =
    req.context && req.context.length > 0
      ? `이전 대화 문맥(참고용, 번역 대상 아님):\n${req.context
          .map((c) => `${c.role === 'peer' ? '상대방' : '나'}: ${c.text}`)
          .join('\n')}\n\n`
      : ''

  return { system: system + glossary, user: `${context}번역할 ${from} 문장:\n${req.text}` }
}

export const STT_PROMPT_EN =
  'This is business meeting audio in English. Transcribe verbatim with correct punctuation.'
export const STT_PROMPT_AUTO =
  'This is business meeting audio containing Korean and/or English speech. Transcribe verbatim in the language actually spoken, with correct punctuation. Do not translate.'
