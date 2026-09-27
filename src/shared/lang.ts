import type { DetectedLang } from './types'

const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/g
const LATIN = /[A-Za-z]/g

/**
 * 한국어/영어 판정.
 *
 * 제공자별 STT 응답이 언어 필드를 일관되게 주지 않으므로 문자 체계로 직접 판정한다.
 * 한글과 라틴 문자는 코드 포인트가 겹치지 않아 두 언어 구분에는 이 방식이 가장 안정적이다.
 */
export function detectLanguage(text: string): { language: DetectedLang; confidence: number } {
  const hangul = (text.match(HANGUL) ?? []).length
  const latin = (text.match(LATIN) ?? []).length
  const total = hangul + latin

  if (total < 2) return { language: 'unknown', confidence: 0 }

  // 한글은 음절 단위라 같은 내용에서 라틴 문자보다 개수가 적게 나온다. 가중치로 보정한다.
  const hangulWeighted = hangul * 2.2
  const weightedTotal = hangulWeighted + latin
  const koRatio = hangulWeighted / weightedTotal

  if (koRatio >= 0.65) return { language: 'ko', confidence: Math.min(1, koRatio) }
  if (koRatio <= 0.2) return { language: 'en', confidence: Math.min(1, 1 - koRatio) }
  return { language: 'unknown', confidence: 1 - Math.abs(0.5 - koRatio) * 2 }
}

/** STT가 자주 만들어내는 무의미한 결과를 걸러낸다. */
const NOISE_PHRASES = [
  'thank you for watching',
  'thanks for watching',
  'subscribe',
  '자막 제공',
  '시청해 주셔서 감사합니다',
  'please subscribe',
  '[music]',
  '[silence]',
  '[blank_audio]',
  '(음악)',
  'you'
]

export function isNoiseTranscript(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (t.length === 0) return true
  // 문자·숫자가 하나도 없으면 (예: "...", "♪") 버린다.
  if (!/[\p{L}\p{N}]/u.test(t)) return true
  const stripped = t.replace(/[\s.,!?…"'`~-]/g, '')
  if (stripped.length <= 1) return true
  return NOISE_PHRASES.includes(t.replace(/[.!?]+$/, ''))
}
