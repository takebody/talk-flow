import { CAPTURE_SAMPLE_RATE, VAD_FRAME_MS } from '@shared/defaults'

const FRAME_SAMPLES = (CAPTURE_SAMPLE_RATE * VAD_FRAME_MS) / 1000 // 320 samples @ 16kHz

/**
 * AudioWorklet 프로세서 소스.
 *
 * 별도 파일을 번들·배포 경로에서 찾아야 하는 문제를 피하려고 Blob URL로 등록한다.
 * 프로세서는 20ms 프레임을 모아 RMS와 샘플을 메인 스레드로 넘기고,
 * VAD 상태 머신은 메인 스레드(VadEngine)에서 돌린다.
 */
const PROCESSOR_SOURCE = `
class TalkFlowVadProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.frameSize = ${FRAME_SAMPLES}
    this.frame = new Float32Array(this.frameSize)
    this.filled = 0
  }

  process(inputs) {
    const input = inputs[0]
    const channel = input && input[0]
    if (!channel) return true

    for (let i = 0; i < channel.length; i++) {
      this.frame[this.filled++] = channel[i]
      if (this.filled === this.frameSize) {
        let sum = 0
        for (let j = 0; j < this.frameSize; j++) sum += this.frame[j] * this.frame[j]
        const copy = this.frame.slice(0)
        this.port.postMessage({ rms: Math.sqrt(sum / this.frameSize), samples: copy }, [copy.buffer])
        this.filled = 0
      }
    }
    return true
  }
}
registerProcessor('talkflow-vad', TalkFlowVadProcessor)
`

let cachedUrl: string | null = null

export function workletModuleUrl(): string {
  if (!cachedUrl) {
    cachedUrl = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: 'text/javascript' }))
  }
  return cachedUrl
}

export const WORKLET_PROCESSOR_NAME = 'talkflow-vad'
export const WORKLET_FRAME_SAMPLES = FRAME_SAMPLES
