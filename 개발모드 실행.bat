@echo off
title Talk-Flow Dev
cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing dependencies... please wait.
    call npm install
)

echo.
echo ================================
echo   Talk-Flow - DEV MODE
echo   Closing this window quits the app.
echo ================================
echo.

call npm run dev

echo.
echo App exited.
pause
