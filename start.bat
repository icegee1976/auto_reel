@echo off
setlocal
title Auto Reel Launcher
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo Auto Reel failed to start. Error code: %EXITCODE%
  echo.
  pause
  exit /b %EXITCODE%
)
