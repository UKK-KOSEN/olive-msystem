@echo off
rem olive-msystem - backup wrapper (ops/backup.py with the venv interpreter)
rem Usage: backup.bat [--keep N] [--include-storage] [--out DIR]
setlocal
cd /d "%~dp0.."
pushd backend
set PY=.\venv\Scripts\python.exe
if exist "%PY%" goto run
popd
set PY=python
:run
"%PY%" ops\backup.py %*
set EXIT=%errorlevel%
echo [backup] exit code %EXIT%
exit /b %EXIT%