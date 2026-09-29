import { useEffect, useState } from 'react'
import type { Minutes, Settings } from '@shared/types'
import { renderMinutesAsText } from '@shared/minutes'
import { PROVIDER_LABELS } from '@shared/defaults'

/**
 * 회의록 전용 창.
 *
 * 본체와 같은 번들을 `?view=minutes`로 열어 렌더링한다. 스토어를 공유하지 않고
 * Main에서 회의록을 직접 읽어 온다 — 창마다 별도의 렌더러 프로세스이므로
 * 본체의 zustand 상태는 여기에 존재하지 않는다.
 */

const MODE_LABEL = { online: '온라인 회의', offline: '오프라인 회의' } as const

function Section({ title, items }: { title: string; items: string[] }): React.JSX.Element {
  return (
    <section className="minutes__section">
      <h2 className="minutes__heading">{title}</h2>
      {items.length === 0 ? (
        <p className="minutes__empty">해당 내용이 없습니다.</p>
      ) : (
        <ul className="minutes__list">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function MinutesWindow(): React.JSX.Element {
  const [minutes, setMinutes] = useState<Minutes | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    // index.html의 <title>이 창 제목을 덮어쓰므로 여기서 다시 지정한다.
    document.title = '회의록'

    void (async () => {
      // 테마와 글자 크기는 본체 설정을 그대로 따른다.
      const settings: Settings = await window.talkflow.settings.get()
      const root = document.documentElement
      const theme =
        settings.display.theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : settings.display.theme
      root.dataset.theme = theme
      root.dataset.fontScale = String(settings.display.fontScale)

      setMinutes(await window.talkflow.minutes.current())
      setLoading(false)
    })()
  }, [])

  // 알림은 잠깐만 보여 준다.
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const onSaveAs = async () => {
    const result = await window.talkflow.minutes.saveAs()
    if (result.ok && result.path) setToast(`저장했습니다: ${result.path}`)
    else if (!result.canceled) setToast(`저장하지 못했습니다: ${result.message ?? '알 수 없는 오류'}`)
  }

  const onCopy = async () => {
    if (!minutes) return
    await window.talkflow.app.copyToClipboard(renderMinutesAsText(minutes))
    setToast('회의록 전문을 클립보드에 복사했습니다.')
  }

  if (loading) {
    return (
      <div className="boot">
        <span className="spinner" aria-hidden="true" />
        <p>회의록을 불러오고 있습니다…</p>
      </div>
    )
  }

  if (!minutes) {
    return (
      <div className="boot">
        <p>표시할 회의록이 없습니다.</p>
        <p className="muted">통역을 종료하면 회의록이 이 창에 표시됩니다.</p>
      </div>
    )
  }

  const started = new Date(minutes.startedAt)
  const ended = minutes.endedAt ? new Date(minutes.endedAt) : null
  const elapsed = ended ? Math.round((ended.getTime() - started.getTime()) / 60_000) : null

  return (
    <div className="minutes">
      <header className="minutes__head">
        <div>
          <p className="minutes__eyebrow">Talk-Flow 회의록</p>
          <h1 className="minutes__title">{minutes.title}</h1>
        </div>
        <div className="minutes__actions">
          <button type="button" className="btn" onClick={() => void onCopy()}>
            전문 복사
          </button>
          <button type="button" className="btn" onClick={() => void onSaveAs()}>
            다른 이름으로 저장
          </button>
          {minutes.savedPath && (
            <button
              type="button"
              className="btn"
              onClick={() => void window.talkflow.minutes.reveal()}
            >
              폴더 열기
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => window.close()}>
            닫기
          </button>
        </div>
      </header>

      <dl className="minutes__meta">
        <div>
          <dt>일시</dt>
          <dd>{started.toLocaleString('ko-KR')}</dd>
        </div>
        {elapsed !== null && (
          <div>
            <dt>소요 시간</dt>
            <dd>약 {elapsed}분</dd>
          </div>
        )}
        <div>
          <dt>형태</dt>
          <dd>{MODE_LABEL[minutes.mode]}</dd>
        </div>
        <div>
          <dt>발화 수</dt>
          <dd>{minutes.entryCount}건</dd>
        </div>
      </dl>

      {minutes.savedPath && (
        <p className="minutes__saved">
          자동 저장됨 · <code>{minutes.savedPath}</code>
        </p>
      )}

      {minutes.truncated && (
        <p className="minutes__notice">
          대화가 길어 중간 일부를 생략한 채 요약했습니다. 중요한 구간은 대화 기록 내보내기로
          원본을 확인하세요.
        </p>
      )}

      <div className="minutes__body">
        <section className="minutes__section">
          <h2 className="minutes__heading">요약</h2>
          <p className="minutes__summary">{minutes.summary}</p>
        </section>

        <Section title="주요 논의" items={minutes.keyPoints} />
        <Section title="결정 사항" items={minutes.decisions} />

        <section className="minutes__section">
          <h2 className="minutes__heading">액션 아이템</h2>
          {minutes.actionItems.length === 0 ? (
            <p className="minutes__empty">해당 내용이 없습니다.</p>
          ) : (
            <ul className="minutes__list minutes__list--actions">
              {minutes.actionItems.map((item, i) => (
                <li key={i}>
                  <span>{item.task}</span>
                  {(item.owner || item.due) && (
                    <span className="minutes__tags">
                      {item.owner && <span className="minutes__tag">담당 {item.owner}</span>}
                      {item.due && <span className="minutes__tag">기한 {item.due}</span>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Section title="후속 확인 필요" items={minutes.followUps} />
      </div>

      <footer className="minutes__foot">
        <span>
          {new Date(minutes.generatedAt).toLocaleString('ko-KR')} 생성 ·{' '}
          {PROVIDER_LABELS[minutes.provider]} / {minutes.model}
        </span>
        <span>AI가 자동 생성한 초안입니다. 중요한 내용은 원본 대화록과 대조하세요.</span>
      </footer>

      {toast && (
        <div className="minutes__toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
