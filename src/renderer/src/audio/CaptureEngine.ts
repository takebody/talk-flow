import type { CaptureMode, Settings, VadSensitivity, VoiceProfile } from '@shared/types'
import {
  CAPTURE_SAMPLE_RATE,
  VAD_ABSOLUTE_FLOOR,
  VAD_FRAME_MS,
  VAD_MIN_UTTERANCE_MS,
  VAD_MULTIPLIER,
  VAD_ONSET_FRAMES,
  VAD_PREROLL_MS
} from '@shared/defaults'
import { encodeWav } from './wav'
import { WORKLET_PROCESSOR_NAME, workletModuleUrl } from './worklet'
import { analyzeVoiceFromAudio } from './voiceAnalyzer'

export interface Utterance {
  wav: Uint8Array
  durationMs: number
  /** 발화가 끝난 시각 (지연 계산 기준점) */
  endedAt: number
  acousticProfile?: VoiceProfile
}

export interface CaptureCallbacks {
  onUtterance(utterance: Utterance): void
  /** 0..1 정규화 레벨과 현재 발화 중 여부 */
  onLevel(level: number, speaking: boolean): void
  onError(message: string, fatal: boolean): void
  /** 스트림이 외부 요인(장치 분리 등)으로 끊겼을 때 */
  onStreamEnded(): void
}

const PREROLL_FRAMES = Math.round(VAD_PREROLL_MS / VAD_FRAME_MS)

/**
 * VAD 상태 머신.
 *
 * 적응형 노이즈 플로어(무음 구간의 EMA)를 기준으로 발화 시작/종료를 판정한다.
 * 발화 시작 직전 프리롤 프레임을 함께 담아 어두(語頭) 잘림을 막는다.
 */
class VadEngine {
  private noiseFloor = VAD_ABSOLUTE_FLOOR
  private onsetCount = 0
  private silenceMs = 0
  private speaking = false
  private preroll: Float32Array[] = []
  private collected: Float32Array[] = []
  private collectedSamples = 0

  constructor(
    private sensitivity: VadSensitivity,
    private endSilenceMs: number,
    private maxUtteranceMs: number,
    private emit: (samples: Float32Array) => void
  ) {}

  get isSpeaking(): boolean {
    return this.speaking
  }

  /** 레벨 미터용: 현재 임계값 기준으로 0..1 정규화한 값 */
  normalize(rms: number): number {
    const ceiling = Math.max(this.threshold() * 4, 0.08)
    return Math.min(1, rms / ceiling)
  }

  private threshold(): number {
    return Math.max(this.noiseFloor * VAD_MULTIPLIER[this.sensitivity], VAD_ABSOLUTE_FLOOR)
  }

  push(rms: number, samples: Float32Array): void {
    const threshold = this.threshold()

    if (!this.speaking) {
      // 무음 구간에서만 노이즈 플로어를 갱신한다.
      this.noiseFloor = this.noiseFloor * 0.97 + rms * 0.03
      if (this.noiseFloor < 0.0004) this.noiseFloor = 0.0004

      this.preroll.push(samples)
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift()

      if (rms > threshold) {
        this.onsetCount++
        if (this.onsetCount >= VAD_ONSET_FRAMES) {
          this.speaking = true
          this.silenceMs = 0
          this.collected = [...this.preroll]
          this.collectedSamples = this.collected.reduce((n, f) => n + f.length, 0)
          this.preroll = []
        }
      } else {
        this.onsetCount = 0
      }
      return
    }

    this.collected.push(samples)
    this.collectedSamples += samples.length

    // 종료 판정은 시작보다 낮은 임계를 써서 문장 중간의 짧은 약음에 끊기지 않게 한다.
    if (rms < threshold * 0.6) {
      this.silenceMs += VAD_FRAME_MS
    } else {
      this.silenceMs = 0
    }

    const durationMs = (this.collectedSamples / CAPTURE_SAMPLE_RATE) * 1000
    if (this.silenceMs >= this.endSilenceMs || durationMs >= this.maxUtteranceMs) {
      this.finish()
    }
  }

  finish(): void {
    if (!this.speaking) return
    this.speaking = false
    this.onsetCount = 0
    this.silenceMs = 0

    const total = this.collectedSamples
    const chunks = this.collected
    this.collected = []
    this.collectedSamples = 0

    const durationMs = (total / CAPTURE_SAMPLE_RATE) * 1000
    if (durationMs < VAD_MIN_UTTERANCE_MS) return

    const merged = new Float32Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    this.emit(merged)
  }
}

export class CaptureEngine {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private vad: VadEngine | null = null
  private running = false
  private levelThrottle = 0

  get isRunning(): boolean {
    return this.running
  }

  async start(mode: CaptureMode, settings: Settings, callbacks: CaptureCallbacks): Promise<void> {
    if (this.running) await this.stop()

    this.stream = await this.acquireStream(mode, settings)

    // AudioContext를 16kHz로 만들면 Chromium이 리샘플링을 처리하므로
    // 별도 다운샘플링 코드가 필요 없다.
    this.context = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE, latencyHint: 'interactive' })
    await this.context.audioWorklet.addModule(workletModuleUrl())

    this.source = this.context.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.context, WORKLET_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0
    })

    this.vad = new VadEngine(
      settings.audio.vadSensitivity,
      settings.audio.silenceMs,
      settings.audio.maxUtteranceMs,
      (samples) => {
        const acousticProfile = analyzeVoiceFromAudio(samples, CAPTURE_SAMPLE_RATE)
        callbacks.onUtterance({
          wav: encodeWav(samples, CAPTURE_SAMPLE_RATE),
          durationMs: (samples.length / CAPTURE_SAMPLE_RATE) * 1000,
          endedAt: Date.now(),
          acousticProfile
        })
      }
    )

    this.node.port.onmessage = (event: MessageEvent<{ rms: number; samples: Float32Array }>) => {
      const { rms, samples } = event.data
      const vad = this.vad
      if (!vad) return
      vad.push(rms, samples)

      // 레벨 미터는 60ms마다만 갱신해 리렌더 부담을 줄인다.
      this.levelThrottle += VAD_FRAME_MS
      if (this.levelThrottle >= 60) {
        this.levelThrottle = 0
        callbacks.onLevel(vad.normalize(rms), vad.isSpeaking)
      }
    }

    this.source.connect(this.node)

    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (this.running) callbacks.onStreamEnded()
      })
    }

    this.running = true
  }

  private async acquireStream(mode: CaptureMode, settings: Settings): Promise<MediaStream> {
    if (mode === 'online') {
      // Main 프로세스의 setDisplayMediaRequestHandler가 audio:'loopback'을 지정한다.
      // Chromium이 비디오 소스를 요구하므로 받은 비디오 트랙은 즉시 정리한다.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
      for (const track of stream.getVideoTracks()) {
        track.stop()
        stream.removeTrack(track)
      }
      if (stream.getAudioTracks().length === 0) {
        throw new Error(
          '시스템 오디오 트랙을 얻지 못했습니다. Windows 오디오 드라이버 문제일 수 있습니다. 오프라인(마이크) 모드를 사용해 보세요.'
        )
      }
      return stream
    }

    const audio: MediaTrackConstraints = {
      echoCancellation: settings.audio.echoCancellation,
      noiseSuppression: settings.audio.noiseSuppression,
      autoGainControl: settings.audio.autoGainControl
    }
    if (settings.audio.micDeviceId) {
      // exact를 쓰면 장치가 사라졌을 때 다른 장치가 임의로 선택되지 않는다(FR-02).
      audio.deviceId = { exact: settings.audio.micDeviceId }
    }
    return navigator.mediaDevices.getUserMedia({ audio, video: false })
  }

  /** 진행 중인 발화를 즉시 확정한다(일시정지/종료 시 마지막 문장을 잃지 않도록). */
  flush(): void {
    this.vad?.finish()
  }

  async stop(): Promise<void> {
    this.running = false
    this.vad?.finish()
    this.vad = null

    if (this.node) {
      this.node.port.onmessage = null
      this.node.disconnect()
      this.node = null
    }
    this.source?.disconnect()
    this.source = null

    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null

    if (this.context && this.context.state !== 'closed') {
      await this.context.close().catch(() => undefined)
    }
    this.context = null
  }
}

/**
 * 진단용 고정 길이 샘플 캡처.
 *
 * VAD를 거치지 않고 지정한 시간만큼 그대로 녹음해 WAV로 돌려준다.
 * 설정 화면의 "캡처 테스트"와 "실인식 테스트"에서 사용한다.
 */
export async function captureSample(
  mode: CaptureMode,
  settings: Settings,
  durationMs: number,
  onLevel?: (level: number) => void
): Promise<{ wav: Uint8Array; durationMs: number; peak: number }> {
  const probe = new CaptureEngine()
  const chunks: Float32Array[] = []
  let total = 0
  let peak = 0

  // 내부 acquireStream/워크릿 구성을 재사용하되, 콜백에서 프레임을 직접 모은다.
  await probe.start(mode, settings, {
    onUtterance: () => undefined,
    onLevel: (level) => onLevel?.(level),
    onError: () => undefined,
    onStreamEnded: () => undefined
  })

  const node = (probe as unknown as { node: AudioWorkletNode | null }).node
  if (!node) {
    await probe.stop()
    throw new Error('오디오 처리 노드를 만들 수 없습니다.')
  }

  node.port.onmessage = (event: MessageEvent<{ rms: number; samples: Float32Array }>) => {
    chunks.push(event.data.samples)
    total += event.data.samples.length
    if (event.data.rms > peak) peak = event.data.rms
    onLevel?.(Math.min(1, event.data.rms / 0.08))
  }

  await new Promise((resolve) => setTimeout(resolve, durationMs))
  await probe.stop()

  const merged = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  return {
    wav: encodeWav(merged, CAPTURE_SAMPLE_RATE),
    durationMs: (total / CAPTURE_SAMPLE_RATE) * 1000,
    peak
  }
}

/** 마이크 목록. 권한이 없으면 label이 비어 오므로 한 번 권한을 얻은 뒤 다시 조회한다. */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  let devices = await navigator.mediaDevices.enumerateDevices()
  const inputs = devices.filter((d) => d.kind === 'audioinput')
  if (inputs.length > 0 && inputs.every((d) => !d.label)) {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of probe.getTracks()) track.stop()
    devices = await navigator.mediaDevices.enumerateDevices()
  }
  return devices.filter((d) => d.kind === 'audioinput')
}
