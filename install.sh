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
#   --update       Update an existing install in place: pull the latest source,
#                  rebuild, and restart (Docker), or `helm upgrade` (--helm).
#                  Keeps your .env. Safe to re-run.
#   --doctor       Diagnose only. Checks Docker/Compose, Node, helm/kubectl,
#                  disk, ports, and an existing install — fixes nothing, just
#                  reports what's wrong. Run this first when something breaks.
#   --no-open      Don't auto-open the browser at the end.
#   --ollama URL   Override the Ollama endpoint (default: localhost:11434).
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
EXIT_OK=0
on_exit() { local code=$?; [[ "$code" -ne 0 && "$EXIT_OK" -ne 1 ]] && need_help; }
trap on_exit EXIT
trap 'CURRENT_STEP="line $LINENO"' ERR

# NOTE: install analytics are captured SERVER-SIDE by the install server
# (install-openagentics / server.mjs) — it sees the real client IP, does geo +
# network enrichment, parses the UA, and beacons to admin.agenticwork.io with the
# real INSTALL_BEACON_SECRET. No client-side beacon here: it would leak the secret
# in this public script and can't reach the IP-gated admin anyway.

# ─── Resource preflight helpers ──────────────────────────────────────────────
# Free disk (GB) on the install volume. Best-effort; 0 if it can't be read.
free_disk_gb() { df -Pg "$1" 2>/dev/null | awk 'NR==2{print $4+0}' || echo 0; }
# Is a TCP port already bound on the host? (used to catch UI port clashes early)
port_in_use() {
  local p="$1"
  if command -v lsof >/dev/null 2>&1; then lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then nc -z localhost "$p" >/dev/null 2>&1
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
while [[ $# -gt 0 ]]; do
  case "$1" in
    --wizard)  MODE=wizard;     shift ;;
    --quick)   MODE=quick;      shift ;;
    --helm)    MODE=helm;       shift ;;
    --update)  MODE=update;     shift ;;
    --doctor)  MODE=doctor;     shift ;;
    --env)     MODE=env-file; ENV_FILE_OVERRIDE="${2:-}"; shift 2 ;;
    --no-open) OPEN_BROWSER=0;  shift ;;
    --ollama)  OLLAMA_HOST_OVERRIDE="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//;s/^#//'
      EXIT_OK=1; exit 0 ;;
    *) warn "Unknown option: $1 (ignoring). Run with --help to see valid flags."; shift ;;
  esac
done

banner

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
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  [[ "$NODE_MAJOR" -ge 20 ]] || fatal "Node.js 20+ required (found $(node --version))." 'Upgrade Node (https://nodejs.org), or use --quick / --env to skip the TUI wizard.'
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

  curl -fsSL --max-time 60 "$BUNDLE_URL" | tar -xz -C "$INSTALL_DIR" \
    || fatal "Could not download the compose bundle from ${DIST_BASE}." \
             "Check your network and try again." \
             "You can mirror the bundle and set OPENAGENTIC_DIST_BASE to its host."
  ok "Bundle downloaded"

  # Record version + pin the public registry so compose pulls pre-built images.
  echo "$VERSION" > "$INSTALL_DIR/VERSION"
  if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    {
      echo "OPENAGENTIC_REGISTRY=${GHCR_ORG}"
      echo "OPENAGENTIC_TAG=${VERSION}"
    } > "$INSTALL_DIR/.env.registry"
  fi
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
  docker compose --profile milvus up -d --build 2>&1 | tail -10 \
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
    -f "$VALUES" --wait --timeout 10m 2>&1 | tail -12 \
    || fatal 'helm install did not complete (rollout timed out or a pod is failing).' \
        "See which pods are unhealthy:  kubectl -n $NS get pods" \
        "Describe a stuck pod:           kubectl -n $NS describe pod <name>" \
        "Common causes: image pull, pending PVC (no storage class), or a missing secret."
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
  info 'Launching the setup wizard…'
  printf '\n'

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
    # End-user path: run from the published npm package — no source on disk
    WIZARD_PKG="@agenticwork/setup"
    WIZARD_VERSION="${VERSION#v}"
    [[ "$WIZARD_VERSION" == "latest" || -z "$WIZARD_VERSION" ]] && WIZARD_VERSION=""
    PKG_REF="${WIZARD_PKG}${WIZARD_VERSION:+@${WIZARD_VERSION}}"
    info "Running wizard from ${C_BOLD}${PKG_REF}${C_RESET} (cached in ~/.npm/_npx)"
    if [[ -e /dev/tty ]]; then
      exec npx --yes "$PKG_REF" < /dev/tty
    else
      exec npx --yes "$PKG_REF"
    fi
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
