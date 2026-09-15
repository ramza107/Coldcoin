@echo off
setlocal
cd /d "%~dp0"
title ReplayFace

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Need Node.js LTS once:  https://nodejs.org/
  echo  Install, restart PC, run this again.
  echo.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo Building UI first time...
  call npm install
  call npm run build
  if errorlevel 1 (
    echo Build failed
    pause
    exit /b 1
  )
)

echo.
echo  ReplayFace — one app, no Overwolf
echo  ---------------------------------
echo  1^) Window/server starts
echo  2^) Connect your profile
echo  3^) After games: Last finished / auto-watch
echo  4^) In lobby: paste enemy IDs for live intel
echo.

REM Prefer desktop window if electron can run; else companion+browser
if exist "desktop\start-desktop.bat" (
  call desktop\start-desktop.bat
) else (
  call mini-client\RUN.bat
)
