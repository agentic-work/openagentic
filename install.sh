#!/usr/bin/env bash
# OpenAgentic installer — https://openagentics.io
#
# Usage:
#   curl -sSL https://install.openagentics.io | bash
#   # or
#   curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash
#
# What this does:
#   1. Verifies Docker is installed and running
#   2. Clones the openagentic repo into ~/.openagentic (or updates it)
#   3. Launches the Ink TUI wizard
#   4. Brings up the stack (Docker or Helm)
#   5. Opens http://localhost:8080 in your browser
set -euo pipefail

# ─── Pretty output ──────────────────────────────────────────────────────────
readonly C_RESET=$'\033[0m'
readonly C_DIM=$'\033[2m'
readonly C_BOLD=$'\033[1m'
readonly C_PURPLE=$'\033[38;5;135m'
readonly C_BLUE=$'\033[38;5;39m'
readonly C_GREEN=$'\033[38;5;46m'
readonly C_YELLOW=$'\033[38;5;220m'
readonly C_RED=$'\033[38;5;196m'
readonly C_GRAY=$'\033[38;5;244m'

banner() {
  printf '\n'
  printf '  %s╭─────────────────────────────────────────────────╮%s\n' "$C_PURPLE" "$C_RESET"
  printf '  %s│%s   %sopenagentic%s   %sthe agentic platform for IT%s   %s│%s\n' "$C_PURPLE" "$C_RESET" "$C_BOLD" "$C_RESET" "$C_GRAY" "$C_RESET" "$C_PURPLE" "$C_RESET"
  printf '  %s╰─────────────────────────────────────────────────╯%s\n' "$C_PURPLE" "$C_RESET"
  printf '\n'
}

info()    { printf '  %s·%s %s\n' "$C_BLUE"   "$C_RESET" "$*"; }
ok()      { printf '  %s✓%s %s\n' "$C_GREEN"  "$C_RESET" "$*"; }
warn()    { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fatal()   { printf '  %s✗%s %s\n' "$C_RED"    "$C_RESET" "$*"; exit 1; }

# ─── Pre-flight ─────────────────────────────────────────────────────────────
banner

info 'Checking prerequisites…'

command -v docker >/dev/null 2>&1 || fatal 'Docker is required. Install it from https://docs.docker.com/get-docker/'
docker info >/dev/null 2>&1 || fatal 'Docker daemon is not running. Start Docker Desktop (or the docker service) and re-run.'
ok 'Docker is available'

if ! docker compose version >/dev/null 2>&1; then
  fatal 'Docker Compose v2 is required (docker compose — the plugin, not docker-compose). Install it from https://docs.docker.com/compose/install/.'
fi
ok 'Docker Compose v2 is available'

command -v git >/dev/null 2>&1 || fatal 'git is required.'
ok 'git is available'

# Node is needed for the TUI. If missing, try to install via nvm, otherwise fail with guidance.
if ! command -v node >/dev/null 2>&1; then
  warn 'Node.js is not installed — the setup wizard needs it.'
  fatal 'Install Node.js 20+ from https://nodejs.org/ (or `brew install node` / `apt install nodejs`) and re-run.'
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  fatal "Node.js 20+ required (found $(node --version)). Upgrade via nvm or your package manager."
fi
ok "Node $(node --version) is available"

# ─── Cloud-secret stubs ─────────────────────────────────────────────────────
# docker-compose.yml mounts these as env_file on the mcp-proxy service, so
# they MUST exist even for users who aren't using any cloud MCP. Empty stubs
# are harmless — the proxy just sees no AWS/Azure/GCP envs and skips those MCPs.
SECRETS_DIR="$HOME/.openagentic/cloud-secrets"
mkdir -p "$SECRETS_DIR"
for f in aws.env azure.env gcp.env; do
  [[ -f "$SECRETS_DIR/$f" ]] || {
    cat > "$SECRETS_DIR/$f" <<EOF
# Fill in via the wizard or by hand. Empty = MCP stays disabled.
EOF
  }
done
ok "Cloud-secret stubs ensured under $SECRETS_DIR"

# ─── Clone or update repo ───────────────────────────────────────────────────
INSTALL_DIR="${OPENAGENTIC_HOME:-$HOME/.openagentic}"
REPO_URL="${OPENAGENTIC_REPO:-https://github.com/agentic-work/openagentic.git}"
BRANCH="${OPENAGENTIC_BRANCH:-main}"

info "Install location: ${C_BOLD}${INSTALL_DIR}${C_RESET}"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  info 'Updating existing install…'
  git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
  git -C "$INSTALL_DIR" reset --quiet --hard "origin/$BRANCH"
  ok 'Repo updated'
else
  info 'Cloning openagentic…'
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  ok 'Repo cloned'
fi

# ─── Build & run the wizard ─────────────────────────────────────────────────
cd "$INSTALL_DIR/tools/setup"

if [[ ! -d node_modules ]]; then
  info 'Installing wizard dependencies (first run only)…'
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --silent --prod=false
  elif command -v npm >/dev/null 2>&1; then
    npm install --silent --no-fund --no-audit
  else
    fatal 'Neither pnpm nor npm was found on PATH.'
  fi
  ok 'Wizard dependencies installed'
fi

info 'Launching the setup wizard…'
printf '\n'

# The TUI owns stdout/stderr/stdin from here.
exec ./node_modules/.bin/tsx src/index.tsx "$@"
