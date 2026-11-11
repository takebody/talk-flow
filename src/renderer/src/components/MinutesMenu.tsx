import { useEffect, useMemo, useRef, useState } from 'react'
import type { SavedMinutesMeta } from '@shared/types'
import { useStore } from '../store'
import { ModeLabel } from './icons'
import { isStaleBridge } from './ErrorBoundary'

/**
 * 저장된 회의록 메뉴 (상태 바의 📄 버튼, Ctrl+Shift+M).
 *
 * 회의가 끝난 뒤 닫아 버린 회의록 창을 다시 열 수 있게 한다.
 * 항목을 고르면 회의록 창이 그 회의록으로 열린다(이미 열려 있으면 내용이 바뀐다).
 */

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `오늘 ${time}`
  return `${d.toLocaleDateString('ko-KR', {
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short'
  })} ${time}`
}

export function MinutesMenu(): React.JSX.Element {
  const open = useStore((s) => s.minutesMenuOpen)
  const setOpen = useStore((s) => s.openMinutesMenu)
  const minutesBusy = useStore((s) => s.minutesBusy)
  const [items, setItems] = useState<SavedMinutesMeta[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // 열 때마다 새로 읽는다. 방금 끝난 회의의 회의록도 바로 보여야 한다.
  useEffect(() => {
    if (!open) return
    setError(null)
    setQuery('')
    setItems(null)
    let alive = true
    // 동기 예외(예: 재시작 전의 예전 preload에 list가 없음)도 같은 경로로 처리한다.
    Promise.resolve()
      .then(() => window.talkflow.minutes.list())
      .then((list) => {
        if (alive) setItems(list)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setItems([])
        setError(
          isStaleBridge(err)
            ? '앱이 업데이트되었지만 아직 다시 시작되지 않았습니다. 앱을 완전히 종료한 뒤 다시 실행하세요.'
            : `회의록 목록을 불러오지 못했습니다: ${(err as Error)?.message ?? err}`
        )
      })
    return () => {
      alive = false
    }
  }, [open, minutesBusy])

  // 검색창은 목록이 길 때만 나타난다. 나타나면 바로 입력할 수 있게 한다.
  useEffect(() => {
    if (open && items && items.length > 5) searchRef.current?.focus()
  }, [open, items])

  // 바깥 클릭·Esc로 닫는다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  const filtered = useMemo(() => {
    if (!items) return null
    const q = query.trim().toLowerCase()
    return q ? items.filter((m) => m.title.toLowerCase().includes(q)) : items
  }, [items, query])

  const openOne = async (id: string) => {
    setOpening(id)
    setError(null)
    try {
      const result = await window.talkflow.minutes.openSaved(id)
      if (result.ok) setOpen(false)
      else setError(result.message ?? '회의록을 열지 못했습니다.')
    } catch (err) {
      setError(`회의록을 열지 못했습니다: ${(err as Error)?.message ?? err}`)
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="minmenu" ref={rootRef}>
      <button
        type="button"
        className={`btn btn--icon ${open ? 'is-active' : ''}`}
        onClick={() => setOpen(!open)}
        title="저장된 회의록 (Ctrl+Shift+M)"
        aria-label="저장된 회의록"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        📄
      </button>

      {open && (
        <div className="minmenu__panel" role="dialog" aria-label="저장된 회의록">
          <div className="minmenu__head">
            <strong>저장된 회의록</strong>
            {items && !error && <span className="muted">{items.length}건</span>}
          </div>

          {items && items.length > 5 && (
            <input
              ref={searchRef}
              type="search"
              className="input minmenu__search"
              placeholder="제목으로 찾기"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}

          {error && <p className="result is-bad minmenu__error">{error}</p>}

          <div className="minmenu__body">
            {filtered === null ? (
              <p className="minmenu__empty">
                <span className="spinner spinner--inline" aria-hidden="true" /> 불러오는 중…
              </p>
            ) : error && items && items.length === 0 ? null : items && items.length === 0 ? (
              <p className="minmenu__empty">
                저장된 회의록이 없습니다.
                <br />
                <span className="muted">통역을 종료하면 회의록이 자동으로 저장됩니다.</span>
              </p>
            ) : filtered.length === 0 ? (
              <p className="minmenu__empty">‘{query}’와 일치하는 회의록이 없습니다.</p>
            ) : (
              <ul className="minmenu__list">
                {filtered.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="minmenu__item"
                      onClick={() => void openOne(m.id)}
                      disabled={opening !== null}
                      title={m.path ?? undefined}
                    >
                      <span className="minmenu__title">
                        {m.title}
                        {opening === m.id && (
                          <span className="spinner spinner--inline" aria-hidden="true" />
                        )}
                      </span>
                      <span className="minmenu__meta">
                        <span>{formatDate(m.startedAt)}</span>
                        {m.mode && <ModeLabel mode={m.mode} short />}
                        {!!m.entryCount && <span>발화 {m.entryCount}건</span>}
                        {m.source === 'txt' && (
                          <span
                            className="minmenu__badge"
                            title="텍스트 파일에서 다시 읽어 온 회의록입니다."
                          >
                            텍스트
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="minmenu__foot">
            <button
              type="button"
              className="btn btn--ghost btn--tiny"
              onClick={() => void window.talkflow.minutes.openFolder()}
            >
              저장 폴더 열기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
