import type { CaptureMode, Lang, LanguagePair } from '@shared/types'
import { LANGUAGE_PAIRS, LANG_LABELS } from '@shared/defaults'

/*
 * 모드 아이콘과 국기.
 *
 * Windows의 Chromium은 국기 이모지(🇺🇸)를 그리지 못하고 "US" 같은 글자로
 * 표시하므로 국기는 인라인 SVG로 직접 그린다. 외부 이미지·폰트를 쓰지 않아
 * 오프라인과 CSP 제약에서도 그대로 동작한다.
 */

/* ------------------------------------------------------------ 모드 아이콘 */

export function ModeIcon({ mode }: { mode: CaptureMode }): React.JSX.Element {
  return (
    <svg
      className={`icon icon--mode icon--${mode}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {mode === 'online' ? (
        // 화상 회의: 모니터 속 참석자
        <>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
          <circle cx="12" cy="8.5" r="2.5" />
          <path d="M7.5 15a4.5 3.5 0 0 1 9 0" />
        </>
      ) : (
        // 대면 회의: 마주 앉은 참석자들
        <>
          <circle cx="9" cy="7" r="3.5" />
          <path d="M2.5 20v-1.5A4.5 4.5 0 0 1 7 14h4a4.5 4.5 0 0 1 4.5 4.5V20" />
          <path d="M16 3.5a3.5 3.5 0 0 1 0 7" />
          <path d="M19 14.2a4.5 4.5 0 0 1 2.5 4.3V20" />
        </>
      )}
    </svg>
  )
}

export const MODE_LABELS: Record<CaptureMode, string> = {
  online: '온라인 회의',
  offline: '오프라인 회의'
}

/** 아이콘 + 모드 이름 */
export function ModeLabel({
  mode,
  suffix,
  short
}: {
  mode: CaptureMode
  suffix?: string
  short?: boolean
}): React.JSX.Element {
  const text = short ? (mode === 'online' ? '온라인' : '오프라인') : MODE_LABELS[mode]
  return (
    <span className="withicon">
      <ModeIcon mode={mode} />
      <span>
        {text}
        {suffix && <span className="withicon__suffix"> {suffix}</span>}
      </span>
    </span>
  )
}

/* ------------------------------------------------------------------- 국기 */

const KR_ANGLE = (Math.atan2(2, 3) * 180) / Math.PI // 태극기 대각선 기울기 ≈ 33.69°

/** 괘 하나. 막대 3개, broken이면 가운데가 끊긴다. 위→아래 순서. */
function Trigram({
  x,
  y,
  rotate,
  broken
}: {
  x: number
  y: number
  rotate: number
  broken: [boolean, boolean, boolean]
}): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`} fill="#000">
      {broken.map((b, i) => {
        const by = -2 + i * 1.5
        return b ? (
          <g key={i}>
            <rect x={-3} y={by} width={2.75} height={1} />
            <rect x={0.25} y={by} width={2.75} height={1} />
          </g>
        ) : (
          <rect key={i} x={-3} y={by} width={6} height={1} />
        )
      })}
    </g>
  )
}

function FlagKR(): React.JSX.Element {
  const rad = (KR_ANGLE * Math.PI) / 180
  const dx = 11 * Math.cos(rad)
  const dy = 11 * Math.sin(rad)
  const tilt = 90 - KR_ANGLE
  return (
    <>
      <rect width="36" height="24" fill="#fff" />
      <g transform={`rotate(${KR_ANGLE} 18 12)`}>
        <circle cx="18" cy="12" r="6" fill="#0047a0" />
        {/* 빨강(양)은 위, 파랑(음)은 아래. 좌상단에서 빨강이, 우하단에서 파랑이 파고든다. */}
        <path d="M12 12A6 6 0 0 1 24 12A3 3 0 0 0 18 12A3 3 0 0 1 12 12Z" fill="#cd2e3a" />
      </g>
      {/* 건(좌상) · 감(우상) · 리(좌하) · 곤(우하) */}
      <Trigram x={18 - dx} y={12 - dy} rotate={-tilt} broken={[false, false, false]} />
      <Trigram x={18 + dx} y={12 - dy} rotate={tilt} broken={[true, false, true]} />
      <Trigram x={18 - dx} y={12 + dy} rotate={tilt} broken={[false, true, false]} />
      <Trigram x={18 + dx} y={12 + dy} rotate={-tilt} broken={[true, true, true]} />
    </>
  )
}

function FlagUS(): React.JSX.Element {
  const stripe = 24 / 13
  const stars: React.JSX.Element[] = []
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      stars.push(
        <circle key={`${r}-${c}`} cx={1.6 + c * 2.8 + (r % 2) * 1.4} cy={1.7 + r * 2.9} r={0.55} />
      )
    }
  }
  return (
    <>
      <rect width="36" height="24" fill="#fff" />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} y={i * 2 * stripe} width="36" height={stripe} fill="#b22234" />
      ))}
      <rect width="15.5" height={stripe * 7} fill="#3c3b6e" />
      <g fill="#fff">{stars}</g>
    </>
  )
}

function FlagJP(): React.JSX.Element {
  return (
    <>
      <rect width="36" height="24" fill="#fff" />
      <circle cx="18" cy="12" r="7.2" fill="#bc002d" />
    </>
  )
}

export function Flag({ lang }: { lang: Lang }): React.JSX.Element {
  return (
    <svg className="flag" viewBox="0 0 36 24" aria-hidden="true">
      {lang === 'en' ? <FlagUS /> : lang === 'ja' ? <FlagJP /> : <FlagKR />}
    </svg>
  )
}

/** 국기 + 언어 이름 */
export function LangLabel({ lang }: { lang: Lang }): React.JSX.Element {
  return (
    <span className="withicon">
      <Flag lang={lang} />
      <span>{LANG_LABELS[lang]}</span>
    </span>
  )
}

/** "🇺🇸 영어 ⇄ 🇰🇷 한국어" */
export function LangPairLabel({ pair }: { pair: LanguagePair }): React.JSX.Element {
  const lp = LANGUAGE_PAIRS.find((p) => p.id === pair) ?? LANGUAGE_PAIRS[0]
  return (
    <span className="withicon withicon--pair" aria-label={lp.label}>
      <LangLabel lang={lp.langs[0]} />
      <span className="withicon__arrow" aria-hidden="true">
        ⇄
      </span>
      <LangLabel lang={lp.langs[1]} />
    </span>
  )
}
