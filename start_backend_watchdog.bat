:backend_watchdog
setlocal enabledelayedexpansion
cd /d "%~dp0"
if not defined BACKEND_PORT set BACKEND_PORT=8000
if not defined BACKEND_HOST set BACKEND_HOST=127.0.0.1
set PORT=%BACKEND_PORT%
if not exist "backend\.venv\Scripts\python.exe" (
  echo [watchdog] [ERROR E002] backend\.venv\Scripts\python.exe not found.
  echo         Run start.bat once to create the venv.
  pause
  exit /b 1
)
if not exist logs mkdir logs
set ATTEMPT=0
set RESTARTS=0
:check_b
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 goto start_b
echo [watchdog] Backend already running on port %PORT%. Only monitoring...
timeout /t 5 /nobreak >nul
goto check_b
:start_b
set /a ATTEMPT+=1
set /a RESTARTS+=1
echo [watchdog] Starting backend (uvicorn on %PORT%) [attempt !ATTEMPT!]...
for /f %%i in ('powershell -NoProfile -Command "[uint64]((Get-Date).ToFileTimeUtc())"') do set START_MS=%%i
pushd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host %BACKEND_HOST% --port %PORT% 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath ..\logs\backend-uvicorn.log"
set EXIT=%errorlevel%
popd
set ELAPSED=0
if defined START_MS (
  for /f %%i in ('powershell -NoProfile -Command "$d=([uint64]((Get-Date).ToFileTimeUtc())-%START_MS%)/10000000.0; [int]$d"') do set ELAPSED=%%i
)
echo [watchdog] Backend exited (code %EXIT%, lived !ELAPSED!s). Restarting...
set DELAY=3
if !ELAPSED! lss 10 set /a DELAY=2 + %RESTARTS% * 2
if !ELAPSED! geq 10 set RESTARTS=0
if !DELAY! gtr 30 set DELAY=30
if %RESTARTS% geq 15 (
  echo [watchdog] Backend has crashed %RESTARTS% times right after boot. Check logs\backend-uvicorn.log. Waiting 60s before retry.
  set DELAY=60
)
echo [watchdog] Waiting !DELAY!s before retry...
timeout /t !DELAY! /nobreak >nul
goto check_b
