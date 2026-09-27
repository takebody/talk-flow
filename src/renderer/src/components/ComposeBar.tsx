import { useRef, useState } from 'react'
import { MAX_INPUT_CHARS } from '@shared/defaults'
import { useStore } from '../store'

export function ComposeBar(): React.JSX.Element {
  const submitText = useStore((s) => s.submitText)
  const busy = useStore((s) => s.busyCount > 0)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const send = async () => {
    const value = text.trim()
    if (!value || sending) return
    setSending(true)
    setText('')
    try {
      await submitText(value)
    } finally {
      setSending(false)
      areaRef.current?.focus()
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter는 줄바꿈, Ctrl+Enter가 번역 (FR-12)
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void send()
    }
  }

  const over = text.length > MAX_INPUT_CHARS

  return (
    <div className="compose">
      <textarea
        ref={areaRef}
        className="compose__input"
        placeholder="한국어를 입력하세요 — Ctrl+Enter 로 영어 번역"
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="한국어 입력"
      />
      <div className="compose__side">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void send()}
          disabled={!text.trim() || over || sending}
        >
          번역
        </button>
        <span className={`compose__count ${over ? 'is-over' : ''}`}>
          {text.length}/{MAX_INPUT_CHARS}
        </span>
        {busy && <span className="compose__busy">처리 중…</span>}
      </div>
    </div>
  )
}
