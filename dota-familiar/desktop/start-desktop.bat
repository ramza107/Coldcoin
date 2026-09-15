@echo off
setlocal
cd /d "%~dp0.."
title ReplayFace
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org/ then restart PC
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo Building UI...
  call npm run build
)

if not exist "node_modules\electron" (
  echo Installing Electron once...
  call npm install --no-save electron@33.2.1
)

echo Starting ReplayFace desktop...
npx --yes electron@33.2.1 desktop\main.cjs
if errorlevel 1 pause
