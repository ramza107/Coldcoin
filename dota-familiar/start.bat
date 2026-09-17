@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ReplayFace Mini Client
color 0A

echo.
echo ========================================
echo   ReplayFace Mini Client
echo ========================================
echo.
echo Folder: %CD%
echo.
echo Press any key to start...
pause >nul
echo.

if not exist "dist\index.html" (
  echo [ERROR] dist\index.html not found.
  echo Make sure you unzipped ReplayFace-MiniClient-v2 fully.
  echo Current folder must contain: dist, companion, RUN.bat
  echo.
  dir /b
  echo.
  pause
  exit /b 1
)

if not exist "companion\server.mjs" (
  echo [ERROR] companion\server.mjs not found.
  dir /b
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo 1. Install LTS: https://nodejs.org/
  echo 2. Restart computer
  echo 3. Run RUN.bat again
  echo.
  pause
  exit /b 1
)

echo Node found:
where node
node -v
echo.

echo Freeing port 17321 if busy...
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":17321" ^| findstr "LISTENING"') do (
  echo  kill PID %%p
  taskkill /F /PID %%p >nul 2>nul
)

echo.
echo Starting http://127.0.0.1:17321/
echo KEEP THIS WINDOW OPEN
echo Log: companion-run.log
echo.

echo ----- %DATE% %TIME% ----- > companion-run.log
node -v >> companion-run.log 2>&1

start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:17321/"

node companion\server.mjs >> companion-run.log 2>&1
set ERR=%ERRORLEVEL%

echo.
echo Stopped. Code=%ERR%
type companion-run.log
echo.
pause
exit /b %ERR%
