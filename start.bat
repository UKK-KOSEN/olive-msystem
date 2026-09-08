@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   olive-msystem 起動（冗長構成）
echo   バックエンド (FastAPI) : http://localhost:8000
echo   フロントエンド(Next.js): http://localhost:3001
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
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
exit /b 0

:run_frontend
cd /d "%~dp0frontend"
call npm run start -- -p 3001
exit /b 0
