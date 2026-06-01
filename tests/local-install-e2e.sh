#!/usr/bin/env bash
# Local install end-to-end harness — no docker for the openagentic
# services. Brings up the data plane (postgres, redis, milvus, etcd,
# minio) via docker compose, then runs each openagentic-* service as a
# native node/python process pointed at the local data plane and an
# Ollama endpoint of your choice.
#
# Defaults are tuned for the common "Ollama on localhost:11434 with
# nomic-embed-text + gpt-oss:20b" setup; override via env.
#
# Usage:
#   tests/local-install-e2e.sh                      # run with defaults
#   OLLAMA_HOST=http://localhost:11434 \
#   OLLAMA_EMBED_MODEL=nomic-embed-text \
#   OLLAMA_CHAT_MODEL=gpt-oss:20b \
#     tests/local-install-e2e.sh                    # explicit
#   tests/local-install-e2e.sh --keep               # leave services running
#   tests/local-install-e2e.sh --quick              # skip slow Ollama smoke
#
# The harness:
#   1. Checks prereqs (node 22+, pnpm 10+, python 3.11+, docker, jq, curl)
#   2. Probes Ollama for the required models
#   3. Brings up data-plane docker services only (postgres/redis/milvus)
#   4. pnpm install + build llm-sdk + workflow-engine + prisma generate
#   5. Launches api/ui/workflows/mcp-proxy/proxy/synth as background
#      processes; logs go to .e2e-logs/<service>.log; pids tracked in
#      .e2e-logs/pids/
#   6. Waits for each service's health endpoint
#   7. Runs smoke assertions: /api/health, login → JWT, chat stream
#      against gpt-oss:20b returns content, UI serves HTML
#      (NOTE: the platform is no-paywall — there is NO 402/enterprise gate
#       to assert. The removed 402 phase used to live here. For a full
#       HELM/k8s acceptance run use tests/verify-deployment/ instead.)
#   8. Tears everything down (unless --keep)

set -eo pipefail

# ─── Config ─────────────────────────────────────────────────────────────────
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-nomic-embed-text}"
OLLAMA_CHAT_MODEL="${OLLAMA_CHAT_MODEL:-gpt-oss:20b}"

POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-e2e-localpass}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@openagentic.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-E2eTestPass123!}"
JWT_SECRET="${JWT_SECRET:-e2e-jwt-secret-not-for-prod}"
SIGNING_SECRET="${SIGNING_SECRET:-e2e-signing-secret-not-for-prod}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-e2e-internal-key}"

# Ports — picked to not collide with the docker compose stack (8080/8000/etc).
API_PORT="${API_PORT:-18000}"
UI_PORT="${UI_PORT:-18080}"
WORKFLOWS_PORT="${WORKFLOWS_PORT:-13400}"
MCP_PROXY_PORT="${MCP_PROXY_PORT:-18081}"
PROXY_PORT="${PROXY_PORT:-13300}"
SYNTH_PORT="${SYNTH_PORT:-18090}"

# Data-plane ports (host-exposed by the data-plane compose project).
PG_PORT="${PG_PORT:-15432}"
REDIS_PORT="${REDIS_PORT:-16379}"
MILVUS_PORT="${MILVUS_PORT:-19530}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO/.e2e-logs"
PID_DIR="$LOG_DIR/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

KEEP=0
QUICK=0
for a in "$@"; do
  case "$a" in
    --keep)  KEEP=1 ;;
    --quick) QUICK=1 ;;
    -h|--help) sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# //;s/^#//'; exit 0 ;;
  esac
done

# ─── Helpers ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()    { printf "${CYAN}[e2e]${NC} %s\n" "$*"; }
ok()     { printf "${GRN}[ok]${NC}  %s\n" "$*"; }
warn()   { printf "${YLW}[warn]${NC} %s\n" "$*"; }
fail()   { printf "${RED}[fail]${NC} %s\n" "$*"; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

wait_for_http() {
  local url="$1" name="$2" tries="${3:-60}"
  log "waiting for $name at $url …"
  for i in $(seq 1 "$tries"); do
    if curl -fsS -o /dev/null --max-time 2 "$url"; then
      ok "$name reachable"
      return 0
    fi
    sleep 2
  done
  fail "$name did not become reachable in $((tries*2))s"
}

start_service() {
  local name="$1"; shift
  local cmd="$*"
  log "starting $name → log: $LOG_DIR/$name.log"
  ( cd "$REPO" && eval "$cmd" ) > "$LOG_DIR/$name.log" 2>&1 &
  echo $! > "$PID_DIR/$name.pid"
}

cleanup() {
  if [ "$KEEP" = "1" ]; then
    log "--keep: leaving services running. pids in $PID_DIR/"
    log "stop later with:  for f in $PID_DIR/*.pid; do kill \$(cat \$f) 2>/dev/null; done"
    return
  fi
  log "tearing down services…"
  for f in "$PID_DIR"/*.pid; do
    [ -f "$f" ] || continue
    local pid; pid=$(cat "$f")
    kill "$pid" 2>/dev/null || true
  done
  log "tearing down data plane…"
  docker compose -p oap-e2e -f "$LOG_DIR/data-plane.compose.yml" down -v 2>/dev/null || true
}
trap cleanup EXIT

# ─── 1. Prereq check ────────────────────────────────────────────────────────
log "1/8 prereq check"
require node
require pnpm
require docker
require curl
require jq
require python3
node_ver=$(node -v | sed 's/v//;s/\..*//')
[ "$node_ver" -ge 22 ] || fail "node 22+ required (have v$(node -v))"
pnpm_ver=$(pnpm -v | sed 's/\..*//')
[ "$pnpm_ver" -ge 10 ] || fail "pnpm 10+ required (have $(pnpm -v))"
ok "prereqs satisfied (node $(node -v), pnpm $(pnpm -v))"

# ─── 2. Ollama probe ────────────────────────────────────────────────────────
log "2/8 Ollama probe at $OLLAMA_HOST"
if ! curl -fsS --max-time 5 "$OLLAMA_HOST/api/tags" >/dev/null; then
  fail "Ollama not reachable at $OLLAMA_HOST — fix OLLAMA_HOST or start ollama"
fi
tags=$(curl -fsS "$OLLAMA_HOST/api/tags")
for m in "$OLLAMA_EMBED_MODEL" "$OLLAMA_CHAT_MODEL"; do
  if echo "$tags" | jq -e --arg m "$m" '.models[] | select(.name==$m or .model==$m)' >/dev/null; then
    ok "model present: $m"
  else
    fail "model missing on $OLLAMA_HOST: $m  (pull with: ollama pull $m)"
  fi
done

# ─── 3. Data plane (postgres + redis + milvus only) ─────────────────────────
log "3/8 data plane (postgres + redis + milvus)"
cat > "$LOG_DIR/data-plane.compose.yml" <<EOF
services:
  pg:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: openagentic
      POSTGRES_PASSWORD: $POSTGRES_PASSWORD
      POSTGRES_DB: openagentic
    ports: ["$PG_PORT:5432"]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U openagentic"], interval: 2s, retries: 30 }
  redis:
    image: redis:7-alpine
    ports: ["$REDIS_PORT:6379"]
    healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 2s, retries: 30 }
  etcd:
    image: quay.io/coreos/etcd:v3.5.18
    environment: { ALLOW_NONE_AUTHENTICATION: "yes", ETCD_ADVERTISE_CLIENT_URLS: "http://etcd:2379", ETCD_LISTEN_CLIENT_URLS: "http://0.0.0.0:2379" }
    healthcheck: { test: ["CMD", "etcdctl", "endpoint", "health"], interval: 2s, retries: 30 }
  minio:
    image: minio/minio:RELEASE.2024-12-18T13-15-44Z
    command: minio server /data
    environment: { MINIO_ROOT_USER: minioadmin, MINIO_ROOT_PASSWORD: minioadmin }
    healthcheck: { test: ["CMD", "mc", "ready", "local"], interval: 2s, retries: 30 }
  milvus:
    image: milvusdb/milvus:v2.4.15
    command: milvus run standalone
    environment:
      ETCD_ENDPOINTS: etcd:2379
      MINIO_ADDRESS: minio:9000
      MINIO_ACCESS_KEY_ID: minioadmin
      MINIO_SECRET_ACCESS_KEY: minioadmin
    depends_on: { etcd: { condition: service_healthy }, minio: { condition: service_healthy } }
    ports: ["$MILVUS_PORT:19530"]
    healthcheck: { test: ["CMD", "curl", "-f", "http://localhost:9091/healthz"], interval: 5s, retries: 60 }
EOF
docker compose -p oap-e2e -f "$LOG_DIR/data-plane.compose.yml" up -d >/dev/null
log "  waiting for pg + redis + milvus healthy…"
for s in pg redis milvus; do
  for i in $(seq 1 120); do
    [ "$(docker inspect --format '{{.State.Health.Status}}' "oap-e2e-$s-1" 2>/dev/null)" = healthy ] && break
    sleep 2
  done
done
ok "data plane healthy"

# ─── 4. Install + build shared packages + prisma ────────────────────────────
log "4/8 pnpm install + build llm-sdk + workflow-engine"
pnpm install --no-frozen-lockfile > "$LOG_DIR/pnpm-install.log" 2>&1 || fail "pnpm install failed (see $LOG_DIR/pnpm-install.log)"
( cd "$REPO/services/shared/llm-sdk" && pnpm exec tsc -p tsconfig.json && node scripts/fix-esm-imports.js ) > "$LOG_DIR/sdk-build.log" 2>&1
( cd "$REPO/services/shared/workflow-engine" && pnpm exec tsc -p tsconfig.json ) > "$LOG_DIR/wf-engine-build.log" 2>&1
ok "shared packages built"

# Generate api + workflows Prisma clients. Order matters when both live
# in the hoisted .pnpm tree — api wins last so api typecheck stays clean.
pnpm -C services/openagentic-workflows exec prisma generate > "$LOG_DIR/prisma-workflows.log" 2>&1
pnpm -C services/openagentic-api exec prisma generate       > "$LOG_DIR/prisma-api.log" 2>&1
ok "prisma clients generated"

# Apply migrations against the e2e postgres.
DB_URL="postgresql://openagentic:$POSTGRES_PASSWORD@localhost:$PG_PORT/openagentic"
DATABASE_URL="$DB_URL" pnpm -C services/openagentic-api exec prisma migrate deploy > "$LOG_DIR/prisma-migrate.log" 2>&1 \
  || { warn "migrate deploy failed — falling back to db push"; \
       DATABASE_URL="$DB_URL" pnpm -C services/openagentic-api exec prisma db push --accept-data-loss --skip-generate >> "$LOG_DIR/prisma-migrate.log" 2>&1 \
       || fail "prisma db push failed (see $LOG_DIR/prisma-migrate.log)"; }
ok "schema applied to e2e postgres"

# Build api dist (server.js, used by `node dist/server.js` for parity with prod).
( cd "$REPO/services/openagentic-api" && pnpm exec tsc ) > "$LOG_DIR/api-build.log" 2>&1
ok "api built"

# Build UI dist (vite bundle, served by a static server below).
( cd "$REPO/services/openagentic-ui" && SKIP_DOCS_GENERATE=1 pnpm run build ) > "$LOG_DIR/ui-build.log" 2>&1
ok "ui built"

# ─── 5. Launch services natively ────────────────────────────────────────────
log "5/8 launching services"

# Shared env every node service inherits.
COMMON_ENV="NODE_ENV=development \
  DATABASE_URL=$DB_URL \
  REDIS_URL=redis://localhost:$REDIS_PORT \
  REDIS_HOST=localhost REDIS_PORT=$REDIS_PORT \
  MILVUS_HOST=localhost MILVUS_PORT=$MILVUS_PORT \
  OLLAMA_ENABLED=true OLLAMA_HOST=$OLLAMA_HOST OLLAMA_BASE_URL=$OLLAMA_HOST \
  OLLAMA_EMBEDDING_MODEL=$OLLAMA_EMBED_MODEL OLLAMA_EMBED_MODEL=$OLLAMA_EMBED_MODEL \
  EMBEDDING_PROVIDER=ollama DISABLE_RAG=true \
  JWT_SECRET=$JWT_SECRET SIGNING_SECRET=$SIGNING_SECRET \
  INTERNAL_API_KEY=$INTERNAL_API_KEY \
  AUTH_PROVIDER=local LOCAL_LOGIN_ENABLED=true \
  ADMIN_USER_EMAIL=$ADMIN_EMAIL \
  ADMIN_SEED_PASSWORD=$ADMIN_PASSWORD \
  ADMIN_REQUIRE_PASSWORD_RESET=false"

# api (the main service that prisma-migrates + seeds prompts on first boot).
start_service api "env $COMMON_ENV \
  PORT=$API_PORT API_HOST=localhost API_PORT=$API_PORT \
  MCP_PROXY_HOST=localhost MCP_PROXY_PORT=$MCP_PROXY_PORT \
  WORKFLOWS_HOST=localhost WORKFLOWS_PORT=$WORKFLOWS_PORT \
  SYNTH_HOST=localhost SYNTH_PORT=$SYNTH_PORT \
  OPENAGENTIC_PROXY_URL=http://localhost:$PROXY_PORT \
  WORKFLOW_SERVICE_URL=http://localhost:$WORKFLOWS_PORT \
  node services/openagentic-api/dist/server.js"

# mcp-proxy (python fastapi).
start_service mcp-proxy "env $COMMON_ENV \
  PORT=$MCP_PROXY_PORT API_HOST=localhost API_PORT=$API_PORT \
  python3 -m uvicorn main:app --app-dir services/openagentic-mcp-proxy/src --host 127.0.0.1 --port $MCP_PROXY_PORT"

# workflows (node).
start_service workflows "env $COMMON_ENV \
  PORT=$WORKFLOWS_PORT \
  API_URL=http://localhost:$API_PORT \
  node services/openagentic-workflows/dist/index.js"

# proxy (node, light egress proxy).
start_service proxy "env $COMMON_ENV \
  PORT=$PROXY_PORT \
  node services/openagentic-proxy/dist/index.js"

# synth (python).
start_service synth "env $COMMON_ENV \
  PORT=$SYNTH_PORT \
  python3 -m uvicorn main:app --app-dir services/openagentic-synth --host 127.0.0.1 --port $SYNTH_PORT"

# ui: serve the freshly-built vite bundle via pnpm dlx serve (no node modules at runtime).
start_service ui "pnpm dlx serve -s services/openagentic-ui/dist -l $UI_PORT"

# ─── 6. Wait for health ─────────────────────────────────────────────────────
log "6/8 waiting for service health"
wait_for_http "http://localhost:$API_PORT/api/health"             "api"        180
wait_for_http "http://localhost:$MCP_PROXY_PORT/health"           "mcp-proxy"  60
wait_for_http "http://localhost:$WORKFLOWS_PORT/health"           "workflows"  60
wait_for_http "http://localhost:$UI_PORT/"                        "ui"         60

# ─── 7. Smoke assertions ────────────────────────────────────────────────────
log "7/8 smoke assertions"

# 7a. /api/health
h=$(curl -fsS "http://localhost:$API_PORT/api/health")
echo "$h" | jq -e '.status == "healthy"'        >/dev/null || fail "api health not healthy: $h"
echo "$h" | jq -e '.database.status == "connected"' >/dev/null || fail "db not connected: $h"
echo "$h" | jq -e '.redis.status == "connected"'    >/dev/null || fail "redis not connected: $h"
ok "/api/health: status + db + redis connected"

# 7b. login → JWT
login=$(curl -fsS -X POST "http://localhost:$API_PORT/api/auth/local/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
TOKEN=$(echo "$login" | jq -r .token)
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || fail "no token in login response: $login"
echo "$login" | jq -e '.user.isAdmin == true' >/dev/null || fail "user is not admin: $login"
ok "POST /api/auth/local/login: JWT returned, isAdmin=true"

# 7c. chat model list — should include the configured chat model.
models=$(curl -fsS -H "Authorization: Bearer $TOKEN" "http://localhost:$API_PORT/api/chat/models")
if echo "$models" | jq -e --arg m "$OLLAMA_CHAT_MODEL" '.models[]? | select(.id == $m or .modelId == $m or contains($m))' >/dev/null 2>&1; then
  ok "/api/chat/models lists $OLLAMA_CHAT_MODEL"
else
  warn "/api/chat/models did not list $OLLAMA_CHAT_MODEL (continuing — model resolves at chat time)"
fi

# 7d. (REMOVED) The old enterprise 402-paywall assertion lived here. The
#     platform is no-paywall now — there is no 402/upgrade_url gate to assert.
#     Removed as part of the OSS no-paywall reframe; the HELM/k8s acceptance
#     matrix lives in tests/verify-deployment/ instead.

# 7e. chat stream — actually exercise gpt-oss via Ollama (slow; skip with --quick).
if [ "$QUICK" = "1" ]; then
  warn "--quick: skipping chat stream against $OLLAMA_CHAT_MODEL"
else
  log "  chat stream against $OLLAMA_CHAT_MODEL (Ollama at $OLLAMA_HOST) …"
  body=$(jq -nc --arg m "$OLLAMA_CHAT_MODEL" '{messages:[{role:"user",content:"Reply with exactly: pong"}], model:$m, stream:true}')
  resp=$(curl -fsS -N --max-time 60 \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -X POST "http://localhost:$API_PORT/api/chat/stream" \
    -d "$body" || true)
  # accept either modern SSE "data: {...}" or our normalized text_delta events
  if echo "$resp" | grep -qE '"type":"text_delta"|"content"|data: ' ; then
    ok "/api/chat/stream emitted streaming events from $OLLAMA_CHAT_MODEL"
  else
    fail "chat stream returned no recognizable events. first 500 chars: $(echo "$resp" | head -c 500)"
  fi
fi

# 7f. UI bundle
ui_root=$(curl -fsS "http://localhost:$UI_PORT/")
echo "$ui_root" | grep -qi '<title>'  || fail "UI did not return HTML"
ok "UI serving HTML"

# ─── 8. Done ────────────────────────────────────────────────────────────────
log "8/8 ALL CHECKS PASSED"
printf "${GRN}local install end-to-end OK${NC}\n"
printf "  api:        http://localhost:$API_PORT\n"
printf "  ui:         http://localhost:$UI_PORT\n"
printf "  workflows:  http://localhost:$WORKFLOWS_PORT\n"
printf "  mcp-proxy:  http://localhost:$MCP_PROXY_PORT\n"
printf "  ollama:     $OLLAMA_HOST  (embed=$OLLAMA_EMBED_MODEL, chat=$OLLAMA_CHAT_MODEL)\n"
printf "  logs:       $LOG_DIR\n"
[ "$KEEP" = "1" ] && printf "  (--keep set: services left running)\n"
