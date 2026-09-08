$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir
Write-Host "Pulling latest from origin..."
git pull
node dashboard-web/server/index.mjs
