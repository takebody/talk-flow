import type { SpeakerGender, VoiceProfile } from '@shared/types'

/**
 * 오디오 신호의 기본 주파수(F0, Pitch)와 스펙트럼 특성을 분석하여
 * 화자의 성별, 톤, 억양/발음 특성의 기초 데이터를 추출합니다.
 */

/** 자기상관(Autocorrelation) 기법을 이용한 기본 주파수(F0) 추정 */
export function estimatePitch(samples: Float32Array, sampleRate: number): number | null {
  // 계산 효율을 위해 최대 4096개 샘플만 분석
  const maxSamples = Math.min(samples.length, 4096)
  if (maxSamples < 512) return null

  const minFreq = 65 // 최저 남성 기본 주파수 (Hz)
  const maxFreq = 420 // 최고 여성/어린이 기본 주파수 (Hz)

  const minPeriod = Math.floor(sampleRate / maxFreq)
  const maxPeriod = Math.floor(sampleRate / minFreq)

  let bestPeriod = -1
  let bestCorrelation = 0

  // 정규화 전 기본 에너지 계산
  let energy0 = 0
  for (let i = 0; i < maxSamples; i++) {
    energy0 += samples[i] * samples[i]
  }
  if (energy0 < 0.001) return null // 무음 구간

  for (let period = minPeriod; period <= maxPeriod; period++) {
    let corr = 0
    let energy1 = 0
    for (let i = 0; i < maxSamples - period; i++) {
      corr += samples[i] * samples[i + period]
      energy1 += samples[i + period] * samples[i + period]
    }
    const norm = Math.sqrt(energy0 * energy1)
    const normalizedCorr = norm > 0 ? corr / norm : 0

    if (normalizedCorr > bestCorrelation) {
      bestCorrelation = normalizedCorr
      bestPeriod = period
    }
  }

  // 자기상관 계수가 0.35 이상일 때 유효한 피치로 판정
  if (bestCorrelation > 0.35 && bestPeriod > 0) {
    return Math.round(sampleRate / bestPeriod)
  }
  return null
}

/** 스펙트럼 밝기(Centroid) 측정: 톤의 고저 및 선명도 */
export function estimateBrightness(samples: Float32Array): number {
  let zeroCrossings = 0
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] >= 0 && samples[i] < 0) || (samples[i - 1] < 0 && samples[i] >= 0)) {
      zeroCrossings++
    }
  }
  return zeroCrossings / samples.length
}

/**
 * 오디오 샘플로부터 음향 특성 기반 VoiceProfile 생성
 */
export function analyzeVoiceFromAudio(samples: Float32Array, sampleRate: number): VoiceProfile {
  const pitchHz = estimatePitch(samples, sampleRate)
  const brightness = estimateBrightness(samples)

  let gender: SpeakerGender = 'unknown'
  let tone = '안정된 중음'
  let summary = '중음의 음성'

  if (pitchHz !== null) {
    if (pitchHz < 165) {
      gender = 'male'
      if (pitchHz < 120) {
        tone = '묵직한 저음'
        summary = '남성 · 저음'
      } else {
        tone = '차분한 중저음'
        summary = '남성 · 중저음'
      }
    } else {
      gender = 'female'
      if (pitchHz > 230) {
        tone = '밝고 높은 고음'
        summary = '여성 · 고음'
      } else {
        tone = '맑고 경쾌한 중고음'
        summary = '여성 · 중고음'
      }
    }
  } else {
    // 피치 검출 불가 시 영교차율 기반 보정
    if (brightness > 0.12) {
      tone = '선명하고 또렷한 톤'
      summary = '선명한 톤'
    } else {
      tone = '부드러운 중음'
      summary = '부드러운 음조'
    }
  }

  const pronunciation = brightness > 0.1 ? '정확하고 또렷한 발음' : '부드러운 연음'

  return {
    gender,
    tone,
    accent: '자연스러운 억양',
    pronunciation,
    summary,
    pitchHz: pitchHz ?? undefined
  }
}
