<#
.SYNOPSIS
  openagentic installer for Windows (PowerShell) - https://agenticwork.io

.DESCRIPTION
  Mirrors install.sh for Windows: verifies Docker Desktop / git / Node 20+,
  clones (or updates) the repo to %USERPROFILE%\.openagentic over HTTPS, runs the
  interactive Ink TUI setup wizard, then brings the Docker Compose stack up.

  The wizard writes .env (deploy target, admin user, Ollama, LLM providers, MCP
  selection + per-MCP auth) and - on the Docker target - brings the stack up
  itself; the final `docker compose up -d` here is an idempotent safety net.

  Linux / macOS users: use the bash installer instead -
    curl -sSL https://install.openagentics.io | bash

.EXAMPLE
  # One-liner (run in Windows Terminal / PowerShell):
  irm https://install.openagentics.io/install.ps1 | iex

.EXAMPLE
  # From a local checkout:
  .\install.ps1

.LINK
  https://openagentics.io/docs/troubleshooting
  https://github.com/agentic-work/openagentic/issues
#>

# Fail fast: any error (including a non-terminating one we promote) aborts.
$ErrorActionPreference = 'Stop'

# --- Constants ---------------------------------------------------------------
$RepoUrl     = 'https://github.com/agentic-work/openagentic.git'   # HTTPS - public, no SSH/token
$InstallDir  = Join-Path $env:USERPROFILE '.openagentic'
$TroubleUrl  = 'https://openagentics.io/docs/troubleshooting'
$IssuesUrl   = 'https://github.com/agentic-work/openagentic/issues'

# --- Pretty output -----------------------------------------------------------
function Write-Step($msg) { Write-Host "`n  > $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  . $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  + $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Fail($msg, [string[]]$hints) {
  Write-Host "`n  x $msg" -ForegroundColor Red
  foreach ($h in $hints) { Write-Host "      -> $h" -ForegroundColor DarkGray }
  Write-Host ''
  Write-Host "  Still stuck? Troubleshooting: $TroubleUrl" -ForegroundColor DarkGray
  Write-Host "               Open an issue:   $IssuesUrl"  -ForegroundColor DarkGray
  Write-Host ''
  exit 1
}

function Banner {
  Write-Host ''
  Write-Host '  (alt)  openagentic        self-hosted - docker - windows - v1.0' -ForegroundColor White
  Write-Host '  ------------------------------------------------------------------' -ForegroundColor Green
  Write-Host '  the open agentic platform for IT operations' -ForegroundColor Gray
  Write-Host ''
}

Banner

# --- Pre-flight --------------------------------------------------------------
Write-Step 'Pre-flight'

# git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail 'git is required.' @(
    'Install it: winget install --id Git.Git -e',
    'Or download: https://git-scm.com/download/win'
  )
}

# Docker CLI + daemon
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail 'Docker Desktop is required.' @(
    'Install it: winget install --id Docker.DockerDesktop -e',
    'Or download: https://docs.docker.com/desktop/install/windows-install/'
  )
}
# `docker info` succeeds only when the daemon is actually running.
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Fail 'The Docker daemon is not running.' @(
    'Start Docker Desktop and wait for the whale icon to go steady, then re-run.'
  )
}
# Compose v2 plugin
& docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  Fail 'Docker Compose v2 is required.' @(
    'Update Docker Desktop - Compose v2 ships with current versions.'
  )
}

# Node 20+ (the Ink TUI wizard needs it)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js 20+ is required for the setup wizard.' @(
    'Install it: winget install --id OpenJS.NodeJS.LTS -e',
    'Or download: https://nodejs.org'
  )
}
$nodeMajor = 0
try {
  $nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]' 2>$null)
} catch { $nodeMajor = 0 }
if ($nodeMajor -lt 20) {
  $found = (& node --version 2>$null)
  if (-not $found) { $found = 'unknown' }
  Fail "Node.js 20+ required (found $found)." @(
    'Upgrade Node: winget install --id OpenJS.NodeJS.LTS -e   (or https://nodejs.org)'
  )
}

Write-Ok ("Docker, Compose v2, git, Node {0}" -f (& node --version))

# --- Clone or update the repo (HTTPS, idempotent) ----------------------------
if (Test-Path (Join-Path $InstallDir '.git')) {
  Write-Step "Updating existing install at $InstallDir"
  Push-Location $InstallDir
  try {
    & git pull --ff-only
    if ($LASTEXITCODE -ne 0) {
      Write-Warn 'git pull --ff-only did not fast-forward; keeping the existing checkout as-is.'
    } else {
      Write-Ok 'Repo updated'
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Step "Cloning openagentic to $InstallDir"
  Write-Info "Source: $RepoUrl"
  & git clone --depth 1 $RepoUrl $InstallDir
  if ($LASTEXITCODE -ne 0) {
    Fail 'git clone failed.' @(
      'Check your network / proxy and that the repo URL is reachable:',
      "  $RepoUrl"
    )
  }
  Write-Ok 'Repo cloned'
}

# --- Run the Ink TUI setup wizard --------------------------------------------
# Same wizard install.sh runs: tsx from the cloned tools/setup source. Ink needs
# a real console - Windows Terminal / PowerShell provides one (raw-mode input).
$SetupDir = Join-Path $InstallDir 'tools\setup'
$WizardEntry = Join-Path $SetupDir 'src\index.tsx'
if (-not (Test-Path $WizardEntry)) {
  Fail "Setup wizard not found at $WizardEntry" @(
    'The clone may be incomplete - delete the install dir and re-run:',
    "  Remove-Item -Recurse -Force `"$InstallDir`""
  )
}

Push-Location $SetupDir
try {
  # The local tsx CLI shim install.sh execs as ./node_modules/.bin/tsx - on
  # Windows npm writes a tsx.cmd batch shim alongside it.
  $tsxBin = Join-Path $SetupDir 'node_modules\.bin\tsx.cmd'
  if (-not (Test-Path $tsxBin)) {
    Write-Step 'Installing wizard dependencies (first run only)'
    # tools/setup is NOT part of the repo's pnpm workspace, so plain `npm install`
    # is the reliable cross-tool path here (it has no workspace to confuse it).
    & npm install --no-fund --no-audit
    if (-not (Test-Path $tsxBin)) {
      Fail 'Could not install the setup wizard (tsx is missing after install).' @(
        "Re-run manually: cd `"$SetupDir`" ; npm install"
      )
    }
    Write-Ok 'Wizard dependencies installed'
  }

  Write-Step 'Launching the setup wizard'
  Write-Host ''
  # Invoke the local tsx shim directly (mirrors install.sh's
  # ./node_modules/.bin/tsx src/index.tsx) so Ink gets the live PowerShell
  # console - a piped `iex` one-liner still leaves the console attached for
  # the wizard's raw-mode keyboard input.
  & $tsxBin 'src\index.tsx'
  if ($LASTEXITCODE -ne 0) {
    Fail 'The setup wizard exited with an error.' @(
      'Re-run the installer, or see the troubleshooting guide.'
    )
  }
} finally {
  Pop-Location
}

# --- Bring the stack up (idempotent safety net) ------------------------------
# On the Docker target the wizard already runs `docker compose up`; re-running it
# from the repo root is a no-op if everything is already up, and brings up any
# service that isn't. (Helm-target installs have no local compose stack - skip.)
if (Test-Path (Join-Path $InstallDir 'docker-compose.yml')) {
  Write-Step 'Ensuring the Docker Compose stack is up'
  Push-Location $InstallDir
  try {
    & docker compose up -d
    if ($LASTEXITCODE -ne 0) {
      Fail 'docker compose up failed.' @(
        'Check: docker compose ps   and   docker logs openagentic-api-1 --tail=100'
      )
    }
  } finally {
    Pop-Location
  }
}

# --- Done --------------------------------------------------------------------
Write-Host ''
Write-Host '  OpenAgentic is up.' -ForegroundColor Green
Write-Host '  Chat UI:        http://localhost:8080' -ForegroundColor White
Write-Host '  Admin email:    admin@openagentic.local' -ForegroundColor White
Write-Host ("  Admin password: see {0}\admin-credentials.txt" -f $InstallDir) -ForegroundColor White
Write-Host ''
Write-Host "  Docs: $TroubleUrl" -ForegroundColor DarkGray
Write-Host ''
