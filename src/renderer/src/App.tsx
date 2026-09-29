import { useEffect } from 'react'
import { useStore } from './store'
import { StatusBar } from './components/StatusBar'
import { ConversationView } from './components/ConversationView'
import { ComposeBar } from './components/ComposeBar'
import { UsageBar } from './components/UsageBar'
import { ConsentGate } from './components/ConsentGate'
import { SettingsPanel } from './components/SettingsPanel'
import { BannerBar } from './components/BannerBar'

export function App(): React.JSX.Element {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const settings = useStore((s) => s.settings)
  const status = useStore((s) => s.status)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const openSettings = useStore((s) => s.openSettings)

  useEffect(() => {
    void init()
  }, [init])

  // 테마와 글자 크기를 document에 반영한다.
  useEffect(() => {
    const root = document.documentElement
    const theme =
      settings.display.theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : settings.display.theme
    root.dataset.theme = theme
    root.dataset.fontScale = String(settings.display.fontScale)
    root.dataset.compact = settings.display.compact ? 'true' : 'false'
  }, [settings.display.theme, settings.display.fontScale, settings.display.compact])

  // 단축키 (FR-12)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useStore.getState()
      if (event.ctrlKey && event.key === ',') {
        event.preventDefault()
        store.openSettings(!store.settingsOpen)
        return
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (store.status === 'capturing') void store.pause()
        else void store.start()
        return
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        const next = !store.settings.display.alwaysOnTop
        void window.talkflow.window.setAlwaysOnTop(next)
        void store.patchSettings({ display: { ...store.settings.display, alwaysOnTop: next } })
        return
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        const partnerLang = store.settings.languagePair === 'ja-ko' ? 'ja' : 'en'
        const partnerLabel = partnerLang === 'ja' ? '일본어' : '영어'
        const lastPartner = [...store.entries]
          .reverse()
          .find((e) => e.targetLanguage === partnerLang && e.translatedText)
        if (lastPartner?.translatedText) {
          void window.talkflow.app.copyToClipboard(lastPartner.translatedText)
          store.setBanner({ kind: 'info', message: `마지막 ${partnerLabel} 번역문을 복사했습니다.` })
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!ready) {
    return (
      <div className="boot">
        <span className="spinner" aria-hidden="true" />
        <p>Talk-Flow를 준비하고 있습니다…</p>
      </div>
    )
  }

  if (!settings.consent.accepted) {
    return <ConsentGate />
  }

  return (
    <div className="app">
      <StatusBar />
      <BannerBar />
      <ConversationView />
      <ComposeBar />
      <UsageBar />
      {settingsOpen && <SettingsPanel onClose={() => openSettings(false)} />}
      {status === 'capturing' && (
        <span className="sr-only" role="status">
          통역 캡처가 진행 중입니다.
        </span>
      )}
    </div>
  )
}
