# Talk-Flow

Windows용 실시간 회의 통역 보조 앱. 요구사항은 [PRD.md](PRD.md)를 참조하세요.

- **수신 통역** — 상대방의 영어 음성을 캡처해 영어 원문과 한국어 번역을 함께 표시
- **송신 통역** — 입력한 한국어를 영어로 번역해 같은 대화 스레드에 표시 (복사해서 채팅에 붙여넣거나 직접 읽기)
- **온라인 모드** — Windows 시스템 오디오 루프백 캡처 (Webex / Teams 병행)
- **오프라인 모드** — 마이크 캡처 + 언어 자동 감지 양방향 통역
- **제공자 선택** — OpenAI / Azure OpenAI / Google Gemini

음성 합성(TTS)은 이 버전 범위에서 제외되었습니다.

## 실행

```bash
npm install
```

```bash
npm run dev
```

프로덕션 번들 빌드:

```bash
npm run build
```

Windows 설치 패키지(NSIS + portable) 생성:

```bash
npm run dist
```

## 첫 사용

1. 앱을 실행하면 클라우드 전송 안내가 표시됩니다. 내용을 확인하고 동의합니다.
2. `⚙ 설정 → AI 제공자` 에서 제공자를 선택하고 API Key를 입력한 뒤 **연결 테스트**를 실행합니다.
   - Azure OpenAI는 엔드포인트와 STT/번역 배포명을 함께 입력해야 합니다.
3. 온라인 회의라면 회의 음성이 **Windows 기본 재생 장치**로 나오는지 확인합니다.
   오프라인 회의라면 `설정 → 오디오`에서 마이크를 선택합니다.
4. `설정 → 오디오 → 캡처 + 실인식 테스트(5초)`로 실제 인식 결과를 미리 확인합니다.
5. 메인 화면에서 모드를 고르고 **통역 시작**을 누릅니다.

## 단축키

| 키 | 동작 |
|---|---|
| `Ctrl+Enter` | 입력한 한국어 번역 |
| `Enter` | 입력창 줄바꿈 |
| `Ctrl+Shift+S` | 통역 시작 / 일시정지 |
| `Ctrl+Shift+T` | 항상 위 토글 |
| `Ctrl+Shift+C` | 마지막 영어 번역문 복사 |
| `Ctrl+,` | 설정 열기 |
| `Esc` | 설정 닫기 |

## 구조

```
src/
  shared/      Main·Preload·Renderer 공용 타입, 기본값, 언어 판정
  main/        Electron Main — 창, safeStorage 키 보관, 세션 저장소, AI 어댑터
    providers/ OpenAI / Azure OpenAI / Gemini 어댑터 + 공통 오류 정규화
  preload/     contextBridge로 노출하는 화이트리스트 IPC 표면
  renderer/    React UI
    src/audio/ getDisplayMedia(loopback) · getUserMedia(mic) · AudioWorklet VAD · WAV 인코딩
```

### 보안 경계

- API Key는 **Main 프로세스에만** 존재합니다. 렌더러에 키를 전달하는 IPC 채널이 없습니다.
- 키는 Electron `safeStorage`(Windows DPAPI)로 암호화해 `%APPDATA%/Talk-Flow/credentials.bin`에 저장하며,
  "암호화 저장"을 끄면 프로세스 메모리에만 유지됩니다.
- 렌더러는 `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`로 실행되고
  CSP로 외부 `connect-src`가 차단됩니다. 모든 AI 호출은 Main을 경유합니다.
- 원본 오디오는 저장하지 않습니다. 대화 텍스트만 `%APPDATA%/Talk-Flow/sessions/*.jsonl`에
  append-only로 기록되며 기본 보존 기간은 30일입니다.

## 알려진 제약

- 온라인 모드는 시스템 오디오 **전체**를 캡처합니다. 알림음·음악도 포함될 수 있으므로 회의 중 알림 음소거를 권장합니다.
- 발화 단위(VAD) 처리 방식이므로 부분 자막이 아니라 발화 종료 후 문장 단위로 표시됩니다.
- 오프라인 모드의 언어 자동 감지는 한글/라틴 문자 체계로 판정합니다. 신뢰도가 낮으면 `언어 미확정` 배지가 붙고 수동 재분류가 가능합니다.
- 추정 비용은 `설정 → AI 제공자 → 단가`에 직접 입력한 값으로만 계산됩니다. 앱은 요금 정보를 조회하지 않습니다.
