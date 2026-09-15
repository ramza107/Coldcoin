@echo off
setlocal EnableExtensions
title ReplayFace Mini Client — install GSI

echo.
echo  ReplayFace — install Dota Game State Integration cfg
echo  =====================================================
echo.

set "CFG_SRC=%~dp0..\companion\gamestate_integration_replayface.cfg"
if not exist "%CFG_SRC%" (
  echo ERROR: missing %CFG_SRC%
  pause
  exit /b 1
)

set "DOTA_CFG="
if exist "%ProgramFiles(x86)%\Steam\steamapps\common\dota 2 beta\game\dota\cfg" (
  set "DOTA_CFG=%ProgramFiles(x86)%\Steam\steamapps\common\dota 2 beta\game\dota\cfg"
)
if exist "%ProgramFiles%\Steam\steamapps\common\dota 2 beta\game\dota\cfg" (
  set "DOTA_CFG=%ProgramFiles%\Steam\steamapps\common\dota 2 beta\game\dota\cfg"
)

if "%DOTA_CFG%"=="" (
  echo Could not find default Steam Dota folder.
  echo Paste your Dota "cfg" folder path.
  echo Example:
  echo   D:\SteamLibrary\steamapps\common\dota 2 beta\game\dota\cfg
  set /p DOTA_CFG=Path: 
)

if not exist "%DOTA_CFG%" (
  echo ERROR: folder not found: %DOTA_CFG%
  pause
  exit /b 1
)

set "GSI_DIR=%DOTA_CFG%\gamestate_integration"
if not exist "%GSI_DIR%" mkdir "%GSI_DIR%"
copy /Y "%CFG_SRC%" "%GSI_DIR%\gamestate_integration_replayface.cfg" >nul
if errorlevel 1 (
  echo ERROR: copy failed
  pause
  exit /b 1
)

echo.
echo Installed:
echo   %GSI_DIR%\gamestate_integration_replayface.cfg
echo.
echo Next:
echo   1. Steam - Dota 2 - Properties - Launch Options:
echo        -gamestateintegration
echo   2. Restart Dota
echo   3. Run start.bat
echo   4. Load overwolf-app in Overwolf (unpacked)
echo.
pause
