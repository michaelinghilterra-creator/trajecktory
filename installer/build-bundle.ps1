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
#
# Nothing watches this pin. Dependabot reads package manifests, so a version
# literal in a PowerShell script is invisible to it, and no workflow builds or
# scans the installer. The previous value (20.18.1, November 2024) therefore sat
# here untouched until Node 20 reached EOL on 2026-04-30 and the shipped runtime
# became permanently unpatchable: post-EOL CVEs are never backported, and
# update-system.mjs refuses to touch vendored runtimes, so every install stayed
# on it until a new .exe shipped. Move BEFORE the EOL date, not after. 24.x
# (Krypton) is supported through April 2028; check the schedule at
# https://nodejs.org/en/about/previous-releases when touching this line.
$NodeVersion = '24.18.0'
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
# The shipped app updates itself by pulling system-layer files from the PUBLIC
# repo (see update-system.mjs). That needs a real repo with a remote. Since the
# repo is public, the origin is a plain tokenless HTTPS URL: no credential ships
# in the bundle and anonymous fetch just works. Rebuild and ship this bundle only
# AFTER the repo is public (see the go-public rollout in the plan).
Write-Host "Initializing self-update git repo in the payload ..."
$bundleVer = (Get-Content (Join-Path $PayloadApp 'VERSION') -Raw).Trim()
$RepoUrl   = "https://github.com/michaelinghilterra-creator/trajecktory.git"
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
  # Fetch-only origin. update-system.mjs never pushes (it fetches, then commits
  # locally), and an end user has no write access to the public repo regardless.
  # But any editor that notices a git remote will cheerfully offer "Create PR",
  # which reads to a tester as though contributing upstream were part of the
  # product. Pointing the push URL at a non-repo turns that into an immediate,
  # self-explaining failure instead of a confusing GitHub auth round trip.
  # Fetch is unaffected: `remote set-url` without --push leaves the fetch URL alone,
  # so ensureTokenlessOrigin()'s legacy-token rewrite still works.
  & git -C $PayloadApp remote set-url --push origin 'trajecktory-is-read-only-fork-on-github-to-contribute'
  # Never prompt for or reuse machine credentials on fetch: the public repo needs
  # none, and this keeps a headless self-update from hanging on a credential prompt.
  & git -C $PayloadApp config credential.helper ''
  # Git for Windows hides the .git dir (Hidden attribute, via core.hideDotFiles).
  # Clear it so Inno Setup's recursesubdirs definitely ships .git into the install
  # — the self-update repo (and its authenticated remote) lives there.
  & attrib -h (Join-Path $PayloadApp '.git')
  # Heavy-runtime generation marker; update-system.mjs refuses code updates that
  # need a newer bundle than this. Bump when you ship a new .exe with new Node/Chromium.
  # Generation 2 = Node 24.x; generation 1 was Node 20.x. MIN_BUNDLE_VERSION in the
  # repo deliberately STAYS at 1: the code still runs on the old runtime, and
  # raising it would cut every existing generation-1 install off from all code
  # updates, not just from changes that actually need Node 24.
  Set-Content -Path (Join-Path $PayloadApp '.bundle-version') -Value '2' -NoNewline
  Write-Host "Self-update repo ready (tokenless public origin, baseline committed at v$bundleVer)."

# ── 6.6 interview-prep layout QA: no stray FLAT cheat sheets may ship ─────────
# The folder-per-company convention (modes/interview-prep.md + organize-interview-
# prep.mjs) puts every shipped cheat sheet in interview-prep/{Company}/. git archive
# should carry only interview-prep/.gitkeep (all prep is gitignored), so --check must
# find nothing. A flat .md here means one was force-tracked past the .gitignore and
# would reach every new user unorganized — fail the build. --check never moves files.
Write-Host "Checking interview-prep layout in payload ..."
$ipDir     = Join-Path $PayloadApp 'interview-prep'
$orgScript = Join-Path $PayloadApp 'organize-interview-prep.mjs'
if ((Test-Path $ipDir) -and (Test-Path $orgScript)) {
  & $NodeExe $orgScript --dir $ipDir --check
  if ($LASTEXITCODE -ne 0) {
    throw "Refusing to build: flat interview-prep file(s) in payload. Cheat sheets must live in interview-prep/{Company}/. A flat file here was force-tracked past .gitignore (interview-prep/* is ignored) — remove it from git, or run 'node organize-interview-prep.mjs --apply' and re-commit the source."
  }
  Write-Host "  interview-prep layout OK."
} else {
  Write-Host "  (interview-prep dir or organizer script absent — skipping)"
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
# Also scan the bundle's .git/config specifically (it has no file extension, so it
# is not in $textExt above): the tokenless origin means it must contain NO
# credential, so this fails the build if a token is ever reintroduced into the URL.
$gitConfig = Join-Path $PayloadApp '.git\config'
if (Test-Path $gitConfig) {
  $hits += Select-String -Path $gitConfig -Pattern $secretPatterns -List -ErrorAction SilentlyContinue
}
if ($hits) {
  $hits | ForEach-Object { Write-Warning "PII/secret in payload: $($_.Path)" }
  throw "Refusing to build: personal data or secrets found in payload (see warnings above)."
}

# ── 7b. PII gate (the enforcing one) ─────────────────────────────────────────
# The scan above only knows THREE literals: the builder's own name, email and
# phone, matched as plaintext. v1.14.0 shipped past it carrying a .zip of the
# builder's CV (an archive stores its contents compressed, so no plaintext scan
# can see inside), a real recruiter's work email (not the builder — no concept of
# third parties), a real walk-away figure (a bare number — no concept of comp),
# and real evaluation reports (no concept of pipeline state).
#
# verify-no-pii.mjs covers those four classes and is the same engine test-all.mjs
# runs against the tracked tree, so the repo gate and the ship gate cannot drift.
# It derives every term at runtime from the gitignored sources on THIS machine,
# which is why it runs from $RepoRoot (where config/profile.yml and data/ live)
# and points --payload at the staged tree.
Write-Host "Scanning payload for personal data (verify-no-pii.mjs) ..."
# Scanned surface is $PayloadApp, not $Payload: $PayloadApp is the `git archive HEAD`
# tree (the app itself, and the exact surface this gate is built for), while $Payload
# also holds the vendored Node runtime and Chromium — hundreds of MB of third-party
# binaries fetched from nodejs.org that cannot contain this maintainer personal data.
$piiScript = Join-Path $RepoRoot 'verify-no-pii.mjs'
if (Test-Path $piiScript) {
  Push-Location $RepoRoot
  try { & $NodeExe $piiScript --payload $PayloadApp } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) {
    throw "Refusing to build: personal data in payload (see the leak list above). These files would ship to every user who installs or updates. Remove them from git — the payload is built with 'git archive HEAD', so tracked means shipped."
  }
} else {
  throw "Refusing to build: verify-no-pii.mjs not found at $piiScript. The personal-data gate is mandatory; a build without it is how a real CV shipped in v1.14.0."
}

# ── 8. Report ─────────────────────────────────────────────────────────────────
$sizeMB = [math]::Round((Get-ChildItem $Payload -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "`nPayload staged at $Payload ($sizeMB MB)."
Write-Host "Next: compile installer\trajecktory.iss with Inno Setup to produce TrajecktorySetup.exe."
