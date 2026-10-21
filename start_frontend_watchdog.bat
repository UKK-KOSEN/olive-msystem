:frontend_watchdog
setlocal enabledelayedexpansion
cd /d "%~dp0"
if not defined FRONTEND_PORT set FRONTEND_PORT=3001
if not defined BACKEND_URL set BACKEND_URL=http://127.0.0.1:8000
set ATTEMPT=0
set RESTARTS=0
if not exist logs mkdir logs
:check_f
netstat -ano | findstr /R /C:":%FRONTEND_PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 goto start_f
echo [watchdog] Frontend already running on port %FRONTEND_PORT%. Only monitoring...
timeout /t 5 /nobreak >nul
goto check_f
:start_f
set /a ATTEMPT+=1
set /a RESTARTS+=1
echo [watchdog] Starting frontend (Next.js on %FRONTEND_PORT%) [attempt !ATTEMPT!]...
for /f %%i in ('powershell -NoProfile -Command "[uint64]((Get-Date).ToFileTimeUtc())"') do set START_MS=%%i
pushd frontend
set BACKEND_URL=%BACKEND_URL%
call npm run start -- -p %FRONTEND_PORT% >> ..\logs\frontend-next.log 2>&1
set EXIT=%errorlevel%
popd
set ELAPSED=0
if defined START_MS (
  for /f %%i in ('powershell -NoProfile -Command "$d=([uint64]((Get-Date).ToFileTimeUtc())-%START_MS%)/10000000.0; [int]$d"') do set ELAPSED=%%i
)
echo [watchdog] Frontend exited (code %EXIT%, lived !ELAPSED!s). Restarting...
set DELAY=3
if !ELAPSED! lss 10 set /a DELAY=2 + %RESTARTS% * 2
if !ELAPSED! geq 10 set RESTARTS=0
if !DELAY! gtr 30 set DELAY=30
if %RESTARTS% geq 15 (
  echo [watchdog] Frontend has crashed %RESTARTS% times right after boot. Check logs\frontend-next.log. Waiting 60s before retry.
  set DELAY=60
)
echo [watchdog] Waiting !DELAY!s before retry...
timeout /t !DELAY! /nobreak >nul
goto check_f
