@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ============================================
rem  olive-msystem - Frontend watchdog (auto-restart)
rem  Runs Next.js on port 3001. On crash it restarts
rem  with exponential backoff; a crash-loop (<10s
rem  lifetime) backs off further, a healthy long run
rem  resets the counter. Single-instance guard
rem  prevents double startup.
rem ============================================

if not defined FRONTEND_PORT set FRONTEND_PORT=3001
set PORT=%FRONTEND_PORT%

rem --- pre-flight: production build and node_modules must exist ---
if not exist "frontend\node_modules" (
  echo [watchdog] [ERROR] frontend\node_modules not found.
  echo [watchdog] Run start.bat once to install dependencies, then re-run this.
  pause
  exit /b 1
)
if not exist "frontend\.next\BUILD_ID" (
  echo [watchdog] [ERROR] frontend\.next\BUILD_ID not found.
  echo [watchdog] Run "npm run build" in frontend/ or re-run start.bat.
  pause
  exit /b 1
)

set ATTEMPT=0
set RESTARTS=0

:check
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 goto start
echo [watchdog] Frontend already running on port %PORT%. Only monitoring...
timeout /t 5 /nobreak >nul
goto check

:start
set /a ATTEMPT+=1
set /a RESTARTS+=1
echo [watchdog] Starting frontend (Next.js on %PORT%) [attempt !ATTEMPT!]...
for /f %%i in ('powershell -NoProfile -Command "[uint64]((Get-Date).ToFileTimeUtc())"') do set START_MS=%%i
if not exist logs mkdir logs
pushd frontend
call npm run start -- -p %PORT% >> ..\logs\frontend.log 2>&1
set EXIT=%errorlevel%
popd

rem --- elapsed seconds since the process started (locale-safe, via FileTime) ---
set ELAPSED=0
if not defined START_MS goto compute_done
for /f %%i in ('powershell -NoProfile -Command "$d=([uint64]((Get-Date).ToFileTimeUtc())-%START_MS%)/10000000.0; [int]$d"') do set ELAPSED=%%i
:compute_done

echo [watchdog] Frontend exited (code %EXIT%, lived !ELAPSED!s). Restarting...
rem --- crash loop detection: quick exit -> exponential backoff ---
set DELAY=3
if !ELAPSED! lss 10 set /a DELAY=2 + %RESTARTS% * 2
if !ELAPSED! geq 10 set RESTARTS=0
if not defined DELAY set DELAY=3
if !DELAY! gtr 30 set DELAY=30
if %RESTARTS% geq 15 (
  echo [watchdog] Frontend has crashed %RESTARTS% times right after boot.
  echo [watchdog] Check logs\frontend.log. Waiting 60s before retry.
  set DELAY=60
)
echo [watchdog] Waiting !DELAY!s before retry...
timeout /t !DELAY! /nobreak >nul
goto check
