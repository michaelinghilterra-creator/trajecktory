#requires -Version 5.1
<#
  stop-trajecktory.ps1 — stop the running dashboard. Wired to a "Stop trajecktory"
  Start Menu shortcut.

  Finds the server via the PID + port that launch-trajecktory.ps1 recorded (the
  server may not be on 3333 if that port was taken), falling back to a port scan.

  UNTESTED: authored without a build machine. Verify on a clean VM.
#>
$ErrorActionPreference = 'SilentlyContinue'

$InstallDir = $PSScriptRoot
$stopped = $false

# 1. Preferred: the exact PID recorded at launch.
$pidFile = Join-Path $InstallDir '.tjk-pid'
if (Test-Path $pidFile) {
  $recorded = (Get-Content $pidFile -Raw).Trim()
  if ($recorded -match '^\d+$') {
    $proc = Get-Process -Id ([int]$recorded)
    if ($proc) {
      Write-Host "Stopping trajecktory (pid $($proc.Id))"
      Stop-Process -Id $proc.Id -Force
      $stopped = $true
    }
  }
}

# 2. Fallback: whoever owns the recorded port (or 3333 if none was recorded).
if (-not $stopped) {
  $port = 3333
  $portFile = Join-Path $InstallDir '.tjk-port'
  if (Test-Path $portFile) {
    $p = (Get-Content $portFile -Raw).Trim()
    if ($p -match '^\d+$') { $port = [int]$p }
  }
  foreach ($c in (Get-NetTCPConnection -LocalPort $port -State Listen)) {
    $proc = Get-Process -Id $c.OwningProcess
    if ($proc) {
      Write-Host "Stopping trajecktory (pid $($proc.Id), port $port)"
      Stop-Process -Id $proc.Id -Force
      $stopped = $true
    }
  }
}

if ($stopped) {
  Remove-Item (Join-Path $InstallDir '.tjk-pid') -Force -ErrorAction SilentlyContinue
} else {
  Write-Host 'No running trajecktory server found.'
}
