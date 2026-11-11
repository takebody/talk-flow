import { BrowserWindow, app, shell } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Minutes, SavedMinutesMeta } from '@shared/types'
import { minutesFileName, parseMinutesText, renderMinutesAsText } from '@shared/minutes'

/**
 * 회의록 보관과 표시.
 *
 * 회의록은 세션 기록(jsonl)과 달리 "완성된 문서"라서 텍스트 파일 자체가 원본이다.
 * 별도의 DB나 인덱스를 두지 않고, 생성 즉시 문서 폴더에 저장한 뒤 같은 내용을
 * 창에 띄운다. 방금 만든 회의록만 메모리에 들고 있으면 창이 그것을 읽어 간다.
 */

let current: Minutes | null = null
let minutesWindow: BrowserWindow | null = null

export function setCurrentMinutes(minutes: Minutes): void {
  current = minutes
}

export function getCurrentMinutes(): Minutes | null {
  return current
}

/** 회의록 자동 저장 폴더. 사용자가 바로 찾을 수 있는 문서 폴더 아래에 둔다. */
export function minutesDir(): string {
  return join(app.getPath('documents'), 'Talk-Flow 회의록')
}

/**
 * 생성 직후 자동 저장한다.
 *
 * 저장 대화상자를 먼저 띄우면 회의가 끝난 직후의 산만한 상황에서 취소되기 쉽고,
 * 그러면 방금 만든 회의록이 사라진다. 일단 저장하고 경로를 알려 준 다음,
 * 다른 위치가 필요하면 창에서 "다른 이름으로 저장"을 쓰게 한다.
 */
export async function autoSaveMinutes(minutes: Minutes): Promise<string | null> {
  try {
    const dir = minutesDir()
    await mkdir(dir, { recursive: true })
    const path = join(dir, minutesFileName(minutes))
    // Windows 메모장이 UTF-8로 인식하도록 BOM을 붙인다.
    await writeFile(path, `﻿${renderMinutesAsText(minutes)}`, 'utf-8')
    return path
  } catch (err) {
    console.error('[minutes] 자동 저장 실패:', (err as Error).message)
    return null
  }
}

/* ------------------------------------------------------ 저장된 회의록 */

/**
 * 회의록 원본 데이터(JSON) 보관 폴더.
 *
 * 텍스트 파일은 사람이 읽는 문서라 창에 다시 띄우기에는 정보가 모자라다.
 * 회의록 창을 그대로 다시 열 수 있도록 구조 데이터를 앱 데이터 폴더에 함께 둔다.
 * 문서 폴더에는 사용자가 보는 .txt만 남긴다.
 */
function recordsDir(): string {
  return join(app.getPath('userData'), 'minutes')
}

/** 세션 ID는 파일명으로 쓰므로 안전한 문자만 남긴다. */
const safeId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'minutes'

export async function storeMinutesRecord(minutes: Minutes): Promise<void> {
  try {
    await mkdir(recordsDir(), { recursive: true })
    await writeFile(
      join(recordsDir(), `${safeId(minutes.sessionId)}.json`),
      JSON.stringify(minutes, null, 2),
      'utf-8'
    )
  } catch (err) {
    console.error('[minutes] 원본 보관 실패:', (err as Error).message)
  }
}

async function readJsonRecords(): Promise<{ file: string; minutes: Minutes }[]> {
  let files: string[]
  try {
    files = (await readdir(recordsDir())).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out: { file: string; minutes: Minutes }[] = []
  for (const file of files) {
    try {
      const minutes = JSON.parse(await readFile(join(recordsDir(), file), 'utf-8')) as Minutes
      if (minutes && typeof minutes.summary === 'string') out.push({ file, minutes })
    } catch {
      // 깨진 파일은 목록에서 뺀다.
    }
  }
  return out
}

async function readTxtFiles(): Promise<{ file: string; path: string; mtime: Date }[]> {
  let files: string[]
  try {
    files = (await readdir(minutesDir())).filter((f) => f.toLowerCase().endsWith('.txt'))
  } catch {
    return []
  }
  const out: { file: string; path: string; mtime: Date }[] = []
  for (const file of files) {
    const path = join(minutesDir(), file)
    try {
      out.push({ file, path, mtime: (await stat(path)).mtime })
    } catch {
      /* 그 사이 지워진 파일 */
    }
  }
  return out
}

async function loadTxt(file: string, path: string, mtime: Date): Promise<Minutes | null> {
  try {
    return parseMinutesText(await readFile(path, 'utf-8'), {
      id: `txt-${file}`,
      modifiedAt: mtime.toISOString(),
      path
    })
  } catch {
    return null
  }
}

/**
 * 저장된 회의록 목록 (최신순).
 *
 * JSON 원본이 있는 회의록을 우선 쓰고, 문서 폴더에 텍스트 파일만 있는 회의록
 * (이 기능 이전에 만들어졌거나 다른 PC에서 옮겨 온 것)은 텍스트를 읽어 되살린다.
 * 텍스트 파일을 지운 회의록도 원본이 남아 있으면 계속 열 수 있다.
 */
export async function listSavedMinutes(): Promise<SavedMinutesMeta[]> {
  const records = await readJsonRecords()
  const known = new Set(
    records.map((r) => r.minutes.savedPath?.toLowerCase()).filter((p): p is string => !!p)
  )

  const list: SavedMinutesMeta[] = records.map(({ file, minutes }) => ({
    id: `json:${file}`,
    title: minutes.title,
    startedAt: minutes.startedAt,
    mode: minutes.mode,
    entryCount: minutes.entryCount,
    path: minutes.savedPath && existsSync(minutes.savedPath) ? minutes.savedPath : undefined,
    source: 'json'
  }))

  for (const txt of await readTxtFiles()) {
    if (known.has(txt.path.toLowerCase())) continue
    const minutes = await loadTxt(txt.file, txt.path, txt.mtime)
    if (!minutes) continue // 회의록 형식이 아닌 텍스트 파일
    list.push({
      id: `txt:${txt.file}`,
      title: minutes.title,
      startedAt: minutes.startedAt,
      mode: minutes.mode,
      entryCount: minutes.entryCount,
      path: txt.path,
      source: 'txt'
    })
  }

  return list.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/**
 * 목록의 id로 회의록을 읽는다.
 * id는 렌더러에서 오므로 경로로 바로 쓰지 않고, 폴더 안의 파일명과 정확히 맞을 때만 연다.
 */
export async function loadSavedMinutes(id: string): Promise<Minutes | null> {
  const sep = id.indexOf(':')
  const kind = id.slice(0, sep)
  const file = id.slice(sep + 1)
  if (!file || file !== basename(file)) return null

  if (kind === 'json') {
    const record = (await readJsonRecords()).find((r) => r.file === file)
    if (!record) return null
    const m = record.minutes
    // 텍스트 파일이 지워졌으면 "폴더 열기"가 엉뚱한 곳을 가리키지 않게 경로를 지운다.
    return { ...m, savedPath: m.savedPath && existsSync(m.savedPath) ? m.savedPath : undefined }
  }
  if (kind === 'txt') {
    const txt = (await readTxtFiles()).find((t) => t.file === file)
    return txt ? loadTxt(txt.file, txt.path, txt.mtime) : null
  }
  return null
}

/**
 * 회의록 전용 창을 띄운다.
 *
 * 렌더러 번들을 하나로 유지하기 위해 같은 index.html을 `?view=minutes`로 연다.
 * 창은 열린 뒤 `minutes:current`로 내용을 직접 읽어 간다.
 */
export function openMinutesWindow(parent: BrowserWindow | null): void {
  if (minutesWindow && !minutesWindow.isDestroyed()) {
    // 이미 열려 있으면 새 회의록을 다시 읽도록 새로 고친다.
    minutesWindow.reload()
    if (minutesWindow.isMinimized()) minutesWindow.restore()
    minutesWindow.focus()
    return
  }

  minutesWindow = new BrowserWindow({
    width: 720,
    height: 860,
    minWidth: 420,
    minHeight: 480,
    show: false,
    backgroundColor: '#f7f5f2',
    title: '회의록',
    // 항상 위로 떠 있는 본체 위에서도 회의록을 읽을 수 있어야 한다.
    parent: parent ?? undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  minutesWindow.once('ready-to-show', () => minutesWindow?.show())
  minutesWindow.on('closed', () => {
    minutesWindow = null
  })

  minutesWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    minutesWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=minutes`)
  } else {
    minutesWindow.loadFile(join(__dirname, '../renderer/index.html'), { search: 'view=minutes' })
  }
}
