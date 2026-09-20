param(
  [int]$IntervalSec = 10,
  [string]$PrimaryPort = '8000',
  [string]$StandbyPort = '8001',
  [string]$FrontendPort = '3001',
  [string]$FrontendUrl = $null,
  [int]$HealthFailureThreshold = 0,
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
if ($HealthFailureThreshold -le 0) {
  $HealthFailureThreshold = 3
  if ($env:HEALTH_FAILURE_THRESHOLD) {
    try { $HealthFailureThreshold = [int]$env:HEALTH_FAILURE_THRESHOLD } catch {}
  }
}
if ($HealthFailureThreshold -lt 1) { throw 'HealthFailureThreshold must be at least 1' }
if ($IntervalSec -lt 1) { throw 'IntervalSec must be at least 1' }
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir 'redundant-monitor.log'
$MonitorPidFile = Join-Path $LogDir 'redundant-monitor.pid'
if (!$FrontendUrl) { $FrontendUrl = "http://127.0.0.1:$FrontendPort/api/health" }

function Write-Log {
  param([string]$Message)
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [redundant] $Message"
  Add-Content -LiteralPath $LogFile -Value $line
  Write-Host $line
}

function Test-MonitorProcess {
  param([int]$MonitorPid)
  if (!$MonitorPid) { return $false }
  try {
    $process = Get-Process -Id $MonitorPid -ErrorAction Stop
    if ($process.ProcessName -notmatch '^powershell') { return $false }
    $command = (Get-CimInstance Win32_Process -Filter "ProcessId=$MonitorPid").CommandLine
    return [string]$command -like "*redundant-monitor.ps1*"
  } catch {
    return $false
  }
}

function Stop-MonitorProcess {
  if (!(Test-Path -LiteralPath $MonitorPidFile)) { return }
  try {
    $monitorPid = [int](Get-Content -LiteralPath $MonitorPidFile | Select-Object -First 1)
  } catch {
    Remove-Item -LiteralPath $MonitorPidFile -Force -ErrorAction SilentlyContinue
    return
  }
  if ($monitorPid -and $monitorPid -ne $PID -and (Test-MonitorProcess -MonitorPid $monitorPid)) {
    Write-Log "stopping monitor (pid=$monitorPid)"
    Stop-Process -Id $monitorPid -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 5; $i++) {
      if (!(Test-MonitorProcess -MonitorPid $monitorPid)) { break }
      Start-Sleep -Seconds 1
    }
  }
  Remove-Item -LiteralPath $MonitorPidFile -Force -ErrorAction SilentlyContinue
}

function Get-ListenerPid {
  param([string]$Port)
  $connection = Get-NetTCPConnection -LocalPort ([int]$Port) -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($connection) { return [int]$connection.OwningProcess }

  $matches = netstat -ano 2>$null |
    Select-String -Pattern ":$Port\s.*LISTENING\s+(\d+)\s*$"
  foreach ($match in $matches) {
    if ($match.Matches.Count -gt 0) {
      return [int]$match.Matches[0].Groups[1].Value
    }
  }
  return $null
}

function Stop-Port {
  param([string]$Port)
  $listenerPid = Get-ListenerPid -Port $Port
  if (!$listenerPid) { return }
  Write-Log "stopping listener on port $Port (pid=$listenerPid)"
  Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

function Start-BackendNode {
  param(
    [string]$Port,
    [string]$Role,
    [string]$InstanceId
  )
  if (Get-ListenerPid -Port $Port) { return }
  $script = Join-Path $Root 'ops\run-backend-node.ps1'
  $arguments = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script,
    '-Port', $Port, '-Role', $Role, '-InstanceId', $InstanceId
  )
  Write-Log "starting $InstanceId backend on port $Port ($Role)"
  Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Minimized | Out-Null
  Start-Sleep -Seconds 1
  if (!(Wait-For-Health -Url "http://127.0.0.1:$Port/api/health" -ExpectedRole $Role)) {
    Write-Log "backend $InstanceId did not become healthy as $Role"
  }
}

function Start-FrontendWatchdog {
  if (Get-ListenerPid -Port $FrontendPort) { return }
  $bat = Join-Path $Root 'run_frontend.bat'
  $env:FRONTEND_PORT = $FrontendPort
  if (!$env:BACKEND_URL) { $env:BACKEND_URL = "http://127.0.0.1:$PrimaryPort" }
  Write-Log "starting frontend watchdog on port $FrontendPort"
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', "`"$bat`"") -WindowStyle Minimized | Out-Null
  Start-Sleep -Seconds 3
}

function Restart-Frontend {
  Stop-Port -Port $FrontendPort
  Start-FrontendWatchdog
}

function Test-Health {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 6
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
      return [pscustomobject]@{ reachable = $false; ready = $false; can_promote = $false; role = ''; status = [string]$response.StatusCode }
    }
    $body = $response.Content | ConvertFrom-Json
    $ready = $body.ready -eq $true -or [string]$body.ready -eq 'true'
    $canPromote = $body.can_promote -eq $true -or
      [string]$body.can_promote -eq 'true' -or
      [string]$body.db_status -eq 'ok'
    return [pscustomobject]@{
      reachable = $true
      ready = $ready
      can_promote = $canPromote
      role = [string]$body.role
      status = [string]$body.status
    }
  } catch {
    return [pscustomobject]@{ reachable = $false; ready = $false; can_promote = $false; role = ''; status = 'error' }
  }
}

function Wait-For-Health {
  param(
    [string]$Url,
    [string]$ExpectedRole
  )
  for ($i = 0; $i -lt 10; $i++) {
    $health = Test-Health -Url $Url
    if ($health.reachable -and $health.role -eq $ExpectedRole) {
      return $true
    }
    Start-Sleep -Seconds 1
  }
  return $false
}

if ($Stop) {
  Write-Log 'stopping redundant monitor'
  Stop-MonitorProcess
  Write-Log 'stopping redundant processes'
  Stop-Port -Port $FrontendPort
  Stop-Port -Port $PrimaryPort
  Stop-Port -Port $StandbyPort
  exit 0
}

$existingMonitorPid = $null
if (Test-Path -LiteralPath $MonitorPidFile) {
  try { $existingMonitorPid = [int](Get-Content -LiteralPath $MonitorPidFile | Select-Object -First 1) } catch {}
}
if (Test-MonitorProcess -MonitorPid $existingMonitorPid) {
  Write-Log 'redundant monitor is already running'
  exit 0
}
Set-Content -LiteralPath $MonitorPidFile -Value $PID

$primaryFailures = 0
$standbyFailures = 0
$frontendFailures = 0
Write-Log "monitor started (primary=$PrimaryPort standby=$StandbyPort frontend=$FrontendPort interval=${IntervalSec}s threshold=$HealthFailureThreshold)"

try {
  while ($true) {
    try {
      $primary = Test-Health -Url "http://127.0.0.1:$PrimaryPort/api/health"
      $standby = Test-Health -Url "http://127.0.0.1:$StandbyPort/api/health"
      $frontend = Test-Health -Url $FrontendUrl

      if ($primary.reachable -and $primary.role -ne 'active') {
        Write-Log "primary role is $($primary.role); restarting it as active"
        Stop-Port -Port $PrimaryPort
        Start-BackendNode -Port $PrimaryPort -Role 'active' -InstanceId 'primary'
        $primaryFailures = 0
      } elseif (!$primary.reachable -or !$primary.can_promote) {
        $primaryFailures++
        if ($primaryFailures -ge $HealthFailureThreshold) {
          Stop-Port -Port $PrimaryPort
          if ($standby.reachable -and $standby.can_promote) {
            Write-Log 'primary is unhealthy; starting a replacement active backend on the primary port'
          } else {
            Write-Log 'primary is unhealthy and standby is not promotable; restarting primary'
          }
          Start-BackendNode -Port $PrimaryPort -Role 'active' -InstanceId 'primary'
          $primaryFailures = 0
        }
      } else {
        $primaryFailures = 0
      }

      if ($standby.reachable -and $standby.role -ne 'standby') {
        Write-Log "standby role is $($standby.role); restarting it as standby"
        Stop-Port -Port $StandbyPort
        Start-BackendNode -Port $StandbyPort -Role 'standby' -InstanceId 'standby'
        $standbyFailures = 0
      } elseif (!$standby.reachable -or !$standby.can_promote) {
        $standbyFailures++
        if ($standbyFailures -ge $HealthFailureThreshold) {
          Stop-Port -Port $StandbyPort
          Write-Log 'standby is unhealthy; restarting standby'
          Start-BackendNode -Port $StandbyPort -Role 'standby' -InstanceId 'standby'
          $standbyFailures = 0
        }
      } else {
        $standbyFailures = 0
      }

      if (!$frontend.reachable) {
        $frontendFailures++
        if ($frontendFailures -ge $HealthFailureThreshold) {
          Write-Log 'frontend health check failed; restarting frontend watchdog'
          Restart-Frontend
          $frontendFailures = 0
        }
      } else {
        $frontendFailures = 0
        Start-FrontendWatchdog
      }
    } catch {
      Write-Log "monitor loop error: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $IntervalSec
  }
} finally {
  if (Test-Path -LiteralPath $MonitorPidFile) {
    try {
      $currentPid = [int](Get-Content -LiteralPath $MonitorPidFile | Select-Object -First 1)
      if ($currentPid -eq $PID) {
        Remove-Item -LiteralPath $MonitorPidFile -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
}
