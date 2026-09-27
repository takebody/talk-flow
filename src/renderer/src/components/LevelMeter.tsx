import { useStore } from '../store'

export function LevelMeter(): React.JSX.Element {
  const level = useStore((s) => s.level)
  const speaking = useStore((s) => s.speaking)
  const active = useStore((s) => s.status === 'capturing')

  const segments = 12
  const lit = active ? Math.round(level * segments) : 0

  return (
    <div
      className="meter"
      role="meter"
      aria-label="입력 레벨"
      aria-valuenow={Math.round(level * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={`meter__seg ${i < lit ? (speaking ? 'is-speech' : 'is-on') : ''}`}
        />
      ))}
    </div>
  )
}
