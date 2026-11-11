import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * 렌더링 중 예외가 나도 빈 화면만 남지 않게 한다.
 *
 * React는 처리되지 않은 렌더링 오류가 나면 트리 전체를 내려 버린다. 회의 중에
 * 화면이 하얗게 비면 사용자는 무슨 일인지 알 수 없으므로, 오류 내용과
 * 다시 불러오기 버튼을 보여 준다.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] 렌더링 오류:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="boot">
        <p>
          <strong>화면을 표시하는 중 오류가 발생했습니다.</strong>
        </p>
        <p className="muted">
          {isStaleBridge(error)
            ? '앱이 업데이트되었지만 아직 다시 시작되지 않았습니다. 앱을 완전히 종료한 뒤 다시 실행하세요.'
            : error.message}
        </p>
        <button type="button" className="btn btn--primary" onClick={() => location.reload()}>
          다시 불러오기
        </button>
      </div>
    )
  }
}

/**
 * 개발 모드(`npm run dev`)는 화면 코드만 즉시 바뀌고 Main·Preload는 재시작 전까지
 * 예전 코드로 남는다. 새 화면이 아직 없는 IPC 함수를 부르면 이 오류가 난다.
 */
export function isStaleBridge(error: unknown): boolean {
  return error instanceof TypeError && /is not a function|Cannot read properties of undefined/.test(error.message)
}
