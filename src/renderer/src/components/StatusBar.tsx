import type { LanguagePair } from '@shared/types'
import { LANGUAGE_PAIRS } from '@shared/defaults'
import { useStore } from '../store'
import { LevelMeter } from './LevelMeter'

type StatusView = { label: string; tone: 'idle' | 'live' | 'busy' | 'warn' | 'error' }

function statusView(
  status: string,
  busy: number,
  hasKey: boolean,
  speaking: boolean,
  minutesBusy: boolean
): StatusView {
  // 회의록 작성은 통역이 끝난 뒤에도 수십 초 이어진다. 가장 먼저 알려야 한다.
  if (minutesBusy) return { label: '회의록 작성 중', tone: 'busy' }
  if (status === 'error') return { label: '오류', tone: 'error' }
  if (!hasKey) return { label: '키 미설정', tone: 'warn' }
  if (status === 'paused') return { label: '일시정지', tone: 'warn' }
  if (status === 'capturing') {
    if (busy > 0) return { label: '처리 중', tone: 'busy' }
    if (speaking) return { label: '발화 감지', tone: 'live' }
    return { label: '캡처 중', tone: 'live' }
  }
  if (busy > 0) return { label: '처리 중', tone: 'busy' }
  return { label: '준비', tone: 'idle' }
}

export function StatusBar(): React.JSX.Element {
  const status = useStore((s) => s.status)
  const busy = useStore((s) => s.busyCount)
  const speaking = useStore((s) => s.speaking)
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const setLanguagePair = useStore((s) => s.setLanguagePair)
  const start = useStore((s) => s.start)
  const pause = useStore((s) => s.pause)
  const resume = useStore((s) => s.resume)
  const stopAndSummarize = useStore((s) => s.stopAndSummarize)
  const minutesBusy = useStore((s) => s.minutesBusy)
  const settings = useStore((s) => s.settings)
  const credential = useStore((s) => s.credential)
  const openSettings = useStore((s) => s.openSettings)
  const patchSettings = useStore((s) => s.patchSettings)

  const view = statusView(status, busy, !!credential?.hasKey, speaking, minutesBusy)
  const running = status === 'capturing'

  const toggleAlwaysOnTop = async () => {
    const next = !settings.display.alwaysOnTop
    await window.talkflow.window.setAlwaysOnTop(next)
    await patchSettings({ display: { ...settings.display, alwaysOnTop: next } })
  }

  return (
    <header className="statusbar">
      <div className="statusbar__row">
        {/*
          LG 워드마크는 텍스트로만 표현한다. 공식 로고 심볼 이미지는 사내 브랜드
          자산으로 교체해야 하며, 임의로 만들어 넣지 않는다.
        */}
        <span className="brand" aria-label="LG전자 Talk-Flow">
          <span className="brand__wordmark">LG</span>
          {!settings.display.compact && <span className="brand__product">Talk-Flow</span>}
        </span>
        <span className="brand__divider" aria-hidden="true" />

        <span className={`chip chip--${view.tone}`}>
          <span className="chip__dot" aria-hidden="true" />
          {view.label}
        </span>

        <div className="statusbar__spacer" />

        {!running && status !== 'paused' && !minutesBusy && (
          <button type="button" className="btn btn--primary" onClick={() => void start()}>
            통역 시작
          </button>
        )}
        {running && (
          <button type="button" className="btn" onClick={() => void pause()}>
            일시정지
          </button>
        )}
        {status === 'paused' && (
          <button type="button" className="btn btn--primary" onClick={() => void resume()}>
            재개
          </button>
        )}
        {/*
          회의록 작성이 끝날 때까지 버튼을 남겨 둔다. 상태가 idle로 바뀌면서
          버튼이 사라지면 사용자는 무엇이 진행 중인지 알 수 없다.
        */}
        {(running || status === 'paused' || minutesBusy) && (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={minutesBusy}
            onClick={() => void stopAndSummarize()}
            title="통역을 끝내고 회의록을 작성합니다."
          >
            {minutesBusy ? (
              <>
                <span className="spinner spinner--inline" aria-hidden="true" />
                회의록 작성 중…
              </>
            ) : (
              '통역 종료'
            )}
          </button>
        )}

        <button
          type="button"
          className={`btn btn--icon ${settings.display.alwaysOnTop ? 'is-active' : ''}`}
          onClick={() => void toggleAlwaysOnTop()}
          title="항상 위 (Ctrl+Shift+T)"
          aria-pressed={settings.display.alwaysOnTop}
        >
          📌
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => openSettings(true)}
          title="설정 (Ctrl+,)"
        >
          ⚙
        </button>
      </div>

      {/* 모드 선택은 2행으로 내렸다. 1행에 다 넣으면 480px 기본 폭에서 넘친다. */}
      <div className="statusbar__row statusbar__row--meta">
        <select
          className="select select--compact"
          value={mode}
          disabled={running}
          onChange={(e) => setMode(e.target.value as 'online' | 'offline')}
          aria-label="통역 모드"
          title={running ? '통역 중에는 모드를 변경할 수 없습니다.' : '통역 모드'}
        >
          <option value="online">온라인 회의</option>
          <option value="offline">오프라인 회의</option>
        </select>

        <select
          className="select select--compact"
          value={settings.languagePair ?? 'en-ko'}
          disabled={running}
          onChange={(e) => void setLanguagePair(e.target.value as LanguagePair)}
          aria-label="회의 언어"
          title={running ? '통역 중에는 회의 언어를 변경할 수 없습니다.' : '회의 언어'}
        >
          {LANGUAGE_PAIRS.map((lp) => (
            <option key={lp.id} value={lp.id}>
              {lp.label}
            </option>
          ))}
        </select>

        <LevelMeter />

        <span className="muted">
          {mode === 'online'
            ? '시스템 오디오 전체 캡처 (알림음 포함)'
            : settings.audio.micLabel || '기본 마이크'}
        </span>
      </div>
    </header>
  )
}
