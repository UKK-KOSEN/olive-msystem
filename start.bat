@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ================================================================
rem  olive-msystem - all-in-one launcher
rem  Bootstraps everything a fresh checkout needs and starts the
rem  backend/frontend watchdog processes:
rem    - Python venv       (backend\.venv, auto-created)
rem    - backend deps      (pip install -r backend\requirements.txt, idempotent)
rem    - olive-p engine    (cloned to external\olive-p on first run unless
rem                         OLIVE_P_DIR/env or an existing checkout is found)
rem    - frontend deps     (npm install when node_modules is missing)
rem    - frontend build    (npm run build when .next\BUILD_ID is missing)
rem    - detection engine  (olive-p / upscaler / ffmpeg health check)
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
set EXTERNAL_OLIVE_P=external\olive-p

echo ================================================================
echo   olive-msystem launcher (watchdog + detection engine)
echo   Backend  (FastAPI)  : http://%BACKEND_HOST%:%BACKEND_PORT%
echo   Frontend (Next.js)  : http://localhost:%FRONTEND_PORT%
echo   Duplicate-start guard + auto-restart enabled
echo ================================================================
echo.

rem ---- 0. detection engine (olive-p) source ----
rem    Prefer an explicit OLIVE_P_DIR; otherwise use an existing checkout
rem    (bundled external\olive-p or the legacy well-known path). Only when
rem    nothing exists do we clone from GitHub so a fresh machine boots fully
rem    self-contained.
if defined OLIVE_P_DIR (
  echo [OK]   OLIVE_P_DIR set: %OLIVE_P_DIR%
) else if exist "%EXTERNAL_OLIVE_P%\src\runtime.py" (
  echo [OK]   Detection engine found: %EXTERNAL_OLIVE_P%
) else if exist "%USERPROFILE%\Downloads\olive-p\src\runtime.py" (
  echo [OK]   Detection engine found ^(existing checkout^): %USERPROFILE%\Downloads\olive-p
) else (
  echo [SETUP] olive-p not found under external\olive-p. Fetching detection engine...
  git --version >nul 2>&1
  if errorlevel 1 goto :err_git
  if not exist "external" mkdir external
  echo [SETUP] git clone https://github.com/UKK-KOSEN/olive-vision-ai.git ^(olive-p^) ...
  git clone --depth 1 https://github.com/UKK-KOSEN/olive-vision-ai.git "%EXTERNAL_OLIVE_P%"
  if errorlevel 1 goto :err_olivep
  echo [OK]   Detection engine cloned: %EXTERNAL_OLIVE_P%
)

rem ---- 1. Python venv (create when missing) + backend deps ----
if not exist "%VENV_PY%" (
  echo [SETUP] Creating Python venv...
  py -m venv backend\.venv
  if errorlevel 1 goto :err_venv
) else (
  echo [OK]   Python venv found: %VENV_PY%
)
echo [SETUP] Ensuring backend Python deps are up to date...
"%VENV_PY%" -m pip install --disable-pip-version-check -r backend\requirements.txt
if errorlevel 1 goto :err_venv
echo [OK]   Backend deps ready.

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

:err_git
echo.
echo [ERROR] git was not found, but it is required to fetch the olive-p
echo         detection engine. Install Git for Windows (https://git-scm.com)
echo         and re-run start.bat, or set OLIVE_P_DIR to an existing olive-p.
pause
exit /b 1

:err_olivep
echo.
echo [ERROR] Failed to clone the olive-p detection engine into external\olive-p.
echo         Check your network/credentials, or set OLIVE_P_DIR to an existing olive-p.
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
