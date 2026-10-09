@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ============================================
rem  olive-msystem - Backend watchdog (auto-restart)
rem  Runs uvicorn on port 8000. On crash it restarts
rem  with exponential backoff; a crash-loop (<10s
rem  lifetime) backs off further, a healthy long run
rem  resets the counter. The single-instance guard
rem  prevents double startup.
rem ============================================

if not defined BACKEND_PORT if defined PORT set BACKEND_PORT=%PORT%
if not defined BACKEND_PORT set BACKEND_PORT=8000
if not defined BACKEND_HOST if defined HOST set BACKEND_HOST=%HOST%
if not defined BACKEND_HOST set BACKEND_HOST=127.0.0.1
set PORT=%BACKEND_PORT%

rem --- pre-flight: the venv must exist or retrying is pointless ---
if not exist "backend\.venv\Scripts\python.exe" (
  echo [watchdog] [ERROR] backend\.venv\Scripts\python.exe not found.
  echo [watchdog] Run start.bat once to create the venv, then re-run this.
  pause
  exit /b 1
)

set ATTEMPT=0
set RESTARTS=0

:check
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 goto start
echo [watchdog] Backend already running on port %PORT%. Only monitoring...
timeout /t 5 /nobreak >nul
goto check

:start
set /a ATTEMPT+=1
set /a RESTARTS+=1
echo [watchdog] Starting backend (uvicorn on %PORT%) [attempt !ATTEMPT!]...
for /f %%i in ('powershell -NoProfile -Command "[uint64]((Get-Date).ToFileTimeUtc())"') do set START_MS=%%i
if not exist logs mkdir logs
pushd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host %BACKEND_HOST% --port %PORT% 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath ..\logs\backend-uvicorn.log"
set EXIT=%errorlevel%
popd

rem --- elapsed seconds since the process started (locale-safe, via FileTime) ---
set ELAPSED=0
if not defined START_MS goto compute_done
for /f %%i in ('powershell -NoProfile -Command "$d=([uint64]((Get-Date).ToFileTimeUtc())-%START_MS%)/10000000.0; [int]$d"') do set ELAPSED=%%i
:compute_done

echo [watchdog] Backend exited (code %EXIT%, lived !ELAPSED!s). Restarting...
rem --- crash loop detection: quick exit -> exponential backoff ---
set DELAY=3
if !ELAPSED! lss 10 set /a DELAY=2 + %RESTARTS% * 2
if !ELAPSED! geq 10 set RESTARTS=0
if not defined DELAY set DELAY=3
if !DELAY! gtr 30 set DELAY=30
if %RESTARTS% geq 15 (
  echo [watchdog] Backend has crashed %RESTARTS% times right after boot.
  echo [watchdog] Check logs\backend-uvicorn.log. Waiting 60s before retry.
  set DELAY=60
)
echo [watchdog] Waiting !DELAY!s before retry...
timeout /t !DELAY! /nobreak >nul
goto check
