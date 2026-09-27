import type { ProviderId } from './types'

export interface KeyCheck {
  /** false면 저장을 막는다 (명백한 오입력) */
  ok: boolean
  error?: string
  /** 저장은 허용하되 사용자에게 알린다 (사내 게이트웨이 등 예외 형식 대응) */
  warning?: string
}

const EXPECTED_PREFIX: Partial<Record<ProviderId, { prefix: string; label: string }>> = {
  openai: { prefix: 'sk-', label: 'sk-' },
  gemini: { prefix: 'AIza', label: 'AIza' }
}

/**
 * API Key 형식 검사.
 *
 * 실제 인증은 서버만 판정할 수 있으므로, 여기서는 "누가 봐도 키가 아닌 값"만 막는다.
 * (예: 셸 명령어나 URL을 실수로 붙여넣는 경우)
 */
export function validateApiKey(provider: ProviderId, raw: string): KeyCheck {
  const key = raw.trim()

  if (key.length === 0) return { ok: false, error: 'API Key를 입력하세요.' }

  if (/\s/.test(key)) {
    return {
      ok: false,
      error: 'API Key에 공백이나 줄바꿈이 있습니다. 명령어나 문장을 붙여넣지 않았는지 확인하세요.'
    }
  }

  if (/^https?:\/\//i.test(key)) {
    return { ok: false, error: 'URL이 입력되었습니다. 엔드포인트가 아니라 API Key를 입력하세요.' }
  }

  if (key.length < 16) {
    return { ok: false, error: `API Key가 너무 짧습니다 (${key.length}자).` }
  }

  const expected = EXPECTED_PREFIX[provider]
  if (expected && !key.startsWith(expected.prefix)) {
    return {
      ok: true,
      warning: `보통 ${expected.label} 로 시작하는 키입니다. 사내 게이트웨이를 쓰신다면 그대로 저장해도 됩니다.`
    }
  }

  return { ok: true }
}
