import { useEffect } from 'react'
import { useStore } from '../store'

export function BannerBar(): React.JSX.Element | null {
  const banner = useStore((s) => s.banner)
  const dismiss = useStore((s) => s.dismissBanner)
  const openSettings = useStore((s) => s.openSettings)

  // 안내성 메시지는 스스로 사라진다. 오류는 사용자가 닫아야 한다.
  useEffect(() => {
    if (banner?.kind !== 'info') return
    const timer = setTimeout(dismiss, 3000)
    return () => clearTimeout(timer)
  }, [banner, dismiss])

  if (!banner) return null

  return (
    <div className={`banner banner--${banner.kind}`} role="alert">
      <div className="banner__body">
        <strong>{banner.message}</strong>
        {banner.hint && <span className="banner__hint">{banner.hint}</span>}
      </div>
      <div className="banner__actions">
        {banner.kind !== 'info' && (
          <button type="button" className="btn btn--tiny" onClick={() => openSettings(true)}>
            설정
          </button>
        )}
        <button type="button" className="btn btn--tiny btn--ghost" onClick={dismiss}>
          닫기
        </button>
      </div>
    </div>
  )
}
