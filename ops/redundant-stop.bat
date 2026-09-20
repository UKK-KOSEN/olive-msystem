@echo off
setlocal
if not defined BACKEND_PORT set BACKEND_PORT=8000
if not defined STANDBY_PORT set STANDBY_PORT=8001
if not defined FRONTEND_PORT set FRONTEND_PORT=3001
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0redundant-monitor.ps1" -Stop -PrimaryPort "%BACKEND_PORT%" -StandbyPort "%STANDBY_PORT%" -FrontendPort "%FRONTEND_PORT%"
endlocal
exit /b %ERRORLEVEL%
