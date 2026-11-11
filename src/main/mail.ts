import { clipboard, shell } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MailSendResult, Minutes } from '@shared/types'
import { isValidEmail, parseRecipients } from '@shared/defaults'
import { renderMinutesAsText } from '@shared/minutes'

/**
 * 회의록 메일 발송.
 *
 * SMTP 서버·계정 비밀번호를 앱에 맡기지 않도록, PC에 로그인된 Outlook을
 * COM 자동화로 호출해 사용자의 계정으로 바로 보낸다. Outlook이 없거나
 * (예: 새 Outlook만 설치된 환경) 호출에 실패하면 기본 메일 앱의 작성 창을 띄운다.
 */

const POWERSHELL_TIMEOUT_MS = 60_000
/** Windows 셸이 mailto: URL을 자르지 않는 안전한 길이 */
const MAILTO_MAX_LENGTH = 1900

function mailSubject(m: Minutes): string {
  const date = new Date(m.startedAt).toLocaleDateString('ko-KR')
  return `[회의록] ${m.title} (${date})`
}

/** PowerShell 작은따옴표 문자열 이스케이프 */
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`

function outlookScript(jsonPath: string): string {
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  $data = Get-Content -LiteralPath ${psQuote(jsonPath)} -Raw -Encoding UTF8 | ConvertFrom-Json
  $wasRunning = [bool](Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue)
  $outlook = New-Object -ComObject Outlook.Application
  $ns = $outlook.GetNamespace('MAPI')
  $mail = $outlook.CreateItem(0)
  $mail.To = $data.to
  $mail.Subject = $data.subject
  $mail.Body = $data.body
  $mail.Send()
  try { $ns.SendAndReceive($false) } catch {}
  if (-not $wasRunning) {
    # 앱이 띄운 Outlook은 참조가 끊기면 바로 닫히므로, 보낼 편지함이 빌 때까지 잠시 기다린다.
    $outbox = $ns.GetDefaultFolder(4)
    for ($i = 0; $i -lt 20 -and $outbox.Items.Count -gt 0; $i++) { Start-Sleep -Milliseconds 500 }
  }
  Write-Output 'OK'
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`
}

function runPowerShell(script: string): Promise<{ ok: boolean; output: string }> {
  // -EncodedCommand는 UTF-16LE base64를 받으므로 따옴표·한글 이스케이프 문제가 없다.
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) resolve({ ok: false, output: (stderr || err.message).trim() })
        else resolve({ ok: stdout.includes('OK'), output: stdout.trim() })
      }
    )
  })
}

async function sendViaOutlook(
  to: string[],
  subject: string,
  body: string
): Promise<{ ok: boolean; message?: string }> {
  if (process.platform !== 'win32') return { ok: false, message: 'Windows 전용 기능입니다.' }

  const jsonPath = join(tmpdir(), `talkflow-mail-${randomUUID()}.json`)
  try {
    await writeFile(jsonPath, JSON.stringify({ to: to.join('; '), subject, body }), 'utf-8')
    const result = await runPowerShell(outlookScript(jsonPath))
    return result.ok ? { ok: true } : { ok: false, message: result.output || 'Outlook 호출 실패' }
  } finally {
    await unlink(jsonPath).catch(() => undefined)
  }
}

async function openMailto(to: string[], subject: string, body: string): Promise<boolean> {
  const base = `mailto:${to.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}`
  let url = `${base}&body=${encodeURIComponent(body)}`
  if (url.length > MAILTO_MAX_LENGTH) {
    // 본문이 길면 URL에 다 담을 수 없다. 전문은 클립보드로 넘긴다.
    clipboard.writeText(body)
    url = `${base}&body=${encodeURIComponent('회의록 전문이 클립보드에 복사되어 있습니다. 여기에 붙여넣기(Ctrl+V) 하세요.\r\n\r\n')}`
  }
  try {
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}

export async function emailMinutes(m: Minutes, rawRecipients: string): Promise<MailSendResult> {
  const recipients = parseRecipients(rawRecipients)
  if (recipients.length === 0) {
    return {
      ok: false,
      message: '수신 이메일이 설정되지 않았습니다. 설정 → 기록 → 회의록 메일 수신인에서 입력하세요.'
    }
  }
  const invalid = recipients.filter((a) => !isValidEmail(a))
  if (invalid.length > 0) {
    return { ok: false, message: `수신 이메일 형식이 올바르지 않습니다: ${invalid.join(', ')}` }
  }

  const subject = mailSubject(m)
  const body = renderMinutesAsText(m)

  const outlook = await sendViaOutlook(recipients, subject, body)
  if (outlook.ok) return { ok: true, method: 'outlook', recipients }

  console.warn('[mail] Outlook 발송 실패, 기본 메일 앱으로 전환:', outlook.message)
  if (await openMailto(recipients, subject, body)) {
    return {
      ok: true,
      method: 'mailto',
      recipients,
      message: `Outlook으로 바로 보내지 못해 메일 작성 창을 열었습니다. 보내기를 눌러 주세요. (${outlook.message})`
    }
  }
  return { ok: false, message: `메일을 보내지 못했습니다: ${outlook.message}` }
}
