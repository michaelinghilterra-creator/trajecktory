#requires -Version 5.1
<#
  build-bundle.ps1 — stage the fully self-contained, offline payload that the
  Inno Setup installer (trajecktory.iss) compresses into TrajecktorySetup.exe.

  Run this ONCE on a Windows build machine. It needs internet (to fetch Node and
  Chromium) but the resulting payload/ does not — everything is bundled.

  UNTESTED IN CI: this was authored without a build machine in the loop. Walk it
  the first time and adjust the pinned versions / exclusion list as needed.

  Usage:
    pwsh -ExecutionPolicy Bypass -File installer\build-bundle.ps1
#>
$ErrorActionPreference = 'Stop'

# ── Config ────────────────────────────────────────────────────────────────────
# Pin the Node runtime so the bundle never depends on (or touches) the user's
# system Node. Bump deliberately; keep it on an active LTS.
$NodeVersion = '20.18.1'
$NodeZipName = "node-v$NodeVersion-win-x64"
$NodeUrl     = "https://nodejs.org/dist/v$NodeVersion/$NodeZipName.zip"

$InstallerDir = $PSScriptRoot                                   # career-ops\installer
$RepoRoot     = Split-Path $InstallerDir -Parent                # career-ops
$Payload      = Join-Path $InstallerDir 'payload'
$PayloadNode  = Join-Path $Payload 'node'
$PayloadApp   = Join-Path $Payload 'career-ops'
$BrowsersPath = Join-Path $PayloadApp 'ms-playwright'

Write-Host "Repo root : $RepoRoot"
Write-Host "Payload   : $Payload"

# ── 1. Clean payload ────────────────────────────────────────────────────────
if (Test-Path $Payload) { Remove-Item $Payload -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Payload | Out-Null

# ── 2. Fetch + extract pinned portable Node ──────────────────────────────────
$zip = Join-Path $env:TEMP "$NodeZipName.zip"
Write-Host "Downloading Node $NodeVersion ..."
Invoke-WebRequest -Uri $NodeUrl -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $Payload -Force
Rename-Item (Join-Path $Payload $NodeZipName) $PayloadNode
$NodeExe = Join-Path $PayloadNode 'node.exe'
$NpmCmd  = Join-Path $PayloadNode 'npm.cmd'
if (-not (Test-Path $NodeExe)) { throw "node.exe not found at $NodeExe" }

# Make the bundled Node the one used for every install step below.
$env:Path = "$PayloadNode;$env:Path"

# ── 3. Copy the career-ops tree, EXCLUDING all user-layer + machine data ──────
# IMPORTANT: until the repo history is rewritten (the "fresh-history repo"
# Milestone-1 task), this exclusion list is the ONLY thing keeping the user's
# CV / profile / tracker / reports / keys out of the shipped bundle. The PII
# scan in step 7 is the backstop. Review both whenever the tree changes.
$excludeDirs = @(
  '.git', 'node_modules', 'ms-playwright', 'output', 'reports', 'backups',
  'data', 'interview-prep', 'jds', 'ignore-old_design_audit_files', '.claude\projects'
)
$excludeFiles = @(
  '.env', '*.env', '*.bak', '*.bak-*', 'cv.md', 'profile.yml',
  '_profile.md', 'article-digest.md', 'portals.yml', 'server.log', '*.patch'
)
# robocopy: /MIR mirror, /XD exclude dirs, /XF exclude files. Exit codes 0-7 are success.
robocopy $RepoRoot $PayloadApp /MIR /XD @excludeDirs /XF @excludeFiles /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }

# Recreate the empty writable dirs onboarding/Launchpad expects.
foreach ($d in 'data', 'output', 'reports') {
  New-Item -ItemType Directory -Force -Path (Join-Path $PayloadApp $d) | Out-Null
}

# Sanity: the example configs the first-run flow copies from must be present.
foreach ($f in 'config\profile.example.yml', 'templates\portals.example.yml', 'modes\_profile.template.md') {
  if (-not (Test-Path (Join-Path $PayloadApp $f))) { throw "Missing onboarding template: $f" }
}

# ── 4. Install production deps with the BUNDLED Node (matches the runtime) ─────
Write-Host "npm ci (root, omit dev) ..."
& $NpmCmd --prefix $PayloadApp ci --omit=dev
Write-Host "npm ci (dashboard-web, incl. dev for esbuild build.mjs) ..."
& $NpmCmd --prefix (Join-Path $PayloadApp 'dashboard-web') ci

# ── 5. Bundle Claude Code into the portable Node (eval/scan run on it) ─────────
# Installs claude + claude.cmd under payload\node so it is on PATH at runtime.
# The user authenticates it once with `claude login` (their own Pro account).
Write-Host "Installing Claude Code into the bundled Node ..."
$env:NPM_CONFIG_PREFIX = $PayloadNode
& $NpmCmd install -g '@anthropic-ai/claude-code'
Remove-Item Env:\NPM_CONFIG_PREFIX
if (-not (Test-Path (Join-Path $PayloadNode 'claude.cmd'))) {
  Write-Warning "claude.cmd not found in $PayloadNode — verify the global prefix install layout."
}

# ── 6. Bundle Playwright Chromium INSIDE the payload (offline) ────────────────
Write-Host "Installing Playwright Chromium into the payload ..."
$env:PLAYWRIGHT_BROWSERS_PATH = $BrowsersPath
& $NodeExe (Join-Path $PayloadApp 'node_modules\playwright\cli.js') install chromium
Remove-Item Env:\PLAYWRIGHT_BROWSERS_PATH

# ── 7. PII backstop: fail the build if any personal data slipped into payload ─
# Mirrors the repo PII scrub. Add patterns if the candidate identity changes.
Write-Host "Scanning payload for residual PII ..."
# Generic secret prefix + the owner's identity read from the SOURCE profile.yml
# (the payload excludes profile.yml). Never hardcoded, so this script ships clean
# and the scan adapts to whoever is building.
$piiPatterns = @('sk-ant-api')
$srcProfile = Join-Path $RepoRoot 'config\profile.yml'
if (Test-Path $srcProfile) {
  $prof = Get-Content $srcProfile -Raw
  foreach ($k in 'full_name', 'email', 'phone') {
    $rx = '(?m)^\s*' + $k + ':\s*["'']?([^"''\r\n#]+)'
    if ($prof -match $rx) { $piiPatterns += $Matches[1].Trim() }
  }
}
$hits = Get-ChildItem $Payload -Recurse -File |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\ms-playwright\\' } |
  Select-String -Pattern $piiPatterns -List -ErrorAction SilentlyContinue
if ($hits) {
  $hits | ForEach-Object { Write-Warning "PII in payload: $($_.Path)" }
  throw "Refusing to build: personal data found in payload (see warnings above)."
}

# ── 8. Report ─────────────────────────────────────────────────────────────────
$sizeMB = [math]::Round((Get-ChildItem $Payload -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "`nPayload staged at $Payload ($sizeMB MB)."
Write-Host "Next: compile installer\trajecktory.iss with Inno Setup to produce TrajecktorySetup.exe."
