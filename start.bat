@echo off
chcp 65001 > nul
title Talk-Flow (Backend + Frontend)
cd /d "%~dp0"

echo ====================================================================
echo   Talk-Flow 통합 개발 환경 실행
echo   - 백엔드 (Electron Main Process : AI 어댑터, 세션 저장소, IPC)
echo   - 프론트엔드 (Vite + React 19 UI : 오디오 캡처 VAD, 대화창)
echo ====================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 goto NO_NODE

if exist "node_modules" goto RUN_DEV

echo [알림] node_modules 폴더가 없습니다. 의존성 패키지를 먼저 설치합니다...
echo.
call npm install
if %errorlevel% neq 0 goto INSTALL_ERROR
echo.
echo [완료] 패키지 설치가 완료되었습니다.
echo.

:RUN_DEV
if not exist "node_modules\electron\dist\electron.exe" (
    echo [알림] Electron 실행 파일(바이너리) 확인 및 복구 중...
    call node node_modules\electron\install.js
)

echo [알림] 백엔드(Electron Main)와 프론트엔드(Vite React)를 동시에 실행합니다...
echo [안내] 앱을 종료하려면 이 콘솔 창을 닫거나 Ctrl+C를 누르세요.
echo.

call npm run dev
goto APP_END

:NO_NODE
echo.
echo [오류] Node.js가 설치되어 있지 않거나 PATH에 등록되지 않았습니다.
echo https://nodejs.org 에서 Node.js를 설치해 주세요.
goto APP_END

:INSTALL_ERROR
echo.
echo [오류] 패키지 설치(npm install)에 실패했습니다.
goto APP_END

:APP_END
echo.
echo [알림] 작업이 완료되었거나 애플리케이션이 종료되었습니다.
pause