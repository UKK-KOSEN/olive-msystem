param(
  [string]$Port = '8000',
  [string]$Role = 'active',
  [string]$InstanceId = 'node'
)

$ErrorActionPreference = 'Stop'
if ($Role -notin @('active', 'standby')) {
  throw "Role must be active or standby"
}
if ($InstanceId -notmatch '^[A-Za-z0-9_-]+$') {
  throw 'InstanceId may contain only letters, numbers, underscore, and hyphen'
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$PidFile = Join-Path $LogDir "backend-$InstanceId.pid"
$LogFile = Join-Path $LogDir "backend-$InstanceId-uvicorn.log"
$Python = $null
$VenvPython = Join-Path $Root 'backend\.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $VenvPython) {
  $Python = $VenvPython
} else {
  $PyCommand = Get-Command py -ErrorAction SilentlyContinue
  if ($PyCommand) { $Python = $PyCommand.Source }
}
if (!$Python) {
  throw 'Python executable was not found'
}

$env:PORT = $Port
$env:HOST = $env:BACKEND_HOST
if (!$env:HOST) { $env:HOST = '127.0.0.1' }
$env:OLIVE_INSTANCE_ID = $InstanceId
$env:OLIVE_INSTANCE_ROLE = $Role

Set-Location (Join-Path $Root 'backend')
Set-Content -LiteralPath $PidFile -Value $PID
try {
  & $Python -m uvicorn app.main:app --host $env:HOST --port $Port 2>&1 |
    Tee-Object -FilePath $LogFile
}
finally {
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}
