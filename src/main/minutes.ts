import { BrowserWindow, app, shell } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Minutes } from '@shared/types'
import { minutesFileName, renderMinutesAsText } from '@shared/minutes'

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
  // [임시 검증용 — 제거 예정]
  if (!current && process.env.TALKFLOW_DEMO_MINUTES) {
    return {
      sessionId: 'demo',
      generatedAt: new Date().toISOString(),
      startedAt: new Date(Date.now() - 42 * 60_000).toISOString(),
      endedAt: new Date().toISOString(),
      mode: 'online',
      entryCount: 37,
      provider: 'anthropic',
      model: 'claude-opus-5',
      savedPath: 'C:\\Users\\User\\Documents\\Talk-Flow 회의록\\회의록_2026-09-29-09-10_Q4 로드맵 검토.txt',
      truncated: true,
      title: 'Q4 로드맵 및 리소스 배분 검토',
      summary:
        '싱가포르 팀과 Q4 출시 범위를 검토했습니다. 결제 모듈은 11월 첫째 주로 미루고, 온보딩 개편을 먼저 내보내기로 했습니다.\n리소스 부족이 반복 지적되어 QA 인원 충원 검토가 필요합니다.',
      keyPoints: [
        '온보딩 개편은 A/B 테스트 결과가 긍정적이어서 전체 배포로 확대하는 방향입니다.',
        '결제 모듈은 외부 PG 인증 일정이 확정되지 않아 날짜를 못 박기 어렵습니다.',
        'QA 인원이 두 명뿐이라 릴리스가 겹치면 회귀 테스트를 다 돌릴 수 없습니다.'
      ],
      decisions: [
        '온보딩 개편을 10월 3주차에 전체 배포합니다.',
        '결제 모듈 출시는 11월 첫째 주로 연기합니다.'
      ],
      actionItems: [
        { task: 'PG사에 인증 일정 재확인 후 공유', owner: '김대환', due: '10월 4일' },
        { task: 'QA 충원 요청서 작성', owner: 'Sarah' },
        { task: '온보딩 배포 체크리스트 갱신' }
      ],
      followUps: [
        '싱가포르 팀 휴일이 배포 주간과 겹치는지 확인이 필요합니다.',
        '"레이턴시 목표를 200ms로 한다"는 발언은 음성 인식이 불확실해 재확인이 필요합니다.'
      ]
    }
  }
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
