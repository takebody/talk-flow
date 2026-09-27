import { app } from 'electron'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  CaptureMode,
  ConversationEntry,
  ProviderId,
  SessionMeta,
  SessionRecord,
  SessionUsage,
  SttProviderId
} from '@shared/types'
import { emptyUsage } from '@shared/types'

/**
 * 세션 기록 저장소.
 *
 * 항목이 확정될 때마다 `<sessionId>.jsonl`에 한 줄씩 append 한다.
 * - 앱이 비정상 종료되어도 이미 기록된 줄은 그대로 남는다.
 * - 같은 id가 여러 번 append되면 마지막 줄이 유효하다(last-wins).
 * 전문 검색/통계 요구가 생기면 이 모듈 뒤에서 SQLite로 교체할 수 있다.
 */

const sessionsDir = () => join(app.getPath('userData'), 'sessions')
const indexPath = () => join(sessionsDir(), 'index.json')

function ensureDir(): void {
  mkdirSync(sessionsDir(), { recursive: true })
}

function sessionPath(sessionId: string): string {
  // 외부에서 온 id로 경로를 만들기 때문에 uuid 형태만 허용한다.
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(sessionId)) throw new Error('invalid sessionId')
  return join(sessionsDir(), `${sessionId}.jsonl`)
}

function readIndex(): SessionMeta[] {
  try {
    if (!existsSync(indexPath())) return []
    const parsed = JSON.parse(readFileSync(indexPath(), 'utf-8'))
    return Array.isArray(parsed) ? (parsed as SessionMeta[]) : []
  } catch {
    return []
  }
}

function writeIndex(list: SessionMeta[]): void {
  ensureDir()
  writeFileSync(indexPath(), JSON.stringify(list, null, 2), 'utf-8')
}

function upsertIndex(meta: SessionMeta): void {
  const list = readIndex()
  const i = list.findIndex((s) => s.sessionId === meta.sessionId)
  if (i >= 0) list[i] = meta
  else list.unshift(meta)
  writeIndex(list)
}

export function startSession(
  mode: CaptureMode,
  sttProvider: SttProviderId,
  translationProvider: ProviderId
): SessionMeta {
  ensureDir()
  const meta: SessionMeta = {
    sessionId: randomUUID(),
    startedAt: new Date().toISOString(),
    mode,
    sttProvider,
    translationProvider,
    entryCount: 0,
    usage: emptyUsage()
  }
  writeFileSync(sessionPath(meta.sessionId), '', 'utf-8')
  upsertIndex(meta)
  return meta
}

export function appendEntry(sessionId: string, entry: ConversationEntry): void {
  ensureDir()
  const file = sessionPath(sessionId)
  if (!existsSync(file)) writeFileSync(file, '', 'utf-8')
  appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf-8')
}

export function endSession(sessionId: string, usage: SessionUsage, entryCount: number): void {
  const list = readIndex()
  const i = list.findIndex((s) => s.sessionId === sessionId)
  if (i < 0) return
  list[i] = { ...list[i], endedAt: new Date().toISOString(), usage, entryCount }
  writeIndex(list)
}

export function listSessions(): SessionMeta[] {
  return readIndex().sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export function loadSession(sessionId: string): SessionRecord | null {
  const meta = readIndex().find((s) => s.sessionId === sessionId)
  if (!meta) return null
  const file = sessionPath(sessionId)
  if (!existsSync(file)) return { ...meta, entries: [] }

  // last-wins: 같은 id의 뒤쪽 줄이 앞쪽 줄을 덮는다.
  const byId = new Map<string, ConversationEntry>()
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as ConversationEntry
      if (entry?.id) byId.set(entry.id, entry)
    } catch {
      // 크래시로 마지막 줄이 잘렸을 수 있다. 해당 줄만 버린다.
    }
  }
  const entries = [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return { ...meta, entries }
}

export function deleteSession(sessionId: string): void {
  const file = sessionPath(sessionId)
  if (existsSync(file)) rmSync(file, { force: true })
  writeIndex(readIndex().filter((s) => s.sessionId !== sessionId))
}

export function clearAllSessions(): void {
  ensureDir()
  for (const name of readdirSync(sessionsDir())) {
    if (name.endsWith('.jsonl')) rmSync(join(sessionsDir(), name), { force: true })
  }
  writeIndex([])
}

/** 보존 기간이 지난 세션을 정리한다. retentionDays=0이면 무기한 보관. */
export function pruneOldSessions(retentionDays: number): number {
  if (!retentionDays) return 0
  const cutoff = Date.now() - retentionDays * 86_400_000
  let removed = 0
  for (const meta of readIndex()) {
    if (new Date(meta.startedAt).getTime() < cutoff) {
      deleteSession(meta.sessionId)
      removed++
    }
  }
  return removed
}

/* ------------------------------------------------------------------ 내보내기 */

const pad = (n: number) => String(n).padStart(2, '0')

function timeOf(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function renderSessionAsText(record: SessionRecord): string {
  const lines: string[] = []
  lines.push('Talk-Flow 대화록')
  lines.push(`세션 ID   : ${record.sessionId}`)
  lines.push(`시작       : ${new Date(record.startedAt).toLocaleString('ko-KR')}`)
  if (record.endedAt) lines.push(`종료       : ${new Date(record.endedAt).toLocaleString('ko-KR')}`)
  lines.push(`모드       : ${record.mode === 'online' ? '온라인 회의' : '오프라인 회의'}`)
  lines.push(`음성 인식  : ${record.sttProvider}`)
  lines.push(`번역       : ${record.translationProvider}`)
  lines.push(`항목 수    : ${record.entries.length}`)
  lines.push('='.repeat(60))
  lines.push('')

  for (const e of record.entries) {
    const who = e.direction === 'incoming' ? '상대방' : '나'
    lines.push(`[${timeOf(e.timestamp)}] ${who}`)
    lines.push(`  원문(${e.sourceLanguage}) : ${e.sourceText}`)
    if (e.translatedText) lines.push(`  번역(${e.targetLanguage}) : ${e.translatedText}`)
    if (e.status === 'error') lines.push(`  오류 : ${e.errorMessage ?? '알 수 없는 오류'}`)
    if (e.needsReview) lines.push('  * 언어 자동 판정이 불확실한 항목')
    lines.push('')
  }

  const u = record.usage
  lines.push('='.repeat(60))
  lines.push(
    `사용량: 오디오 ${(u.audioSeconds / 60).toFixed(1)}분 · STT ${u.sttRequests}회 · 번역 ${u.translateRequests}회 · 토큰 ${u.inputTokens}/${u.outputTokens}`
  )
  return lines.join('\r\n')
}
