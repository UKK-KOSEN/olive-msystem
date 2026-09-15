@echo off
rem olive-msystem - start the service monitor (supervisor) in its own window.
rem Auto-start: Windows タスクスケジューラでログオン時か起動時に実行する:
rem   powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "<repo>\ops\monitor.ps1"
setlocal
start "olive-msystem monitor" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0monitor.ps1"
echo [monitor] launched in a separate window. Logs: logs\monitor.log