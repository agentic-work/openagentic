#!/usr/bin/env bash
# openagentic installer — https://agenticwork.io
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash
#   # …or, from a local checkout:
#   ./install.sh
#
# Modes:
#   (default)      Launch the interactive Ink TUI wizard. Lets you pick Docker
#                  (compose) or Helm (kubernetes), then walks provider choice,
#                  per-MCP creds, review, and the live install — all on screen.
#                  This is what `curl -sSL install.openagentics.io | bash` runs.
#                  The wizard writes the same .env shape that --env consumes.
#
#   --quick        Five-minute zero-config Docker path:
#                    - probes Ollama at localhost:11434
#                    - auto-pulls the embed + chat model if missing
#                    - generates random admin / postgres / JWT creds
#                    - brings the stack up (no Milvus on the default profile)
#                    - opens your browser auto-logged-in via a one-shot
#                      magic link, pre-pointed at your local Azure / AWS /
#                      GCP / k8s creds (mounted read-only into mcp-proxy).
#   --wizard       Explicitly launch the wizard (same as the default).
#   --helm         One-line Kubernetes install. Clones the repo, then
#                  `helm upgrade --install` the chart into the `openagentic`
#                  namespace and waits for rollout. Needs helm + kubectl + a
#                  reachable cluster (kube-context). No Docker required.
#   --env PATH     Skip ALL prompts. Copy PATH to ./.env and bring up the
#                  stack as-is. Useful for scripted installs / CI / 2nd
#                  machines where you already have a known-good .env.
#   --no-open      Don't auto-open the browser at the end.
#   --ollama URL   Override the Ollama endpoint (default: localhost:11434).
set -euo pipefail

# ─── Pretty output ──────────────────────────────────────────────────────────
readonly C_RESET=$'\033[0m'
readonly C_BOLD=$'\033[1m'
# brand palette (openagentics.io / Boards-of-Canada world) — was Claude-purple.
readonly C_PURPLE=$'\033[38;2;95;168;119m'    # repointed: dusty brand green (steps/▸)
readonly C_BLUE=$'\033[38;2;111;179;168m'     # beepboop teal (info ·)
readonly C_GREEN=$'\033[38;2;136;204;160m'    # accent green (ok ✓)
readonly C_YELLOW=$'\033[38;2;217;174;82m'    # amber (warn !)
readonly C_RED=$'\033[38;2;224;102;58m'       # burnt-orange (fatal ✗)
readonly C_GRAY=$'\033[38;2;169;188;169m'     # muted cream
# beepboop's own inks
readonly C_TEAL=$'\033[38;2;111;179;168m'     # body
readonly C_PHOS=$'\033[38;2;159;216;196m'     # phosphor screen (eyes/mouth)
readonly C_ORANGE=$'\033[38;2;219;130;64m'    # antenna LED / signal
readonly C_AMBER=$'\033[38;2;217;174;82m'     # amber cheeks
readonly C_CREAM=$'\033[38;2;227;235;224m'    # warm cream text

# clean masthead — gradient wordmark + rule + tagline (matches the Ink wizard).
banner() {
  [ -t 1 ] && printf '\033[2J\033[3J\033[H'   # start in a clean terminal
  printf '\n'
  printf '  %s%s⌥  %sopen%sagen%stic%s          %sself-hosted · docker / k8s · v1.0%s\n' \
    "$C_BOLD" "$C_ORANGE" "$C_TEAL" "$C_GREEN" "$C_AMBER" "$C_RESET" "$C_GRAY" "$C_RESET"
  printf '  %s──────────────────────────────────────────────────────────────────%s\n' "$C_GREEN" "$C_RESET"
  printf '  %sthe open agentic platform for IT operations%s\n' "$C_CREAM" "$C_RESET"
  printf '\n'
}

info()  { printf '  %s·%s %s\n' "$C_BLUE"   "$C_RESET" "$*"; }
ok()    { printf '  %s✓%s %s\n' "$C_GREEN"  "$C_RESET" "$*"; }
warn()  { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fatal() { printf '  %s✗%s %s\n' "$C_RED"    "$C_RESET" "$*"; exit 1; }
step()  { printf '\n  %s▸%s %s\n' "$C_PURPLE" "$C_RESET" "$*"; }

# ─── Args ───────────────────────────────────────────────────────────────────
# Default is the interactive Ink-TUI wizard: it lets the user pick Docker (compose)
# or Helm (kubernetes) and walks the whole install. `curl -sSL install.openagentics.io
# | bash` lands here. Use --quick for the zero-config 5-minute Docker path.
MODE=wizard
OPEN_BROWSER=1
OLLAMA_HOST_OVERRIDE=""
ENV_FILE_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --wizard)  MODE=wizard;     shift ;;
    --quick)   MODE=quick;      shift ;;
    --helm)    MODE=helm;       shift ;;
    --env)     MODE=env-file; ENV_FILE_OVERRIDE="$2"; shift 2 ;;
    --no-open) OPEN_BROWSER=0;  shift ;;
    --ollama)  OLLAMA_HOST_OVERRIDE="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//;s/^#//'
      exit 0 ;;
    *) shift ;;
  esac
done

banner

# ─── Pre-flight ─────────────────────────────────────────────────────────────
step "Pre-flight"
command -v git >/dev/null 2>&1    || fatal 'git is required.'
if [[ "$MODE" == "helm" ]]; then
  command -v helm    >/dev/null 2>&1 || fatal 'helm is required for --helm. Install: https://helm.sh/docs/intro/install/'
  command -v kubectl >/dev/null 2>&1 || fatal 'kubectl is required for --helm.'
  kubectl cluster-info >/dev/null 2>&1 || fatal 'No reachable Kubernetes cluster (check your kube-context).'
  ok 'helm, kubectl, cluster, git'
else
  command -v docker >/dev/null 2>&1 || fatal 'Docker is required. Install from https://docs.docker.com/get-docker/'
  docker info >/dev/null 2>&1       || fatal 'Docker daemon not running. Start Docker Desktop / the docker service and re-run.'
  docker compose version >/dev/null 2>&1 || fatal 'Docker Compose v2 plugin is required.'
  ok 'Docker, Compose v2, git'
fi

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

# ─── Helm path ──────────────────────────────────────────────────────────────
# One-line Kubernetes install: helm upgrade --install the chart, wait for the
# rollout, print the WOW banner. Values: values-local-k8s.yaml if present,
# else the chart defaults.
if [[ "$MODE" == "helm" ]]; then
  NS="${OPENAGENTIC_NAMESPACE:-openagentic}"
  VALUES="helm/openagentic/values-local-k8s.yaml"
  [[ -f "$VALUES" ]] || VALUES="helm/openagentic/values.yaml"
  step "helm upgrade --install openagentic (namespace: ${NS})"
  info "values: ${C_BOLD}${VALUES}${C_RESET}"
  helm upgrade --install openagentic ./helm/openagentic \
    --namespace "$NS" --create-namespace \
    -f "$VALUES" --wait --timeout 10m 2>&1 | tail -12
  ok 'Helm release deployed'
  printf '\n  %sOpenAgentic is up on Kubernetes.%s\n\n' "$C_GREEN$C_BOLD" "$C_RESET"
  printf '  Namespace:  %s%s%s\n' "$C_BOLD" "$NS" "$C_RESET"
  printf '  Open UI:    %skubectl -n %s port-forward svc/ui 8080:80%s  →  %shttp://localhost:8080%s\n' "$C_BOLD" "$NS" "$C_RESET" "$C_BOLD" "$C_RESET"
  printf '  Pods:       %skubectl -n %s get pods%s\n\n' "$C_BOLD" "$NS" "$C_RESET"
  exit 0
fi

# Cloud-secret stub files — mcp-proxy mounts these as env_file unconditionally.
SECRETS_DIR="$HOME/.openagentic/cloud-secrets"
mkdir -p "$SECRETS_DIR"
for f in aws.env azure.env gcp.env; do
  [[ -f "$SECRETS_DIR/$f" ]] || printf '# Fill in via the wizard or by hand. Empty = MCP relies on mounted host CLI creds.\n' > "$SECRETS_DIR/$f"
done

# ─── Env-file path ──────────────────────────────────────────────────────────
# Skips both wizard + auto-gen. Copies the user-supplied .env in, brings the
# stack up, autologins via MAGIC_BOOT_TOKEN if the env defines one. The Ink
# wizard writes the same shape, so this is the "I already configured it once,
# now do it again" path.
if [[ "$MODE" == "env-file" ]]; then
  step "Env file"
  [[ -n "$ENV_FILE_OVERRIDE" ]] || fatal '--env requires a path argument.'
  [[ -f "$ENV_FILE_OVERRIDE" ]] || fatal "env file not found: $ENV_FILE_OVERRIDE"
  cp "$ENV_FILE_OVERRIDE" .env
  chmod 600 .env || true
  ok "Copied $ENV_FILE_OVERRIDE → ./.env"

  # Pull the MAGIC_BOOT_TOKEN out if the supplied env has one; otherwise mint
  # a fresh one + write it back so first-run autologin still works.
  if grep -qE '^MAGIC_BOOT_TOKEN=.{16,}' .env; then
    export MAGIC_BOOT_TOKEN="$(grep -E '^MAGIC_BOOT_TOKEN=' .env | head -1 | cut -d= -f2-)"
    ok 'Using MAGIC_BOOT_TOKEN from supplied env'
  else
    MAGIC_TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
    export MAGIC_BOOT_TOKEN="$MAGIC_TOKEN"
    echo "MAGIC_BOOT_TOKEN=$MAGIC_TOKEN" >> .env
    ok 'Minted fresh MAGIC_BOOT_TOKEN'
  fi

  step "docker compose up"
  docker compose --profile milvus up -d 2>&1 | tail -8

  info 'Waiting for api healthy (~90s on first boot)…'
  s=unknown
  for _ in $(seq 1 90); do
    s=$(docker inspect --format '{{.State.Health.Status}}' openagentic-api-1 2>/dev/null || echo unknown)
    [[ "$s" == "healthy" ]]   && { ok 'api is healthy'; break; }
    [[ "$s" == "unhealthy" ]] && fatal 'api went unhealthy. Check `docker logs openagentic-api-1`.'
    sleep 2
  done
  [[ "$s" == "healthy" ]] || fatal 'api did not go healthy in ~3min.'

  UI_HOST_PORT=$(grep -E '^UI_HOST_PORT=' .env | head -1 | cut -d= -f2- || echo 8080)
  UI_HOST_PORT="${UI_HOST_PORT:-8080}"
  MAGIC_URL="http://localhost:${UI_HOST_PORT}/auth/magic?token=${MAGIC_BOOT_TOKEN}"
  printf '\n  %sOpenAgentic is up.%s\n' "$C_GREEN$C_BOLD" "$C_RESET"
  printf '  Chat UI:    %s%s%s\n' "$C_BOLD" "http://localhost:${UI_HOST_PORT}" "$C_RESET"
  printf '  Autologin:  %s%s%s\n\n' "$C_BOLD" "$MAGIC_URL" "$C_RESET"
  if [[ "$OPEN_BROWSER" == "1" ]]; then
    if   command -v xdg-open >/dev/null 2>&1; then xdg-open "$MAGIC_URL" >/dev/null 2>&1 || true
    elif command -v open     >/dev/null 2>&1; then open     "$MAGIC_URL" >/dev/null 2>&1 || true
    fi
  fi
  exit 0
fi

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
  # When invoked via `curl … | bash`, the shell's stdin is the download pipe, not
  # the keyboard — the Ink TUI needs a real TTY for raw-mode input. Re-attach stdin
  # to the controlling terminal so the wizard is interactive in the one-line install.
  if [[ -e /dev/tty ]]; then
    exec ./node_modules/.bin/tsx src/index.tsx < /dev/tty
  else
    exec ./node_modules/.bin/tsx src/index.tsx
  fi
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

# 2. Make sure embed + chat models exist.
#    Embed model: small (~270MB), always nomic-embed-text. Pull if missing.
#    Chat model: detect the best tool-capable model the user already has, in
#    rough order of quality. Only auto-pull when nothing usable is present —
#    avoids a 5GB+ surprise on a box that already has e.g. llama3.1:8b loaded.
EMBED_MODEL="${OLLAMA_EMBED_MODEL:-nomic-embed-text}"
DEFAULT_CHAT="${OLLAMA_CHAT_MODEL:-qwen2.5:7b}"
have_model() {
  curl -fsS --max-time 5 "$LOCAL_OLLAMA/api/tags" 2>/dev/null \
    | grep -qE "\"(name|model)\"[[:space:]]*:[[:space:]]*\"$1(:[^\"]*)?\""
}
# Embed model
if have_model "$EMBED_MODEL"; then
  ok "Ollama has $EMBED_MODEL"
else
  info "Pulling $EMBED_MODEL (~270MB)…"
  curl -fsS -X POST "$LOCAL_OLLAMA/api/pull" -d "{\"name\":\"$EMBED_MODEL\"}" >/dev/null 2>&1 \
    || warn "Pull failed; try manually later: ollama pull $EMBED_MODEL"
fi

# Chat model — auto-detect.
CHAT_MODEL=""
# Pull all available model names once; grep for tool-capable families in order.
all_models=$(curl -fsS --max-time 5 "$LOCAL_OLLAMA/api/tags" 2>/dev/null | \
  grep -oE "\"(name|model)\"[[:space:]]*:[[:space:]]*\"[^\"]+\"" | \
  sed -E 's/.*"([^"]+)"$/\1/' | sort -u)
# Priority order: small-and-strong first, then large-and-strongest, then any tool-capable family.
for pat in 'qwen2\.5' 'qwen3' 'gpt-oss' 'llama3\.3' 'llama3\.1' 'llama-?3' 'mistral' 'gemma'; do
  match=$(echo "$all_models" | grep -E "^$pat(:|$)" | head -1)
  if [[ -n "$match" ]]; then CHAT_MODEL="$match"; break; fi
done
if [[ -n "$CHAT_MODEL" ]]; then
  ok "Using existing chat model: $CHAT_MODEL"
else
  info "No tool-capable chat model found. Pulling $DEFAULT_CHAT (~4.7GB; ~3min on broadband)…"
  if curl -fsS -X POST "$LOCAL_OLLAMA/api/pull" -d "{\"name\":\"$DEFAULT_CHAT\"}" >/dev/null 2>&1; then
    ok "Pulled $DEFAULT_CHAT"
    CHAT_MODEL="$DEFAULT_CHAT"
  else
    warn "Pull failed; the stack will boot but chat will fail until you pull a model:"
    warn "  ollama pull $DEFAULT_CHAT"
    CHAT_MODEL="$DEFAULT_CHAT"
  fi
fi

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

# 6. Bring it up. The milvus profile (etcd/minio/milvus) is REQUIRED — the api
# connects to Milvus on boot and exits if it can't reach it (server.ts).
step "docker compose up"
info 'Pulling images and starting services (first boot pulls a few GB)…'
docker compose --profile milvus up -d 2>&1 | tail -8

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
