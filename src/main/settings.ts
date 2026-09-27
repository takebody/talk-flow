import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { CredentialStatus, ProviderId, Settings } from '@shared/types'
import { defaultSettings } from '@shared/defaults'

const dataDir = () => app.getPath('userData')
const settingsPath = () => join(dataDir(), 'settings.json')
const credentialsPath = () => join(dataDir(), 'credentials.bin')

let cache: Settings | null = null

/** 저장된 설정을 기본값 위에 얕은-깊은 병합한다. 스키마가 늘어나도 기존 파일이 깨지지 않는다. */
function merge(base: Settings, patch: unknown): Settings {
  if (!patch || typeof patch !== 'object') return base
  const out = { ...base } as Record<string, unknown>
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!(key in out)) continue
    const current = out[key]
    if (
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[key] = merge(current as Settings, value)
    } else if (value !== undefined) {
      out[key] = value
    }
  }
  return out as unknown as Settings
}

export function getSettings(): Settings {
  if (cache) return cache
  const base = defaultSettings()
  try {
    if (existsSync(settingsPath())) {
      cache = merge(base, JSON.parse(readFileSync(settingsPath(), 'utf-8')))
    } else {
      cache = base
    }
  } catch {
    cache = base
  }
  return cache
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = merge(getSettings(), patch)
  cache = next
  try {
    mkdirSync(dataDir(), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  } catch (err) {
    console.error('[settings] 저장 실패:', (err as Error).message)
  }
  return next
}

/* --------------------------------------------------------------- API Key 보관 */

/**
 * API Key는 Main 프로세스에만 존재한다.
 * - remember=true  → safeStorage(Windows DPAPI)로 암호화해 디스크에 보관
 * - remember=false → 이 프로세스 메모리에만 보관하고 종료 시 사라진다
 */
const memoryKeys = new Map<ProviderId, string>()

type KeyFile = Partial<Record<ProviderId, string>>

function readKeyFile(): KeyFile {
  try {
    if (!existsSync(credentialsPath())) return {}
    return JSON.parse(readFileSync(credentialsPath(), 'utf-8')) as KeyFile
  } catch {
    return {}
  }
}

function writeKeyFile(data: KeyFile): void {
  mkdirSync(dataDir(), { recursive: true })
  if (Object.keys(data).length === 0) {
    if (existsSync(credentialsPath())) unlinkSync(credentialsPath())
    return
  }
  writeFileSync(credentialsPath(), JSON.stringify(data), 'utf-8')
}

export function secureStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function setApiKey(provider: ProviderId, apiKey: string, remember: boolean): void {
  const trimmed = apiKey.trim()
  memoryKeys.set(provider, trimmed)

  const file = readKeyFile()
  if (remember && secureStorageAvailable()) {
    file[provider] = safeStorage.encryptString(trimmed).toString('base64')
  } else {
    delete file[provider]
  }
  writeKeyFile(file)
}

export function clearApiKey(provider: ProviderId): void {
  memoryKeys.delete(provider)
  const file = readKeyFile()
  delete file[provider]
  writeKeyFile(file)
}

export function getApiKey(provider: ProviderId): string | null {
  const inMemory = memoryKeys.get(provider)
  if (inMemory) return inMemory

  const encrypted = readKeyFile()[provider]
  if (!encrypted || !secureStorageAvailable()) return null
  try {
    const value = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    memoryKeys.set(provider, value)
    return value
  } catch {
    return null
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return '•'.repeat(key.length)
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}

export function credentialStatus(provider: ProviderId): CredentialStatus {
  const key = getApiKey(provider)
  return {
    provider,
    hasKey: !!key,
    persisted: !!readKeyFile()[provider],
    preview: key ? maskKey(key) : undefined,
    secureStorageAvailable: secureStorageAvailable()
  }
}

/** 로그·오류 메시지에 키가 섞여 나가지 않도록 마스킹한다. */
export function scrubSecrets(text: string): string {
  let out = text
  for (const key of memoryKeys.values()) {
    if (key.length >= 8) out = out.split(key).join('[REDACTED_KEY]')
  }
  return out
    .replace(/sk-[A-Za-z0-9_\-]{16,}/g, '[REDACTED_KEY]')
    .replace(/AIza[A-Za-z0-9_\-]{20,}/g, '[REDACTED_KEY]')
}
