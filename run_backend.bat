@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ============================================
rem  olive-msystem - Backend watchdog (auto-restart)
rem  Runs uvicorn on port 8000. If the process dies
rem  (crash) it restarts after a short delay. The
rem  single-instance guard prevents double startup.
rem ============================================

if not defined BACKEND_PORT if defined PORT set BACKEND_PORT=%PORT%
if not defined BACKEND_PORT set BACKEND_PORT=8000
if not defined BACKEND_HOST if defined HOST set BACKEND_HOST=%HOST%
if not defined BACKEND_HOST set BACKEND_HOST=127.0.0.1
set PORT=%BACKEND_PORT%

:check
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 goto start
echo [watchdog] Backend already running on port %PORT%. Only monitoring...
timeout /t 5 /nobreak >nul
goto check

:start
echo [watchdog] Starting backend (uvicorn on %PORT%)...
if not exist logs mkdir logs
pushd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host %BACKEND_HOST% --port %PORT% >> ..\logs\backend-uvicorn.log 2>&1
set EXIT=%errorlevel%
popd
echo [watchdog] Backend exited (code %EXIT%). Restarting in 3s...
timeout /t 3 /nobreak >nul
goto check
