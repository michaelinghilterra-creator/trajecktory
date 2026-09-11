$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir
Write-Host "Pulling latest from origin..."
git pull

# Auto-restart: relaunch node if it ever dies unexpectedly (e.g. sleep/suspend
# killed it mid-eval). Ctrl+C still stops this for good, since the break signal
# goes to the whole console process tree, not just the node child below.
while ($true) {
    node dashboard-web/server/index.mjs
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) { break }
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Server exited with code $exitCode, restarting in 3s..."
    Start-Sleep -Seconds 3
}
