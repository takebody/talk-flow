import { useState } from 'react'
import { useStore } from '../store'
import { PROVIDER_LABELS } from './providerLabels'

/**
 * 최초 실행 게이트 (NFR-03).
 * 클라우드 전송 동의 없이는 통역 기능에 접근할 수 없다.
 */
export function ConsentGate(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const acceptConsent = useStore((s) => s.acceptConsent)
  const [checked, setChecked] = useState(false)

  return (
    <div className="consent">
      <div className="consent__card">
        <h1>Talk-Flow 시작하기</h1>
        <p className="consent__lead">
          Talk-Flow는 회의 음성과 입력한 문장을 <strong>사용자가 직접 등록한 AI 서비스</strong>로
          전송해 실시간 통역합니다. 시작하기 전에 아래 내용을 확인해 주세요.
        </p>

        <ul className="consent__list">
          <li>
            <strong>클라우드 전송</strong> — 캡처된 음성은{' '}
            {PROVIDER_LABELS[settings.sttProvider]}, 번역할 텍스트는{' '}
            {PROVIDER_LABELS[settings.translationProvider]} 서버로 전송됩니다.
          </li>
          <li>
            <strong>과금</strong> — 사용자의 API Key로 요금이 청구됩니다. 앱은 요금을 대신 부담하지
            않으며, 세션별 사용량을 화면 하단에 표시합니다.
          </li>
          <li>
            <strong>오디오 미저장</strong> — 원본 음성은 저장하지 않습니다. 전송 직후 메모리에서
            해제됩니다.
          </li>
          <li>
            <strong>기록 저장</strong> — 대화 텍스트는 이 PC에만 저장되며 기본 보존 기간은 30일입니다.
            설정에서 언제든 변경·삭제할 수 있습니다.
          </li>
          <li>
            <strong>텔레메트리 없음</strong> — 앱은 사용 데이터를 외부로 수집하지 않습니다.
          </li>
          <li>
            <strong>제공자 변경</strong> — 음성 인식과 번역을 담당할 제공자는 설정에서 각각 바꿀 수
            있습니다.
          </li>
        </ul>

        <p className="consent__warn">
          회의 내용이 외부 서비스로 전송되므로, 사내 보안 정책상 외부 전송이 제한된 회의에는
          사용하지 마세요. 설정에서 사내 정책상 허용된 제공자만 선택하면 전송 대상을 통제할 수 있습니다.
        </p>

        <label className="consent__check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>위 내용을 확인했고, 음성·텍스트의 클라우드 전송에 동의합니다.</span>
        </label>

        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={!checked}
          onClick={() => void acceptConsent()}
        >
          동의하고 계속
        </button>
      </div>
    </div>
  )
}
