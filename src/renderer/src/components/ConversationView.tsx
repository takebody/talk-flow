import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConversationEntry } from '@shared/types'
import { useStore } from '../store'

const pad = (n: number) => String(n).padStart(2, '0')

function timeOf(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function EntryCard({ entry }: { entry: ConversationEntry }): React.JSX.Element {
  const retryEntry = useStore((s) => s.retryEntry)
  const reclassify = useStore((s) => s.reclassify)
  const setBanner = useStore((s) => s.setBanner)
  const incoming = entry.direction === 'incoming'

  const copy = async (text: string) => {
    await window.talkflow.app.copyToClipboard(text)
    setBanner({ kind: 'info', message: '클립보드에 복사했습니다.' })
  }

  return (
    <article className={`entry ${incoming ? 'entry--in' : 'entry--out'}`}>
      <div className="entry__head">
        <span className="entry__who">{incoming ? '상대방' : '나'}</span>
        <span className="entry__time">{timeOf(entry.timestamp)}</span>
        {entry.needsReview && (
          <span className="badge badge--warn" title="언어 자동 판정이 불확실합니다.">
            언어 미확정
          </span>
        )}
        {entry.status === 'transcribing' && <span className="badge">인식 중</span>}
        {entry.status === 'translating' && <span className="badge">번역 중</span>}
        {entry.status === 'error' && <span className="badge badge--error">오류</span>}
      </div>

      {entry.status === 'transcribing' ? (
        <p className="entry__placeholder">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          음성을 인식하고 있습니다…
        </p>
      ) : (
        <>
          <p className={`entry__source lang-${entry.sourceLanguage}`}>{entry.sourceText}</p>

          {entry.translatedText && (
            <div className="entry__translated">
              <p className={`lang-${entry.targetLanguage}`}>{entry.translatedText}</p>
              <button
                type="button"
                className="btn btn--tiny btn--ghost"
                onClick={() => void copy(entry.translatedText!)}
                title="번역문 복사"
              >
                복사
              </button>
            </div>
          )}

          {entry.status === 'translating' && (
            <p className="entry__placeholder entry__placeholder--sub">번역하는 중…</p>
          )}

          {entry.status === 'error' && (
            <div className="entry__error">
              <span>{entry.errorMessage ?? '처리에 실패했습니다.'}</span>
              {entry.sourceText && (
                <button
                  type="button"
                  className="btn btn--tiny"
                  onClick={() => void retryEntry(entry.id)}
                >
                  재시도
                </button>
              )}
            </div>
          )}

          {entry.needsReview && entry.status === 'final' && (
            <div className="entry__review">
              <span className="muted">방향이 잘못되었나요?</span>
              <button
                type="button"
                className="btn btn--tiny"
                onClick={() => void reclassify(entry.id, incoming ? 'outgoing' : 'incoming')}
              >
                {incoming ? '내 발화로 변경' : '상대 발화로 변경'}
              </button>
            </div>
          )}
        </>
      )}
    </article>
  )
}

export function ConversationView(): React.JSX.Element {
  const entries = useStore((s) => s.entries)
  const mode = useStore((s) => s.mode)
  const status = useStore((s) => s.status)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const lastCount = useRef(entries.length)

  // 사용자가 위로 스크롤해 이전 기록을 보는 동안에는 강제로 내리지 않는다 (FR-05).
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    setPinned(atBottom)
    if (atBottom) setUnseen(0)
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (pinned) {
      el.scrollTop = el.scrollHeight
    } else if (entries.length > lastCount.current) {
      setUnseen((n) => n + (entries.length - lastCount.current))
    }
    lastCount.current = entries.length
  }, [entries, pinned])

  useEffect(() => {
    if (entries.length === 0) {
      setPinned(true)
      setUnseen(0)
    }
  }, [entries.length])

  const jumpToLatest = () => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setPinned(true)
    setUnseen(0)
  }

  return (
    <div className="conversation">
      <div
        className="conversation__scroll"
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="대화 기록"
      >
        {entries.length === 0 ? (
          <div className="empty">
            <p className="empty__title">
              {status === 'capturing' ? '음성을 기다리고 있습니다.' : '아직 대화가 없습니다.'}
            </p>
            <p className="empty__hint">
              {mode === 'online'
                ? 'Webex 또는 Teams 회의에 참여한 뒤 통역 시작을 누르세요. 상대방의 영어 발화가 영어 원문과 한국어 번역으로 표시됩니다.'
                : '통역 시작을 누르면 마이크로 들어오는 한국어·영어 발화를 자동으로 구분해 서로 반대 언어로 번역합니다.'}
            </p>
            <p className="empty__hint">
              아래 입력창에 한국어를 적고 <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 를 누르면 영어 번역문이
              같은 대화 흐름에 표시됩니다.
            </p>
          </div>
        ) : (
          entries.map((entry) => <EntryCard key={entry.id} entry={entry} />)
        )}
      </div>

      {!pinned && unseen > 0 && (
        <button type="button" className="jump" onClick={jumpToLatest}>
          새 항목 {unseen}개 ↓
        </button>
      )}
    </div>
  )
}
