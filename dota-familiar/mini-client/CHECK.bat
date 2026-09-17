@echo off
cd /d "%~dp0"
title ReplayFace CHECK
echo === ReplayFace diagnostics ===
echo Folder: %CD%
echo.
echo [1] dist\index.html
if exist dist\index.html (echo   OK) else (echo   MISSING)
echo [2] companion\server.mjs
if exist companion\server.mjs (echo   OK) else (echo   MISSING)
echo [3] Node.js
where node 2>nul && node -v || echo   MISSING - install https://nodejs.org/
echo [4] Port 17321
netstat -ano | findstr ":17321" | findstr "LISTENING" && echo   BUSY || echo   free
echo.
echo Files in this folder:
dir /b
echo.
pause
