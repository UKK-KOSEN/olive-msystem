@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

if not defined BACKEND_PORT set BACKEND_PORT=8000
if not defined BACKEND_HOST set BACKEND_HOST=127.0.0.1
if not defined FRONTEND_PORT set FRONTEND_PORT=3001
if not defined BACKEND_URL set BACKEND_URL=http://127.0.0.1:%BACKEND_PORT%

echo ============================================
echo   olive-msystem 起動（watchdog構成）
echo   バックエンド (FastAPI) : http://%BACKEND_HOST%:%BACKEND_PORT%
echo   フロントエンド(Next.js): http://localhost:%FRONTEND_PORT%
echo   二重起動防止 + 自動再起動 有効
echo ============================================

rem ---- 初回セットアップ（仮想環境が無い時のみ） ----
if not exist "backend\.venv\Scripts\python.exe" (
  echo [SETUP] Python 仮想環境を作成中...
  pushd backend
  py -m venv .venv
  .venv\Scripts\python.exe -m pip install -r requirements.txt
  popd
)
if not exist "frontend\node_modules" (
  echo [SETUP] npm install を実行中...
  pushd frontend
  call npm install
  popd
)

rem ---- バックエンド起動（watchdog、二重起動防止） ----
if "%~1"=="backend" goto run_backend
if "%~1"=="frontend" goto run_frontend

echo [START] バックエンド watchdog を起動中...
start "olive-backend-watchdog" cmd /k "cd /d %~dp0 && run_backend.bat"

echo [START] フロント watchdog を起動中...
start "olive-frontend-watchdog" cmd /k "cd /d %~dp0 && run_frontend.bat"

echo.
echo ブラウザで http://localhost:3001 を開いてください。
echo 終了するには各 watchdog ウィンドウを閉じてください。
timeout /t 3 /nobreak >nul
endlocal
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
