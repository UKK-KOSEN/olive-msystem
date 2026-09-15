@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ============================================
rem  olive-msystem - Frontend watchdog (auto-restart)
rem  Runs Next.js on port 3001. If the process dies
rem  it restarts after a short delay. Single-instance
rem  guard prevents double startup.
rem ============================================

set PORT=3001

:check
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 goto start
echo [watchdog] Frontend already running on port %PORT%. Only monitoring...
timeout /t 5 /nobreak >nul
goto check

:start
echo [watchdog] Starting frontend (Next.js on %PORT%)...
if not exist logs mkdir logs
pushd frontend
call npm run start -- -p %PORT% >> ..\logs\frontend.log 2>&1
set EXIT=%errorlevel%
popd
echo [watchdog] Frontend exited (code %EXIT%). Restarting in 3s...
timeout /t 3 /nobreak >nul
goto check
