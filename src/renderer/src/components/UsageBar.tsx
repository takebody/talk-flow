import type { ProviderId, SttProviderId } from '@shared/types'
import { averageLatencyMs, estimateCostUsd, useStore } from '../store'
import { PROVIDER_ORDER, PROVIDER_SHORT, STT_PROVIDER_IDS } from './providerLabels'

/** 사용량·반응시간 미터 (FR-10) + 제공자 전환. 단가가 없으면 금액을 표시하지 않는다. */
export function UsageBar(): React.JSX.Element {
  const usage = useStore((s) => s.usage)
  const latencies = useStore((s) => s.latencies)
  const settings = useStore((s) => s.settings)
  const session = useStore((s) => s.session)
  const credentials = useStore((s) => s.credentials)
  const switchProvider = useStore((s) => s.switchProvider)
  const switchSttProvider = useStore((s) => s.switchSttProvider)

  const cost = estimateCostUsd(usage, settings)
  const avg = averageLatencyMs(latencies)
  const worst = latencies.length > 0 ? Math.max(...latencies) : null
  const sttReady = credentials[settings.sttProvider]?.hasKey ?? false
  const mtReady = credentials[settings.translationProvider]?.hasKey ?? false

  return (
    <footer className="usagebar" aria-label="세션 사용량">
      <span title="캡처된 오디오 시간">🎙 {(usage.audioSeconds / 60).toFixed(1)}분</span>
      <span className="sep" aria-hidden="true">·</span>
      <span title="STT 요청 / 번역 요청">
        STT {usage.sttRequests} · 번역 {usage.translateRequests}
      </span>
      <span className="sep" aria-hidden="true">·</span>
      <span title="발화 종료 → 번역 표시까지의 최근 10건 평균 / 최대">
        지연 {avg !== null ? `${(avg / 1000).toFixed(1)}s` : '—'}
        {worst !== null && ` (최대 ${(worst / 1000).toFixed(1)}s)`}
      </span>
      {cost !== null && (
        <>
          <span className="sep" aria-hidden="true">·</span>
          <span title="설정에 입력한 단가로 계산한 추정값입니다.">약 ${cost.toFixed(3)} (추정)</span>
        </>
      )}

      <span className="usagebar__spacer" />

      {/*
        제공자 전환. 키는 제공자별로 보관되므로 바꿔도 다른 키가 지워지지 않는다.
        STT(오디오 지원 제공자만) → 번역(전체) 순으로 표시한다.
      */}
      <label className="provswitch" title="음성 인식 제공자">
        <span className="sr-only">음성 인식 제공자</span>
        <span className={`provswitch__dot ${sttReady ? 'is-ok' : 'is-warn'}`} aria-hidden="true" />
        <select
          className="provswitch__select"
          value={settings.sttProvider}
          onChange={(e) => void switchSttProvider(e.target.value as SttProviderId)}
        >
          {STT_PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {PROVIDER_SHORT[id]}
              {credentials[id]?.hasKey ? '' : ' (키 없음)'}
            </option>
          ))}
        </select>
      </label>

      <span className="provswitch__arrow" aria-hidden="true">→</span>

      <label className="provswitch" title="번역 제공자">
        <span className="sr-only">번역 제공자</span>
        <span className={`provswitch__dot ${mtReady ? 'is-ok' : 'is-warn'}`} aria-hidden="true" />
        <select
          className="provswitch__select"
          value={settings.translationProvider}
          onChange={(e) => void switchProvider(e.target.value as ProviderId)}
        >
          {PROVIDER_ORDER.map((id) => (
            <option key={id} value={id}>
              {PROVIDER_SHORT[id]}
              {credentials[id]?.hasKey ? '' : ' (키 없음)'}
            </option>
          ))}
        </select>
      </label>

      {session && (
        <span className="muted" title={`세션 ID ${session.sessionId}`}>
          · 진행 중
        </span>
      )}
    </footer>
  )
}
