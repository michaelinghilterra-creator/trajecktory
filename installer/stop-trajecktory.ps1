#requires -Version 5.1
<#
  stop-trajecktory.ps1 — stop the running dashboard (the Node process bound to
  port 3333). Wired to a "Stop trajecktory" Start Menu shortcut.

  UNTESTED: authored without a build machine. Verify on a clean VM.
#>
$ErrorActionPreference = 'SilentlyContinue'

$stopped = $false
# Preferred: find whoever owns the listener on 3333 and stop that PID.
$conns = Get-NetTCPConnection -LocalPort 3333 -State Listen
foreach ($c in $conns) {
  $proc = Get-Process -Id $c.OwningProcess
  if ($proc) {
    Write-Host "Stopping trajecktory (pid $($proc.Id))"
    Stop-Process -Id $proc.Id -Force
    $stopped = $true
  }
}

if (-not $stopped) {
  Write-Host 'No trajecktory server found listening on port 3333.'
}
