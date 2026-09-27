@echo off
title Talk-Flow Build
cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing dependencies... please wait.
    call npm install
)

echo.
echo ================================
echo   Talk-Flow - BUILD INSTALLER
echo ================================
echo.

call npm run dist

echo.
echo Done. Check the "release" folder for the exe file.
pause
