@echo off
setlocal
title ReplayFace — open Overwolf app folder
explorer "%~dp0..\overwolf-app"
echo.
echo In Overwolf:
echo   Settings -^> About -^> Development options -^> Load unpacked extension
echo   Select the folder that just opened (overwolf-app).
echo.
pause
