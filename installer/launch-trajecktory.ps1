#requires -Version 5.1
<#
  launch-trajecktory.ps1 — start the dashboard from an installed bundle.

  Installed at <InstallDir>\launch-trajecktory.ps1, with <InstallDir>\node and
  <InstallDir>\career-ops as siblings. The Start Menu / desktop shortcut points
  here (run via: powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File ...).

  UNTESTED: authored without a build machine. Verify on a clean VM.
#>
$ErrorActionPreference = 'Stop'

$InstallDir = $PSScriptRoot
$NodeDir    = Join-Path $InstallDir 'node'
$AppRoot    = Join-Path $InstallDir 'career-ops'
$WebDir     = Join-Path $AppRoot 'dashboard-web'
$Url        = 'http://localhost:3333'

# 1. Put the bundled Node + Claude Code on PATH for this process. The server
#    shells out to bare `node ...` and spawns `claude`, so both must resolve
#    from the bundle, never from the user's system.
$env:Path = "$NodeDir;$env:Path"

# 2. Point Playwright at the bundled Chromium (offline, no global cache).
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $AppRoot 'ms-playwright'

# 3. First run only: authenticate Claude Code against the user's own Claude Pro
#    account so Evaluate / Scan work. Best-effort and interactive; never blocks
#    the dashboard from starting. The pasted API key (if any) powers only the
#    draft features, not eval.
$loginMarker = Join-Path $InstallDir '.claude-login-done'
if (-not (Test-Path $loginMarker)) {
  try {
    Write-Host 'First run: sign in to your Claude account so Evaluate/Scan can run.'
    & (Join-Path $NodeDir 'claude.cmd') login
    New-Item -ItemType File -Path $loginMarker -Force | Out-Null
  } catch {
    Write-Warning "Claude sign-in skipped/failed; run 'claude login' later to enable Evaluate/Scan. ($_)"
  }
}

# 4. Build the front-end bundle, then start the server (single Express process).
Push-Location $WebDir
& (Join-Path $NodeDir 'node.exe') 'build.mjs'
$server = Start-Process -FilePath (Join-Path $NodeDir 'node.exe') `
  -ArgumentList 'server\index.mjs' -PassThru -WindowStyle Hidden
Pop-Location

# 5. Wait for the server to answer, then open the default browser.
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null; break }
  catch { Start-Sleep -Milliseconds 500 }
}
Start-Process $Url

# 6. Keep this process tied to the server so "Stop trajecktory" (or ending this
#    process) takes the server down with it.
Wait-Process -Id $server.Id
