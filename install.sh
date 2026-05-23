#!/usr/bin/env bash
# openagentic installer — https://agenticwork.io
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash
#   # …or, from a local checkout:
#   ./install.sh
#
# Modes:
#   (default)      Five-minute zero-config quick path:
#                    - probes Ollama at localhost:11434
#                    - auto-pulls the embed + chat model if missing
#                    - generates random admin / postgres / JWT creds
#                    - brings the stack up (no Milvus on the default profile)
#                    - opens your browser auto-logged-in via a one-shot
#                      magic link, pre-pointed at your local Azure / AWS /
#                      GCP / k8s creds (mounted read-only into mcp-proxy).
#
#   --wizard       Launch the Ink TUI wizard for careful configuration
#                  (provider choice, per-MCP creds, Helm, etc.).
#   --no-open      Don't auto-open the browser at the end.
#   --ollama URL   Override the Ollama endpoint (default: localhost:11434).
set -euo pipefail

# ─── Pretty output ──────────────────────────────────────────────────────────
readonly C_RESET=$'\033[0m'
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

info()  { printf '  %s·%s %s\n' "$C_BLUE"   "$C_RESET" "$*"; }
ok()    { printf '  %s✓%s %s\n' "$C_GREEN"  "$C_RESET" "$*"; }
warn()  { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fatal() { printf '  %s✗%s %s\n' "$C_RED"    "$C_RESET" "$*"; exit 1; }
step()  { printf '\n  %s▸%s %s\n' "$C_PURPLE" "$C_RESET" "$*"; }

# ─── Args ───────────────────────────────────────────────────────────────────
MODE=quick
OPEN_BROWSER=1
OLLAMA_HOST_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --wizard)  MODE=wizard;     shift ;;
    --no-open) OPEN_BROWSER=0;  shift ;;
    --ollama)  OLLAMA_HOST_OVERRIDE="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//;s/^#//'
      exit 0 ;;
    *) shift ;;
  esac
done

banner

# ─── Pre-flight ─────────────────────────────────────────────────────────────
step "Pre-flight"
command -v docker >/dev/null 2>&1 || fatal 'Docker is required. Install from https://docs.docker.com/get-docker/'
docker info >/dev/null 2>&1       || fatal 'Docker daemon not running. Start Docker Desktop / the docker service and re-run.'
docker compose version >/dev/null 2>&1 || fatal 'Docker Compose v2 plugin is required.'
command -v git >/dev/null 2>&1    || fatal 'git is required.'
ok 'Docker, Compose v2, git'

if [[ "$MODE" == "wizard" ]]; then
  command -v node >/dev/null 2>&1 || fatal 'Node.js 20+ is required for the wizard.'
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  [[ "$NODE_MAJOR" -ge 20 ]] || fatal "Node.js 20+ required (found $(node --version))."
  ok "Node $(node --version) (wizard mode)"
fi

# ─── Source: use local checkout if present, otherwise clone ────────────────
INSTALL_DIR="${OPENAGENTIC_HOME:-$HOME/.openagentic}"
REPO_URL="${OPENAGENTIC_REPO:-https://github.com/agentic-work/openagentic.git}"
BRANCH="${OPENAGENTIC_BRANCH:-main}"

if [[ -f "./docker-compose.yml" && -d "./services/openagentic-api" ]]; then
  INSTALL_DIR="$(pwd)"
  info "Using current checkout at ${C_BOLD}${INSTALL_DIR}${C_RESET}"
else
  step "Source"
  info "Install location: ${C_BOLD}${INSTALL_DIR}${C_RESET}"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
    git -C "$INSTALL_DIR" reset --quiet --hard "origin/$BRANCH"
    ok 'Repo updated'
  else
    git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    ok 'Repo cloned'
  fi
fi
cd "$INSTALL_DIR"

# Cloud-secret stub files — mcp-proxy mounts these as env_file unconditionally.
SECRETS_DIR="$HOME/.openagentic/cloud-secrets"
mkdir -p "$SECRETS_DIR"
for f in aws.env azure.env gcp.env; do
  [[ -f "$SECRETS_DIR/$f" ]] || printf '# Fill in via the wizard or by hand. Empty = MCP relies on mounted host CLI creds.\n' > "$SECRETS_DIR/$f"
done

# ─── Wizard path ────────────────────────────────────────────────────────────
if [[ "$MODE" == "wizard" ]]; then
  cd tools/setup
  if [[ ! -d node_modules ]]; then
    info 'Installing wizard dependencies (first run only)…'
    if command -v pnpm >/dev/null 2>&1; then pnpm install --silent --prod=false
    else npm install --silent --no-fund --no-audit; fi
    ok 'Wizard dependencies installed'
  fi
  info 'Launching the setup wizard…'
  printf '\n'
  exec ./node_modules/.bin/tsx src/index.tsx
fi

# ─── Quick path ─────────────────────────────────────────────────────────────
step "Quick install"

# 1. Resolve Ollama endpoint and probe it from the host.
OLLAMA_HOST="${OLLAMA_HOST_OVERRIDE:-${OLLAMA_HOST:-}}"
if [[ -z "$OLLAMA_HOST" ]]; then
  if curl -fsS --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
    OLLAMA_HOST="http://host.docker.internal:11434"
    ok 'Found Ollama on localhost:11434 — containers will reach it via host.docker.internal'
  else
    warn 'No Ollama detected on localhost:11434.'
    warn 'Install Ollama (https://ollama.com/download) and re-run, or pass --ollama URL.'
    fatal 'Ollama is required for the quick install path. Use --wizard for cloud-LLM-only setups.'
  fi
fi
# Reach the same daemon Docker will hit, but from the host shell.
LOCAL_OLLAMA="${OLLAMA_HOST//host.docker.internal/localhost}"

# 2. Make sure the embed + chat models exist; auto-pull if missing.
EMBED_MODEL="${OLLAMA_EMBED_MODEL:-nomic-embed-text}"
CHAT_MODEL="${OLLAMA_CHAT_MODEL:-gpt-oss:20b}"
have_model() {
  curl -fsS --max-time 5 "$LOCAL_OLLAMA/api/tags" 2>/dev/null \
    | grep -qE "\"(name|model)\"[[:space:]]*:[[:space:]]*\"$1(:[^\"]*)?\""
}
for m in "$EMBED_MODEL" "$CHAT_MODEL"; do
  if have_model "$m"; then
    ok "Ollama has $m"
  else
    info "Pulling $m (this can take a few minutes for big models)…"
    if ! curl -fsS -X POST "$LOCAL_OLLAMA/api/pull" -d "{\"name\":\"$m\"}" >/dev/null 2>&1; then
      warn "Pull request for $m failed; pull manually later: ollama pull $m"
    fi
  fi
done

# 3. Generate .env with random creds if it doesn't exist.
gen_secret() {
  local n="${1:-24}"
  openssl rand -hex "$n" 2>/dev/null || head -c $((n * 2)) /dev/urandom | base64 | tr -d '/+=' | head -c "$((n * 2))"
}
if [[ -f .env ]]; then
  info '.env exists — keeping your existing config'
  set -a; . ./.env; set +a
else
  PG_PASS="$(gen_secret 16)"
  ADMIN_PASS="$(gen_secret 16)"
  JWT_SEC="$(gen_secret 32)"
  SIGN_SEC="$(gen_secret 32)"
  cat > .env <<EOF
# Generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
POSTGRES_PASSWORD=$PG_PASS
ADMIN_USER_EMAIL=admin@openagentic.local
ADMIN_SEED_PASSWORD=$ADMIN_PASS
JWT_SECRET=$JWT_SEC
SIGNING_SECRET=$SIGN_SEC
OLLAMA_HOST=$OLLAMA_HOST
OLLAMA_EMBED_MODEL=$EMBED_MODEL
OLLAMA_CHAT_MODEL=$CHAT_MODEL
UI_HOST_PORT=8080
# Quick path uses pgvector inside postgres. For Milvus, run:
#   docker compose --profile milvus up -d
DISABLE_RAG=true
SKIP_TOOL_SEMANTIC_CACHE=true
EOF
  printf 'email: admin@openagentic.local\npassword: %s\n' "$ADMIN_PASS" > "$HOME/.openagentic/admin-credentials.txt"
  chmod 600 "$HOME/.openagentic/admin-credentials.txt" .env
  ok "Generated .env (admin creds in ~/.openagentic/admin-credentials.txt)"
fi

# 4. Mint a one-shot magic-link token so the browser opens auto-logged-in.
MAGIC_TOKEN="$(gen_secret 24)"
export MAGIC_BOOT_TOKEN="$MAGIC_TOKEN"

# 5. Detect host cloud CLIs and tell the user what we found.
step "Cloud creds (host CLIs)"
detected=()
if [[ -d "$HOME/.azure" ]] && { [[ -f "$HOME/.azure/azureProfile.json" ]] || [[ -d "$HOME/.azure/TokenCache" ]]; }; then
  detected+=("Azure (~/.azure)")
fi
if [[ -f "$HOME/.aws/credentials" || -f "$HOME/.aws/config" ]]; then detected+=("AWS (~/.aws)"); fi
if [[ -d "$HOME/.config/gcloud" ]]; then detected+=("GCP (~/.config/gcloud)"); fi
if [[ -f "$HOME/.kube/config" ]];   then detected+=("Kubernetes (~/.kube/config)"); fi
if (( ${#detected[@]} > 0 )); then
  ok "Will mount read-only into mcp-proxy: ${detected[*]}"
else
  warn 'No host cloud CLIs detected. Cloud MCPs will load but return auth errors.'
  warn 'Run `az login` / `aws configure` / `gcloud auth login` to wire them up.'
fi

# 6. Bring it up.
step "docker compose up"
info 'Pulling images and starting services (first boot pulls a few GB)…'
docker compose up -d 2>&1 | tail -8

# 7. Wait for api healthy.
info 'Waiting for api healthy (~90s on first boot)…'
s=unknown
for _ in $(seq 1 90); do
  s=$(docker inspect --format '{{.State.Health.Status}}' openagentic-api-1 2>/dev/null || echo unknown)
  [[ "$s" == "healthy"   ]] && { ok 'api is healthy'; break; }
  [[ "$s" == "unhealthy" ]] && fatal 'api went unhealthy. Check `docker logs openagentic-api-1`.'
  sleep 2
done
[[ "$s" == "healthy" ]] || fatal 'api did not go healthy in ~3min. Check `docker logs openagentic-api-1`.'

# 8. Print summary + open browser auto-logged-in.
UI_HOST_PORT="${UI_HOST_PORT:-8080}"
MAGIC_URL="http://localhost:${UI_HOST_PORT}/auth/magic?token=${MAGIC_TOKEN}"

step "You're in"
printf '  %sOpenAgentic is up.%s\n\n' "$C_GREEN$C_BOLD" "$C_RESET"
printf '  Chat UI:        %s%s%s\n' "$C_BOLD" "http://localhost:${UI_HOST_PORT}" "$C_RESET"
printf '  Auto-login:     %s%s%s   %s(one-shot)%s\n' "$C_BOLD" "$MAGIC_URL" "$C_RESET" "$C_GRAY" "$C_RESET"
printf '  Admin email:    %sadmin@openagentic.local%s\n' "$C_BOLD" "$C_RESET"
printf '  Admin password: see %s~/.openagentic/admin-credentials.txt%s\n\n' "$C_BOLD" "$C_RESET"

if (( ${#detected[@]} > 0 )); then
  printf '  %sTry one of these in the chat:%s\n' "$C_PURPLE" "$C_RESET"
  for tag in "${detected[@]}"; do
    case "$tag" in
      Azure*) printf '    · %sShow me my Azure subscriptions%s\n'           "$C_BOLD" "$C_RESET" ;;
      AWS*)   printf '    · %sShow me my AWS account and EC2 instances%s\n' "$C_BOLD" "$C_RESET" ;;
      GCP*)   printf '    · %sList my GCP projects%s\n'                     "$C_BOLD" "$C_RESET" ;;
      Kuber*) printf '    · %sList all my Kubernetes pods%s\n'              "$C_BOLD" "$C_RESET" ;;
    esac
  done
  printf '\n'
fi

if [[ "$OPEN_BROWSER" == "1" ]]; then
  if   command -v xdg-open >/dev/null 2>&1; then xdg-open "$MAGIC_URL" >/dev/null 2>&1 || true
  elif command -v open     >/dev/null 2>&1; then open     "$MAGIC_URL" >/dev/null 2>&1 || true
  fi
fi
