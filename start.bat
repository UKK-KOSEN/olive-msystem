@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   olive-msystem 起動
echo   バックエンド (FastAPI) : http://localhost:8000
echo   フロントエンド(Next.js): http://localhost:3000
echo ============================================

rem ---- バックエンド起動 ----
if not exist "backend\.venv\Scripts\python.exe" (
  echo [SETUP] Python 仮想環境を作成中...
  pushd backend
  py -m venv .venv
  .venv\Scripts\python.exe -m pip install -r requirements.txt
  popd
)

echo [BACKEND] FastAPI を起動中...
start "olive-backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"

timeout /t 5 /nobreak >nul

rem ---- フロントエンド起動 ----
echo [FRONTEND] Next.js を起動中...
start "olive-frontend" cmd /k "cd /d %~dp0frontend && npm install && npm run dev -- -p 3000"

echo.
echo ブラウザで http://localhost:3000 を開いてください。
endlocal
