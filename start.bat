@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ================================================================
rem  olive-msystem - all-in-one launcher
rem  Bootstraps everything a fresh checkout needs and starts the
rem  backend/frontend watchdog processes:
rem    - prerequisite tools (git / Python / Node / ffmpeg, auto-installed via
rem      winget when missing - PATH is rebuilt afterwards in this same session)
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
echo   Prerequisites auto-install + duplicate-start guard enabled
echo ================================================================
echo.

rem ---- 0. prerequisite tools (git / python / node / ffmpeg) ----
rem    Auto-installs missing tools via winget so a fresh Windows machine
rem    needs zero manual steps. After installing, PATH is rebuilt from the
rem    registry so the new tools resolve in THIS session (no window restart).
set NEED_INSTALL=0
set NEEDED_TOOLS=

where git >nul 2>&1
if not errorlevel 1 ( echo [OK]   git     : found ) else ( set NEED_INSTALL=1 & set NEEDED_TOOLS=!NEEDED_TOOLS! git )
where py >nul 2>&1
if not errorlevel 1 ( echo [OK]   python  : found ^(py launcher^) ) else (
  where python >nul 2>&1
  if not errorlevel 1 ( echo [OK]   python  : found ) else ( set NEED_INSTALL=1 & set NEEDED_TOOLS=!NEEDED_TOOLS! python )
)
where node >nul 2>&1
if not errorlevel 1 ( echo [OK]   node    : found ) else ( set NEED_INSTALL=1 & set NEEDED_TOOLS=!NEEDED_TOOLS! node )
where npm >nul 2>&1
if not errorlevel 1 ( echo [OK]   npm     : found ) else ( set NEED_INSTALL=1 & set NEEDED_TOOLS=!NEEDED_TOOLS! npm )
where ffmpeg >nul 2>&1
if not errorlevel 1 ( echo [OK]   ffmpeg  : found ) else ( set NEED_INSTALL=1 & set NEEDED_TOOLS=!NEEDED_TOOLS! ffmpeg )

if "!NEED_INSTALL!"=="1" (
  echo.
  echo [SETUP] Missing tools:!NEEDED_TOOLS!
  echo [SETUP] Installing prerequisites via winget ^(one-time, may take a few minutes^)...
  where winget >nul 2>&1
  if errorlevel 1 goto :err_winget

  where git >nul 2>&1
  if errorlevel 1 (
    winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
    if errorlevel 1 goto :err_tools
echo [ERROR E001] Required tools installation failed / 必要なツールのインストールに失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   Git / Python / Node.js / ffmpeg のいずれかのインストールに失敗しました。
echo   Installation of Git / Python / Node.js / ffmpeg failed.
echo.
echo [CAUSE / 考えられる原因]
echo   - winget が利用できない / winget is not available
echo   - ネットワーク接続の問題 / Network connection issue
echo   - パッケージソースへのアクセス制限 / Package source access restricted
echo.
echo [ACTION / 対処方法]
echo   1. 手動で必要なツールをインストールしてください / Install required tools manually:
echo      - Git for Windows : https://git-scm.com/download/win
echo      - Python 3.12     : https://www.python.org/downloads/
echo      - Node.js LTS     : https://nodejs.org/
echo      - ffmpeg           : https://www.gyan.dev/ffmpeg/builds/ or winget ffmpeg
echo   2. PATH に追加後、新しいコマンドプロンプトで start.bat を再実行してください
echo      After adding to PATH, open a NEW Command Prompt and re-run start.bat
echo   3. それでも解決しない場合は start.bat check で環境を診断してください
echo      If still failing, run "start.bat check" to diagnose the environment
echo.
pause
exit /b 1

:err_venv
echo.
echo [ERROR E002] Python venv creation/installation failed / Python仮想環境の作成・セットアップに失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   backend\.venv の作成または依存パッケージのインストールに失敗しました。
echo   Failed to create backend\.venv or install backend dependencies.
echo.
echo [CAUSE / 考えられる原因]
echo   - pip / setuptools / wheel の破損 / Broken pip/setuptools/wheel
echo   - requirements.txt の依存関係競合 / Dependency conflicts in requirements.txt
echo   - ディスク容量不足 / Insufficient disk space
echo   - プロキシ/ファイアウォールによる制限 / Proxy/firewall restrictions
echo.
echo [ACTION / 対処方法]
echo   1. ログを確認してください / Check logs: backend\logs or terminal output above
echo   2. 仮想環境を削除して再試行してください / Remove venv and retry:
echo      rmdir /s /q backend\.venv
echo      start.bat
echo   3. pip を更新して再試行してください / Upgrade pip and retry:
echo      backend\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel
echo      backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
echo.
pause
exit /b 1

:err_olivep
echo.
echo [ERROR E003] Failed to clone olive-p detection engine / olive-p検出エンジンのクローンに失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   external\olive-p へのクローンに失敗しました。
echo   Failed to clone the olive-p detection engine into external\olive-p
echo.
echo [CAUSE / 考えられる原因]
echo   - ネットワーク接続 / Network issue
echo   - Git認証・権限 / Git auth/permission issue
echo   - リポジトリアクセス制限 / Repository access restricted
echo.
echo [ACTION / 対処方法]
echo   1. 既存の olive-p を指定してください / Use existing olive-p:
echo      set OLIVE_P_DIR=C:\path\to\olive-p
echo      start.bat
echo   2. 手動でクローンしてください / Clone manually:
echo      git clone <olive-p-repo-url> external\olive-p
echo   3. ネットワーク/プロキシ設定を確認してください / Check network/proxy settings
echo.
pause
exit /b 1

:err_npm
echo.
echo [ERROR E004] npm install failed / npm install に失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   frontend\node_modules のインストールに失敗しました。
echo   Failed to install frontend dependencies via npm install.
echo.
echo [CAUSE / 考えられる原因]
echo   - node_modules の破損 / Corrupted node_modules
echo   - package-lock.json 不整合 / package-lock.json mismatch
echo   - npm キャッシュ不良 / Corrupted npm cache
echo   - ネットワーク/レジストリアクセス制限 / Registry/network restrictions
echo.
echo [ACTION / 対処方法]
echo   1. クリーンインストールを試行してください / Try clean install:
echo      cd frontend
echo      rmdir /s /q node_modules
echo      del package-lock.json (必要な場合のみ / if needed)
echo      npm install
echo   2. npm キャッシュをクリアしてください / Clear npm cache:
echo      npm cache verify
echo      npm cache clean --force (古いnpmの場合 / older npm)
echo   3. ネットワーク設定を確認してください / Check proxy/npm config (npm config get proxy/https-proxy)
echo.
pause
exit /b 1

:err_build
echo.
echo [ERROR E005] Frontend build failed / フロントエンドビルドに失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   npm run build に失敗しました。Next.js アプリのビルドが完了できません。
echo   Next.js build failed. Cannot complete frontend build.
echo.
echo [CAUSE / 考えられる原因]
echo   - TypeScript/ESLint エラー / TypeScript/ESLint errors
echo   - 依存関係の不整合 / Dependency mismatch
echo   - 環境変数不足 / Missing environment variables
echo   - メモリ不足 / Out of memory
echo.
echo [ACTION / 対処方法]
echo   1. 上記のエラーログを確認して修正してください / Review errors above and fix them
echo   2. 開発モードで動作確認してください / Test in dev mode:
echo      cd frontend ^&^& npm run dev
echo   3. キャッシュをクリアして再ビルドしてください / Clear Next cache and rebuild:
echo      cd frontend ^&^& rmdir /s /q .next
echo      npm run build
echo   4. それでも解決しない場合は node_modules を再インストールしてください
echo      Reinstall node_modules if still failing
echo.
pause
exit /b 1

:err_olivep
  echo [OK]   Detection engine cloned: %EXTERNAL_OLIVE_P%
)

rem ---- 2. Python venv (create when missing) + backend deps ----
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

rem ---- 3. frontend node_modules (install when missing) ----
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

rem ---- 4. frontend build (.next), skipped when running backend only ----
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

rem ---- 5. detection engine check (olive-p / upscaler / ffmpeg) ----
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

rem ---- 6. route modes ----
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

:err_winget
echo.
echo [ERROR] The winget package manager was not found, but missing
echo         prerequisites need to be installed. Install the "App Installer"
echo         from the Microsoft Store (or install Git / Python / Node / ffmpeg
echo         manually), then re-run start.bat.
pause
exit /b 1

:err_tools
echo [ERROR E001] Required tools installation failed / 必要なツールのインストールに失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   Git / Python / Node.js / ffmpeg のいずれかのインストールに失敗しました。
echo   Installation of Git / Python / Node.js / ffmpeg failed.
echo.
echo [CAUSE / 考えられる原因]
echo   - winget が利用できない / winget is not available
echo   - ネットワーク接続の問題 / Network connection issue
echo   - パッケージソースへのアクセス制限 / Package source access restricted
echo.
echo [ACTION / 対処方法]
echo   1. 手動で必要なツールをインストールしてください / Install required tools manually:
echo      - Git for Windows : https://git-scm.com/download/win
echo      - Python 3.12     : https://www.python.org/downloads/
echo      - Node.js LTS     : https://nodejs.org/
echo      - ffmpeg           : https://www.gyan.dev/ffmpeg/builds/ or winget ffmpeg
echo   2. PATH に追加後、新しいコマンドプロンプトで start.bat を再実行してください
echo      After adding to PATH, open a NEW Command Prompt and re-run start.bat
echo   3. それでも解決しない場合は start.bat check で環境を診断してください
echo      If still failing, run "start.bat check" to diagnose the environment
echo.
pause
exit /b 1

:err_venv
echo.
echo [ERROR E002] Python venv creation/installation failed / Python仮想環境の作成・セットアップに失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   backend\.venv の作成または依存パッケージのインストールに失敗しました。
echo   Failed to create backend\.venv or install backend dependencies.
echo.
echo [CAUSE / 考えられる原因]
echo   - pip / setuptools / wheel の破損 / Broken pip/setuptools/wheel
echo   - requirements.txt の依存関係競合 / Dependency conflicts in requirements.txt
echo   - ディスク容量不足 / Insufficient disk space
echo   - プロキシ/ファイアウォールによる制限 / Proxy/firewall restrictions
echo.
echo [ACTION / 対処方法]
echo   1. ログを確認してください / Check logs: backend\logs or terminal output above
echo   2. 仮想環境を削除して再試行してください / Remove venv and retry:
echo      rmdir /s /q backend\.venv
echo      start.bat
echo   3. pip を更新して再試行してください / Upgrade pip and retry:
echo      backend\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel
echo      backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
echo.
pause
exit /b 1

:err_olivep
echo.
echo [ERROR E003] Failed to clone olive-p detection engine / olive-p検出エンジンのクローンに失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   external\olive-p へのクローンに失敗しました。
echo   Failed to clone the olive-p detection engine into external\olive-p
echo.
echo [CAUSE / 考えられる原因]
echo   - ネットワーク接続 / Network issue
echo   - Git認証・権限 / Git auth/permission issue
echo   - リポジトリアクセス制限 / Repository access restricted
echo.
echo [ACTION / 対処方法]
echo   1. 既存の olive-p を指定してください / Use existing olive-p:
echo      set OLIVE_P_DIR=C:\path\to\olive-p
echo      start.bat
echo   2. 手動でクローンしてください / Clone manually:
echo      git clone <olive-p-repo-url> external\olive-p
echo   3. ネットワーク/プロキシ設定を確認してください / Check network/proxy settings
echo.
pause
exit /b 1

:err_npm
echo.
echo [ERROR E004] npm install failed / npm install に失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   frontend\node_modules のインストールに失敗しました。
echo   Failed to install frontend dependencies via npm install.
echo.
echo [CAUSE / 考えられる原因]
echo   - node_modules の破損 / Corrupted node_modules
echo   - package-lock.json 不整合 / package-lock.json mismatch
echo   - npm キャッシュ不良 / Corrupted npm cache
echo   - ネットワーク/レジストリアクセス制限 / Registry/network restrictions
echo.
echo [ACTION / 対処方法]
echo   1. クリーンインストールを試行してください / Try clean install:
echo      cd frontend
echo      rmdir /s /q node_modules
echo      del package-lock.json (必要な場合のみ / if needed)
echo      npm install
echo   2. npm キャッシュをクリアしてください / Clear npm cache:
echo      npm cache verify
echo      npm cache clean --force (古いnpmの場合 / older npm)
echo   3. ネットワーク設定を確認してください / Check proxy/npm config (npm config get proxy/https-proxy)
echo.
pause
exit /b 1

:err_build
echo.
echo [ERROR E005] Frontend build failed / フロントエンドビルドに失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   npm run build に失敗しました。Next.js アプリのビルドが完了できません。
echo   Next.js build failed. Cannot complete frontend build.
echo.
echo [CAUSE / 考えられる原因]
echo   - TypeScript/ESLint エラー / TypeScript/ESLint errors
echo   - 依存関係の不整合 / Dependency mismatch
echo   - 環境変数不足 / Missing environment variables
echo   - メモリ不足 / Out of memory
echo.
echo [ACTION / 対処方法]
echo   1. 上記のエラーログを確認して修正してください / Review errors above and fix them
echo   2. 開発モードで動作確認してください / Test in dev mode:
echo      cd frontend ^&^& npm run dev
echo   3. キャッシュをクリアして再ビルドしてください / Clear Next cache and rebuild:
echo      cd frontend ^&^& rmdir /s /q .next
echo      npm run build
echo   4. それでも解決しない場合は node_modules を再インストールしてください
echo      Reinstall node_modules if still failing
echo.
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

