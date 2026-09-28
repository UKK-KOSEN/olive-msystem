<#
.SYNOPSIS
  olive-msystem service monitor: restarts backend / frontend on failure.
.DESCRIPTION
  Polls the backend health endpoint and the frontend root page every N seconds.
  A single transient blip (slow request, restart in progress) is ignored; only
  FailureThreshold consecutive failures kill the offending process (allowing
  the watchdog batch to restart it) and a log line is appended to
  ``logs/monitor.log``.  The script runs indefinitely until the caller
  cancels it (Ctrl-C) or it is killed.
.NOTES
  Run via ``ops\start-monitor.bat`` or as a Scheduled Task.
  Designed for PowerShell 5.1+.
#>
param(
  [int]$IntervalSec = 30,
  [string]$BackendUrl = 'http://127.0.0.1:8000/api/health',
  [string]$FrontendUrl = 'http://127.0.0.1:3001/',
  [string]$BackendPort = '8000',
  [string]$FrontendPort = '3001',
  [int]$FailureThreshold = 3,
  [int]$StartupGraceSec = 30
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

function Revive-Service {
  param([string]$Name, [string]$Port, [string]$Bat)
  $listening = Get-ListenerPid $Port
  if ($listening) {
    Write-Log "$Name unhealthy (listening=$listening). killing..."
    Stop-Process -Id $listening -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  } else {
    Write-Log "$Name DOWN (port free). ensuring watchdog..."
  }
  if (-not (Get-ListenerPid $Port)) {
    Start-Watchdog $Bat
    Write-Log "started $Bat"
    Start-Sleep -Seconds 5
  }
}

$backendBat  = (Resolve-Path (Join-Path $Root 'run_backend.bat')).Path
$frontendBat = (Resolve-Path (Join-Path $Root 'run_frontend.bat')).Path

$backendFailures  = 0
$frontendFailures = 0
$backendLastReset  = Get-Date
$frontendLastReset = Get-Date

Write-Log "monitor started (interval=${IntervalSec}s threshold=$FailureThreshold)"

while ($true) {
  # --- backend ---
  if (-not (Test-Service $BackendUrl)) {
    if ((Get-Date) -lt $backendLastReset.AddSeconds($StartupGraceSec)) {
      # A freshly restarted process needs time to boot; don't punish it for
      # a slow cold start, or the monitor and watchdog would fight in a loop.
      Write-Log "backend warming up after (re)start; probe failures ignored"
      $backendFailures = 0
    } else {
      $backendFailures++
      if ($backendFailures -ge $FailureThreshold) {
        Revive-Service 'backend' $BackendPort $backendBat
        $backendFailures  = 0
        $backendLastReset = Get-Date
      } else {
        Write-Log "backend unhealthy ($backendFailures/$FailureThreshold); verifying again"
      }
    }
  } else {
    $backendFailures = 0
  }

  # --- frontend ---
  if (-not (Test-Service $FrontendUrl)) {
    if ((Get-Date) -lt $frontendLastReset.AddSeconds($StartupGraceSec)) {
      Write-Log "frontend warming up after (re)start; probe failures ignored"
      $frontendFailures = 0
    } else {
      $frontendFailures++
      if ($frontendFailures -ge $FailureThreshold) {
        Revive-Service 'frontend' $FrontendPort $frontendBat
        $frontendFailures  = 0
        $frontendLastReset = Get-Date
      } else {
        Write-Log "frontend unhealthy ($frontendFailures/$FailureThreshold); verifying again"
      }
    }
  } else {
    $frontendFailures = 0
  }

  Start-Sleep -Seconds $IntervalSec
}