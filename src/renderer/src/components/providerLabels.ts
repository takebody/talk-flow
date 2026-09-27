import type { ProviderId } from '@shared/types'

export { PROVIDER_LABELS, STT_PROVIDER_IDS } from '@shared/defaults'

/** 표시 순서 */
export const PROVIDER_ORDER: ProviderId[] = ['openai', 'gemini', 'anthropic']

/** 좁은 폭(상태 바·푸터)에서 쓰는 짧은 이름 */
export const PROVIDER_SHORT: Record<ProviderId, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  anthropic: 'Claude'
}

export const PROVIDER_KEY_HINT: Record<ProviderId, string> = {
  openai: 'platform.openai.com에서 발급한 sk- 로 시작하는 키',
  gemini: 'Google AI Studio에서 발급한 AIza… 로 시작하는 키',
  anthropic: 'console.anthropic.com에서 발급한 sk-ant- 로 시작하는 키'
}

/** Claude는 오디오 입력을 지원하지 않아 음성 인식에 쓸 수 없다. */
export const PROVIDER_NO_STT_REASON: Partial<Record<ProviderId, string>> = {
  anthropic: 'Claude API는 오디오 입력을 지원하지 않아 음성 인식에 사용할 수 없습니다. 번역만 담당합니다.'
}
