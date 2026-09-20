@echo off
setlocal
cd /d "%~dp0.."
if not defined BACKEND_PORT set BACKEND_PORT=8000
if not defined STANDBY_PORT set STANDBY_PORT=8001
if not defined FRONTEND_PORT set FRONTEND_PORT=3001
if not exist "backend\.venv\Scripts\python.exe" (
  echo [setup] Python virtual environment is missing. Run start.bat once first.
  exit /b 1
)
if not exist "frontend\node_modules" (
  echo [setup] frontend dependencies are missing. Run npm install in frontend first.
  exit /b 1
)
if not exist "frontend\.next" (
  echo [setup] frontend build is missing. Run npm run build in frontend first.
  exit /b 1
)
echo ============================================
echo   olive-msystem active/standby redundancy
echo   primary backend : 127.0.0.1:%BACKEND_PORT%
echo   standby backend : 127.0.0.1:%STANDBY_PORT%
echo   frontend        : http://localhost:%FRONTEND_PORT%
echo ============================================
start "olive-redundant-monitor" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0redundant-monitor.ps1" -PrimaryPort "%BACKEND_PORT%" -StandbyPort "%STANDBY_PORT%" -FrontendPort "%FRONTEND_PORT%"
echo [redundant] monitor launched; logs: logs\redundant-monitor.log
endlocal
exit /b 0
