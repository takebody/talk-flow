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
  const renameParticipant = useStore((s) => s.renameParticipant)
  const setBanner = useStore((s) => s.setBanner)
  const incoming = entry.direction === 'incoming'

  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')

  const speakerName = entry.speakerName || (incoming ? '상대방' : '나')
  const speakerClass = incoming
    ? `entry--speaker-${(entry.colorIndex ?? 0) % 8}`
    : 'entry--out'

  const handleStartRename = () => {
    if (!entry.speakerId) return
    setNameInput(speakerName)
    setEditingName(true)
  }

  const handleSaveRename = () => {
    if (entry.speakerId && nameInput.trim()) {
      renameParticipant(entry.speakerId, nameInput.trim())
    }
    setEditingName(false)
  }

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveRename()
    else if (e.key === 'Escape') setEditingName(false)
  }

  const copy = async (text: string) => {
    await window.talkflow.app.copyToClipboard(text)
    setBanner({ kind: 'info', message: '클립보드에 복사했습니다.' })
  }

  const vp = entry.voiceProfile
  const voiceDetailTooltip = vp
    ? [
        vp.gender ? `성별: ${vp.gender === 'female' ? '여성' : vp.gender === 'male' ? '남성' : '알 수 없음'}` : null,
        vp.tone ? `톤/피치: ${vp.tone}${vp.pitchHz ? ` (${vp.pitchHz}Hz)` : ''}` : null,
        vp.accent ? `억양: ${vp.accent}` : null,
        vp.pronunciation ? `발음: ${vp.pronunciation}` : null
      ]
        .filter(Boolean)
        .join(' | ')
    : ''

  return (
    <article className={`entry ${incoming ? 'entry--in' : 'entry--out'} ${speakerClass}`}>
      <div className="entry__head">
        {editingName ? (
          <input
            type="text"
            className="speaker-name-input"
            value={nameInput}
            autoFocus
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={handleSaveRename}
            onKeyDown={handleNameKeyDown}
          />
        ) : (
          <button
            type="button"
            className="speaker-badge"
            onClick={handleStartRename}
            title={entry.speakerId ? '클릭하여 참석자 이름 변경' : undefined}
          >
            <span className="speaker-badge__dot" aria-hidden="true" />
            <span className="entry__who">{speakerName}</span>
          </button>
        )}

        {vp?.summary && (
          <span className="voice-tag" title={voiceDetailTooltip}>
            🎙️ {vp.summary}
          </span>
        )}

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
  const participants = useStore((s) => s.participants)
  const selectedSpeakerId = useStore((s) => s.selectedSpeakerId)
  const setSelectedSpeakerId = useStore((s) => s.setSelectedSpeakerId)
  const mode = useStore((s) => s.mode)
  const status = useStore((s) => s.status)
  const languagePair = useStore((s) => s.settings.languagePair)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const lastCount = useRef(entries.length)

  const partnerLabel = languagePair === 'ja-ko' ? '일본어' : '영어'

  // 특정 참석자 필터링이 활성화된 경우
  const visibleEntries = selectedSpeakerId
    ? entries.filter((e) => e.speakerId === selectedSpeakerId)
    : entries

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
    } else if (visibleEntries.length > lastCount.current) {
      setUnseen((n) => n + (visibleEntries.length - lastCount.current))
    }
    lastCount.current = visibleEntries.length
  }, [visibleEntries, pinned])

  useEffect(() => {
    if (visibleEntries.length === 0) {
      setPinned(true)
      setUnseen(0)
    }
  }, [visibleEntries.length])

  const jumpToLatest = () => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setPinned(true)
    setUnseen(0)
  }

  return (
    <div className="conversation">
      {participants.length > 0 && (
        <div className="participants-bar" role="toolbar" aria-label="회의 참석자 필터">
          <span className="participants-bar__label">참석자:</span>
          <button
            type="button"
            className={`participant-chip ${selectedSpeakerId === null ? 'is-active' : ''}`}
            onClick={() => setSelectedSpeakerId(null)}
          >
            전체 ({entries.length})
          </button>
          {participants.map((p) => {
            const isMe = p.id === 'me'
            const colorClass = isMe ? 'chip--me' : `chip--speaker-${(p.colorIndex ?? 0) % 8}`
            return (
              <button
                key={p.id}
                type="button"
                className={`participant-chip ${colorClass} ${selectedSpeakerId === p.id ? 'is-active' : ''}`}
                onClick={() => setSelectedSpeakerId(selectedSpeakerId === p.id ? null : p.id)}
                title={`${p.name}: ${p.summary || '목소리 특성 분석됨'} (클릭 시 이 참석자의 발화만 필터링)`}
              >
                <span className="participant-chip__dot" aria-hidden="true" />
                <span className="participant-chip__name">{p.name}</span>
                {p.summary && <span className="participant-chip__summary">· {p.summary}</span>}
                <span className="participant-chip__count">{p.utteranceCount}</span>
              </button>
            )
          })}
        </div>
      )}

      <div
        className="conversation__scroll"
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="대화 기록"
      >
        {visibleEntries.length === 0 ? (
          <div className="empty">
            <p className="empty__title">
              {status === 'capturing'
                ? selectedSpeakerId
                  ? '해당 참석자의 발화가 없습니다.'
                  : '음성을 기다리고 있습니다.'
                : '아직 대화가 없습니다.'}
            </p>
            <p className="empty__hint">
              {mode === 'online'
                ? `Webex 또는 Teams 회의에 참여한 뒤 통역 시작을 누르세요. 상대방의 ${partnerLabel} 발화가 ${partnerLabel} 원문과 한국어 번역으로 표시됩니다.`
                : `통역 시작을 누르면 마이크로 들어오는 한국어·${partnerLabel} 발화를 자동으로 구분해 서로 반대 언어로 번역합니다.`}
            </p>
            <p className="empty__hint">
              목소리 톤(고저·중저음), 억양, 발음 특성 및 성별에 따라 각 회의 참석자별로 색상이 구분되어 표시됩니다.
            </p>
          </div>
        ) : (
          visibleEntries.map((entry) => <EntryCard key={entry.id} entry={entry} />)
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
