@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ================================================================
rem  olive-msystem - all-in-one launcher (single file)
rem  Bootstraps everything a fresh checkout needs and starts the
rem  backend/frontend watchdog processes:
rem    - prerequisite tools (git / Python 3.12 / Node / ffmpeg, auto-installed
rem      via winget when missing - PATH is rebuilt afterwards in this session)
rem    - detection engine  (olive-p, cloned to external\olive-p on first run
rem                         unless OLIVE_P_DIR or an existing checkout is found)
rem    - Python venv       (backend\.venv, auto-created)
rem    - backend deps      (pip install -r backend\requirements.txt, idempotent)
rem    - frontend deps     (npm install when node_modules is missing)
rem    - frontend build    (npm run build when .next\BUILD_ID is missing)
rem    - detection engine  (olive-p / upscaler / ffmpeg health check)
rem    - watchdog start    (backend + frontend, auto-restart on crash)
rem
rem  Usage:
rem    start.bat                full setup + watchdogs (recommended)
rem    start.bat check          verify environment, do not start daemons
rem    start.bat backend        setup + run backend in foreground
rem    start.bat frontend       setup + run frontend in foreground
rem
rem  Notes:
rem    - This file is UTF-8 (BOM) and switches the console to code page
rem      65001 so Japanese messages render correctly on Windows.
rem    - Everything (setup, watchdogs, error handling) lives in this one
rem      file. No auxiliary .bat is required.
rem    - Admin credentials are written to logs\admin-credentials.txt on
rem      the first backend start.
rem ================================================================

rem ---- fast paths: watchdog modes (skip the whole setup) ----
if /I "%~1"=="watchdog-backend"  goto :watchdog_backend
if /I "%~1"=="watchdog-frontend" goto :watchdog_frontend

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

rem ================================================================
rem  STEP 0. prerequisite tools (git / python 3.12 / node / ffmpeg)
rem ================================================================
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
  )
  where py >nul 2>&1
  if errorlevel 1 (
    where python >nul 2>&1
    if errorlevel 1 (
      winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
      if errorlevel 1 goto :err_tools
    )
  )
  where node >nul 2>&1
  if errorlevel 1 (
    winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
    if errorlevel 1 goto :err_tools
  )
  where npm >nul 2>&1
  if errorlevel 1 (
    winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
    if errorlevel 1 goto :err_tools
  )
  where ffmpeg >nul 2>&1
  if errorlevel 1 (
    winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
    if errorlevel 1 goto :err_tools
  )

  rem --- refresh PATH from registry (system + user) for this session ---
  for /F "skip=2 tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%B"
  for /F "skip=2 tokens=2,*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%B"
  set "PATH=%SYS_PATH%;%USER_PATH%;%SystemRoot%\System32;%SystemRoot%"

  echo.
  echo [SETUP] Verifying installed tools...
  where git >nul 2>&1
  if errorlevel 1 goto :err_tools2
  where py >nul 2>&1
  if errorlevel 1 (
    where python >nul 2>&1
    if errorlevel 1 goto :err_tools2
  )
  where node >nul 2>&1
  if errorlevel 1 goto :err_tools2
  where npm >nul 2>&1
  if errorlevel 1 goto :err_tools2
  where ffmpeg >nul 2>&1
  if errorlevel 1 goto :err_tools2
  echo [OK]   Prerequisites installed and ready.
)

rem ================================================================
rem  STEP 1. detection engine (olive-p) source
rem ================================================================
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

rem ================================================================
rem  STEP 2. Python venv (create when missing) + backend deps
rem ================================================================
if not exist "%VENV_PY%" (
  echo [SETUP] Creating Python venv...
  set "PY_BOOT=py -3.12"
  %PY_BOOT% --version >nul 2>&1
  if errorlevel 1 set "PY_BOOT=py -3"
  %PY_BOOT% --version >nul 2>&1
  if errorlevel 1 set "PY_BOOT=py"
  %PY_BOOT% -m venv backend\.venv
  if errorlevel 1 goto :err_venv
  echo [OK]   Venv created with: %PY_BOOT%
) else (
  echo [OK]   Python venv found: %VENV_PY%
)
echo [SETUP] Ensuring backend Python deps are up to date...
"%VENV_PY%" -m pip install --disable-pip-version-check -r backend\requirements.txt
if errorlevel 1 goto :err_venv
echo [OK]   Backend deps ready.

rem ================================================================
rem  STEP 3. frontend node_modules (install when missing)
rem ================================================================
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

rem ================================================================
rem  STEP 4. frontend build (.next), skipped when running backend only
rem ================================================================
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

rem ================================================================
rem  STEP 5. detection engine check (olive-p / upscaler / ffmpeg)
rem ================================================================
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

rem ================================================================
rem  STEP 6. route modes
rem ================================================================
if /I "%~1"=="check"    goto :run_check
if /I "%~1"=="backend"  goto :run_backend
if /I "%~1"=="frontend" goto :run_frontend

rem ================================================================
rem  STEP 7. start watchdogs
rem ================================================================
if not exist "logs" mkdir "logs"

echo [START] Backend watchdog ...
start "olive-backend-watchdog" cmd /k ""%~dp0start.bat" watchdog-backend"
echo [START] Frontend watchdog ...
start "olive-frontend-watchdog" cmd /k ""%~dp0start.bat" watchdog-frontend"

echo.
echo Open http://localhost:%FRONTEND_PORT% in your browser.
echo   ブラウザで http://localhost:%FRONTEND_PORT% を開いてください。
echo Close the watchdog windows to stop the app.
echo   停止するには watchdog ウィンドウを閉じてください。
echo Admin credentials are written to %~dp0logs\admin-credentials.txt
echo   管理者認証情報は %~dp0logs\admin-credentials.txt に保存されます。
timeout /t 3 /nobreak >nul
endlocal
exit /b 0

rem ================================================================
rem  WATCHDOG - backend (auto-restart with exponential backoff)
rem ================================================================
:watchdog_backend
setlocal enabledelayedexpansion
cd /d "%~dp0"
if not defined BACKEND_PORT set BACKEND_PORT=8000
if not defined BACKEND_HOST set BACKEND_HOST=127.0.0.1
set PORT=%BACKEND_PORT%
if not exist "backend\.venv\Scripts\python.exe" (
  echo.
  echo [ERROR E002] backend\.venv\Scripts\python.exe not found.
  echo   仮想環境が見つかりません。start.bat を実行してください。
  echo   Venv missing. Run start.bat first to create it.
  echo.
  pause
  exit /b 1
)
if not exist "logs" mkdir "logs"
set ATTEMPT=0
set RESTARTS=0
:check_b
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 goto start_b
echo [watchdog] Backend already running on port %PORT%. Only monitoring...
echo [watchdog] バックエンドは起動済みです。監視のみ継続します。
timeout /t 5 /nobreak >nul
goto check_b
:start_b
set /a ATTEMPT+=1
set /a RESTARTS+=1
echo [watchdog] Starting backend (uvicorn on %PORT%) [attempt !ATTEMPT!]...
echo [watchdog] バックエンドを起動しています...
for /f %%i in ('powershell -NoProfile -Command "[uint64]((Get-Date).ToFileTimeUtc())"') do set START_MS=%%i
pushd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host %BACKEND_HOST% --port %PORT% 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath ..\logs\backend-uvicorn.log"
set EXIT=%errorlevel%
popd
set ELAPSED=0
if not defined START_MS goto compute_b
for /f %%i in ('powershell -NoProfile -Command "$d=([uint64]((Get-Date).ToFileTimeUtc())-%START_MS%)/10000000.0; [int]$d"') do set ELAPSED=%%i
:compute_b
echo [watchdog] Backend exited (code %EXIT%, lived !ELAPSED!s). Restarting...
echo [watchdog] バックエンドが終了しました。再起動します...
set DELAY=3
if !ELAPSED! lss 10 set /a DELAY=2 + %RESTARTS% * 2
if !ELAPSED! geq 10 set RESTARTS=0
if !DELAY! gtr 30 set DELAY=30
if %RESTARTS% geq 15 (
  echo [watchdog] Backend has crashed %RESTARTS% times right after boot.
  echo [watchdog]         Check logs\backend-uvicorn.log. Waiting 60s before retry.
  echo [watchdog]         起動直後にクラッシュしました。ログを確認して60秒後に再試行します。
  set DELAY=60
)
echo [watchdog] Waiting !DELAY!s before retry...
timeout /t !DELAY! /nobreak >nul
goto check_b

rem ================================================================
rem  WATCHDOG - frontend (auto-restart with exponential backoff)
rem ================================================================
:watchdog_frontend
setlocal enabledelayedexpansion
cd /d "%~dp0"
if not defined FRONTEND_PORT set FRONTEND_PORT=3001
if not defined BACKEND_PORT set BACKEND_PORT=8000
if not defined BACKEND_URL set BACKEND_URL=http://127.0.0.1:%BACKEND_PORT%
if not exist "frontend\node_modules" (
  echo.
  echo [ERROR E004] frontend\node_modules not found.
  echo   依存パッケージが見つかりません。start.bat を実行してください。
  echo   node_modules missing. Run start.bat first to install dependencies.
  echo.
  pause
  exit /b 1
)
if not exist "logs" mkdir "logs"
set ATTEMPT=0
set RESTARTS=0
:check_f
netstat -ano | findstr /R /C:":%FRONTEND_PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 goto start_f
echo [watchdog] Frontend already running on port %FRONTEND_PORT%. Only monitoring...
echo [watchdog] フロントエンドは起動済みです。監視のみ継続します。
timeout /t 5 /nobreak >nul
goto check_f
:start_f
set /a ATTEMPT+=1
set /a RESTARTS+=1
echo [watchdog] Starting frontend (Next.js on %FRONTEND_PORT%) [attempt !ATTEMPT!]...
echo [watchdog] フロントエンドを起動しています...
for /f %%i in ('powershell -NoProfile -Command "[uint64]((Get-Date).ToFileTimeUtc())"') do set START_MS=%%i
pushd frontend
set BACKEND_URL=%BACKEND_URL%
call npm run start -- -p %FRONTEND_PORT%
set EXIT=%errorlevel%
popd
set ELAPSED=0
if not defined START_MS goto compute_f
for /f %%i in ('powershell -NoProfile -Command "$d=([uint64]((Get-Date).ToFileTimeUtc())-%START_MS%)/10000000.0; [int]$d"') do set ELAPSED=%%i
:compute_f
echo [watchdog] Frontend exited (code %EXIT%, lived !ELAPSED!s). Restarting...
echo [watchdog] フロントエンドが終了しました。再起動します...
set DELAY=3
if !ELAPSED! lss 10 set /a DELAY=2 + %RESTARTS% * 2
if !ELAPSED! geq 10 set RESTARTS=0
if !DELAY! gtr 30 set DELAY=30
if %RESTARTS% geq 15 (
  echo [watchdog] Frontend has crashed %RESTARTS% times right after boot.
  echo [watchdog]         Check logs\frontend-next.log. Waiting 60s before retry.
  echo [watchdog]         起動直後にクラッシュしました。ログを確認して60秒後に再試行します。
  set DELAY=60
)
echo [watchdog] Waiting !DELAY!s before retry...
timeout /t !DELAY! /nobreak >nul
goto check_f

rem ================================================================
rem  foreground modes (for debugging)
rem ================================================================
:run_check
echo [CHECK-DONE] Environment and detection engine checked. No daemon started.
echo [CHECK-DONE] 環境の確認が完了しました。デーモンは起動していません。
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

rem ================================================================
rem  ERROR HANDLERS (bilingual: 日本語 / English)
rem ================================================================
:err_winget
echo.
echo [ERROR E006] winget was not found / winget が見つかりません
echo.
echo [DESCRIPTION / 説明]
echo   必須ツールの自動インストールに winget ^(App Installer^) が必要です。
echo   winget ^(App Installer^) is required to auto-install missing tools.
echo.
echo [CAUSE / 考えられる原因]
echo   - App Installer ^(Microsoft Store^) が未インストール
echo     App Installer ^(Microsoft Store^) is not installed
echo   - Windows ビルドが古い / Windows build is too old
echo.
echo [ACTION / 対処方法]
echo   1. Microsoft Store から "App Installer" をインストールしてください
echo      Install "App Installer" from the Microsoft Store
echo   2. または必須ツールを手動でインストールしてください
echo      Or install the required tools manually:
echo        - Git for Windows : https://git-scm.com/download/win
echo        - Python 3.12     : https://www.python.org/downloads/
echo        - Node.js LTS     : https://nodejs.org/
echo        - ffmpeg           : https://www.gyan.dev/ffmpeg/builds/
echo   3. 新しいコマンドプロンプトで start.bat を再実行してください
echo      Open a NEW Command Prompt and re-run start.bat
echo.
pause
exit /b 1

:err_tools
echo.
echo [ERROR E001] Required tools installation failed / 必要なツールのインストールに失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   Git / Python 3.12 / Node.js / ffmpeg のいずれかのインストールに失敗しました。
echo   Installation of Git / Python 3.12 / Node.js / ffmpeg failed.
echo.
echo [CAUSE / 考えられる原因]
echo   - winget が利用できない / winget is not available
echo   - ネットワーク接続の問題 / Network connection issue
echo   - パッケージソースへのアクセス制限 / Package source access restricted
echo   - 管理者権限が必要 / Administrator privileges required
echo.
echo [ACTION / 対処方法]
echo   1. 管理者権限で再度実行してください / Re-run as Administrator
echo   2. 手動で必要なツールをインストールしてください / Install required tools manually:
echo        - Git for Windows : https://git-scm.com/download/win
echo        - Python 3.12     : https://www.python.org/downloads/
echo        - Node.js LTS     : https://nodejs.org/
echo        - ffmpeg           : https://www.gyan.dev/ffmpeg/builds/
echo   3. PATH に追加後、新しいコマンドプロンプトで start.bat を再実行してください
echo      After adding to PATH, open a NEW Command Prompt and re-run start.bat
echo   4. それでも解決しない場合は start.bat check で環境を診断してください
echo      If still failing, run "start.bat check" to diagnose the environment
echo.
pause
exit /b 1

:err_tools2
echo.
echo [ERROR E007] Installed tools are not visible on PATH / PATH にツールが見つかりません
echo.
echo [DESCRIPTION / 説明]
echo   ツールはインストールされましたが、このセッションの PATH に見つかりません。
echo   The tools were installed but are not visible on PATH in this session.
echo.
echo [CAUSE / 考えられる原因]
echo   - PATH 反映には新しいシェルが必要 / PATH changes need a fresh shell
echo   - インストール先 differs / Install location differs from the registry PATH
echo.
echo [ACTION / 対処方法]
echo   1. このウィンドウを閉じて、新しいコマンドプロンプトを開いてください
echo      Close this window and open a NEW Command Prompt
echo   2. 新しいコマンドプロンプトで start.bat を実行してください
echo      Run start.bat from the new Command Prompt
echo.
pause
exit /b 1

:err_git
echo.
echo [ERROR E008] git was not found / git が見つかりません
echo.
echo [DESCRIPTION / 説明]
echo   olive-p 検出エンジンの取得には git が必要です。
echo   git is required to fetch the olive-p detection engine.
echo.
echo [CAUSE / 考えられる原因]
echo   - Git for Windows が未インストール / Git for Windows is not installed
echo   - PATH に git がない / git is not on PATH
echo.
echo [ACTION / 対処方法]
echo   1. Git for Windows をインストールしてください
echo      Install Git for Windows: https://git-scm.com/download/win
echo   2. または既存の olive-p を指定して回避してください
echo      Or skip the clone by pointing at an existing olive-p:
echo        set OLIVE_P_DIR=C:\path\to\olive-p
echo        start.bat
echo.
pause
exit /b 1

:err_olivep
echo.
echo [ERROR E003] Failed to clone olive-p detection engine / olive-p検出エンジンのクローンに失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   external\olive-p へのクローンに失敗しました。
echo   Failed to clone the olive-p detection engine into external\olive-p.
echo.
echo [CAUSE / 考えられる原因]
echo   - ネットワーク接続の問題 / Network connection issue
echo   - Git 認証・権限の問題 / Git auth or permission issue
echo   - リポジトリアクセス制限 / Repository access restricted
echo.
echo [ACTION / 対処方法]
echo   1. 既存の olive-p を指定してください / Use an existing olive-p:
echo        set OLIVE_P_DIR=C:\path\to\olive-p
echo        start.bat
echo   2. 手動でクローンしてから再度実行してください / Clone manually, then re-run:
echo        git clone https://github.com/UKK-KOSEN/olive-vision-ai.git external\olive-p
echo        start.bat
echo   3. ネットワーク / プロキシ設定を確認してください / Check network and proxy settings
echo.
pause
exit /b 1

:err_venv
echo.
echo [ERROR E002] Python venv creation or dependency install failed / Python仮想環境の作成・依存インストールに失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   backend\.venv の作成、または backend\requirements.txt のインストールに失敗しました。
echo   Failed to create backend\.venv or install backend dependencies.
echo.
echo [CAUSE / 考えられる原因]
echo   - pip / setuptools / wheel の破損 / Broken pip, setuptools or wheel
echo   - requirements.txt の依存関係競合 / Dependency conflicts in requirements.txt
echo   - ディスク容量不足 / Insufficient disk space
echo   - プロキシ / ファイアウォールによる制限 / Proxy or firewall restrictions
echo   - Python 3.12 ではない venv が作成された / venv was created with another Python version
echo.
echo [ACTION / 対処方法]
echo   1. 上のログで失敗したパッケージを確認してください
echo      Check the log above for the failing package
echo   2. 仮想環境を削除して再作成してください / Recreate the venv:
echo        rmdir /s /q backend\.venv
echo        start.bat
echo   3. pip を更新してから再インストールしてください / Upgrade pip then reinstall:
echo        backend\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel
echo        backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
echo   4. Python 3.12 が PATH にあるか確認してください / Verify Python 3.12 is on PATH:
echo        py -3.12 --version
echo.
pause
exit /b 1

:err_npm
echo.
echo [ERROR E004] npm install failed / npm install に失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   frontend\node_modules のインストールに失敗しました。
echo   Failed to install the frontend dependencies via npm install.
echo.
echo [CAUSE / 考えられる原因]
echo   - node_modules の破損 / Corrupted node_modules
echo   - package-lock.json の不整合 / package-lock.json mismatch
echo   - npm キャッシュの破損 / Corrupted npm cache
echo   - レジストリ / ネットワークへのアクセス制限 / Registry or network restrictions
echo.
echo [ACTION / 対処方法]
echo   1. クリーンインストールを試してください / Try a clean install:
echo        cd frontend
echo        rmdir /s /q node_modules
echo        npm install
echo   2. npm キャッシュを検証・クリアしてください / Verify or clear the npm cache:
echo        npm cache verify
echo        npm cache clean --force
echo   3. プロキシ設定を確認してください / Check proxy settings:
echo        npm config get proxy
echo        npm config get https-proxy
echo.
pause
exit /b 1

:err_build
echo.
echo [ERROR E005] Frontend build failed / フロントエンドビルドに失敗しました
echo.
echo [DESCRIPTION / 説明]
echo   npm run build に失敗しました。Next.js アプリのビルドを完了できません。
echo   npm run build failed. The Next.js build cannot be completed.
echo.
echo [CAUSE / 考えられる原因]
echo   - TypeScript / ESLint のエラー / TypeScript or ESLint errors
echo   - 依存関係の不整合 / Dependency mismatch
echo   - 環境変数の不足 / Missing environment variables
echo   - メモリ不足 / Out of memory
echo.
echo [ACTION / 対処方法]
echo   1. 上のエラーログを確認して修正してください / Review the error log above and fix it
echo   2. 開発モードで動作確認してください / Test in development mode:
echo        cd frontend
echo        npm run dev
echo   3. Next.js のキャッシュをクリアして再ビルドしてください / Clear the Next cache and rebuild:
echo        cd frontend
echo        rmdir /s /q .next
echo        npm run build
echo   4. それでも解決しない場合は依存関係を再インストールしてください
echo      Reinstall the dependencies if the build still fails:
echo        cd frontend
echo        rmdir /s /q node_modules
echo        npm install
echo.
pause
exit /b 1
