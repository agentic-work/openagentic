#!/bin/sh

echo "========================================="
echo "Dependencies Health Check"
echo "========================================="

# Step 1: Wait for Milvus gRPC port.
# Milvus is OPTIONAL — a minimal install uses pgvector inside postgres for
# vector search (no Milvus container). Skip the wait when Milvus is disabled
# (MILVUS_ENABLED=false) or the tool semantic cache is off
# (SKIP_TOOL_SEMANTIC_CACHE=true) — i.e. the pgvector-only configuration.
if [ "${MILVUS_ENABLED}" = "false" ] || [ "${SKIP_TOOL_SEMANTIC_CACHE}" = "true" ]; then
  echo "[1/4] Milvus disabled — using pgvector for vector search, skipping Milvus wait."
else
  echo "[1/4] Waiting for Milvus vector database to be fully ready..."
  MILVUS_HOST=${MILVUS_HOST:-milvus}
  MILVUS_PORT=${MILVUS_PORT:-19530}

  echo "  Checking Milvus gRPC at: $MILVUS_HOST:$MILVUS_PORT"
  MILVUS_READY=false
  echo -n "  Waiting for Milvus to accept connections "
  for i in $(seq 1 60); do
    if nc -z -w 2 "$MILVUS_HOST" "$MILVUS_PORT" 2>/dev/null; then
      echo " ready ✓"
      echo "  Stabilizing (5s)…"
      sleep 5
      echo "✅ Milvus is ready"
      MILVUS_READY=true
      break
    fi
    echo -n "."
    sleep 5
  done

  if [ "$MILVUS_READY" = "false" ]; then
    echo ""
    echo "🚨 FATAL: Milvus not ready after 5 minutes — cannot start without vector search"
    exit 1
  fi
fi

# Step 2: Wait for Redis to be ready
echo "[2/4] Waiting for Redis to be ready..."
REDIS_HOST=${REDIS_HOST:-redis}
REDIS_PORT=${REDIS_PORT:-6379}

echo "  Checking Redis at: $REDIS_HOST:$REDIS_PORT"
echo -n "  Waiting for Redis "
for i in $(seq 1 12); do
  if nc -z -w 2 "$REDIS_HOST" "$REDIS_PORT" 2>/dev/null; then
    echo " ready ✓"
    echo "✅ Redis is ready"
    break
  fi
  if [ $i -eq 12 ]; then
    echo ""
    echo "🚨 FATAL: Redis not ready after 60 seconds"
    exit 1
  fi
  echo -n "."
  sleep 5
done

# Step 3: Wait for MCP Proxy to be ready
echo "[3/4] Waiting for MCP Proxy to be ready..."
MCP_PROXY_URL="${MCP_PROXY_URL:-http://mcp-proxy:8080}"
MCP_HEALTH_URL="${MCP_PROXY_URL}/health"

echo "  Checking MCP Proxy health at: $MCP_HEALTH_URL"
echo -n "  Waiting for MCP Proxy "
for i in $(seq 1 30); do
  if curl -f -s "$MCP_HEALTH_URL" >/dev/null 2>&1; then
    echo " ready ✓"
    echo "  MCP servers initializing (5s)…"
    sleep 5
    echo "✅ MCP Proxy is ready"
    break
  fi
  if [ $i -eq 30 ]; then
    echo ""
    echo "🚨 FATAL: MCP Proxy not ready after 150 seconds — tools cannot be indexed"
    exit 1
  fi
  echo -n "."
  sleep 5
done

# Step 4: Wait for embedding model to be available
echo "[4/4] Checking embedding model availability..."
EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-ollama}"

case "$EMBEDDING_PROVIDER" in
  ollama)
    EMBEDDING_OLLAMA_BASE_URL="${EMBEDDING_OLLAMA_BASE_URL:-${OLLAMA_BASE_URL:-http://ollama:11434}}"
    EMBEDDING_MODEL="${EMBEDDING_MODEL:-embeddinggemma}"
    echo "  Testing Ollama embedding at: $EMBEDDING_OLLAMA_BASE_URL with model: $EMBEDDING_MODEL"
    echo -n "  Waiting for Ollama embedding model "
    for i in $(seq 1 12); do
      EMBED_RESULT=$(curl -s -w "%{http_code}" -o /dev/null -X POST "$EMBEDDING_OLLAMA_BASE_URL/api/embed" \
        -H "Content-Type: application/json" \
        -d "{\"model\":\"$EMBEDDING_MODEL\",\"input\":\"test\"}" 2>/dev/null)
      if [ "$EMBED_RESULT" = "200" ]; then
        echo " ready ✓"
        echo "✅ Ollama embedding model is available"
        break
      fi
      if [ $i -eq 12 ]; then
        echo ""
        echo "🚨 FATAL: Ollama embedding model not available"
        exit 1
      fi
      echo -n "."
      sleep 5
    done
    ;;
  vertex-ai|vertex|gcp)
    echo "  Vertex AI embedding — SDK handles auth at runtime, skipping pre-check"
    echo "✅ Vertex AI embedding provider configured"
    ;;
  openai|openai-compatible)
    echo "  OpenAI embedding — API key auth at runtime, skipping pre-check"
    echo "✅ OpenAI embedding provider configured"
    ;;
  azure-openai|azure|azureopenai)
    echo "  Azure OpenAI embedding — token auth at runtime, skipping pre-check"
    echo "✅ Azure OpenAI embedding provider configured"
    ;;
  aws-bedrock|aws|bedrock)
    echo "  AWS Bedrock embedding — SDK handles auth at runtime, skipping pre-check"
    echo "✅ AWS Bedrock embedding provider configured"
    ;;
  *)
    echo "⚠️  Unknown embedding provider: $EMBEDDING_PROVIDER — skipping pre-check"
    ;;
esac

echo "========================================="
echo "Syncing database schema"
echo "========================================="
# Schema sync uses `prisma db push` (idempotent: creates missing tables on
# first boot, no-ops when in sync). KNOWN HARDENING GAP (tracked): db push is
# schema-only, so the raw-SQL security objects in prisma/migrations/ —
# row-level-security policies + the audit-immutability triggers — are NOT
# created by this path. Switching to `prisma migrate deploy` requires first
# regenerating a clean, replayable from-empty migration baseline (the current
# 13 migrations are out-of-order drift on a db-push base and fail from empty:
# "schema admin does not exist"). That regen + a boot-regression test that
# asserts the RLS/triggers exist belongs in the in-cluster CI runner where a
# real DB boot can be gated. Until then this stays db push so fresh installs
# boot reliably.
if ! ./node_modules/.bin/prisma db push --accept-data-loss --skip-generate; then
  echo "prisma db push failed. Aborting start."
  exit 1
fi
echo "Schema in sync"

echo "========================================="
echo "✅ ALL dependencies ready - starting API server"
echo "========================================="

echo "Starting API server..."
exec node dist/server.js
