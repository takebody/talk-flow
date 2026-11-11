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
    if (event.key !== 'Enter') return
    // 한글 IME 조합 중의 Enter는 글자 확정용이므로 건드리지 않는다.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return

    // Ctrl+Enter(또는 Shift+Enter)는 줄바꿈, Enter는 번역
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      const area = event.currentTarget
      const start = area.selectionStart
      const end = area.selectionEnd
      const next = `${text.slice(0, start)}\n${text.slice(end)}`
      setText(next)
      requestAnimationFrame(() => {
        area.selectionStart = area.selectionEnd = start + 1
      })
      return
    }
    if (event.shiftKey) return // 기본 동작(줄바꿈)

    event.preventDefault()
    if (text.length <= MAX_INPUT_CHARS) void send()
  }

  const over = text.length > MAX_INPUT_CHARS

  return (
    <div className="compose">
      <textarea
        ref={areaRef}
        className="compose__input"
        placeholder="한국어를 입력하세요 — Enter 로 번역, Ctrl+Enter 로 줄바꿈"
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
