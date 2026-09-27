import { BrowserWindow, app, session, shell } from 'electron'
import { join } from 'node:path'
import { getSettings, scrubSecrets, updateSettings } from './settings'
import { pruneOldSessions } from './sessions'
import { registerIpc } from './ipc'

// userData 경로(%APPDATA%/Talk-Flow)가 결정되기 전에 호출해야 한다.
app.setName('Talk-Flow')

let mainWindow: BrowserWindow | null = null

const isDev = !app.isPackaged

function createWindow(): void {
  const settings = getSettings()

  mainWindow = new BrowserWindow({
    width: settings.window.width,
    height: settings.window.height,
    x: settings.window.x,
    y: settings.window.y,
    minWidth: 320,
    minHeight: 480,
    show: false,
    backgroundColor: '#101216',
    title: 'Talk-Flow',
    alwaysOnTop: settings.display.alwaysOnTop,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 창 위치·크기를 저장해 다음 실행 시 복원한다.
  const persistBounds = () => {
    if (!mainWindow || mainWindow.isMinimized() || mainWindow.isMaximized()) return
    const b = mainWindow.getBounds()
    updateSettings({ window: { width: b.width, height: b.height, x: b.x, y: b.y } })
  }
  mainWindow.on('resized', persistBounds)
  mainWindow.on('moved', persistBounds)
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 렌더러 오류를 진단용으로 남긴다. 키가 섞이지 않도록 마스킹한다.
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${scrubSecrets(message)} (${sourceId}:${line})`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] 프로세스 종료:', details.reason, details.exitCode)
  })

  // 외부 링크는 앱 안에서 열지 않는다.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) event.preventDefault()
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * 오디오 캡처 권한 설정.
 *
 * - getDisplayMedia: audio:'loopback' 으로 시스템 오디오를 캡처한다.
 *   'loopbackWithMute'가 아니라 'loopback'을 쓰기 때문에 사용자의 스피커/헤드셋
 *   청취는 그대로 유지된다(FR-01).
 * - getUserMedia(마이크): 오프라인 모드용으로 'media' 권한만 허용한다.
 */
function configureMediaAccess(): void {
  const ses = session.defaultSession

  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      const win = mainWindow
      if (!win) {
        callback({})
        return
      }
      // Chromium은 화면 캡처 요청에 비디오 소스를 요구한다.
      // 렌더러는 받은 비디오 트랙을 즉시 stop()하고 오디오 트랙만 사용한다.
      callback({ video: win.webContents.mainFrame, audio: 'loopback' })
    },
    { useSystemPicker: false }
  )

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media')
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.talkflow.app')

  configureMediaAccess()
  registerIpc(() => mainWindow)

  const removed = pruneOldSessions(getSettings().history.retentionDays)
  if (removed > 0) console.log(`[sessions] 보존 기간이 지난 세션 ${removed}건을 정리했습니다.`)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

// 단일 인스턴스만 실행한다. 두 인스턴스가 같은 세션 파일에 쓰는 것을 막는다.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}
