import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { MinutesWindow } from './components/MinutesWindow'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root 엘리먼트를 찾을 수 없습니다.')

/*
 * 회의록은 별도의 창에서 열리지만 렌더러 번들은 하나로 유지한다.
 * Main이 같은 index.html을 `?view=minutes`로 열고, 여기서 화면을 갈라 준다.
 */
const view = new URLSearchParams(window.location.search).get('view')

createRoot(container).render(
  <StrictMode>{view === 'minutes' ? <MinutesWindow /> : <App />}</StrictMode>
)
