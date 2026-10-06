@echo off
chcp 65001 > nul
title Talk-Flow (Backend + Frontend)
cd /d "%~dp0"

echo ====================================================================
echo   Talk-Flow 개발 모드 실행
echo   - 백엔드 (Electron Main Process)
echo   - 프론트엔드 (Vite + React 19 UI)
echo ====================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 goto NO_NODE

if exist "node_modules" goto RUN_DEV

echo [알림] 의존성 패키지를 설치합니다. 잠시만 기다려 주세요...
echo.
call npm install
if %errorlevel% neq 0 goto INSTALL_ERROR
echo.
echo [완료] 패키지 설치가 완료되었습니다.
echo.

:RUN_DEV
rem 괄호 블록 안에서는 echo 문장의 닫는 괄호가 블록을 먼저 닫아 버린다.
rem 그래서 아래는 if ( ) 블록 대신 goto 로 분기한다.
if exist "node_modules\electron\dist\electron.exe" goto RUN_APP

echo [알림] Electron 실행 파일 바이너리를 확인하고 복구합니다...
call node node_modules\electron\install.js

:RUN_APP

echo [알림] 백엔드와 프론트엔드를 동시에 실행합니다...
echo [안내] 앱을 종료하려면 이 창을 닫으세요.
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
echo [알림] 앱이 종료되었습니다.
pause