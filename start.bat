@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ================================================================
rem  olive-msystem - all-in-one launcher
rem  Sets up the environment (venv / node_modules / frontend build),
rem  verifies the detection engine (olive-p + upscaler + ffmpeg) and
rem  starts the backend/frontend watchdog processes.
rem
rem  Usage:
rem    start.bat                full setup + watchdogs (recommended)
rem    start.bat check          verify environment, do not start daemons
rem    start.bat backend        setup + run backend in foreground
rem    start.bat frontend       setup + run frontend in foreground
rem ================================================================

if not defined BACKEND_PORT set BACKEND_PORT=8000
if not defined BACKEND_HOST set BACKEND_HOST=127.0.0.1
if not defined FRONTEND_PORT set FRONTEND_PORT=3001
if not defined BACKEND_URL set BACKEND_URL=http://127.0.0.1:%BACKEND_PORT%
set VENV_PY=backend\.venv\Scripts\python.exe

echo ================================================================
echo   olive-msystem launcher (watchdog + detection engine)
echo   Backend  (FastAPI)  : http://%BACKEND_HOST%:%BACKEND_PORT%
echo   Frontend (Next.js)  : http://localhost:%FRONTEND_PORT%
echo   Duplicate-start guard + auto-restart enabled
echo ================================================================
echo.

rem ---- 1. Python venv (create + install when missing) ----
if not exist "%VENV_PY%" (
  echo [SETUP] Creating Python venv...
  py -m venv backend\.venv
  if errorlevel 1 goto :err_venv
  echo [SETUP] Installing backend requirements for the first time...
  "%VENV_PY%" -m pip install -r backend\requirements.txt
  if errorlevel 1 goto :err_venv
) else (
  echo [OK]   Python venv found: %VENV_PY%
)

rem ---- 2. frontend node_modules (install when missing) ----
if not exist "frontend\node_modules" (
  echo [SETUP] npm install frontend deps...
  pushd frontend
  call npm install
  set NPM_RC=!errorlevel!
  popd
  if not "!NPM_RC!"=="0" goto :err_npm
) else (
  echo [OK]   node_modules found.
)

rem ---- 3. frontend build (.next), skipped when running backend only ----
if /I not "%~1"=="backend" (
  if not exist "frontend\.next\BUILD_ID" (
    echo [SETUP] Building frontend via npm run build...
    pushd frontend
    call npm run build
    set BUILD_RC=!errorlevel!
    popd
    if not "!BUILD_RC!"=="0" goto :err_build
  ) else (
    echo [OK]   Frontend build .next found.
  )
)

rem ---- 4. detection engine check (olive-p / upscaler / ffmpeg) ----
echo.
echo [CHECK] Detection engine (olive-p / upscaler / ffmpeg)...
"%VENV_PY%" ops\check_env.py
set ENV_RC=!errorlevel!
echo.
if not "!ENV_RC!"=="0" (
  echo [WARN] One or more checks reported problems. See the list above.
  echo        Press any key to continue anyway, or close this window.
  pause >nul
)

rem ---- 5. route modes ----
if "%~1"=="check" goto :run_check
if "%~1"=="backend" goto :run_backend
if "%~1"=="frontend" goto :run_frontend

echo [START] Backend watchdog ...
start "olive-backend-watchdog" cmd /k "cd /d %~dp0 && run_backend.bat"
echo [START] Frontend watchdog ...
start "olive-frontend-watchdog" cmd /k "cd /d %~dp0 && run_frontend.bat"

echo.
echo Open http://localhost:%FRONTEND_PORT% in your browser.
echo Close the watchdog windows to stop the app.
timeout /t 3 /nobreak >nul
endlocal
exit /b 0

:err_venv
echo.
echo [ERROR] Failed to create/install the Python venv.
echo         Fix the error above and re-run start.bat.
pause
exit /b 1

:err_npm
echo.
echo [ERROR] npm install failed. Fix the error above and re-run start.bat.
pause
exit /b 1

:err_build
echo.
echo [ERROR] Frontend build failed. Fix the error above and re-run start.bat.
pause
exit /b 1

rem ---- foreground modes (for debugging) ----
:run_check
echo [CHECK-DONE] Environment and detection engine checked. No daemon started.
exit /b 0

:run_backend
cd /d "%~dp0backend"
set HOST=%BACKEND_HOST%
set PORT=%BACKEND_PORT%
.venv\Scripts\python.exe -m uvicorn app.main:app --host %BACKEND_HOST% --port %BACKEND_PORT%
exit /b 0

:run_frontend
cd /d "%~dp0frontend"
set BACKEND_URL=%BACKEND_URL%
call npm run start -- -p %FRONTEND_PORT%
exit /b 0
