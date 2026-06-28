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

$InstallerDir = $PSScriptRoot                                   # trajecktory\installer
$RepoRoot     = Split-Path $InstallerDir -Parent                # trajecktory
$Payload      = Join-Path $InstallerDir 'payload'
$PayloadNode  = Join-Path $Payload 'node'
$PayloadApp   = Join-Path $Payload 'trajecktory'
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

# ── 2.5 Stage the Git for Windows installer (run silently at USER-install time) ─
# build-bundle stages a payload the Inno installer ships; running git's installer
# HERE would only touch this build box. Instead, download git's installer next to
# the .iss so trajecktory.iss can run it silently during the USER's install — that
# lands git on the user's PERSISTENT PATH. Claude Code needs a shell (Git Bash, or
# PowerShell as the fallback), and Claude Desktop (a separate app) only sees git
# when it is on the persistent PATH, not a process-scoped one.
$GitVersion   = '2.47.1'
$GitInstaller = 'Git-for-Windows-installer.exe'
$GitUrl       = "https://github.com/git-for-windows/git/releases/download/v$GitVersion.windows.1/Git-$GitVersion-64-bit.exe"
$GitOut       = Join-Path $InstallerDir $GitInstaller
Write-Host "Downloading Git for Windows $GitVersion ..."
Invoke-WebRequest -Uri $GitUrl -OutFile $GitOut
if (-not (Test-Path $GitOut)) { throw "Git installer not downloaded to $GitOut" }

# ── 3. Stage the tracked tree — exactly what the public repo ships ────────────
# Use `git archive` so ONLY committed files reach the payload. The working tree
# also holds gitignored local data (cv.md, config/profile.yml, the
# templates/cv-master.docx resume, AUDIT.md, .env, tracker, reports) — none of it
# is tracked, so none of it can leak here. .gitignore IS the ship boundary; the
# PII scan in step 7 is the backstop.
New-Item -ItemType Directory -Force -Path $PayloadApp | Out-Null
$treeZip = Join-Path $env:TEMP 'trajecktory-tree.zip'
if (Test-Path $treeZip) { Remove-Item $treeZip -Force }
git -C $RepoRoot archive --format=zip -o $treeZip HEAD
if ($LASTEXITCODE -ne 0) { throw "git archive failed with code $LASTEXITCODE" }
Expand-Archive -Path $treeZip -DestinationPath $PayloadApp -Force
Remove-Item $treeZip -Force
# The installer's own source is tracked but doesn't belong inside the shipped app.
Remove-Item (Join-Path $PayloadApp 'installer') -Recurse -Force -ErrorAction SilentlyContinue

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

# ── 6.5 Make the payload a self-updating git working copy ─────────────────────
# The shipped app updates itself by pulling system-layer files from the private
# repo (see update-system.mjs). That needs a real repo with an authenticated
# remote, so we bake in a fine-grained READ-ONLY token (contents:read, this repo
# only) — a non-technical user never sees an auth prompt. The token is read from
# the build environment, NEVER from a tracked file, and lands only in the
# bundle's .git/config (which the PII scan below skips).
$UpdateToken = $env:TJK_UPDATE_TOKEN
if (-not $UpdateToken) {
  $tokenFile = Join-Path $InstallerDir '.update-token'
  if (Test-Path $tokenFile) { $UpdateToken = (Get-Content $tokenFile -Raw).Trim() }
}
if (-not $UpdateToken) {
  Write-Warning "No update token (set TJK_UPDATE_TOKEN env var or create installer\.update-token). Bundle will NOT self-update."
} else {
  Write-Host "Initializing self-update git repo in the payload ..."
  $bundleVer = (Get-Content (Join-Path $PayloadApp 'VERSION') -Raw).Trim()
  $RepoUrl   = "https://x-access-token:$UpdateToken@github.com/michaelinghilterra-creator/trajecktory.git"
  & git -C $PayloadApp init -q
  if ($LASTEXITCODE -ne 0) { throw "git init failed in payload" }
  # Persist a commit identity + disable signing IN THE BUNDLE'S REPO so the
  # updater's own commits (apply / rollback in update-system.mjs) succeed on an
  # end-user machine that has no global git user.name/email configured.
  & git -C $PayloadApp config user.email 'bundle@trajecktory.local'
  & git -C $PayloadApp config user.name  'trajecktory bundle'
  & git -C $PayloadApp config commit.gpgsign false
  # Belt-and-suspenders: keep the huge runtime dirs out of the baseline commit even
  # if the tracked .gitignore on this build box predates the ms-playwright rule.
  $excludeFile = Join-Path $PayloadApp '.git\info\exclude'
  @('node_modules/', 'ms-playwright/', '.bundle-version', '.env', 'dashboard-web/node_modules/') |
    Add-Content -Path $excludeFile
  & git -C $PayloadApp add -A
  & git -C $PayloadApp commit -q -m "trajecktory v$bundleVer bundled baseline"
  if ($LASTEXITCODE -ne 0) { throw "git baseline commit failed in payload" }
  & git -C $PayloadApp remote add origin $RepoUrl
  # Git for Windows hides the .git dir (Hidden attribute, via core.hideDotFiles).
  # Clear it so Inno Setup's recursesubdirs definitely ships .git into the install
  # — the self-update repo (and its authenticated remote) lives there.
  & attrib -h (Join-Path $PayloadApp '.git')
  # Heavy-runtime generation marker; update-system.mjs refuses code updates that
  # need a newer bundle than this. Bump when you ship a new .exe with new Node/Chromium.
  Set-Content -Path (Join-Path $PayloadApp '.bundle-version') -Value '1' -NoNewline
  Write-Host "Self-update repo ready (origin set, baseline committed at v$bundleVer)."
}

# ── 7. PII backstop: fail the build if any personal data slipped into payload ─
# Mirrors the repo PII scrub. Add patterns if the candidate identity changes.
Write-Host "Scanning payload for residual PII ..."
# Two scans: (1) the owner's identity (literal) read from the SOURCE profile.yml
# (the payload excludes profile.yml). Never hardcoded, so this script ships clean
# and the scan adapts to whoever is building.
$piiPatterns = @()
$srcProfile = Join-Path $RepoRoot 'config\profile.yml'
if (Test-Path $srcProfile) {
  $prof = Get-Content $srcProfile -Raw
  foreach ($k in 'full_name', 'email', 'phone') {
    $rx = '(?m)^\s*' + $k + ':\s*["'']?([^"''\r\n#]+)'
    if ($prof -match $rx) { $piiPatterns += $Matches[1].Trim() }
  }
}
# (2) Secret/credential patterns (regex). Catches real API keys/tokens by prefix
# + entropy across providers, not just Anthropic. Add new providers here.
$secretPatterns = @(
  'sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{20,}',   # Anthropic API key
  'sk-proj-[A-Za-z0-9_-]{20,}',              # OpenAI project key
  'GOCSPX-[A-Za-z0-9_-]{10,}',               # Google OAuth client secret
  'ya29\.[A-Za-z0-9_-]{20,}',                # Google OAuth access token
  'gh[pousr]_[A-Za-z0-9]{36,}',              # GitHub token (classic)
  'github_pat_[A-Za-z0-9_]{50,}',            # GitHub fine-grained PAT
  'AKIA[0-9A-Z]{16}',                        # AWS access key id
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'       # PEM private key
)
# Files where the maintainer's name/email legitimately appear (attribution +
# contact). Mirrors the allowlist in test-all.mjs; matched by file name.
$piiAllow = @(
  'README.md', 'LICENSE', 'CITATION.cff', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md',
  'SECURITY.md', 'SUPPORT.md', 'NOTICE.md', 'AGENTS.md', 'CLAUDE.md', 'package.json'
)
$scanFiles = Get-ChildItem $Payload -Recurse -File |
  Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\ms-playwright\\' -and
    $_.FullName -notmatch '\\\.git\\' -and
    ($piiAllow -notcontains $_.Name)
  }
$hits = @()
# Identity match is literal (-SimpleMatch): the phone begins with "+", which is
# not a valid regex quantifier and would otherwise crash Select-String. Safe over
# binaries — the owner's name/email/phone won't appear inside a compiled file.
if ($piiPatterns.Count -gt 0) {
  $hits += $scanFiles | Select-String -Pattern $piiPatterns -SimpleMatch -List -ErrorAction SilentlyContinue
}
# Secret match is regex, restricted to TEXT files. Running entropy-ish patterns
# over binaries yields false positives (e.g. node.exe embeds OpenSSL PEM header
# strings that match the private-key pattern). A real leaked credential lives in
# a text source/config file, which these extensions cover.
$textExt = @('.mjs','.cjs','.js','.jsx','.ts','.tsx','.json','.md','.markdown','.yml','.yaml','.html','.htm','.css','.txt','.ps1','.psm1','.sh','.bash','.toml','.ini','.cfg','.conf','.xml','.svg','.csv','.tsv','.env','.example','.sample','.gitignore','.gitattributes','.editorconfig','.npmrc','.nvmrc')
$secretFiles = $scanFiles | Where-Object { $textExt -contains $_.Extension.ToLower() }
$hits += $secretFiles | Select-String -Pattern $secretPatterns -List -ErrorAction SilentlyContinue
if ($hits) {
  $hits | ForEach-Object { Write-Warning "PII/secret in payload: $($_.Path)" }
  throw "Refusing to build: personal data or secrets found in payload (see warnings above)."
}

# ── 8. Report ─────────────────────────────────────────────────────────────────
$sizeMB = [math]::Round((Get-ChildItem $Payload -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "`nPayload staged at $Payload ($sizeMB MB)."
Write-Host "Next: compile installer\trajecktory.iss with Inno Setup to produce TrajecktorySetup.exe."
