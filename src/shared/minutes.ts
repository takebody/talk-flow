import type { ConversationEntry, Minutes } from './types'

/**
 * 회의록 생성·표시·저장에 공통으로 쓰이는 순수 함수 모듈.
 *
 * 렌더러는 대화 항목에서 프롬프트용 대화록을 만들고, Main은 같은 회의록 구조를
 * 텍스트 파일로 렌더링한다. 두 쪽이 서로 다른 형식을 쓰면 화면과 파일이 어긋나므로
 * 한 곳에 모아 둔다.
 */

/**
 * 프롬프트에 넣는 대화록의 최대 길이.
 *
 * 장시간 회의는 토큰 한도를 넘길 수 있다. 넘치면 중간을 생략하는데, 회의의
 * 도입부(안건)와 마무리(결정·후속 조치)가 회의록에서 가장 중요하므로 양끝을 남긴다.
 */
export const MINUTES_TRANSCRIPT_LIMIT = 24_000

const pad = (n: number) => String(n).padStart(2, '0')

function timeOf(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 회의록 생성에 쓸 수 있는 항목만 고른다. 오류·진행 중 항목은 내용이 없다. */
export function usableEntries(entries: ConversationEntry[]): ConversationEntry[] {
  return entries.filter((e) => e.status === 'final' && e.sourceText.trim().length > 0)
}

/**
 * 대화 항목을 AI에 넘길 평문 대화록으로 만든다.
 * 원문과 번역을 함께 넣는다 — 원문에는 고유명사가, 번역에는 맥락이 더 정확하게 남는다.
 */
export function buildTranscript(
  entries: ConversationEntry[],
  limit = MINUTES_TRANSCRIPT_LIMIT
): { text: string; truncated: boolean } {
  const lines = usableEntries(entries).map((e) => {
    const who = e.speakerName || (e.direction === 'incoming' ? '상대방' : '나')
    const head = `[${timeOf(e.timestamp)}] ${who}: ${e.sourceText.trim()}`
    // 번역문이 원문과 같으면(이미 목표 언어였던 경우) 중복으로 넣지 않는다.
    const translated = e.translatedText?.trim()
    return translated && translated !== e.sourceText.trim() ? `${head}\n    (번역) ${translated}` : head
  })

  const text = lines.join('\n')
  if (text.length <= limit) return { text, truncated: false }

  // 양끝을 남기고 중간을 생략한다.
  const half = Math.floor(limit / 2)
  const head = text.slice(0, half)
  const tail = text.slice(text.length - half)
  return {
    text: `${head}\n\n[… 중략: 대화가 길어 중간 부분을 생략했습니다 …]\n\n${tail}`,
    truncated: true
  }
}

/* ------------------------------------------------------------ 텍스트 렌더링 */

const MODE_LABEL = { online: '온라인 회의', offline: '오프라인 회의' } as const

function section(title: string, items: string[]): string[] {
  if (items.length === 0) return [title, '  (없음)', '']
  return [title, ...items.map((item) => `  - ${item}`), '']
}

/** 회의록을 사람이 읽는 텍스트로 만든다. 파일 저장과 클립보드 복사가 공유한다. */
export function renderMinutesAsText(m: Minutes): string {
  const started = new Date(m.startedAt)
  const ended = m.endedAt ? new Date(m.endedAt) : null
  const minutes = ended ? Math.round((ended.getTime() - started.getTime()) / 60_000) : null

  const lines: string[] = []
  lines.push('='.repeat(60))
  lines.push(`회의록: ${m.title}`)
  lines.push('='.repeat(60))
  lines.push(`일시      : ${started.toLocaleString('ko-KR')}`)
  if (ended) lines.push(`종료      : ${ended.toLocaleString('ko-KR')}`)
  if (minutes !== null) lines.push(`소요 시간 : 약 ${minutes}분`)
  lines.push(`형태      : ${MODE_LABEL[m.mode]}`)
  lines.push(`발화 수   : ${m.entryCount}건`)
  lines.push('')

  lines.push('[요약]')
  lines.push(...m.summary.split('\n').map((line) => `  ${line}`))
  lines.push('')

  lines.push(...section('[주요 논의]', m.keyPoints))
  lines.push(...section('[결정 사항]', m.decisions))

  if (m.actionItems.length === 0) {
    lines.push('[액션 아이템]', '  (없음)', '')
  } else {
    lines.push('[액션 아이템]')
    for (const item of m.actionItems) {
      const owner = item.owner ? ` (담당: ${item.owner}` : ''
      const due = item.due ? `${owner ? ', ' : ' ('}기한: ${item.due}` : ''
      const tail = owner || due ? `${owner}${due})` : ''
      lines.push(`  - ${item.task}${tail}`)
    }
    lines.push('')
  }

  lines.push(...section('[후속 확인 필요]', m.followUps))

  lines.push('-'.repeat(60))
  lines.push(`생성    : ${new Date(m.generatedAt).toLocaleString('ko-KR')}`)
  lines.push(`모델    : ${m.provider} / ${m.model}`)
  if (m.truncated) {
    lines.push('주의    : 대화가 길어 일부 구간을 생략한 채 요약했습니다.')
  }
  lines.push('주의    : AI가 자동 생성한 회의록입니다. 중요한 내용은 원본 대화록과 대조하세요.')

  // Windows 메모장에서 줄바꿈이 깨지지 않도록 CRLF로 내보낸다.
  return lines.join('\r\n')
}

/** 파일명에 쓸 수 없는 문자를 제거한다. */
export function minutesFileName(m: Minutes): string {
  const stamp = m.startedAt.slice(0, 16).replace(/[:T]/g, '-')
  const safe = m.title
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return `회의록_${stamp}${safe ? `_${safe}` : ''}.txt`
}
