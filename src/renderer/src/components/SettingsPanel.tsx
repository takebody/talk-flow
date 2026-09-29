import { useEffect, useState } from 'react'
import type {
  AppInfo,
  DiagnosticsItem,
  LanguagePair,
  ModelInfo,
  ProviderId,
  SessionMeta,
  SttProviderId
} from '@shared/types'
import { LANGUAGE_PAIRS } from '@shared/defaults'
import { validateApiKey } from '@shared/apiKey'
import { useStore } from '../store'
import {
  PROVIDER_KEY_HINT,
  PROVIDER_LABELS,
  PROVIDER_NO_STT_REASON,
  PROVIDER_ORDER,
  PROVIDER_SHORT
} from './providerLabels'
import { captureSample, listMicrophones } from '../audio/CaptureEngine'

type Tab = 'provider' | 'audio' | 'display' | 'history' | 'diagnostics' | 'about'

const TABS: { id: Tab; label: string }[] = [
  { id: 'provider', label: 'AI 제공자' },
  { id: 'audio', label: '오디오' },
  { id: 'display', label: '표시' },
  { id: 'history', label: '기록' },
  { id: 'diagnostics', label: '진단' },
  { id: 'about', label: '정보' }
]

export function SettingsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('provider')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="설정">
      <div className="modal__panel">
        <div className="modal__head">
          <h2>설정</h2>
          <button type="button" className="btn btn--icon" onClick={onClose} aria-label="설정 닫기">
            ✕
          </button>
        </div>

        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tabs__tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="modal__body">
          {tab === 'provider' && <ProviderSection />}
          {tab === 'audio' && <AudioSection />}
          {tab === 'display' && <DisplaySection />}
          {tab === 'history' && <HistorySection />}
          {tab === 'diagnostics' && <DiagnosticsSection />}
          {tab === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ AI 제공자 */

function ProviderSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const allCredentials = useStore((s) => s.credentials)
  const patchSettings = useStore((s) => s.patchSettings)
  const refreshCredential = useStore((s) => s.refreshCredential)
  const switchProvider = useStore((s) => s.switchProvider)
  const switchSttProvider = useStore((s) => s.switchSttProvider)

  /** API Key·모델·단가를 편집할 대상. 기본값은 번역 제공자. */
  const [detail, setDetail] = useState<ProviderId>(settings.translationProvider)
  const [keyInput, setKeyInput] = useState('')
  const [remember, setRemember] = useState(true)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [testing, setTesting] = useState<'stt' | 'translation' | null>(null)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    text: string
    detail?: string
  } | null>(null)

  const cred = allCredentials[detail]
  const pricing = settings.pricing[detail]
  const config = settings.providerConfig

  // 통합 호출은 두 제공자가 같고 그 제공자가 오디오+구조화 출력을 지원할 때만 가능하다.
  const combineActive =
    settings.limits.combineRequests &&
    settings.sttProvider === settings.translationProvider &&
    settings.sttProvider === 'gemini'
  const perUtterance = combineActive ? 1 : 2

  const setModel = (patch: Partial<typeof config>) =>
    void patchSettings({ providerConfig: { ...config, ...patch } })

  const saveKey = async () => {
    const check = validateApiKey(detail, keyInput)
    if (!check.ok) {
      setKeyError(check.error ?? '입력을 확인하세요.')
      return
    }
    await window.talkflow.credentials.set(detail, keyInput.trim(), remember)
    setKeyInput('')
    setKeyError(check.warning ?? null)
    await refreshCredential(detail)
    setTestResult(null)
  }

  const clearKey = async () => {
    await window.talkflow.credentials.clear(detail)
    await refreshCredential(detail)
    setKeyError(null)
    setTestResult(null)
  }

  const runTest = async (target: 'stt' | 'translation') => {
    setTesting(target)
    setTestResult(null)
    const result = await window.talkflow.ai.test(target)
    setTestResult(
      result.ok
        ? { ok: true, text: `연결 성공 — ${result.value}` }
        : {
            ok: false,
            text: `${result.error.message}${result.error.hint ? ` (${result.error.hint})` : ''}`,
            detail: result.error.detail
          }
    )
    setTesting(null)
  }

  const ProviderCard = ({
    id,
    active,
    disabled,
    onSelect
  }: {
    id: ProviderId
    active: boolean
    disabled?: string
    onSelect: () => void
  }) => {
    const c = allCredentials[id]
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        disabled={!!disabled}
        title={disabled}
        className={`providers__card ${active ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''}`}
        onClick={onSelect}
      >
        <span className="providers__radio" aria-hidden="true" />
        <span className="providers__name">{PROVIDER_LABELS[id]}</span>
        {disabled ? (
          <span className="badge">지원 안 함</span>
        ) : c?.hasKey ? (
          <span className="badge badge--ok">키 {c.preview}</span>
        ) : (
          <span className="badge badge--warn">키 없음</span>
        )}
      </button>
    )
  }

  return (
    <section className="section">
      <Field
        label="음성 인식 (STT) 제공자"
        hint="상대방 음성을 텍스트로 바꾸는 역할입니다. Claude API는 오디오 입력을 지원하지 않아 선택할 수 없습니다."
      >
        <div className="providers" role="radiogroup" aria-label="음성 인식 제공자">
          {PROVIDER_ORDER.map((id) => (
            <ProviderCard
              key={id}
              id={id}
              active={id === settings.sttProvider}
              disabled={PROVIDER_NO_STT_REASON[id]}
              onSelect={() => {
                setDetail(id)
                void switchSttProvider(id as SttProviderId)
              }}
            />
          ))}
        </div>
      </Field>

      <Field
        label="번역 제공자"
        hint="실시간 번역을 담당합니다. 음성 인식과 다른 제공자를 지정해도 됩니다."
      >
        <div className="providers" role="radiogroup" aria-label="번역 제공자">
          {PROVIDER_ORDER.map((id) => (
            <ProviderCard
              key={id}
              id={id}
              active={id === settings.translationProvider}
              onSelect={() => {
                setDetail(id)
                void switchProvider(id)
              }}
            />
          ))}
        </div>
        <p className="status-line">
          현재 구성: 음성 인식 <strong>{PROVIDER_SHORT[settings.sttProvider]}</strong> → 번역{' '}
          <strong>{PROVIDER_SHORT[settings.translationProvider]}</strong>
        </p>
      </Field>

      <Field label="제공자별 설정" hint="아래 항목은 선택한 제공자에만 적용됩니다.">
        <div className="segmented">
          {PROVIDER_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className={`segmented__btn ${detail === id ? 'is-active' : ''}`}
              onClick={() => {
                setDetail(id)
                setKeyInput('')
                setKeyError(null)
                setTestResult(null)
              }}
            >
              {PROVIDER_SHORT[id]}
            </button>
          ))}
        </div>
      </Field>

      <Field label={`${PROVIDER_LABELS[detail]} API Key`} hint={PROVIDER_KEY_HINT[detail]}>
        <div className="row">
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={cred?.hasKey ? cred.preview : 'API Key 붙여넣기'}
            value={keyInput}
            onChange={(e) => {
              setKeyInput(e.target.value)
              setKeyError(null)
            }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => void saveKey()}
            disabled={!keyInput.trim()}
          >
            저장
          </button>
        </div>
        {keyError && <p className="result is-bad">{keyError}</p>}
        <label className="check">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={cred ? !cred.secureStorageAvailable : false}
          />
          <span>
            이 PC에 암호화 저장 (Windows DPAPI)
            {cred && !cred.secureStorageAvailable && ' — 이 환경에서는 사용할 수 없습니다'}
          </span>
        </label>
        <p className="status-line">
          {cred?.hasKey ? (
            <>
              <span className="badge badge--ok">키 등록됨</span> {cred.preview}
              {cred.persisted ? ' · 디스크에 암호화 저장' : ' · 이번 실행에서만 유효'}
            </>
          ) : (
            <span className="badge badge--warn">키 없음</span>
          )}
        </p>
        <div className="row">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void clearKey()}
            disabled={!cred?.hasKey}
          >
            키 삭제
          </button>
        </div>
      </Field>

      {detail === 'openai' && (
        <>
          <ModelField
            label="음성 인식(STT) 모델"
            provider="openai"
            value={config.openai.sttModel}
            onChange={(v) => setModel({ openai: { ...config.openai, sttModel: v } })}
          />
          <ModelField
            label="번역 모델"
            provider="openai"
            value={config.openai.chatModel}
            onChange={(v) => setModel({ openai: { ...config.openai, chatModel: v } })}
          />
        </>
      )}

      {detail === 'gemini' && (
        <>
          <ModelField
            label="음성 인식(전사) 모델"
            hint="오디오 입력을 받는 멀티모달 모델이어야 합니다. flash 계열이 지연·비용 면에서 유리합니다."
            provider="gemini"
            value={config.gemini.sttModel}
            onChange={(v) => setModel({ gemini: { ...config.gemini, sttModel: v } })}
          />
          <ModelField
            label="번역 모델"
            provider="gemini"
            value={config.gemini.chatModel}
            onChange={(v) => setModel({ gemini: { ...config.gemini, chatModel: v } })}
          />
        </>
      )}

      {detail === 'anthropic' && (
        <ModelField
          label="Claude 번역 모델"
          hint="Claude는 번역만 담당합니다(오디오 입력 미지원). 회의 중 지연이 신경 쓰이면 더 빠른 모델로 바꿀 수 있습니다."
          provider="anthropic"
          value={config.anthropic.chatModel}
          onChange={(v) => setModel({ anthropic: { ...config.anthropic, chatModel: v } })}
        />
      )}

      <Field
        label="요청 속도 제한"
        hint="발화 하나마다 음성 인식 1회 + 번역 1회가 나갑니다. 무료 등급은 분당 한도가 낮아 그대로 두면 429(한도 초과)가 납니다. 사용 중인 등급의 RPM보다 낮게 잡으세요."
      >
        <div className="grid2">
          <NumberInput
            label="분당 최대 요청 수 (0 = 무제한)"
            value={settings.limits.requestsPerMinute}
            step={1}
            min={0}
            max={600}
            onChange={(v) =>
              void patchSettings({ limits: { ...settings.limits, requestsPerMinute: v } })
            }
          />
          <NumberInput
            label="동시 요청 수"
            value={settings.limits.maxConcurrent}
            step={1}
            min={1}
            max={8}
            onChange={(v) => void patchSettings({ limits: { ...settings.limits, maxConcurrent: v } })}
          />
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.limits.combineRequests}
            onChange={(e) =>
              void patchSettings({
                limits: { ...settings.limits, combineRequests: e.target.checked }
              })
            }
          />
          <span>
            전사와 번역을 한 번의 호출로 합치기 (발화당 요청 2회 → 1회)
            {!combineActive && ' — 현재 구성에서는 적용되지 않습니다'}
          </span>
        </label>
        <p className="status-line">
          발화당 요청 <strong>{perUtterance}회</strong>
          {settings.limits.requestsPerMinute > 0 && (
            <>
              {' '}
              · 분당 {settings.limits.requestsPerMinute}회 제한이면 최대{' '}
              <strong>발화 {Math.floor(settings.limits.requestsPerMinute / perUtterance)}건/분</strong>
            </>
          )}
        </p>
        {!combineActive && settings.limits.combineRequests && (
          <p className="result">
            통합 호출은 음성 인식과 번역 제공자가 <strong>모두 Gemini</strong>일 때 동작합니다.
            현재는 {PROVIDER_SHORT[settings.sttProvider]} → {PROVIDER_SHORT[settings.translationProvider]}{' '}
            구성이라 발화당 2회가 나갑니다. (OpenAI 전사 API와 Claude는 전사·번역 통합 호출을
            지원하지 않습니다.)
          </p>
        )}
      </Field>

      <Field label="연결 테스트" hint="최소 비용의 요청 1회가 발생합니다.">
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() => void runTest('stt')}
            disabled={testing !== null}
          >
            {testing === 'stt' ? '테스트 중…' : `음성 인식 (${PROVIDER_SHORT[settings.sttProvider]})`}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void runTest('translation')}
            disabled={testing !== null}
          >
            {testing === 'translation'
              ? '테스트 중…'
              : `번역 (${PROVIDER_SHORT[settings.translationProvider]})`}
          </button>
        </div>
        {testResult && (
          <>
            <p className={`result ${testResult.ok ? 'is-ok' : 'is-bad'}`}>{testResult.text}</p>
            {testResult.detail && (
              <p className="result">
                <span className="muted">제공자 응답: </span>
                {testResult.detail}
              </p>
            )}
          </>
        )}
      </Field>

      <Field
        label={`${PROVIDER_LABELS[detail]} 단가 (추정 비용 계산용)`}
        hint="앱은 요금 정보를 조회하지 않습니다. 사용 중인 요금제 단가를 직접 입력하면 세션 하단에 추정 비용이 표시됩니다. 비워 두면 금액을 표시하지 않습니다."
      >
        <div className="grid3">
          <NumberInput
            label="STT $/분"
            value={pricing.sttPerMinuteUsd}
            step={0.001}
            onChange={(v) =>
              void patchSettings({
                pricing: { ...settings.pricing, [detail]: { ...pricing, sttPerMinuteUsd: v } }
              })
            }
          />
          <NumberInput
            label="입력 $/1M"
            value={pricing.inputPer1MUsd}
            step={0.01}
            onChange={(v) =>
              void patchSettings({
                pricing: { ...settings.pricing, [detail]: { ...pricing, inputPer1MUsd: v } }
              })
            }
          />
          <NumberInput
            label="출력 $/1M"
            value={pricing.outputPer1MUsd}
            step={0.01}
            onChange={(v) =>
              void patchSettings({
                pricing: { ...settings.pricing, [detail]: { ...pricing, outputPer1MUsd: v } }
              })
            }
          />
        </div>
      </Field>
    </section>
  )
}

/* ---------------------------------------------------------------- 오디오 */

function AudioSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const patchSettings = useStore((s) => s.patchSettings)
  const status = useStore((s) => s.status)
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [testing, setTesting] = useState(false)
  const [testLevel, setTestLevel] = useState(0)
  const [testResult, setTestResult] = useState<string | null>(null)

  const audio = settings.audio
  const running = status === 'capturing'

  const loadMics = async () => {
    try {
      setMics(await listMicrophones())
    } catch (err) {
      setTestResult(`마이크 목록을 읽을 수 없습니다: ${(err as Error).message}`)
    }
  }

  useEffect(() => {
    void loadMics()
  }, [])

  const setAudio = (patch: Partial<typeof audio>) =>
    void patchSettings({ audio: { ...audio, ...patch } })

  const runRecognitionTest = async (mode: 'online' | 'offline') => {
    setTesting(true)
    setTestResult(null)
    try {
      const sample = await captureSample(mode, settings, 5000, setTestLevel)
      if (sample.peak < 0.002) {
        setTestResult(
          mode === 'online'
            ? '소리가 거의 잡히지 않았습니다. 회의 음성이 Windows 기본 재생 장치로 나오는지 확인하세요.'
            : '소리가 거의 잡히지 않았습니다. 마이크 선택과 Windows 마이크 권한을 확인하세요.'
        )
        return
      }
      const result = await window.talkflow.ai.transcribe({
        requestId: crypto.randomUUID(),
        wav: sample.wav,
        durationMs: sample.durationMs,
        languageHint: 'auto',
        languagePair: settings.languagePair
      })
      setTestResult(
        result.ok
          ? `인식 결과 (${result.value.detectedLanguage}): ${result.value.text}`
          : `인식 실패: ${result.error.message}`
      )
    } catch (err) {
      setTestResult(`캡처 실패: ${(err as Error).message}`)
    } finally {
      setTestLevel(0)
      setTesting(false)
    }
  }

  return (
    <section className="section">
      <Field
        label="기본 회의 언어"
        hint="통역할 언어 쌍을 선택합니다. 메인 화면 상태 바에서도 언제든지 변경할 수 있습니다."
      >
        <select
          className="select"
          value={settings.languagePair ?? 'en-ko'}
          onChange={(e) => void patchSettings({ languagePair: e.target.value as LanguagePair })}
        >
          {LANGUAGE_PAIRS.map((lp) => (
            <option key={lp.id} value={lp.id}>
              {lp.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="기본 통역 모드">
        <select
          className="select"
          value={audio.defaultMode}
          onChange={(e) => setAudio({ defaultMode: e.target.value as 'online' | 'offline' })}
        >
          <option value="online">온라인 회의 (시스템 오디오 캡처)</option>
          <option value="offline">오프라인 회의 (마이크 캡처)</option>
        </select>
      </Field>

      <Field
        label="마이크 (오프라인 모드)"
        hint="장치는 이름이 아니라 장치 ID로 저장됩니다. 장치가 사라지면 다시 선택해야 합니다."
      >
        <div className="row">
          <select
            className="select"
            value={audio.micDeviceId}
            onChange={(e) => {
              const dev = mics.find((m) => m.deviceId === e.target.value)
              setAudio({
                micDeviceId: e.target.value,
                micGroupId: dev?.groupId ?? '',
                micLabel: dev?.label ?? ''
              })
            }}
          >
            <option value="">Windows 기본 마이크</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || `마이크 (${m.deviceId.slice(0, 6)}…)`}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => void loadMics()}>
            새로 고침
          </button>
        </div>
        {audio.micDeviceId && !mics.some((m) => m.deviceId === audio.micDeviceId) && (
          <p className="result is-bad">
            저장된 마이크({audio.micLabel || '알 수 없음'})를 찾을 수 없습니다. 다시 선택하세요.
          </p>
        )}
      </Field>

      <Field label="마이크 오디오 처리" hint="회의실 마이크에서는 모두 켜는 편이 안정적입니다.">
        <label className="check">
          <input
            type="checkbox"
            checked={audio.echoCancellation}
            onChange={(e) => setAudio({ echoCancellation: e.target.checked })}
          />
          <span>에코 제거</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={audio.noiseSuppression}
            onChange={(e) => setAudio({ noiseSuppression: e.target.checked })}
          />
          <span>노이즈 억제</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={audio.autoGainControl}
            onChange={(e) => setAudio({ autoGainControl: e.target.checked })}
          />
          <span>자동 게인</span>
        </label>
      </Field>

      <Field
        label="발화 감지 민감도"
        hint="높게 하면 작은 소리도 발화로 잡지만 잡음 오인식과 비용이 늘어납니다."
      >
        <select
          className="select"
          value={audio.vadSensitivity}
          onChange={(e) =>
            setAudio({ vadSensitivity: e.target.value as 'low' | 'medium' | 'high' })
          }
        >
          <option value="low">낮음 (조용한 발화 무시)</option>
          <option value="medium">보통 (권장)</option>
          <option value="high">높음 (작은 소리도 감지)</option>
        </select>
      </Field>

      <div className="grid2">
        <Field label="발화 종료 침묵 (ms)">
          <NumberInput
            value={audio.silenceMs}
            step={50}
            min={300}
            max={2000}
            onChange={(v) => setAudio({ silenceMs: v })}
          />
        </Field>
        <Field label="최대 발화 길이 (ms)">
          <NumberInput
            value={audio.maxUtteranceMs}
            step={1000}
            min={5000}
            max={60000}
            onChange={(v) => setAudio({ maxUtteranceMs: v })}
          />
        </Field>
      </div>

      <Field
        label="캡처 + 실인식 테스트 (5초)"
        hint="실제로 5초를 녹음해 STT까지 수행합니다. AI 요청이 1회 발생합니다."
      >
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={testing || running}
            onClick={() => void runRecognitionTest('online')}
          >
            시스템 오디오
          </button>
          <button
            type="button"
            className="btn"
            disabled={testing || running}
            onClick={() => void runRecognitionTest('offline')}
          >
            마이크
          </button>
        </div>
        {running && <p className="result is-bad">통역 중에는 테스트할 수 없습니다. 먼저 종료하세요.</p>}
        {testing && (
          <div className="testmeter">
            <div className="testmeter__fill" style={{ width: `${Math.round(testLevel * 100)}%` }} />
          </div>
        )}
        {testResult && <p className="result">{testResult}</p>}
      </Field>
    </section>
  )
}

/* ------------------------------------------------------------------ 표시 */

function DisplaySection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const patchSettings = useStore((s) => s.patchSettings)
  const display = settings.display

  const setDisplay = (patch: Partial<typeof display>) =>
    void patchSettings({ display: { ...display, ...patch } })

  return (
    <section className="section">
      <Field label="테마">
        <select
          className="select"
          value={display.theme}
          onChange={(e) => setDisplay({ theme: e.target.value as 'system' | 'light' | 'dark' })}
        >
          <option value="system">시스템 설정 따르기</option>
          <option value="light">라이트</option>
          <option value="dark">다크</option>
        </select>
      </Field>

      <Field label="글자 크기">
        <div className="segmented">
          {(['작게', '보통', '크게', '아주 크게'] as const).map((label, i) => (
            <button
              key={label}
              type="button"
              className={`segmented__btn ${display.fontScale === i ? 'is-active' : ''}`}
              onClick={() => setDisplay({ fontScale: i as 0 | 1 | 2 | 3 })}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="창 옵션">
        <label className="check">
          <input
            type="checkbox"
            checked={display.alwaysOnTop}
            onChange={(e) => {
              void window.talkflow.window.setAlwaysOnTop(e.target.checked)
              setDisplay({ alwaysOnTop: e.target.checked })
            }}
          />
          <span>항상 위에 표시 (Ctrl+Shift+T)</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={display.compact}
            onChange={(e) => {
              void window.talkflow.window.setCompact(e.target.checked)
              setDisplay({ compact: e.target.checked })
            }}
          />
          <span>컴팩트 모드 (좁은 폭에 맞춰 여백 축소)</span>
        </label>
      </Field>
    </section>
  )
}

/* ------------------------------------------------------------------ 기록 */

function HistorySection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const patchSettings = useStore((s) => s.patchSettings)
  const sessionList = useStore((s) => s.sessionList)
  const refreshSessions = useStore((s) => s.refreshSessions)
  const setBanner = useStore((s) => s.setBanner)
  const [confirmClear, setConfirmClear] = useState(false)

  const history = settings.history

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  const exportSession = async (id: string, format: 'json' | 'txt') => {
    const result = await window.talkflow.session.export(id, format)
    if (result.canceled) return
    setBanner(
      result.ok
        ? { kind: 'info', message: `내보냈습니다: ${result.path}` }
        : { kind: 'error', message: result.message ?? '내보내기에 실패했습니다.' }
    )
  }

  const removeSession = async (id: string) => {
    await window.talkflow.session.remove(id)
    await refreshSessions()
  }

  const clearAll = async () => {
    await window.talkflow.session.clearAll()
    await refreshSessions()
    setConfirmClear(false)
    setBanner({ kind: 'info', message: '모든 대화 기록을 삭제했습니다.' })
  }

  return (
    <section className="section">
      <Field label="자동 저장">
        <label className="check">
          <input
            type="checkbox"
            checked={history.autoSave}
            onChange={(e) => void patchSettings({ history: { ...history, autoSave: e.target.checked } })}
          />
          <span>대화 항목이 확정될 때마다 이 PC에 저장 (원본 오디오는 저장하지 않음)</span>
        </label>
      </Field>

      <Field label="보존 기간" hint="앱 시작 시 기간이 지난 세션을 자동으로 삭제합니다.">
        <select
          className="select"
          value={history.retentionDays}
          onChange={(e) =>
            void patchSettings({
              history: { ...history, retentionDays: Number(e.target.value) as 0 | 7 | 30 | 90 }
            })
          }
        >
          <option value={7}>7일</option>
          <option value={30}>30일 (기본)</option>
          <option value={90}>90일</option>
          <option value={0}>무기한 보관</option>
        </select>
      </Field>

      <Field label={`저장된 세션 (${sessionList.length})`}>
        {sessionList.length === 0 ? (
          <p className="muted">저장된 세션이 없습니다.</p>
        ) : (
          <ul className="sessions">
            {sessionList.map((s) => (
              <SessionRow
                key={s.sessionId}
                meta={s}
                onExport={exportSession}
                onDelete={removeSession}
              />
            ))}
          </ul>
        )}
        <div className="row">
          {confirmClear ? (
            <>
              <span className="result is-bad">모든 기록을 삭제할까요? 되돌릴 수 없습니다.</span>
              <button type="button" className="btn btn--danger" onClick={() => void clearAll()}>
                전체 삭제
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setConfirmClear(false)}>
                취소
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirmClear(true)}
                disabled={sessionList.length === 0}
              >
                전체 기록 삭제
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void window.talkflow.app.openUserDataFolder()}
              >
                저장 폴더 열기
              </button>
            </>
          )}
        </div>
      </Field>
    </section>
  )
}

function SessionRow({
  meta,
  onExport,
  onDelete
}: {
  meta: SessionMeta
  onExport: (id: string, format: 'json' | 'txt') => Promise<void>
  onDelete: (id: string) => Promise<void>
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const started = new Date(meta.startedAt)

  return (
    <li className="sessions__row">
      <div className="sessions__info">
        <strong>{started.toLocaleString('ko-KR')}</strong>
        <span className="muted">
          {meta.mode === 'online' ? '온라인' : '오프라인'} · {meta.entryCount}개 항목 ·{' '}
          {(meta.usage.audioSeconds / 60).toFixed(1)}분
          {!meta.endedAt && ' · 진행 중'}
        </span>
      </div>
      <div className="sessions__actions">
        <button type="button" className="btn btn--tiny" onClick={() => void onExport(meta.sessionId, 'txt')}>
          TXT
        </button>
        <button type="button" className="btn btn--tiny" onClick={() => void onExport(meta.sessionId, 'json')}>
          JSON
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              className="btn btn--tiny btn--danger"
              onClick={() => void onDelete(meta.sessionId)}
            >
              삭제 확인
            </button>
            <button type="button" className="btn btn--tiny btn--ghost" onClick={() => setConfirming(false)}>
              취소
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--tiny btn--ghost" onClick={() => setConfirming(true)}>
            삭제
          </button>
        )}
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ 진단 */

function DiagnosticsSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const credentials = useStore((s) => s.credentials)
  const status = useStore((s) => s.status)
  const [items, setItems] = useState<DiagnosticsItem[]>([])
  const [running, setRunning] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.talkflow.app.info().then(setInfo)
  }, [])

  const runAll = async () => {
    setRunning(true)
    const results: DiagnosticsItem[] = []
    const push = (item: DiagnosticsItem) => {
      results.push(item)
      setItems([...results])
    }

    push({
      id: 'consent',
      label: '클라우드 전송 동의',
      ok: settings.consent.accepted,
      detail: settings.consent.accepted
        ? `동의 시각 ${settings.consent.acceptedAt ?? '기록 없음'}`
        : '동의가 필요합니다.'
    })

    // 역할별로 서로 다른 제공자를 쓸 수 있으므로 키와 연결을 각각 점검한다.
    const roles: { role: 'stt' | 'translation'; label: string; provider: ProviderId }[] = [
      { role: 'stt', label: '음성 인식', provider: settings.sttProvider },
      { role: 'translation', label: '번역', provider: settings.translationProvider }
    ]

    for (const { role, label, provider } of roles) {
      const cred = credentials[provider]
      push({
        id: `key-${role}`,
        label: `${label} API Key (${PROVIDER_LABELS[provider]})`,
        ok: !!cred?.hasKey,
        detail: cred?.hasKey
          ? `${cred.preview} · ${cred.persisted ? '암호화 저장됨' : '메모리에만 보관'}`
          : '설정에서 API Key를 입력하세요.'
      })

      if (cred?.hasKey) {
        const test = await window.talkflow.ai.test(role)
        push({
          id: `api-${role}`,
          label: `${label} 연결`,
          ok: test.ok,
          detail: test.ok ? test.value : `${test.error.code}: ${test.error.message}`
        })
      }
    }

    try {
      const mics = await listMicrophones()
      push({
        id: 'mic',
        label: '마이크 장치',
        ok: mics.length > 0,
        detail: mics.length > 0 ? `${mics.length}개 감지: ${mics[0].label || '이름 없음'}` : '마이크를 찾을 수 없습니다.'
      })
    } catch (err) {
      push({ id: 'mic', label: '마이크 장치', ok: false, detail: (err as Error).message })
    }

    if (status !== 'capturing') {
      try {
        const sample = await captureSample('online', settings, 1500)
        push({
          id: 'loopback',
          label: '시스템 오디오 캡처',
          ok: true,
          detail: `1.5초 캡처 성공 (피크 ${sample.peak.toFixed(4)}). ${
            sample.peak < 0.002 ? '소리가 감지되지 않았습니다 — 회의 음성 재생 중에 다시 확인하세요.' : ''
          }`
        })
      } catch (err) {
        push({
          id: 'loopback',
          label: '시스템 오디오 캡처',
          ok: false,
          detail: (err as Error).message
        })
      }
    } else {
      push({
        id: 'loopback',
        label: '시스템 오디오 캡처',
        ok: true,
        detail: '통역이 진행 중이므로 건너뛰었습니다.'
      })
    }

    setRunning(false)
  }

  const copyReport = async () => {
    const lines = [
      'Talk-Flow 진단 리포트',
      `앱 버전   : ${info?.version ?? '-'}`,
      `Electron  : ${info?.electron ?? '-'} / Chromium ${info?.chrome ?? '-'}`,
      `OS        : ${info?.osVersion ?? '-'}`,
      `음성 인식 : ${settings.sttProvider} / ${
        settings.sttProvider === 'openai'
          ? settings.providerConfig.openai.sttModel
          : settings.providerConfig.gemini.sttModel
      }`,
      `번역      : ${settings.translationProvider}`,
      `모드      : ${settings.audio.defaultMode}`,
      '',
      ...items.map((i) => `[${i.ok ? 'OK' : 'FAIL'}] ${i.label} — ${i.detail}`)
    ]
    await window.talkflow.app.copyToClipboard(lines.join('\n'))
  }

  return (
    <section className="section">
      <p className="muted">
        각 항목을 순서대로 점검합니다. AI 연결 테스트는 최소 비용의 요청 1회를 발생시킵니다.
        리포트에는 API Key와 대화 내용이 포함되지 않습니다.
      </p>
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => void runAll()} disabled={running}>
          {running ? '진단 중…' : '전체 진단 실행'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void copyReport()}
          disabled={items.length === 0}
        >
          결과 복사
        </button>
      </div>

      <ul className="diag">
        {items.map((item) => (
          <li key={item.id} className={item.ok ? 'is-ok' : 'is-bad'}>
            <span className="diag__mark" aria-hidden="true">
              {item.ok ? '✓' : '✕'}
            </span>
            <div>
              <strong>{item.label}</strong>
              <span className="muted">{item.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ 정보 */

function AboutSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const patchSettings = useStore((s) => s.patchSettings)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.talkflow.app.info().then(setInfo)
  }, [])

  return (
    <section className="section">
      <Field label="Talk-Flow">
        <p className="muted">
          Windows용 실시간 회의 통역 보조 앱. 상대방의 영어 발화를 영어 원문과 한국어 번역으로
          표시하고, 입력한 한국어를 영어로 번역합니다. 음성 합성(TTS)은 다음 버전에서 제공합니다.
        </p>
      </Field>

      <Field label="버전 정보">
        <ul className="kv">
          <li>
            <span>앱</span>
            <span>{info?.version ?? '-'}</span>
          </li>
          <li>
            <span>Electron</span>
            <span>{info?.electron ?? '-'}</span>
          </li>
          <li>
            <span>Chromium</span>
            <span>{info?.chrome ?? '-'}</span>
          </li>
          <li>
            <span>데이터 폴더</span>
            <span className="ellipsis">{info?.userDataPath ?? '-'}</span>
          </li>
        </ul>
      </Field>

      <Field label="개인정보">
        <p className="muted">
          음성 구간과 번역 텍스트는 선택한 AI 제공자로 전송됩니다. 원본 오디오는 저장하지 않으며,
          앱은 어떤 사용 데이터도 외부로 수집하지 않습니다.
        </p>
        <p className="status-line">
          동의 상태:{' '}
          {settings.consent.accepted ? (
            <span className="badge badge--ok">
              동의 · {settings.consent.acceptedAt?.slice(0, 10) ?? ''}
            </span>
          ) : (
            <span className="badge badge--warn">미동의</span>
          )}
        </p>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => void patchSettings({ consent: { accepted: false } })}
        >
          동의 철회 (통역 기능 잠금)
        </button>
      </Field>
    </section>
  )
}

/* ------------------------------------------------------------ 공용 요소 */

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      {hint && <span className="field__hint">{hint}</span>}
      <div className="field__body">{children}</div>
    </div>
  )
}

/**
 * 모델명 입력 + "목록 조회".
 *
 * 제공자의 모델 ID는 수시로 바뀌고 오타 하나로 404가 난다.
 * 사용자가 자기 키로 실제 호출 가능한 모델을 직접 확인해 고를 수 있게 한다.
 */
function ModelField({
  label,
  hint,
  provider,
  value,
  onChange
}: {
  label: string
  hint?: string
  provider: ProviderId
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const load = async () => {
    setLoading(true)
    setError(null)
    const result = await window.talkflow.ai.listModels(provider)
    if (result.ok) {
      setModels(result.value)
      if (result.value.length === 0) setError('조회된 모델이 없습니다.')
    } else {
      setModels(null)
      setError(
        `${result.error.message}${result.error.hint ? ` (${result.error.hint})` : ''}${
          result.error.detail && result.error.detail !== result.error.message
            ? ` — ${result.error.detail}`
            : ''
        }`
      )
    }
    setLoading(false)
  }

  // 목록에서 고르면 할 일이 끝났으므로 목록을 닫는다. 다시 보려면 조회 버튼을 누른다.
  const pick = (id: string) => {
    onChange(id)
    setModels(null)
    setFilter('')
    setError(null)
  }

  const known = models?.some((m) => m.id === value) ?? null
  const visible = (models ?? []).filter((m) =>
    filter.trim() ? m.id.toLowerCase().includes(filter.trim().toLowerCase()) : true
  )

  return (
    <Field label={label} hint={hint}>
      <div className="row">
        <input
          className="input"
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.trim())}
        />
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? '조회 중…' : '모델 목록 조회'}
        </button>
      </div>

      {known === false && (
        <p className="result is-bad">
          &apos;{value}&apos; 은(는) 조회된 목록에 없습니다. 아래에서 선택하세요.
        </p>
      )}
      {error && <p className="result is-bad">{error}</p>}

      {models && models.length > 0 && (
        <>
          <input
            className="input"
            placeholder={`${models.length}개 모델 검색…`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <ul className="modellist">
            {visible.slice(0, 40).map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`modellist__item ${m.id === value ? 'is-active' : ''}`}
                  onClick={() => pick(m.id)}
                >
                  <code>{m.id}</code>
                  {m.label && m.label !== m.id && <span className="muted">{m.label}</span>}
                </button>
              </li>
            ))}
            {visible.length > 40 && (
              <li className="muted">…그 외 {visible.length - 40}개. 검색어를 좁혀 보세요.</li>
            )}
          </ul>
        </>
      )}
    </Field>
  )
}

function NumberInput({
  label,
  value,
  onChange,
  step = 1,
  min,
  max
}: {
  label?: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
}): React.JSX.Element {
  return (
    <label className="numfield">
      {label && <span>{label}</span>}
      <input
        className="input"
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
    </label>
  )
}
