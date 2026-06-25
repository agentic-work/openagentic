#!/usr/bin/env bash
# openagentic installer — https://agenticwork.io
#
# Usage (linux / macOS):
#   curl -sSL https://install.openagentics.io | bash
#   # …or pin to the repo's raw install.sh:
#   curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash
#   # …or, from a local checkout:
#   ./install.sh
#
# Windows: run the PowerShell installer instead —
#   irm https://install.openagentics.io/install.ps1 | iex
#
# Modes:
#   (default)      Launch the interactive Ink TUI wizard. Lets you pick Docker
#                  (compose) or Helm (kubernetes), then walks provider choice,
#                  per-MCP creds, review, and the live install — all on screen.
#                  This is what `curl -sSL install.openagentics.io | bash` runs.
#                  The wizard writes the same .env shape that --env consumes.
#
#   --quick        Five-minute zero-config Docker path:
#                    - generates random admin / postgres / JWT creds
#                    - brings the stack up (no Milvus on the default profile)
#                    - DETECTS an Ollama you already run (localhost / host
#                      gateway) and wires it as the provider IF present. It does
#                      NOT install or force Ollama on you — if none is running
#                      the stack still boots provider-agnostic and you pick a
#                      provider in the admin UI (or re-run with --wizard).
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
#   --update       Update an existing install in place: pull the latest source,
#                  rebuild, and restart (Docker), or `helm upgrade` (--helm).
#                  Keeps your .env. Safe to re-run.
#   --doctor       Diagnose only. Checks Docker/Compose, Node, helm/kubectl,
#                  disk, ports, and an existing install — fixes nothing, just
#                  reports what's wrong. Run this first when something breaks.
#   --no-open      Don't auto-open the browser at the end.
#   --ollama URL   Override the Ollama endpoint (default: localhost:11434).
#   --milvus       Opt in to the Milvus vector store (HA / large-scale RAG).
#                  Default is the lightweight pgvector-only stack — no
#                  etcd/minio/milvus. (Or set OPENAGENTIC_MILVUS=1.)
#   -h, --help     Show this help.
#
# Get help:  https://openagentics.io/docs/troubleshooting
#            https://github.com/agentic-work/openagentic/issues
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
step()  { printf '\n  %s▸%s %s\n' "$C_PURPLE" "$C_RESET" "$*"; }
# A hint line under a warning/error — the "here's how to fix it" follow-up.
hint()  { printf '    %s↳%s %s\n' "$C_GRAY" "$C_RESET" "$*"; }

# ─── Help / support surface ──────────────────────────────────────────────────
readonly DOCS_URL="https://openagentics.io/docs"
readonly QUICKSTART_URL="https://openagentics.io/docs/quickstart"
readonly TROUBLESHOOT_URL="https://openagentics.io/docs/troubleshooting"
readonly ISSUES_URL="https://github.com/agentic-work/openagentic/issues"
readonly SUPPORT_EMAIL="support@agenticwork.io"
# Set by the trap so the help block can name the phase that failed.
CURRENT_STEP="starting up"

# Printed whenever the installer dies — the single most useful thing for someone
# who is stuck. Names what failed, the most likely fixes, and where to get help.
need_help() {
  printf '\n  %s%s───────────────────────────────────────────────────────────%s\n' "$C_BOLD" "$C_RED" "$C_RESET"
  printf '  %s%sInstall failed during: %s%s\n' "$C_BOLD" "$C_RED" "$CURRENT_STEP" "$C_RESET"
  printf '  %s───────────────────────────────────────────────────────────%s\n\n' "$C_RED" "$C_RESET"
  printf '  %sFirst, try these:%s\n' "$C_BOLD" "$C_RESET"
  printf '    1. Re-run the diagnostic:   %scurl -fsSL https://install.openagentics.io | bash -s -- --doctor%s\n' "$C_BOLD" "$C_RESET"
  printf '    2. Read the error above — it usually says exactly what to fix.\n'
  if [[ "${MODE:-}" == "helm" ]]; then
    printf '    3. Inspect the cluster:     %skubectl -n %s get pods%s   and   %skubectl -n %s describe pod <name>%s\n' \
      "$C_BOLD" "${OPENAGENTIC_NAMESPACE:-openagentic}" "$C_RESET" "$C_BOLD" "${OPENAGENTIC_NAMESPACE:-openagentic}" "$C_RESET"
    printf '    4. Tail a crashing pod:     %skubectl -n %s logs deploy/api --tail=100%s\n' "$C_BOLD" "${OPENAGENTIC_NAMESPACE:-openagentic}" "$C_RESET"
  else
    printf '    3. Check the API logs:      %sdocker logs openagentic-api-1 --tail=100%s\n' "$C_BOLD" "$C_RESET"
    printf '    4. Check what is running:   %sdocker compose ps%s\n' "$C_BOLD" "$C_RESET"
  fi
  printf '\n  %sStill stuck?%s\n' "$C_BOLD" "$C_RESET"
  printf '    Troubleshooting guide: %s%s%s\n' "$C_BLUE" "$TROUBLESHOOT_URL" "$C_RESET"
  printf '    Open an issue (paste the error + the --doctor output): %s%s%s\n' "$C_BLUE" "$ISSUES_URL" "$C_RESET"
  printf '    Email: %s%s%s\n\n' "$C_BLUE" "$SUPPORT_EMAIL" "$C_RESET"
}

# fatal: print the message + remediation hints, then exit. The EXIT trap prints
# the full help block, so fatal stays terse.
fatal() {
  printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$1"
  shift || true
  while [[ $# -gt 0 ]]; do hint "$1"; shift; done
  exit 1
}

# On ANY non-zero exit (set -e tripping, or an explicit fatal), surface the help
# block — unless we exited cleanly (EXIT_OK=1 set right before a successful exit).
# Use an `if` (NOT `[[ … ]] && need_help`): under `set -e`, the `&&` form short-circuits
# to a non-zero status on a CLEAN exit, and bash propagates the EXIT-trap's final status
# as the script's exit code — making a fully-successful install spuriously return 1. The
# `if` form returns 0 when the condition is false, so a successful run exits 0.
EXIT_OK=0
on_exit() { local code=$?; if [[ "$code" -ne 0 && "$EXIT_OK" -ne 1 ]]; then need_help; fi; }
trap on_exit EXIT
trap 'CURRENT_STEP="line $LINENO"' ERR

# ─── Resource preflight helpers ──────────────────────────────────────────────
# Free disk (GB) on the install volume. Best-effort; 0 if it can't be read.
# `df -g` is macOS/BSD-only; GNU df (Linux) rejects it, so the old `-Pg` always
# fell through to `0`. `-Pk` (POSIX 1K blocks) works on BOTH; convert KB→GB.
free_disk_gb() { df -Pk "$1" 2>/dev/null | awk 'NR==2{print int($4/1048576)}' || echo 0; }
# Is a TCP port already bound on the host? (used to catch UI port clashes early)
port_in_use() {
  local p="$1"
  if command -v lsof >/dev/null 2>&1; then lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then nc -z localhost "$p" >/dev/null 2>&1
  else return 1; fi
}
# Portable sha256 of a file → prints the bare hex digest, nothing else.
# Linux ships `sha256sum`; macOS ships `shasum -a 256`. Returns non-zero if
# neither is available so the caller can fail closed.
sha256_of() {
  local f="$1"
  if   command -v sha256sum >/dev/null 2>&1; then sha256sum "$f" | awk '{print $1}'
  elif command -v shasum    >/dev/null 2>&1; then shasum -a 256 "$f" | awk '{print $1}'
  else return 1; fi
}

# ─── Args ───────────────────────────────────────────────────────────────────
# Default is the interactive Ink-TUI wizard: it lets the user pick Docker (compose)
# or Helm (kubernetes) and walks the whole install. `curl -sSL install.openagentics.io
# | bash` lands here. Use --quick for the zero-config 5-minute Docker path.
MODE=wizard
OPEN_BROWSER=1
OLLAMA_HOST_OVERRIDE=""
ENV_FILE_OVERRIDE=""
# Vector store: pgvector-only by default (lightweight — no etcd/minio/milvus).
# Opt in to Milvus with --milvus or OPENAGENTIC_MILVUS=1.
USE_MILVUS="${OPENAGENTIC_MILVUS:-0}"
# Google Vertex AI provider (instead of Ollama). Auth via gcloud ADC by default
# (no key written); pass --vertex-key KEY for API-key mode. Service-account JSON
# is NOT supported for Vertex here (ADC user creds are auto-discovered by the SDK).
VERTEX_MODE=0
VERTEX_API_KEY=''
VERTEX_PROJECT_ID=''
VERTEX_LOCATION='us-central1'
# AWS Bedrock provider (quick path). Auth: long-term IAM keys (--aws-key/--aws-secret),
# short-term STS (also --aws-session-token), or the mounted host ~/.aws default
# credential chain (compose mounts ~/.aws:ro — used when no inline keys are given).
BEDROCK_MODE=0
AWS_KEY_ID=''
AWS_SECRET=''
AWS_SESSION=''
AWS_REGION_FLAG='us-east-1'
BEDROCK_MODEL='amazon.nova-pro-v1:0'
# OpenAI provider (quick path). Direct OpenAI API; --openai-key + --openai-model.
OPENAI_MODE=0
OPENAI_KEY=''
OPENAI_MODEL='gpt-4o-mini'
# Azure AI Foundry provider (quick path). API key OR Microsoft Entra app.
AIF_MODE=0
AIF_ENDPOINT_FLAG=''
AIF_KEY=''
AIF_TENANT=''
AIF_CLIENT=''
AIF_SECRET=''
AIF_DEPLOYMENT=''
# Hugging Face provider (quick path). HF Inference Endpoint / TGI — OpenAI-compatible,
# so it is wired through the OpenAI adapter with a custom base URL.
HF_MODE=0
HF_ENDPOINT=''
HF_TOKEN=''
HF_MODEL=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --wizard)  MODE=wizard;     shift ;;
    --quick)   MODE=quick;      shift ;;
    --helm)    MODE=helm;       shift ;;
    --update)  MODE=update;     shift ;;
    --doctor)  MODE=doctor;     shift ;;
    --down)    MODE=down;       shift ;;
    --env)     MODE=env-file; ENV_FILE_OVERRIDE="${2:-}"; shift 2 ;;
    --no-open) OPEN_BROWSER=0;  shift ;;
    --ollama)  OLLAMA_HOST_OVERRIDE="${2:-}"; shift 2 ;;
    --vertex)       VERTEX_MODE=1;                              shift ;;
    --vertex-key)   VERTEX_MODE=1; VERTEX_API_KEY="${2:-}";     shift 2 ;;
    --gcp-project)  VERTEX_PROJECT_ID="${2:-}";                 shift 2 ;;
    --gcp-location) VERTEX_LOCATION="${2:-us-central1}";        shift 2 ;;
    --bedrock)            BEDROCK_MODE=1;                            shift ;;
    --aws-key)           BEDROCK_MODE=1; AWS_KEY_ID="${2:-}";       shift 2 ;;
    --aws-secret)        BEDROCK_MODE=1; AWS_SECRET="${2:-}";       shift 2 ;;
    --aws-session-token) BEDROCK_MODE=1; AWS_SESSION="${2:-}";      shift 2 ;;
    --aws-region)        AWS_REGION_FLAG="${2:-us-east-1}";         shift 2 ;;
    --bedrock-model)     BEDROCK_MODE=1; BEDROCK_MODEL="${2:-amazon.nova-pro-v1:0}"; shift 2 ;;
    --openai)       OPENAI_MODE=1; OPENAI_KEY="${2:-}";         shift 2 ;;
    --openai-key)   OPENAI_MODE=1; OPENAI_KEY="${2:-}";         shift 2 ;;
    --openai-model) OPENAI_MODE=1; OPENAI_MODEL="${2:-gpt-4o-mini}"; shift 2 ;;
    --aif)            AIF_MODE=1;                                shift ;;
    --aif-endpoint)   AIF_MODE=1; AIF_ENDPOINT_FLAG="${2:-}";   shift 2 ;;
    --aif-key)        AIF_MODE=1; AIF_KEY="${2:-}";             shift 2 ;;
    --aif-tenant)     AIF_MODE=1; AIF_TENANT="${2:-}";          shift 2 ;;
    --aif-client)     AIF_MODE=1; AIF_CLIENT="${2:-}";          shift 2 ;;
    --aif-secret)     AIF_MODE=1; AIF_SECRET="${2:-}";          shift 2 ;;
    --aif-deployment) AIF_MODE=1; AIF_DEPLOYMENT="${2:-}";      shift 2 ;;
    --huggingface)  HF_MODE=1;                                  shift ;;
    --hf-endpoint)  HF_MODE=1; HF_ENDPOINT="${2:-}";            shift 2 ;;
    --hf-token)     HF_MODE=1; HF_TOKEN="${2:-}";               shift 2 ;;
    --hf-model)     HF_MODE=1; HF_MODEL="${2:-}";               shift 2 ;;
    --milvus)  USE_MILVUS=1;    shift ;;
    -h|--help)
      # Self-contained so it works under `curl … | bash -s -- --help`, where the
      # script has no on-disk path ($0 / BASH_SOURCE are unusable through a pipe).
      cat <<'EOH'
openagentic installer — https://agenticwork.io

Usage:
  curl -sSL https://install.openagentics.io | bash
  # …or, from a local checkout:
  ./install.sh

Modes:
  (default)      Launch the interactive Ink TUI wizard (Docker or Helm).
  --quick        Five-minute zero-config Docker path (uses an Ollama you already run if present; never force-installs one).
  --wizard       Explicitly launch the wizard (same as the default).
  --helm         One-line Kubernetes install (needs helm + kubectl + a cluster).
  --env PATH     Skip ALL prompts; copy PATH to ./.env and bring the stack up.
  --update       Update an existing install in place (Docker rebuild or helm upgrade).
  --doctor       Diagnose only — checks Docker/Compose, Node, helm/kubectl, disk, ports.
  --down         Tear down a stack previously installed here with install.sh
                 (stops + removes its Docker containers, network, and volumes).
  --no-open      Don't auto-open the browser at the end.
  --ollama URL   Override the Ollama endpoint (default: localhost:11434).
  --vertex       Use Vertex AI (Google) — ADC by default (gcloud auth application-default login), or --vertex-key KEY.
                 Optional: --gcp-project ID  --gcp-location REGION (default us-central1).
  --bedrock      Use AWS Bedrock. Auth: long-term IAM keys (--aws-key ID --aws-secret SECRET),
                 short-term STS (also --aws-session-token TOKEN), or the mounted host ~/.aws
                 default chain (no inline keys). Optional: --aws-region REGION (default us-east-1)
                 --bedrock-model ID (default amazon.nova-pro-v1:0).
  --openai       Use OpenAI. --openai-key KEY  [--openai-model MODEL (default gpt-4o-mini)].
  --aif          Use Azure AI Foundry. --aif-endpoint URL --aif-deployment NAME, plus an API key
                 (--aif-key KEY) OR a Microsoft Entra app (--aif-tenant/--aif-client/--aif-secret).
  --huggingface  Use a Hugging Face Inference Endpoint / TGI (OpenAI-compatible).
                 --hf-endpoint URL --hf-token TOKEN --hf-model NAME.
  --milvus       Opt in to the Milvus vector store (default is pgvector-only).
  -h, --help     Show this help.

Windows users: run the PowerShell installer instead —
  irm https://install.openagentics.io/install.ps1 | iex

Get help:  https://openagentics.io/docs/troubleshooting
           https://github.com/agentic-work/openagentic/issues
EOH
      EXIT_OK=1; exit 0 ;;
    *) warn "Unknown option: $1 (ignoring). Run with --help to see valid flags."; shift ;;
  esac
done

# `docker compose up` argument set, gated on the vector-store choice. Default is
# pgvector-only (NO --profile milvus, MILVUS_ENABLED unset → isMilvusEnabled()
# returns false in server.ts). --milvus opts into the HA Milvus trio + flips the
# flag so the api connects to it. compose_up <extra-up-args...>
compose_up() {
  # --pull always: ALWAYS fetch the current ghcr `:latest` digest. Plain
  # `docker compose up` reuses an already-present `:latest` tag even when a newer
  # image was published — so a machine with stale cached images runs OLD code
  # (e.g. misses the welcome screen / a server fix). The digest check is cheap
  # when nothing changed; it only re-downloads layers that actually moved.
  if [[ "$USE_MILVUS" == "1" ]]; then
    MILVUS_ENABLED=true docker compose --profile milvus up --pull always "$@"
  else
    docker compose up --pull always "$@"
  fi
}

banner

# ─── Down: tear down a stack previously installed here with install.sh ───────
if [[ "$MODE" == "down" ]]; then
  CURRENT_STEP="teardown"
  step "Tear down"
  DOWN_DIR="${OPENAGENTIC_HOME:-$HOME/.openagentic}"
  command -v docker >/dev/null 2>&1 || fatal 'docker not found.' 'Nothing to tear down without Docker.'
  if [[ ! -f "$DOWN_DIR/docker-compose.yml" ]]; then
    warn "No install.sh stack found at $DOWN_DIR — nothing to tear down."
    EXIT_OK=1; exit 0
  fi
  info "Removing the OpenAgentic stack at $DOWN_DIR (containers, network, volumes)…"
  ( cd "$DOWN_DIR" && docker compose --profile milvus --profile monitoring --profile ollama down -v --remove-orphans >/dev/null 2>&1 ) \
    || ( cd "$DOWN_DIR" && docker compose down -v --remove-orphans >/dev/null 2>&1 ) || true
  ok 'Stack torn down.'
  printf '  Your .env + cloud-secrets under %s are kept — re-run install.sh to bring it back up.\n\n' "$DOWN_DIR"
  EXIT_OK=1; exit 0
fi

# ─── Doctor: diagnose-only, fixes nothing ────────────────────────────────────
# Run first when something is broken. Reports environment + an existing install.
if [[ "$MODE" == "doctor" ]]; then
  CURRENT_STEP="diagnostics"
  step "Diagnostics"
  problems=0
  chk() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else warn "$1 — MISSING/FAILED"; [[ -n "${3:-}" ]] && hint "$3"; problems=$((problems+1)); fi; }
  printf '  %sCore%s\n' "$C_BOLD" "$C_RESET"
  chk 'git' 'command -v git' 'Install git, then re-run.'
  chk 'curl' 'command -v curl'
  printf '\n  %sDocker path%s\n' "$C_BOLD" "$C_RESET"
  chk 'docker CLI' 'command -v docker' 'Install Docker Desktop: https://docs.docker.com/get-docker/'
  chk 'docker daemon running' 'docker info' 'Start Docker Desktop / the docker service.'
  chk 'compose v2 plugin' 'docker compose version' 'Update Docker Desktop, or install the compose v2 plugin.'
  printf '\n  %sKubernetes path (for --helm)%s\n' "$C_BOLD" "$C_RESET"
  chk 'helm' 'command -v helm' 'Install: https://helm.sh/docs/intro/install/'
  chk 'kubectl' 'command -v kubectl' 'Install: https://kubernetes.io/docs/tasks/tools/'
  chk 'reachable cluster' 'kubectl cluster-info' 'Check your kube-context: kubectl config current-context'
  chk 'cert-manager present' 'kubectl get crd certificates.cert-manager.io' 'Needed only for ingress TLS — see the Kubernetes deploy doc.'
  printf '\n  %sWizard path%s\n' "$C_BOLD" "$C_RESET"
  if command -v node >/dev/null 2>&1; then
    NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
    if [[ "$NODE_MAJOR" -ge 20 ]]; then ok "Node $(node --version)"; else warn "Node 20+ required (found $(node --version 2>/dev/null))"; hint 'Install Node 20+: https://nodejs.org'; problems=$((problems+1)); fi
  else warn 'node — MISSING'; hint 'The TUI wizard needs Node 20+. The --quick and --env paths do not.'; problems=$((problems+1)); fi
  printf '\n  %sResources%s\n' "$C_BOLD" "$C_RESET"
  DGB=$(free_disk_gb "$HOME")
  if [[ "$DGB" -ge 10 ]]; then ok "Disk: ${DGB}GB free in \$HOME"; else warn "Only ${DGB}GB free in \$HOME — the images need ~8-10GB"; problems=$((problems+1)); fi
  if port_in_use 8080; then warn 'Port 8080 is already in use'; hint 'Set UI_HOST_PORT in .env to a free port (e.g. 8088), or stop whatever holds 8080.'; else ok 'Port 8080 free'; fi
  printf '\n  %sExisting install%s\n' "$C_BOLD" "$C_RESET"
  if [[ -d "${OPENAGENTIC_HOME:-$HOME/.openagentic}/.git" ]]; then
    ok "Found install at ${OPENAGENTIC_HOME:-$HOME/.openagentic}"
    if command -v docker >/dev/null 2>&1; then
      running=$(docker ps --filter 'name=openagentic-' --format '{{.Names}}' 2>/dev/null | wc -l | tr -d ' ')
      info "openagentic containers running: ${running:-0}"
    fi
  else info 'No existing install in ~/.openagentic (a fresh install will create it).'; fi
  printf '\n'
  if [[ "$problems" -eq 0 ]]; then ok 'No blocking problems found. You should be good to install.'
  else warn "$problems issue(s) above. Fix the MISSING/FAILED items, then run the installer."; fi
  printf '  Docs: %s%s%s   ·   Issues: %s%s%s\n\n' "$C_BLUE" "$TROUBLESHOOT_URL" "$C_RESET" "$C_BLUE" "$ISSUES_URL" "$C_RESET"
  EXIT_OK=1; exit 0
fi

# ─── Pre-flight ─────────────────────────────────────────────────────────────
CURRENT_STEP="pre-flight checks"
step "Pre-flight"
command -v git >/dev/null 2>&1    || fatal 'git is required.' 'macOS: xcode-select --install   ·   Debian/Ubuntu: sudo apt-get install git'
if [[ "$MODE" == "helm" ]]; then
  command -v helm    >/dev/null 2>&1 || fatal 'helm is required for --helm.' 'Install: https://helm.sh/docs/intro/install/'
  command -v kubectl >/dev/null 2>&1 || fatal 'kubectl is required for --helm.' 'Install: https://kubernetes.io/docs/tasks/tools/'
  kubectl cluster-info >/dev/null 2>&1 || fatal 'No reachable Kubernetes cluster.' 'Check your context: kubectl config current-context' 'For a local cluster try Docker Desktop Kubernetes, OrbStack, kind, or minikube.'
  ok 'helm, kubectl, cluster, git'
elif [[ "$MODE" != "update" ]]; then
  command -v docker >/dev/null 2>&1 || fatal 'Docker is required.' 'Install Docker Desktop: https://docs.docker.com/get-docker/'
  docker info >/dev/null 2>&1       || fatal 'The Docker daemon is not running.' 'Start Docker Desktop (or: sudo systemctl start docker) and re-run.'
  docker compose version >/dev/null 2>&1 || fatal 'Docker Compose v2 is required.' 'Update Docker Desktop, or install the compose v2 plugin.'
  ok 'Docker, Compose v2, git'
  # Resource sanity — catch the two most common silent failures up front.
  DGB=$(free_disk_gb "$HOME")
  [[ "$DGB" -ge 6 ]] || warn "Low disk: ~${DGB}GB free in \$HOME (images need ~8-10GB). The pull may fail partway."
  if port_in_use 8080; then
    warn 'Port 8080 is already in use — the UI may not be reachable there.'
    hint 'Set UI_HOST_PORT=8088 (or another free port) in your .env, or stop whatever holds 8080.'
  fi
fi

if [[ "$MODE" == "wizard" ]]; then
  command -v node >/dev/null 2>&1 || fatal 'Node.js 20+ is required for the wizard.' 'Install Node 20+: https://nodejs.org   ·   Or skip the wizard with --quick (Ollama) or --env PATH.'
  # Tolerate a broken node binary: fall back to 0 (→ a clear "20+ required"
  # message) instead of letting `set -e` kill the script with no explanation.
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [[ "$NODE_MAJOR" -ge 20 ]] || fatal "Node.js 20+ required (found $(node --version 2>/dev/null || echo 'unknown'))." 'Upgrade Node (https://nodejs.org), or use --quick / --env to skip the TUI wizard.'
  # npx ships with npm and is how the end-user path fetches the wizard package.
  # Some Node installs (split distro / hardened images) ship node without npm.
  command -v npx >/dev/null 2>&1 || fatal 'npx (ships with npm) is required for the wizard.' 'Install npm with Node from https://nodejs.org, or use --quick / --env.'
  ok "Node $(node --version) (wizard mode)"
fi

# ─── Compose bundle: download only the files needed to run, no source ─────
# Images are pulled from GHCR at `docker compose up` time — nothing is compiled
# locally. If running from a developer checkout (docker-compose.yml + services/
# both present) the local tree is used as-is so devs can test changes.
INSTALL_DIR="${OPENAGENTIC_HOME:-$HOME/.openagentic}"
VERSION="${OPENAGENTIC_VERSION:-1.0.0}"
GHCR_ORG="${OPENAGENTIC_REGISTRY:-ghcr.io/agentic-work}"
# The pull-only compose bundle (no source) is hosted on the install server itself,
# so a public install needs no access to the source repo. Images come from the
# public GHCR registry at `docker compose up` time.
DIST_BASE="${OPENAGENTIC_DIST_BASE:-https://install.openagentics.io}"

if [[ -f "./docker-compose.yml" && -d "./services/openagentic-api" ]]; then
  # Developer local checkout — use it directly (build: stanzas still present)
  INSTALL_DIR="$(pwd)"
  info "Using local checkout at ${C_BOLD}${INSTALL_DIR}${C_RESET}"
else
  step "Downloading compose bundle"
  info "Install location: ${C_BOLD}${INSTALL_DIR}${C_RESET}"
  mkdir -p "$INSTALL_DIR"

  BUNDLE_URL="${DIST_BASE}/openagentic-compose.tgz"
  info "Fetching the compose bundle from ${C_BOLD}${DIST_BASE}${C_RESET}…"

  # The expected sha256 is fetched from the PUBLIC GitHub repo — an INDEPENDENT
  # trust anchor that does NOT share a host (or DNS) with the download server.
  # A compromise of install.openagentics.io alone cannot forge a matching digest
  # because the checksum lives in the source repo. Overridable for mirrors that
  # publish their own (e.g. air-gapped) checksum, but it defaults to GitHub.
  BUNDLE_SHA_URL="${OPENAGENTIC_BUNDLE_SHA_URL:-https://raw.githubusercontent.com/agentic-work/openagentic/main/install/openagentic-compose.tgz.sha256}"
  # Pre-launch the source repo is still private, so the GitHub anchor 404s. As a
  # FALLBACK ONLY (used when the anchor is unreachable) we accept the digest the
  # dist host publishes next to the bundle. The GitHub anchor is always tried
  # FIRST, so the moment the repo is public the independent-host guarantee returns
  # automatically with no change here.
  BUNDLE_SHA_FALLBACK_URL="${DIST_BASE}/openagentic-compose.tgz.sha256"

  # 1. Download to a temp file — never pipe straight into tar. Streaming into the
  #    extractor would run it on bytes we have not verified yet (extract-while-
  #    streaming), so we materialize the bundle first, verify, THEN extract.
  TMP_BUNDLE="$(mktemp "${TMPDIR:-/tmp}/openagentic-compose.XXXXXX.tgz")" \
    || fatal 'Could not create a temp file for the download.'
  # Clean up the temp file on ANY exit from here on (success or failure). We
  # chain into the existing on_exit handler rather than clobber it, so the help
  # block still prints if a fatal trips before we extract.
  trap 'rm -f "$TMP_BUNDLE"; on_exit' EXIT
  curl -fsSL --connect-timeout 15 --retry 3 --retry-connrefused --retry-delay 2 --max-time 120 "$BUNDLE_URL" -o "$TMP_BUNDLE" \
    || fatal "Could not download the compose bundle from ${DIST_BASE}." \
             "Check your network and try again." \
             "You can mirror the bundle and set OPENAGENTIC_DIST_BASE to its host."

  # 2. Fetch the EXPECTED digest from the independent GitHub trust anchor. If the
  #    repo is still private (pre-launch 404), fall back to the dist host's
  #    published checksum so a known-good bundle can still be verified.
  EXPECTED_SHA="$(curl -fsSL --connect-timeout 10 --retry 2 --retry-connrefused --max-time 30 "$BUNDLE_SHA_URL" 2>/dev/null | awk 'NR==1{print $1}' || true)"
  if [[ -z "$EXPECTED_SHA" ]]; then
    EXPECTED_SHA="$(curl -fsSL --connect-timeout 10 --retry 2 --retry-connrefused --max-time 30 "$BUNDLE_SHA_FALLBACK_URL" 2>/dev/null | awk 'NR==1{print $1}' || true)"
    [[ -n "$EXPECTED_SHA" ]] && info "Source-repo checksum anchor unreachable (repo private pre-launch); using the dist host's published digest."
  fi
  [[ -n "$EXPECTED_SHA" ]] \
    || fatal 'Could not fetch the expected bundle checksum — refusing to extract an unverified bundle; the download host may be compromised.' \
             "Checksum URL: $BUNDLE_SHA_URL" \
             "Check your network, or override the anchor with OPENAGENTIC_BUNDLE_SHA_URL."

  # 3. Compute the ACTUAL digest portably (sha256sum on Linux, shasum on macOS).
  ACTUAL_SHA="$(sha256_of "$TMP_BUNDLE")" \
    || fatal 'No sha256 tool found (need sha256sum or shasum) — cannot verify the bundle, refusing to extract.' \
             'Install coreutils (sha256sum) or perl/openssl (shasum) and re-run.'

  # Normalize BOTH digests before comparing — a CRLF-served checksum (Windows
  # mirror) carries a trailing \r, and certutil/some tooling emits uppercase.
  # Strip whitespace + lowercase both sides so a perfectly good bundle isn't
  # rejected with the alarming "host may be compromised" message.
  EXPECTED_SHA="$(printf '%s' "$EXPECTED_SHA" | tr -d '[:space:]' | tr 'A-Z' 'a-z')"
  ACTUAL_SHA="$(printf '%s' "$ACTUAL_SHA" | tr -d '[:space:]' | tr 'A-Z' 'a-z')"

  # 4. FAIL CLOSED on mismatch — do NOT extract a tampered/corrupt bundle.
  if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
    fatal 'Bundle checksum MISMATCH — refusing to extract an unverified bundle; the download host may be compromised.' \
          "expected: $EXPECTED_SHA" \
          "actual:   $ACTUAL_SHA" \
          "If you intentionally mirror a different bundle, publish its sha256 and set OPENAGENTIC_BUNDLE_SHA_URL."
  fi
  ok "Bundle verified (sha256 matches the source-repo anchor)"

  # 5. Verified — extract from the temp file, then drop it.
  # A prior searxng run can leave scripts/searxng owned by a foreign container
  # UID (977) that the non-root host user cannot truncate/unlink — plain tar
  # then EACCES-fails on re-install. If docker is available, clean those stale
  # foreign-owned paths via a throwaway root container first (helm mode reaches
  # here WITHOUT a docker preflight, so gate on docker availability). Then
  # extract with --overwrite --no-same-owner.
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker run --rm -v "$INSTALL_DIR":/work alpine:3 sh -c 'rm -rf /work/scripts/searxng' 2>/dev/null || true
  fi
  tar -xzf "$TMP_BUNDLE" --overwrite --no-same-owner -C "$INSTALL_DIR" \
    || fatal "Could not extract the compose bundle into ${INSTALL_DIR}." \
             "A previous run may have left container-owned files. Remove them and retry: sudo rm -rf \"$INSTALL_DIR/scripts\""
  rm -f "$TMP_BUNDLE"
  # Restore the plain on_exit handler now the temp file is gone.
  trap on_exit EXIT
  ok "Bundle downloaded"

  # Record version only. We deliberately do NOT write OPENAGENTIC_REGISTRY/TAG into
  # .env here: doing so created a PARTIAL .env (just those keys) BEFORE the secret
  # generator, which then saw ".env exists" and skipped generating the required
  # secrets → `compose up` failed on a missing JWT_SECRET/FRONTEND_SECRET. Compose's
  # ${OPENAGENTIC_REGISTRY:-ghcr.io/agentic-work} / ${OPENAGENTIC_TAG:-latest}
  # defaults already resolve the public images; a custom registry can be passed
  # through the environment.
  echo "$VERSION" > "$INSTALL_DIR/VERSION"
fi
cd "$INSTALL_DIR"

# ─── Update path ──────────────────────────────────────────────────────────────
# Pull latest (done above for a cloned install) + rebuild + restart in place,
# keeping the existing .env. Auto-detects an existing Helm release vs Docker.
if [[ "$MODE" == "update" ]]; then
  CURRENT_STEP="update"
  HELM_NS="${OPENAGENTIC_NAMESPACE:-openagentic}"
  if command -v helm >/dev/null 2>&1 && helm status openagentic -n "$HELM_NS" >/dev/null 2>&1; then
    step "Updating the Helm release (namespace: ${HELM_NS})"
    VALUES="helm/openagentic/values-local-k8s.yaml"; [[ -f "$VALUES" ]] || VALUES="helm/openagentic/values.yaml"
    UPD_CHART="./helm/openagentic"; [[ ! -d "$UPD_CHART" ]] && UPD_CHART="oci://ghcr.io/agentic-work/charts/openagentic"
    helm upgrade openagentic $UPD_CHART -n "$HELM_NS" -f "$VALUES" --wait --timeout 10m 2>&1 | tail -12 \
      || fatal 'helm upgrade failed.' "Inspect: kubectl -n $HELM_NS get pods" "Roll back: helm rollback openagentic -n $HELM_NS"
    ok 'Helm release updated'
    printf '\n  %sUpdated.%s  Pods: %skubectl -n %s get pods%s\n\n' "$C_GREEN$C_BOLD" "$C_RESET" "$C_BOLD" "$HELM_NS" "$C_RESET"
    EXIT_OK=1; exit 0
  fi
  command -v docker >/dev/null 2>&1 || fatal 'Docker is required to update a Docker install.' 'Start Docker and re-run, or for a Kubernetes install run with --helm.'
  docker info >/dev/null 2>&1 || fatal 'The Docker daemon is not running.' 'Start Docker Desktop and re-run.'
  [[ -f .env ]] || warn 'No .env found in the install dir — a rebuild will use defaults.'
  step "Rebuilding + restarting (Docker Compose)"
  info 'Pulling base images, rebuilding changed services…'
  compose_up -d --build 2>&1 | tail -10 \
    || fatal 'docker compose up failed during update.' 'Check: docker compose ps   and   docker logs openagentic-api-1 --tail=100'
  info 'Waiting for api healthy (~90s)…'
  s=unknown
  for _ in $(seq 1 90); do
    s=$(docker inspect --format '{{.State.Health.Status}}' openagentic-api-1 2>/dev/null || echo unknown)
    [[ "$s" == "healthy" ]] && { ok 'api is healthy'; break; }
    sleep 2
  done
  [[ "$s" == "healthy" ]] || fatal 'api did not return to healthy after the update.' 'Check: docker logs openagentic-api-1 --tail=120'
  printf '\n  %sUpdated and healthy.%s\n\n' "$C_GREEN$C_BOLD" "$C_RESET"
  EXIT_OK=1; exit 0
fi

# Strong-random secret generator — used by BOTH the Helm and Compose paths, so
# it must be defined before either branch runs.
gen_secret() {
  local n="${1:-24}"
  openssl rand -hex "$n" 2>/dev/null || head -c $((n * 2)) /dev/urandom | base64 | tr -d '/+=' | head -c "$((n * 2))"
}

# ─── Helm path ──────────────────────────────────────────────────────────────
# One-line Kubernetes install: helm upgrade --install the chart, wait for the
# rollout, print the WOW banner. Values: values-local-k8s.yaml if present,
# else the chart defaults.
if [[ "$MODE" == "helm" ]]; then
  CURRENT_STEP="helm install"
  NS="${OPENAGENTIC_NAMESPACE:-openagentic}"
  RELEASE="${OPENAGENTIC_RELEASE:-openagentic}"
  # Values precedence: OPENAGENTIC_VALUES override > local-k8s overlay > chart defaults.
  if [[ -n "${OPENAGENTIC_VALUES:-}" ]]; then
    VALUES="$OPENAGENTIC_VALUES"
    [[ -f "$VALUES" ]] || fatal "OPENAGENTIC_VALUES points to a missing file: $VALUES"
  else
    VALUES="helm/openagentic/values-local-k8s.yaml"
    [[ -f "$VALUES" ]] || VALUES="helm/openagentic/values.yaml"
  fi
  step "helm upgrade --install ${RELEASE} (namespace: ${NS})"
  info "values: ${C_BOLD}${VALUES}${C_RESET}"

  # Secrets: the chart ships NO secret defaults (its templates `required`-guard
  # them, so an unset value aborts the install — same fail-fast as compose's
  # ${VAR:?}). If the operator supplied their own values (OPENAGENTIC_VALUES or
  # a values-local-k8s.yaml overlay) we trust it to carry secrets. Otherwise we
  # generate strong random secrets ONCE, persist them, and reuse them on every
  # upgrade — so a re-run never rotates the JWT/signing/internal trust roots out
  # from under a running release (which would 401 every session).
  HELM_SECRET_FILE=""
  if [[ -z "${OPENAGENTIC_VALUES:-}" && ! -f "helm/openagentic/values-local-k8s.yaml" ]]; then
    HELM_SECRET_FILE="$HOME/.openagentic/helm-secrets.yaml"
    mkdir -p "$HOME/.openagentic"
    if [[ -f "$HELM_SECRET_FILE" ]]; then
      info "Reusing generated Helm secrets (${C_BOLD}${HELM_SECRET_FILE}${C_RESET})"
    else
      _admin_pass="$(gen_secret 16)"
      cat > "$HELM_SECRET_FILE" <<EOF
# Auto-generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Reused on upgrade.
# Strong random secrets — supersede the (empty) chart defaults via -f precedence.
secrets:
  postgresPassword: "$(gen_secret 16)"
  jwtSecret: "$(gen_secret 32)"
  signingSecret: "$(gen_secret 32)"
  internalApiKey: "$(gen_secret 32)"
  frontendSecret: "$(gen_secret 32)"
  adminEmail: admin@openagentic.local
  adminPassword: "${_admin_pass}"
EOF
      chmod 600 "$HELM_SECRET_FILE"
      printf 'email: admin@openagentic.local\npassword: %s\n' "$_admin_pass" > "$HOME/.openagentic/admin-credentials.txt"
      chmod 600 "$HOME/.openagentic/admin-credentials.txt"
      ok "Generated Helm secrets → ${C_BOLD}${HELM_SECRET_FILE}${C_RESET} (admin creds in ~/.openagentic/admin-credentials.txt)"
    fi
  fi

  # ── Vertex(ADC)+gcp overlay (--helm --vertex) ───────────────────────────────
  # Generate an overlay that switches the chart to the Google Vertex provider
  # (ADC) + the gcp MCP on this k3s cluster: Harbor images + amd64 nodeSelector,
  # pgvector-only (matches the proven compose --vertex), and adcSecret.enabled so
  # the chart mounts the user ADC into the api + mcp-proxy. We CREATE the gcp-adc
  # Secret (from ~/.config/gcloud) and the Harbor pull secret BEFORE the upgrade.
  HELM_VERTEX_FILE=""
  if [[ "$VERTEX_MODE" == "1" ]]; then
    ADC_FILE="$HOME/.config/gcloud/application_default_credentials.json"
    # k3s cluster registry + arch. Overridable for other clusters.
    HARBOR_REGISTRY="${OPENAGENTIC_HELM_REGISTRY:-harbor.agenticwork.io/openagentic}"
    HARBOR_TAG="${OPENAGENTIC_HELM_TAG:-latest}"
    NODE_ARCH="${OPENAGENTIC_HELM_ARCH:-amd64}"
    # Resolve project: --gcp-project wins, else gcloud's active project.
    PROJ="$VERTEX_PROJECT_ID"
    if [[ -z "$PROJ" ]]; then
      PROJ="$(gcloud config get-value project 2>/dev/null | tr -d '[:space:]' || true)"
      case "$PROJ" in '(unset)'|'') PROJ='' ;; esac
    fi
    LOC="$VERTEX_LOCATION"

    # 1. gcp-adc Secret (gated on the ADC file existing). Idempotent: delete+create.
    #    The chart mounts this read-only into api ($HOME/.config/gcloud) + mcp-proxy.
    if [[ -f "$ADC_FILE" ]]; then
      kubectl create namespace "$NS" >/dev/null 2>&1 || true
      kubectl -n "$NS" create secret generic gcp-adc \
        --from-file=application_default_credentials.json="$ADC_FILE" \
        --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1 \
        && ok "Created Secret gcp-adc (user ADC) in namespace ${NS}" \
        || warn "Could not create the gcp-adc Secret — the gcp MCP + Vertex will lack ADC."
    else
      warn "Vertex ADC not found at ${ADC_FILE} — run: gcloud auth application-default login"
      warn 'Skipping the gcp-adc Secret; Vertex + the gcp MCP will fail to authenticate until it exists.'
    fi

    # 2. Harbor pull secret (gated on creds in env). Idempotent. Wired into the
    #    overlay's imagePullSecrets below so the private Harbor images can pull.
    HARBOR_PULL_SECRET=""
    if [[ -n "${HARBOR_USERNAME:-}" && -n "${HARBOR_PASSWORD:-}" ]]; then
      HARBOR_PULL_SECRET="harbor-creds"
      kubectl create namespace "$NS" >/dev/null 2>&1 || true
      kubectl -n "$NS" create secret docker-registry "$HARBOR_PULL_SECRET" \
        --docker-server="${HARBOR_REGISTRY%%/*}" \
        --docker-username="$HARBOR_USERNAME" \
        --docker-password="$HARBOR_PASSWORD" \
        --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1 \
        && ok "Created Harbor pull secret ${HARBOR_PULL_SECRET} in namespace ${NS}" \
        || warn "Could not create the Harbor pull secret — private image pulls may fail."
    else
      info 'No HARBOR_USERNAME/HARBOR_PASSWORD in env — assuming an existing harbor-creds secret or public images.'
      HARBOR_PULL_SECRET="harbor-creds"
    fi

    # 3. The Vertex(ADC)+gcp overlay. Proven-good models: chat gemini-2.5-flash,
    #    embedding gemini-embedding-001 @768, image imagen-4.0-fast-generate-001.
    #    pgvector-only (milvus off, SKIP_TOOL_SEMANTIC_CACHE=true). adcSecret on.
    HELM_VERTEX_FILE="$(mktemp "${TMPDIR:-/tmp}/oa-helm-vertex.XXXXXX.yaml")"
    cat > "$HELM_VERTEX_FILE" <<EOF
# Vertex(ADC)+gcp overlay — generated by install.sh --helm --vertex on $(date -u +%Y-%m-%dT%H:%M:%SZ).
image:
  registry: "${HARBOR_REGISTRY}"
  tag: "${HARBOR_TAG}"
imagePullSecrets:
  - name: "${HARBOR_PULL_SECRET}"
nodeSelector:
  kubernetes.io/arch: "${NODE_ARCH}"
ollama:
  enabled: false
milvus:
  enabled: false
adcSecret:
  enabled: true
  secretName: gcp-adc
mcps:
  gcp:
    enabled: true
    projectId: "${PROJ}"
    region: "${LOC}"
# Vertex provider env the structured values don't model (api side). Do NOT set
# GOOGLE_APPLICATION_CREDENTIALS — the user ADC is an authorized_user credential
# the GoogleVertexProvider rejects as a non-SA; the SDK discovers the mounted ADC.
extraEnv:
  - { name: EMBEDDING_PROVIDER, value: "vertex-ai" }
  - { name: GOOGLE_CLOUD_PROJECT, value: "${PROJ}" }
  - { name: GOOGLE_CLOUD_LOCATION, value: "${LOC}" }
  - { name: VERTEX_PROJECT, value: "${PROJ}" }
  - { name: VERTEX_LOCATION, value: "${LOC}" }
  - { name: VERTEX_CHAT_MODEL, value: "gemini-2.5-flash" }
  - { name: GCP_PROJECT_ID, value: "${PROJ}" }
  - { name: GCP_LOCATION, value: "${LOC}" }
  - { name: GCP_EMBEDDING_MODEL, value: "gemini-embedding-001" }
  - { name: EMBEDDING_DIMENSIONS, value: "768" }
  - { name: DEFAULT_IMAGE_MODEL, value: "imagen-4.0-fast-generate-001" }
  - { name: SKIP_TOOL_SEMANTIC_CACHE, value: "true" }
  - { name: BOOTSTRAP_PROVIDER_NAME, value: "google-vertex" }
  - { name: BOOTSTRAP_PROVIDER_DISPLAY_NAME, value: "Google Vertex AI" }
  - { name: BOOTSTRAP_PROVIDER_TYPE, value: "vertex-ai" }
  - { name: BOOTSTRAP_PROVIDER_CONFIG, value: '{"projectId":"${PROJ}","location":"${LOC}"}' }
  - { name: BOOTSTRAP_PROVIDER_DEFAULTS, value: '{"chat":"gemini-2.5-flash","embedding":"gemini-embedding-001","embeddingDimension":768}' }
  - { name: SEEDER_VERSION, value: "6" }
# mcp-proxy reads GCP_PROJECT_ID for the gcp MCP subprocess (=the vertex project).
mcpProxyExtraEnv:
  - { name: GCP_PROJECT_ID, value: "${PROJ}" }
  - { name: GCP_REGION, value: "${LOC}" }
EOF
    info "Vertex(ADC)+gcp overlay: ${C_BOLD}${HELM_VERTEX_FILE}${C_RESET} (Harbor ${HARBOR_REGISTRY}, arch ${NODE_ARCH}, project ${PROJ:-<unset>})"
  fi

  # Use local chart if running from a developer checkout, otherwise pull OCI from GHCR.
  if [[ -d "./helm/openagentic" ]]; then
    HELM_TARGET="./helm/openagentic"
  else
    CHART_VERSION="${VERSION#v}"   # strip leading 'v' — helm semver has no prefix
    [[ "$CHART_VERSION" == "latest" || -z "$CHART_VERSION" ]] && CHART_VERSION=""
    HELM_TARGET="oci://ghcr.io/agentic-work/charts/openagentic"
    info "Pulling chart from GHCR${CHART_VERSION:+ (version: ${C_BOLD}${CHART_VERSION}${C_RESET})}"
  fi
  HELM_VER_FLAG="${CHART_VERSION:+--version $CHART_VERSION}"

  # shellcheck disable=SC2086
  helm upgrade --install "$RELEASE" $HELM_TARGET \
    $HELM_VER_FLAG \
    --namespace "$NS" --create-namespace \
    -f "$VALUES" ${HELM_SECRET_FILE:+-f "$HELM_SECRET_FILE"} ${HELM_VERTEX_FILE:+-f "$HELM_VERTEX_FILE"} --wait --timeout 10m 2>&1 | tail -12 \
    || fatal 'helm install did not complete (rollout timed out or a pod is failing).' \
        "See which pods are unhealthy:  kubectl -n $NS get pods" \
        "Describe a stuck pod:           kubectl -n $NS describe pod <name>" \
        "Common causes: image pull, pending PVC (no storage class), or a missing secret."
  [[ -n "$HELM_VERTEX_FILE" ]] && rm -f "$HELM_VERTEX_FILE"
  ok 'Helm release deployed'
  printf '\n  %sOpenAgentic is up on Kubernetes.%s\n\n' "$C_GREEN$C_BOLD" "$C_RESET"
  printf '  Namespace:  %s%s%s\n' "$C_BOLD" "$NS" "$C_RESET"
  printf '  Open UI:    %skubectl -n %s port-forward svc/ui 8080:80%s  →  %shttp://localhost:8080%s\n' "$C_BOLD" "$NS" "$C_RESET" "$C_BOLD" "$C_RESET"
  printf '  Pods:       %skubectl -n %s get pods%s\n' "$C_BOLD" "$NS" "$C_RESET"
  printf '  Logs:       %skubectl -n %s logs deploy/api -f%s\n\n' "$C_BOLD" "$NS" "$C_RESET"
  EXIT_OK=1; exit 0
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
  # Bring up the full stack at once. The api's entrypoint waits for the mcp-proxy to
  # be reachable (to index tools — FATAL if absent), so the api + mcp-proxy MUST start
  # together; isolating the api makes it crash-loop. workflows waits on
  # api: service_healthy and will bail during the api's slow first boot (~2-4min) — we
  # re-up below once the api is healthy to start it (and anything else that bailed).
  compose_up -d 2>&1 | tail -8

  info 'Waiting for api healthy (first boot ~2-4min: schema push + seed + tool indexing)…'
  s=unknown
  for _ in $(seq 1 300); do
    s=$(docker inspect --format '{{.State.Health.Status}}' openagentic-api-1 2>/dev/null || echo unknown)
    [[ "$s" == "healthy" ]]   && { ok 'api is healthy'; break; }
    [[ "$s" == "unhealthy" ]] && fatal 'api went unhealthy. Check `docker logs openagentic-api-1`.'
    sleep 2
  done
  [[ "$s" == "healthy" ]] || fatal 'api did not go healthy in ~10min.'

  # api is healthy — bring up the remaining services. workflows waits on
  # api: service_healthy, which is now satisfied, so the full stack starts cleanly.
  step "docker compose up (remaining services)"
  compose_up -d 2>&1 | tail -8

  UI_HOST_PORT=$(grep -E '^UI_HOST_PORT=' .env | head -1 | cut -d= -f2- || echo 8080)
  UI_HOST_PORT="${UI_HOST_PORT:-8080}"
  MAGIC_URL="http://localhost:${UI_HOST_PORT}/auth/magic?token=${MAGIC_BOOT_TOKEN}"
  printf '\n  %sOpenAgentic is up.%s\n' "$C_GREEN$C_BOLD" "$C_RESET"
  printf '  Chat UI:    %s%s%s\n' "$C_BOLD" "http://localhost:${UI_HOST_PORT}" "$C_RESET"
  printf '  Autologin:  %s%s%s\n\n' "$C_BOLD" "$MAGIC_URL" "$C_RESET"
  if [[ "$OPEN_BROWSER" == "1" ]]; then
    if   command -v xdg-open >/dev/null 2>&1; then ( xdg-open "$MAGIC_URL" >/dev/null 2>&1 & ) >/dev/null 2>&1 || true
    elif command -v open     >/dev/null 2>&1; then ( open     "$MAGIC_URL" >/dev/null 2>&1 & ) >/dev/null 2>&1 || true
    fi
  fi
  exit 0
fi

# ─── Wizard path ────────────────────────────────────────────────────────────
if [[ "$MODE" == "wizard" ]]; then
  info 'Launching the setup wizard…'
  printf '\n'

  # The interactive Ink TUI needs a controlling terminal. With neither /dev/tty
  # nor a tty on stdin (CI, some docker exec / nested-shell contexts) it can't be
  # driven — steer to the non-interactive path with a clear message.
  if [[ ! -e /dev/tty ]] && [[ ! -t 0 ]]; then
    fatal 'The interactive wizard needs a terminal.' 'Use: curl -sSL https://install.openagentics.io | bash -s -- --quick'
  fi

  # Two launch strategies:
  #   1. Developer checkout (tools/setup/ present): run tsx from source — fastest
  #      for dev iteration, picks up local changes immediately.
  #   2. End-user install (no source): run the published npm package via npx.
  #      npx caches it in ~/.npm/_npx/ — no source cloned, no permanent install.
  #
  # When invoked via `curl … | bash`, stdin is the download pipe, not the
  # keyboard — re-attach to the controlling terminal for raw-mode TUI input.
  TTY_REDIRECT=""
  [[ -e /dev/tty ]] && TTY_REDIRECT="< /dev/tty"

  if [[ -f "$INSTALL_DIR/tools/setup/src/index.tsx" ]]; then
    # Developer path: tsx from source
    cd "$INSTALL_DIR/tools/setup"
    # Install (or repair) deps if the tsx binary isn't actually present — not just
    # if node_modules exists. A half/skipped install (see the workspace note below)
    # can leave node_modules without .bin/tsx, which used to fail cryptically.
    if [[ ! -x node_modules/.bin/tsx ]]; then
      info 'Installing wizard dependencies (first run only)…'
      # CRITICAL: tools/setup is NOT a member of the repo's root pnpm-workspace.yaml.
      # Without --ignore-workspace, pnpm >=10 detects the parent workspace, decides
      # this package isn't part of it, prints "No projects found", and installs
      # NOTHING — leaving .bin/tsx absent. --ignore-workspace forces a standalone
      # install. (npm has no workspace here, so it just works.)
      # NOTE: don't treat the installer's exit code as fatal on its own — pnpm
      # returns non-zero for the harmless ERR_PNPM_IGNORED_BUILDS warning (e.g.
      # esbuild's postinstall) even when tsx installed fine. The real gate is the
      # tsx-binary check below.
      if command -v pnpm >/dev/null 2>&1; then
        pnpm install --silent --prod=false --ignore-workspace || true
      else
        npm install --silent --no-fund --no-audit || true
      fi
      # Verify the binary actually landed before we claim success or try to exec it.
      [[ -x node_modules/.bin/tsx ]] || fatal 'Could not install the setup wizard (tsx is missing after install).' 'Re-run manually: cd '"$INSTALL_DIR"'/tools/setup && pnpm install --ignore-workspace --prod=false' 'If you have npm but not pnpm, that works too: npm install'
      ok 'Wizard dependencies installed'
    fi
    if [[ -e /dev/tty ]]; then
      exec ./node_modules/.bin/tsx src/index.tsx < /dev/tty
    else
      exec ./node_modules/.bin/tsx src/index.tsx
    fi
  else
    # End-user path: run from the published npm package — no source on disk.
    # Don't `exec`: that would replace the shell and kill the EXIT-trap help
    # block, so a raw `npm ERR! 404`/ENOTFOUND would surface with no remediation.
    # Run npx in-process; on failure fall back to @latest, then a clear fatal.
    WIZARD_PKG="@agenticwork/openagentic"
    # Wizard tracks the @latest npm dist-tag by default (the published wizard is
    # always the newest build); pin via OPENAGENTIC_WIZARD_VERSION if needed.
    WIZARD_VERSION="${OPENAGENTIC_WIZARD_VERSION:-latest}"
    [[ "$WIZARD_VERSION" == "latest" || -z "$WIZARD_VERSION" ]] && WIZARD_VERSION=""
    PKG_REF="${WIZARD_PKG}@${WIZARD_VERSION:-latest}"
    info "Running wizard from ${C_BOLD}${PKG_REF}${C_RESET} (cached in ~/.npm/_npx)"
    # The wizard runs from the ~/.npm/_npx cache, so it cannot infer the install
    # dir from its own module path. Tell it explicitly so it reads .env.example /
    # docker-compose.yml and writes .env in $INSTALL_DIR (not the npx cache) —
    # without this the generated .env was missing its required secrets.
    export OPENAGENTIC_HOME="$INSTALL_DIR"
    if [[ -e /dev/tty ]]; then
      npx --yes "$PKG_REF" < /dev/tty || npx --yes "${WIZARD_PKG}@latest" < /dev/tty \
        || fatal 'Could not launch the setup wizard from npm.' 'Zero-config path: curl -sSL https://install.openagentics.io | bash -s -- --quick' 'Check npm: npm view @agenticwork/openagentic version'
    else
      npx --yes "$PKG_REF" || npx --yes "${WIZARD_PKG}@latest" \
        || fatal 'Could not launch the setup wizard from npm.' 'Zero-config path: bash -s -- --quick' 'Check npm: npm view @agenticwork/openagentic version'
    fi
    # The wizard wrote .env and brought the stack up (terminal, like the dev exec
    # path above). Do NOT fall through into the --quick install below.
    exit 0
  fi
fi

# ─── Quick path ─────────────────────────────────────────────────────────────
step "Quick install"

# 1. Detect an Ollama the user ALREADY runs — never install or force one.
#    --quick is provider-agnostic: if an Ollama daemon is reachable we wire it
#    as the provider (the user already chose to run it). If none is found we do
#    NOT fatal and do NOT install Ollama — the stack boots provider-agnostic and
#    the user picks a provider in the admin UI (or re-runs with --wizard).
OLLAMA_HOST="${OLLAMA_HOST_OVERRIDE:-${OLLAMA_HOST:-}}"
HAVE_OLLAMA=0
if [[ -n "$OLLAMA_HOST" ]]; then
  # Explicit endpoint (--ollama URL or OLLAMA_HOST in env) — trust the user.
  HAVE_OLLAMA=1
else
  # Default-route gateway — how a WSL2 distro (and Linux containers) reach an
  # Ollama bound on the Windows/host network when it is NOT on this box's
  # localhost. Reachable from both the host shell and the containers.
  OLLAMA_GW="$(ip route show default 2>/dev/null | awk '/default/{print $3; exit}' || true)"
  if curl -fsS --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
    OLLAMA_HOST="http://host.docker.internal:11434"; HAVE_OLLAMA=1
    ok 'Found Ollama on localhost:11434 — containers will reach it via host.docker.internal'
  elif [[ -n "$OLLAMA_GW" ]] && curl -fsS --max-time 2 "http://$OLLAMA_GW:11434/api/tags" >/dev/null 2>&1; then
    # e.g. WSL2 with Ollama on the Windows host, exposed on the network.
    OLLAMA_HOST="http://$OLLAMA_GW:11434"; HAVE_OLLAMA=1
    ok "Found Ollama on the host network at $OLLAMA_GW:11434 — using it directly (works from host + containers)"
  else
    HAVE_OLLAMA=0
    info "No Ollama detected — booting provider-agnostic (no provider is installed or assumed)."
    info 'Pick a provider in the admin UI after launch, or re-run with --wizard to choose one up front.'
    info 'To use local Ollama: install it (https://ollama.com/download) and re-run --quick, or pass --ollama URL.'
  fi
fi

# 2. When (and only when) an Ollama is present, make sure embed + chat models
#    exist. We pull into an EXISTING daemon the user runs — never install one.
EMBED_MODEL="${OLLAMA_EMBED_MODEL:-nomic-embed-text}"
DEFAULT_CHAT="${OLLAMA_CHAT_MODEL:-qwen2.5:7b}"
CHAT_MODEL=""
if [[ "$HAVE_OLLAMA" == "1" ]]; then
  # Reach the same daemon Docker will hit, but from the host shell.
  LOCAL_OLLAMA="${OLLAMA_HOST//host.docker.internal/localhost}"
  have_model() {
    curl -fsS --max-time 5 "$LOCAL_OLLAMA/api/tags" 2>/dev/null \
      | grep -qE "\"(name|model)\"[[:space:]]*:[[:space:]]*\"$1(:[^\"]*)?\""
  }
  # Embed model: small (~270MB), always nomic-embed-text. Pull if missing.
  if have_model "$EMBED_MODEL"; then
    ok "Ollama has $EMBED_MODEL"
  else
    info "Pulling $EMBED_MODEL (~270MB)…"
    curl -fsS -X POST "$LOCAL_OLLAMA/api/pull" -d "{\"name\":\"$EMBED_MODEL\"}" >/dev/null 2>&1 \
      || warn "Pull failed; try manually later: ollama pull $EMBED_MODEL"
  fi

  # Chat model: detect the best tool-capable model the user already has, in
  # rough order of quality. Only auto-pull when nothing usable is present —
  # avoids a 5GB+ surprise on a box that already has e.g. llama3.1:8b loaded.
  # `|| true`: under `set -euo pipefail`, a grep/curl that finds nothing exits
  # non-zero and would kill the whole install. A no-match here just means "no
  # models yet" — handle it, don't die.
  all_models=$(curl -fsS --max-time 5 "$LOCAL_OLLAMA/api/tags" 2>/dev/null | \
    grep -oE "\"(name|model)\"[[:space:]]*:[[:space:]]*\"[^\"]+\"" | \
    sed -E 's/.*"([^"]+)"$/\1/' | sort -u || true)
  for pat in 'qwen2\.5' 'qwen3' 'gpt-oss' 'llama3\.3' 'llama3\.1' 'llama-?3' 'mistral' 'gemma'; do
    match=$(echo "$all_models" | grep -E "^$pat(:|$)" | head -1 || true)
    if [[ -n "$match" ]]; then CHAT_MODEL="$match"; break; fi
  done
  if [[ -n "$CHAT_MODEL" ]]; then
    ok "Using existing chat model: $CHAT_MODEL"
  else
    info "No tool-capable chat model found. Pulling $DEFAULT_CHAT (~4.7GB; ~3min on broadband)…"
    if curl -fsS -X POST "$LOCAL_OLLAMA/api/pull" -d "{\"name\":\"$DEFAULT_CHAT\"}" >/dev/null 2>&1; then
      ok "Pulled $DEFAULT_CHAT"; CHAT_MODEL="$DEFAULT_CHAT"
    else
      warn "Pull failed; the stack will boot but chat will fail until you pull a model:"
      warn "  ollama pull $DEFAULT_CHAT"
      CHAT_MODEL="$DEFAULT_CHAT"
    fi
  fi
fi

# 3. Generate .env with random creds if it doesn't exist.
# (gen_secret is defined once near the top, before the Helm/Compose split.)
if [[ -f .env ]]; then
  info '.env exists — keeping your existing config'
  # Load it TOLERANTLY. An existing .env can hold values with shell-special
  # chars — e.g. BOOTSTRAP_PROVIDER_DISPLAY_NAME="Ollama (local)", or JSON like
  # BOOTSTRAP_PROVIDER_CONFIG={"endpoint":"…"} — that `. ./.env` chokes on
  # ("syntax error near unexpected token `('"), breaking EVERY re-run. Assign
  # each value RAW via printf -v (no eval, no word-splitting), then export.
  set -a
  while IFS= read -r _envline || [[ -n "$_envline" ]]; do
    case "$_envline" in ''|'#'*) continue ;; esac
    _envkey=${_envline%%=*}
    case "$_envkey" in ''|*[!A-Za-z0-9_]*) continue ;; esac
    printf -v "$_envkey" '%s' "${_envline#*=}"
  done < ./.env
  set +a
else
  PG_PASS="$(gen_secret 16)"
  ADMIN_PASS="$(gen_secret 16)"
  JWT_SEC="$(gen_secret 32)"
  SIGN_SEC="$(gen_secret 32)"
  # All four are REQUIRED by docker-compose.yml (no weak defaults — fail-fast
  # via ${VAR:?...}); the api also fails closed on a missing/weak secret in
  # production. INTERNAL_SERVICE_SECRET mints the oa_sys_ inter-service token
  # the mcp-proxy HMAC-verifies, so api + proxy must share the same value.
  INTERNAL_KEY="$(gen_secret 32)"
  FRONTEND_SEC="$(gen_secret 32)"
  INTERNAL_SVC_SEC="$(gen_secret 32)"
  cat > .env <<EOF
# Generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
POSTGRES_PASSWORD=$PG_PASS
ADMIN_USER_EMAIL=admin@openagentic.local
ADMIN_SEED_PASSWORD=$ADMIN_PASS
JWT_SECRET=$JWT_SEC
SIGNING_SECRET=$SIGN_SEC
INTERNAL_API_KEY=$INTERNAL_KEY
FRONTEND_SECRET=$FRONTEND_SEC
INTERNAL_SERVICE_SECRET=$INTERNAL_SVC_SEC
UI_HOST_PORT=8080
EOF
  # ── Cloud CHAT providers chosen explicitly via quick-flags ───────────────────
  # --bedrock / --openai / --aif / --huggingface each wire ONE bootstrap CHAT
  # provider. EMBEDDING decision (mirrors the bedrock/aif wizard pattern): keep a
  # 768-dim embedding to match the halfvec(768) schema. When a host Ollama is
  # present we route embeddings through nomic-embed-text@768 (key-free, boots
  # healthy regardless of when cloud creds resolve); when NOT, we use the
  # provider's own 768-dim embedding where trivially available (OpenAI
  # text-embedding-3-small@768, Bedrock amazon.titan-embed-text-v2:0@768), else
  # fall back to the OpenAI-compatible endpoint. PROVIDER_WIRED gates the
  # Vertex/Ollama/none chain below so exactly one provider is seeded.
  PROVIDER_WIRED=0

  # Emit the shared embedding env: Ollama if detected, else provider-native @768.
  # $1 = fallback embedding provider when no Ollama ('openai-compatible' supplies
  #      EMBEDDING_ENDPOINT/_API_KEY/_MODEL; 'aws-bedrock' supplies AWS_EMBEDDING_MODEL_ID).
  # $2 = OpenAI-compatible endpoint (only used by the openai-compatible fallback).
  # $3 = OpenAI-compatible api key.  $4 = OpenAI-compatible embedding model.
  emit_embedding_env() {
    if [[ "$HAVE_OLLAMA" == "1" ]]; then
      cat >> .env <<EOF
# Embeddings on the detected host Ollama (nomic-embed-text @768 — matches halfvec).
OLLAMA_ENABLED=true
OLLAMA_HOST=$OLLAMA_HOST
OLLAMA_EMBED_MODEL=$EMBED_MODEL
EMBEDDING_PROVIDER=ollama
EMBEDDING_DIMENSIONS=768
EOF
    else
      case "$1" in
        aws-bedrock)
          cat >> .env <<EOF
# Embeddings via AWS Bedrock Titan (768-dim) — no host Ollama detected.
OLLAMA_ENABLED=false
EMBEDDING_PROVIDER=aws-bedrock
AWS_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0
EMBEDDING_DIMENSIONS=768
EOF
          ;;
        openai-compatible)
          cat >> .env <<EOF
# Embeddings via OpenAI-compatible endpoint (768-dim) — no host Ollama detected.
OLLAMA_ENABLED=false
EMBEDDING_PROVIDER=openai-compatible
EMBEDDING_ENDPOINT=$2
EMBEDDING_MODEL=$4
EMBEDDING_DIMENSIONS=768
EOF
          # EMBEDDING_API_KEY may be a secret — append without echoing.
          printf 'EMBEDDING_API_KEY=%s\n' "$3" >> .env
          ;;
      esac
    fi
  }

  if [[ "$BEDROCK_MODE" == "1" ]]; then
    REGION="${AWS_REGION_FLAG:-us-east-1}"
    cat >> .env <<EOF
# AWS Bedrock chat provider (compose mounts ~/.aws → /root/.aws:ro for the default chain).
AWS_REGION=$REGION
BOOTSTRAP_PROVIDER_NAME=aws-bedrock
BOOTSTRAP_PROVIDER_DISPLAY_NAME="AWS Bedrock"
BOOTSTRAP_PROVIDER_TYPE=aws-bedrock
BOOTSTRAP_PROVIDER_CONFIG={"region":"$REGION"}
BOOTSTRAP_PROVIDER_DEFAULTS={"chat":"$BEDROCK_MODEL","embedding":"nomic-embed-text","embeddingDimension":768}
SEEDER_VERSION=6
EOF
    # Auth: inline IAM keys / STS (append without echo) OR the mounted ~/.aws chain.
    if [[ -n "$AWS_KEY_ID" ]] && [[ -n "$AWS_SECRET" ]]; then
      printf 'AWS_ACCESS_KEY_ID=%s\n' "$AWS_KEY_ID" >> .env
      printf 'AWS_SECRET_ACCESS_KEY=%s\n' "$AWS_SECRET" >> .env
      if [[ -n "$AWS_SESSION" ]]; then
        printf 'AWS_SESSION_TOKEN=%s\n' "$AWS_SESSION" >> .env
        ok "AWS Bedrock wired — auth: short-term STS keys — region: $REGION — model: $BEDROCK_MODEL"
      else
        ok "AWS Bedrock wired — auth: long-term IAM keys — region: $REGION — model: $BEDROCK_MODEL"
      fi
    else
      ok "AWS Bedrock wired — auth: mounted ~/.aws default chain — region: $REGION — model: $BEDROCK_MODEL"
      if [[ ! -d "$HOME/.aws" ]]; then
        warn 'No ~/.aws found — Bedrock will fail to authenticate until you run `aws configure` or pass --aws-key/--aws-secret.'
      fi
    fi
    # Embeddings: Ollama if present, else Bedrock Titan @768.
    emit_embedding_env aws-bedrock
    PROVIDER_WIRED=1

  elif [[ "$OPENAI_MODE" == "1" ]]; then
    cat >> .env <<EOF
# OpenAI chat provider.
BOOTSTRAP_PROVIDER_NAME=openai
BOOTSTRAP_PROVIDER_DISPLAY_NAME="OpenAI"
BOOTSTRAP_PROVIDER_TYPE=openai
BOOTSTRAP_PROVIDER_CONFIG={"baseUrl":"https://api.openai.com/v1"}
BOOTSTRAP_PROVIDER_DEFAULTS={"chat":"$OPENAI_MODEL","embedding":"nomic-embed-text","embeddingDimension":768}
SEEDER_VERSION=6
EOF
    # API key — append without echoing it to the terminal.
    printf 'OPENAI_API_KEY=%s\n' "$OPENAI_KEY" >> .env
    ok "OpenAI wired — model: $OPENAI_MODEL"
    if [[ -z "$OPENAI_KEY" ]]; then
      warn 'No --openai-key given — chat will fail until OPENAI_API_KEY is set.'
    fi
    # Embeddings: Ollama if present, else OpenAI text-embedding-3-small @768.
    emit_embedding_env openai-compatible 'https://api.openai.com/v1' "$OPENAI_KEY" 'text-embedding-3-small'
    PROVIDER_WIRED=1

  elif [[ "$HF_MODE" == "1" ]]; then
    # Hugging Face Inference Endpoint / TGI is OpenAI-compatible: wired through the
    # OpenAI adapter with a custom base URL. The base URL is carried in
    # BOOTSTRAP_PROVIDER_CONFIG.baseUrl (ProviderConfigService maps it onto the
    # OpenAIProvider) — OPENAI_BASE_URL alone is NOT read by the env fallback.
    HF_BASE="${HF_ENDPOINT%/}"
    cat >> .env <<EOF
# Hugging Face (OpenAI-compatible TGI / Inference Endpoint) chat provider.
BOOTSTRAP_PROVIDER_NAME=huggingface
BOOTSTRAP_PROVIDER_DISPLAY_NAME="Hugging Face"
BOOTSTRAP_PROVIDER_TYPE=openai
BOOTSTRAP_PROVIDER_CONFIG={"baseUrl":"$HF_BASE"}
BOOTSTRAP_PROVIDER_DEFAULTS={"chat":"$HF_MODEL","embedding":"nomic-embed-text","embeddingDimension":768}
OPENAI_BASE_URL=$HF_BASE
SEEDER_VERSION=6
EOF
    # HF token (used as the OpenAI bearer) — append without echoing.
    printf 'OPENAI_API_KEY=%s\n' "$HF_TOKEN" >> .env
    ok "Hugging Face wired (OpenAI-compatible) — endpoint: ${HF_BASE:-<unset>} — model: ${HF_MODEL:-<unset>}"
    if [[ -z "$HF_ENDPOINT" ]] || [[ -z "$HF_TOKEN" ]]; then
      warn 'Hugging Face needs --hf-endpoint and --hf-token — chat will fail until both are set.'
    fi
    # Embeddings: Ollama if present, else the same HF endpoint (assumes it serves
    # an embedding model named by --hf-model; document a separate embed model if not).
    emit_embedding_env openai-compatible "$HF_BASE" "$HF_TOKEN" "$HF_MODEL"
    PROVIDER_WIRED=1

  elif [[ "$AIF_MODE" == "1" ]]; then
    AIF_VER='2024-10-21'
    cat >> .env <<EOF
# Azure AI Foundry chat provider.
AIF_ENDPOINT_URL=$AIF_ENDPOINT_FLAG
AIF_API_VERSION=$AIF_VER
AIF_MODEL=$AIF_DEPLOYMENT
OLLAMA_ENABLED=false
BOOTSTRAP_PROVIDER_NAME=azure-ai-foundry
BOOTSTRAP_PROVIDER_DISPLAY_NAME="Azure AI Foundry"
BOOTSTRAP_PROVIDER_TYPE=azure-ai-foundry
BOOTSTRAP_PROVIDER_DEFAULTS={"chat":"$AIF_DEPLOYMENT","embedding":"nomic-embed-text","embeddingDimension":768}
SEEDER_VERSION=6
EOF
    # Auth: Entra app (tenant/client/secret) OR API key. Secrets appended w/o echo.
    if [[ -n "$AIF_TENANT" ]] && [[ -n "$AIF_CLIENT" ]] && [[ -n "$AIF_SECRET" ]]; then
      printf 'AIF_TENANT_ID=%s\n' "$AIF_TENANT" >> .env
      printf 'AIF_CLIENT_ID=%s\n' "$AIF_CLIENT" >> .env
      printf 'AIF_CLIENT_SECRET=%s\n' "$AIF_SECRET" >> .env
      printf 'BOOTSTRAP_PROVIDER_CONFIG={"endpointUrl":"%s","apiVersion":"%s","deploymentName":"%s","tenantId":"%s","clientId":"%s"}\n' \
        "$AIF_ENDPOINT_FLAG" "$AIF_VER" "$AIF_DEPLOYMENT" "$AIF_TENANT" "$AIF_CLIENT" >> .env
      ok "Azure AI Foundry wired — auth: Microsoft Entra app — deployment: ${AIF_DEPLOYMENT:-<unset>}"
    else
      printf 'AIF_API_KEY=%s\n' "$AIF_KEY" >> .env
      printf 'BOOTSTRAP_PROVIDER_CONFIG={"endpointUrl":"%s","apiVersion":"%s","deploymentName":"%s"}\n' \
        "$AIF_ENDPOINT_FLAG" "$AIF_VER" "$AIF_DEPLOYMENT" >> .env
      ok "Azure AI Foundry wired — auth: API key — deployment: ${AIF_DEPLOYMENT:-<unset>}"
    fi
    if [[ -z "$AIF_ENDPOINT_FLAG" ]] || [[ -z "$AIF_DEPLOYMENT" ]]; then
      warn 'Azure AI Foundry needs --aif-endpoint and --aif-deployment — chat will fail until both are set.'
    fi
    # Embeddings: Ollama if present, else AIF has no key-free 768 embed wired here —
    # keep embeddings on Ollama (the recommended default). Surface if absent.
    if [[ "$HAVE_OLLAMA" == "1" ]]; then
      cat >> .env <<EOF
OLLAMA_HOST=$OLLAMA_HOST
OLLAMA_EMBED_MODEL=$EMBED_MODEL
EMBEDDING_PROVIDER=ollama
EMBEDDING_DIMENSIONS=768
EOF
      # OLLAMA_ENABLED must be true for the Ollama embedding path despite AIF chat.
      printf 'OLLAMA_ENABLED=true\n' >> .env
    else
      warn 'No host Ollama for embeddings — Azure AI Foundry embeddings need a 768-dim source. Run Ollama (nomic-embed-text) or wire an embedding provider in the admin UI.'
    fi
    PROVIDER_WIRED=1
  fi

  # Vertex is chosen explicitly (--vertex/--vertex-key) OR auto-detected when no
  # Ollama is present and there's a usable Google credential on disk (gcloud ADC
  # file, or a ~/vertex-api key file). Vertex takes precedence over the Ollama /
  # none branches below.
  ADC_FILE="$HOME/.config/gcloud/application_default_credentials.json"
  if [[ "$PROVIDER_WIRED" == "1" ]]; then
    :  # a cloud chat provider (--bedrock/--openai/--aif/--huggingface) was wired above.
  elif [[ "$VERTEX_MODE" == "1" ]] || { [[ "$HAVE_OLLAMA" != "1" ]] && { [[ -f "$ADC_FILE" ]] || [[ -f "$HOME/vertex-api" ]]; }; }; then
    # Resolve project: explicit flag wins, else gcloud's active project. LOC from flag.
    PROJ="$VERTEX_PROJECT_ID"
    if [[ -z "$PROJ" ]]; then
      PROJ="$(gcloud config get-value project 2>/dev/null | tr -d '[:space:]' || true)"
      case "$PROJ" in '(unset)'|'') PROJ='' ;; esac
    fi
    LOC="$VERTEX_LOCATION"
    # Auth mode: explicit key > ~/vertex-api key file (only when NO ADC) > ADC (no key).
    if [[ -n "$VERTEX_API_KEY" ]]; then
      KEYVAL="$VERTEX_API_KEY"
    elif [[ ! -f "$ADC_FILE" ]] && [[ -f "$HOME/vertex-api" ]]; then
      KEYVAL="$(tr -d '\n\r' < "$HOME/vertex-api")"
    else
      KEYVAL=''
    fi
    # The api-side GoogleVertexProvider validates GOOGLE_APPLICATION_CREDENTIALS as
    # a SERVICE-ACCOUNT JSON and throws if it isn't — but the gcloud ADC file is a
    # USER credential. So in ADC mode we write NOTHING for that var; the SDK
    # auto-discovers /root/.config/gcloud/application_default_credentials.json via
    # vertexai:true + project + location (compose mounts ~/.config/gcloud read-only).
    # This heredoc EXPANDS $PROJ/$LOC into the JSON config.
    cat >> .env <<EOF
# Google Vertex AI provider (compose mounts ~/.config/gcloud → /root/.config/gcloud:ro).
OLLAMA_ENABLED=false
EMBEDDING_PROVIDER=vertex-ai
BOOTSTRAP_PROVIDER_NAME=google-vertex
BOOTSTRAP_PROVIDER_DISPLAY_NAME="Google Vertex AI"
BOOTSTRAP_PROVIDER_TYPE=vertex-ai
BOOTSTRAP_PROVIDER_CONFIG={"projectId":"$PROJ","location":"$LOC"}
BOOTSTRAP_PROVIDER_DEFAULTS={"chat":"gemini-2.5-flash","embedding":"gemini-embedding-001","embeddingDimension":768}
GOOGLE_CLOUD_PROJECT=$PROJ
GOOGLE_CLOUD_LOCATION=$LOC
GCP_PROJECT_ID=$PROJ
GCP_LOCATION=$LOC
GCP_EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIMENSIONS=768
DEFAULT_IMAGE_MODEL=imagen-4.0-fast-generate-001
SEEDER_VERSION=6
EOF
    # API-key mode only: append the key WITHOUT echoing it to the terminal. ADC
    # mode writes no key and no GOOGLE_APPLICATION_CREDENTIALS at all.
    if [[ -n "$KEYVAL" ]]; then
      printf 'VERTEX_AI_API_KEY=%s\n' "$KEYVAL" >> .env
      ok "Vertex AI provider wired — auth: API key — project: ${PROJ:-<unset>} — location: $LOC"
    else
      ok "Vertex AI provider wired — auth: ADC (gcloud) — project: ${PROJ:-<unset>} — location: $LOC"
      # Pre-flight: ADC mode with no ADC file + no key → seeder will error until login.
      if [[ ! -f "$ADC_FILE" ]]; then
        warn 'Vertex ADC not found — run: gcloud auth application-default login'
      fi
    fi
  elif [[ "$HAVE_OLLAMA" == "1" ]]; then
    # The user runs Ollama — wire it as THE provider explicitly. The compose
    # defaults are provider-agnostic (Ollama off, empty bootstrap), so --quick
    # must write the Ollama enablement + bootstrap block for the detected daemon.
    cat >> .env <<EOF
# Ollama provider (detected on the host — not installed by this script).
OLLAMA_ENABLED=true
OLLAMA_HOST=$OLLAMA_HOST
OLLAMA_EMBED_MODEL=$EMBED_MODEL
OLLAMA_CHAT_MODEL=$CHAT_MODEL
EMBEDDING_PROVIDER=ollama
BOOTSTRAP_PROVIDER_NAME=ollama-local
BOOTSTRAP_PROVIDER_DISPLAY_NAME="Ollama (local)"
BOOTSTRAP_PROVIDER_TYPE=ollama
BOOTSTRAP_PROVIDER_CONFIG={"endpoint":"$OLLAMA_HOST"}
BOOTSTRAP_PROVIDER_DEFAULTS={"chat":"$CHAT_MODEL","embedding":"$EMBED_MODEL","embeddingDimension":768}
SEEDER_VERSION=6
EOF
  else
    # No provider chosen — leave Ollama off and seed NO provider. The stack boots
    # healthy and provider-agnostic; the user wires a provider in the admin UI.
    cat >> .env <<EOF
# No LLM provider configured (none detected, none installed). Pick one in the
# admin UI after launch, or re-run install.sh --wizard to choose up front.
OLLAMA_ENABLED=false
EOF
  fi
  if [[ "$USE_MILVUS" == "1" ]]; then
    # Opted into Milvus (HA / large-scale RAG): enable RAG + the vector store.
    cat >> .env <<EOF
# Milvus opt-in (run: docker compose --profile milvus up -d)
MILVUS_ENABLED=true
EOF
  else
    # Default: lightweight pgvector-only (no etcd/minio/milvus). MILVUS_ENABLED
    # stays unset → isMilvusEnabled() returns false in server.ts.
    cat >> .env <<EOF
# Default lightweight stack — pgvector-only (no Milvus). For Milvus, re-run with
# --milvus (or: MILVUS_ENABLED=true docker compose --profile milvus up -d).
DISABLE_RAG=true
SKIP_TOOL_SEMANTIC_CACHE=true
EOF
  fi
  printf 'email: admin@openagentic.local\npassword: %s\n' "$ADMIN_PASS" > "$HOME/.openagentic/admin-credentials.txt"
  chmod 600 "$HOME/.openagentic/admin-credentials.txt" .env
  ok "Generated .env (admin creds in ~/.openagentic/admin-credentials.txt)"
fi

# Belt-and-suspenders: every required ${VAR:?} secret MUST be present, even if a
# partial/stale .env was kept above. Append any that are missing so `compose up`
# never dies on an unset secret.
for s in POSTGRES_PASSWORD JWT_SECRET SIGNING_SECRET INTERNAL_API_KEY FRONTEND_SECRET INTERNAL_SERVICE_SECRET; do
  grep -qE "^${s}=" .env || { echo "${s}=$(gen_secret 24)" >> .env; warn "added a missing ${s} to .env"; }
done

# 4. Mint a magic-link token so the browser opens auto-logged-in. PERSIST it to
#    .env (reuse an existing one) — the api reads MAGIC_BOOT_TOKEN from .env on
#    EVERY boot, so an export alone is lost on the next restart/recreate, breaking
#    auto-login. Mirrors the wizard path.
if grep -qE '^MAGIC_BOOT_TOKEN=.{16,}' .env; then
  MAGIC_TOKEN="$(grep -E '^MAGIC_BOOT_TOKEN=' .env | head -1 | cut -d= -f2-)"
else
  MAGIC_TOKEN="$(gen_secret 24)"
  echo "MAGIC_BOOT_TOKEN=$MAGIC_TOKEN" >> .env
fi
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

# 6. Bring it up. Default is the lightweight pgvector-only stack (no Milvus) —
# the api boots healthy without etcd/minio/milvus (isMilvusEnabled() in
# server.ts). --milvus opts into the Milvus trio for HA / large-scale RAG.
step "docker compose up"
if [[ "$USE_MILVUS" == "1" ]]; then
  info 'Pulling images and starting services with Milvus (first boot pulls a few GB)…'
else
  info 'Pulling images and starting services — pgvector-only (first boot pulls a few GB)…'
fi
# Bring up the full stack at once. The api's entrypoint waits for the mcp-proxy to be
# reachable (to index tools — FATAL if absent), so the api + mcp-proxy MUST start
# together; isolating the api makes it crash-loop. workflows waits on
# api: service_healthy and will bail during the api's slow first boot (~2-4min) — we
# re-up below once the api is healthy to start it (and anything else that bailed).
compose_up -d 2>&1 | tail -8

# 7. Wait for api healthy. First boot can take a few minutes — match the image's
#    600s HEALTHCHECK start-period so we don't give up early.
info 'Waiting for api healthy (first boot ~2-4min: schema push + seed + tool indexing)…'
s=unknown
for _ in $(seq 1 300); do
  s=$(docker inspect --format '{{.State.Health.Status}}' openagentic-api-1 2>/dev/null || echo unknown)
  [[ "$s" == "healthy"   ]] && { ok 'api is healthy'; break; }
  [[ "$s" == "unhealthy" ]] && fatal 'api went unhealthy. Check `docker logs openagentic-api-1`.'
  sleep 2
done
[[ "$s" == "healthy" ]] || fatal 'api did not go healthy in ~10min. Check `docker logs openagentic-api-1`.'

# api is healthy — bring up the rest (workflows waits on api: service_healthy).
step "docker compose up (remaining services)"
compose_up -d 2>&1 | tail -8

# 8. Print summary + open browser auto-logged-in.
UI_HOST_PORT="${UI_HOST_PORT:-8080}"
MAGIC_URL="http://localhost:${UI_HOST_PORT}/auth/magic?token=${MAGIC_TOKEN}"

step "You're in"
printf '  %sOpenAgentic is up.%s\n\n' "$C_GREEN$C_BOLD" "$C_RESET"
printf '  Chat UI:        %s%s%s\n' "$C_BOLD" "http://localhost:${UI_HOST_PORT}" "$C_RESET"
printf '  Auto-login:     %s%s%s   %s(one-shot)%s\n' "$C_BOLD" "$MAGIC_URL" "$C_RESET" "$C_GRAY" "$C_RESET"
printf '  Admin email:    %sadmin@openagentic.local%s\n' "$C_BOLD" "$C_RESET"
printf '  Admin password: see %s~/.openagentic/admin-credentials.txt%s\n\n' "$C_BOLD" "$C_RESET"

printf '  %sTry this first in the chat:%s\n' "$C_PURPLE" "$C_RESET"
# The kubernetes MCP uses the in-cluster / mounted pod ServiceAccount, so this
# works with ZERO cloud creds — always shown first.
printf '    · %sWhich pods are crashlooping and why?%s\n' "$C_BOLD" "$C_RESET"
# Cloud-specific prompts are only useful when that cloud MCP is actually
# credentialed, so show them as secondary suggestions only when detected.
# Guard the empty-array case: on bash 3.2 (macOS default) + `set -u`, expanding
# an empty array via "${detected[@]}" raises "unbound variable" and aborts.
if (( ${#detected[@]} > 0 )); then
  for tag in "${detected[@]}"; do
    case "$tag" in
      Azure*) printf '    · %sShow me my Azure subscriptions%s\n'           "$C_BOLD" "$C_RESET" ;;
      AWS*)   printf '    · %sShow me my AWS account and EC2 instances%s\n' "$C_BOLD" "$C_RESET" ;;
      GCP*)   printf '    · %sList my GCP projects%s\n'                     "$C_BOLD" "$C_RESET" ;;
    esac
  done
fi
printf '\n'

if [[ "$OPEN_BROWSER" == "1" ]]; then
  if   command -v xdg-open >/dev/null 2>&1; then ( xdg-open "$MAGIC_URL" >/dev/null 2>&1 & ) >/dev/null 2>&1 || true
  elif command -v open     >/dev/null 2>&1; then ( open     "$MAGIC_URL" >/dev/null 2>&1 & ) >/dev/null 2>&1 || true
  fi
fi

# --quick install + boot succeeded; exit clean so a trailing non-zero never leaks out.
exit 0
