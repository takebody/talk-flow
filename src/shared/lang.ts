import type { DetectedLang, LanguagePair } from './types'

const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/g
const LATIN = /[A-Za-z]/g
const JAPANESE_KANA = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\uFF65-\uFF9Fー]/g
const CJK_KANJI = /[\u4E00-\u9FFF\u3400-\u4DBF]/g

/**
 * 한국어 / (영어 또는 일본어) 판정.
 *
 * 제공자별 STT 응답이 언어 필드를 일관되게 주지 않으므로 문자 체계로 직접 판정한다.
 * - 영어-한국어: 한글 vs 라틴 문자
 * - 일본어-한국어: 한글 vs 가나(히라가나/가타카나) + 한자
 */
export function detectLanguage(
  text: string,
  pair: LanguagePair = 'en-ko'
): { language: DetectedLang; confidence: number } {
  const hangul = (text.match(HANGUL) ?? []).length
  const kana = (text.match(JAPANESE_KANA) ?? []).length
  const kanji = (text.match(CJK_KANJI) ?? []).length
  const latin = (text.match(LATIN) ?? []).length

  if (pair === 'ja-ko') {
    // 일본어는 가나와 한자가 혼용된다. 현대 한국어 구어 STT에는 한자가 나오지 않는다.
    const jaScore = kana * 2.2 + kanji * 1.6
    const koScore = hangul * 2.0
    const total = jaScore + koScore

    if (total < 2) {
      if (latin >= 2) return { language: 'unknown', confidence: 0 }
      return { language: 'unknown', confidence: 0 }
    }

    const koRatio = koScore / total
    if (koRatio >= 0.65) return { language: 'ko', confidence: Math.min(1, koRatio) }
    if (koRatio <= 0.25) return { language: 'ja', confidence: Math.min(1, 1 - koRatio) }
    return { language: 'unknown', confidence: 1 - Math.abs(0.5 - koRatio) * 2 }
  }

  // 기본값: 영어-한국어 ('en-ko')
  // 텍스트에 가나가 뚜렷하게 포함되어 있다면 일본어로 판정
  if (kana >= 2 && hangul === 0) {
    return { language: 'ja', confidence: 0.95 }
  }

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
  'ご視聴ありがとうございました',
  'ご視聴ありがとう',
  'チャンネル登録よろしくお願いします',
  'チャンネル登録お願いします',
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
