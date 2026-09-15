@echo off
cd /d "%~dp0"
echo ReplayFace Mini Client
echo.
if not exist "dist\index.html" (
  echo ERROR: dist\ missing. Re-download the zip.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Install Node.js LTS from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting http://127.0.0.1:17321/  — keep this window open
start "" "http://127.0.0.1:17321/"
node companion\server.mjs
