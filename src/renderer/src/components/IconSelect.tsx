import { useEffect, useId, useRef, useState } from 'react'

/**
 * 아이콘을 담을 수 있는 드롭다운.
 *
 * 기본 <select>의 <option>은 텍스트만 표시할 수 있어 SVG 아이콘·국기를 넣을 수 없다.
 * 키보드(↑↓ Home End Enter Space Esc)와 스크린 리더(listbox) 동작은 <select>와 맞춘다.
 */

export interface IconSelectOption<T extends string> {
  value: T
  /** 펼친 목록에 표시할 내용 */
  label: React.ReactNode
  /** 닫힌 상태(버튼)에 표시할 내용. 없으면 label을 쓴다. */
  selectedLabel?: React.ReactNode
}

export function IconSelect<T extends string>({
  value,
  options,
  onChange,
  disabled,
  compact,
  ariaLabel,
  title
}: {
  value: T
  options: IconSelectOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  compact?: boolean
  ariaLabel: string
  title?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listId = useId()

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  )
  const selected = options[selectedIndex]

  // 바깥을 누르거나 창이 포커스를 잃으면 닫는다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onBlur = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const openList = () => {
    setActive(selectedIndex)
    setOpen(true)
  }

  const choose = (index: number) => {
    const option = options[index]
    setOpen(false)
    buttonRef.current?.focus()
    if (option && option.value !== value) onChange(option.value)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    const last = options.length - 1
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        if (!open) {
          // 닫힌 상태의 화살표는 <select>처럼 바로 값을 바꾼다.
          const next = Math.min(last, Math.max(0, selectedIndex + step))
          if (next !== selectedIndex) onChange(options[next].value)
        } else {
          setActive((i) => Math.min(last, Math.max(0, i + step)))
        }
        break
      }
      case 'Home':
      case 'End':
        if (open) {
          e.preventDefault()
          setActive(e.key === 'Home' ? 0 : last)
        }
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (open) choose(active)
        else openList()
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
        }
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  return (
    <div
      ref={rootRef}
      className={`iselect ${compact ? 'iselect--compact' : ''} ${open ? 'is-open' : ''}`}
    >
      <button
        ref={buttonRef}
        type="button"
        className="iselect__button"
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="iselect__value">{selected?.selectedLabel ?? selected?.label}</span>
        <svg className="iselect__chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open && (
        <ul id={listId} className="iselect__list" role="listbox" aria-label={ariaLabel}>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`iselect__option ${i === active ? 'is-active' : ''} ${
                o.value === value ? 'is-selected' : ''
              }`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
