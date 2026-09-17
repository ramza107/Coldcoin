@echo off
setlocal EnableExtensions
title ReplayFace Mini Client

cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js not found. Install LTS from https://nodejs.org/
  pause
  exit /b 1
)

echo.
echo  ReplayFace Mini Client
echo  ----------------------
echo  Legal live path: Dota GSI + Overwolf GEP -^> companion -^> OpenDota
echo.

if not exist "dist\index.html" (
  echo No prebuilt UI in dist\. Building once...
  if not exist "node_modules\" (
    call npm install
    if errorlevel 1 (
      echo npm install failed
      pause
      exit /b 1
    )
  )
  call npm run build
  if errorlevel 1 (
    echo build failed
    pause
    exit /b 1
  )
) else (
  echo Using prebuilt UI in dist\  ^(no npm build needed^)
)

echo.
echo Starting companion on http://127.0.0.1:17321/
echo Keep this window open while you play.
echo Open Live lobby there ^(NOT GitHub Pages^).
echo.

start "" "http://127.0.0.1:17321/"
node companion\server.mjs
