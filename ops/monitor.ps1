<#
.SYNOPSIS
  olive-msystem service monitor: restarts backend / frontend on failure.
.DESCRIPTION
  Polls the backend health endpoint and the frontend root page every N seconds.
  If either is unreachable or returns a non-OK HTTP status, the offending
  process is killed (allowing the watchdog batch to restart it) and a log line
  is appended to ``logs/monitor.log``.  The script runs indefinitely until
  the caller cancels it (Ctrl-C) or it is killed.
.NOTES
  Run via ``ops\start-monitor.bat`` or as a Scheduled Task.
  Designed for PowerShell 5.1+.
#>
param(
  [int]$IntervalSec = 30,
  [string]$BackendUrl = 'http://127.0.0.1:8000/api/health',
  [string]$FrontendUrl = 'http://127.0.0.1:3001/',
  [string]$BackendPort = '8000',
  [string]$FrontendPort = '3001'
)

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir 'monitor.log'

function Write-Log {
  param([string]$Message)
  $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $line = "$ts [monitor] $Message"
  Add-Content -Path $LogFile -Value $line
  Write-Host $line
}

function Get-ListenerPid {
  param([string]$Port)
  $pats = @(
    [regex]$Port + '\s.*LISTENING\s*$',
    [regex]$Port + '\s.*LISTENING\s+'
  )
  foreach ($pat in $pats) {
    $hits = netstat -ano | Select-String -Pattern $pat
    foreach ($m in $hits) {
      $parts = ($m.Line -split '\s+') | Where-Object { $_ }
      return [int]$parts[-1]
    }
  }
  return $null
}

function Test-Service {
  param([string]$Url, [int]$TimeoutSec = 8)
  try {
    $r = Invoke-WebRequest -Method Get -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)
  } catch { return $false }
}

function Start-Watchdog {
  param([string]$Bat)
  Start-Process -FilePath 'cmd.exe' -ArgumentList "/c `"$Bat`"" -WindowStyle Minimized
}

$backendBat  = (Resolve-Path (Join-Path $Root 'run_backend.bat')).Path
$frontendBat = (Resolve-Path (Join-Path $Root 'run_frontend.bat')).Path

Write-Log "monitor started (interval=${IntervalSec}s)"

while ($true) {
  # --- backend ---
  if (-not (Test-Service $BackendUrl)) {
    $pidListening = Get-ListenerPid $BackendPort
    if ($pidListening) {
      Write-Log "backend unhealthy (listening=$pidListening). killing..."
      Stop-Process -Id $pidListening -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
    } else {
      Write-Log "backend DOWN (port free). ensuring watchdog..."
    }
    if (-not (Get-ListenerPid $BackendPort)) {
      Start-Watchdog $backendBat
      Write-Log "started run_backend.bat"
      Start-Sleep -Seconds 5
    }
  }

  # --- frontend ---
  if (-not (Test-Service $FrontendUrl)) {
    $pidListening = Get-ListenerPid $FrontendPort
    if ($pidListening) {
      Write-Log "frontend unhealthy (listening=$pidListening). killing..."
      Stop-Process -Id $pidListening -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
    } else {
      Write-Log "frontend DOWN (port free). ensuring watchdog..."
    }
    if (-not (Get-ListenerPid $FrontendPort)) {
      Start-Watchdog $frontendBat
      Write-Log "started run_frontend.bat"
      Start-Sleep -Seconds 5
    }
  }

  Start-Sleep -Seconds $IntervalSec
}