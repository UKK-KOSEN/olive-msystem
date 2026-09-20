@echo off
rem olive-msystem - backup wrapper (ops/backup.py with the venv interpreter)
rem Usage: backup.bat [--keep N] [--include-storage] [--out DIR]
setlocal
set ROOT=%~dp0..
set PY=python
if exist "%ROOT%\backend\.venv\Scripts\python.exe" set PY=%ROOT%\backend\.venv\Scripts\python.exe
"%PY%" "%ROOT%\ops\backup.py" %*
set EXIT=%errorlevel%
echo [backup] exit code %EXIT%
exit /b %EXIT%
