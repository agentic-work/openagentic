#!/bin/sh

echo "========================================="
echo "Dependencies Health Check"
echo "========================================="

# Step 1: Wait for Milvus gRPC port (MANDATORY — semantic search requires it)
echo "[1/4] Waiting for Milvus vector database to be fully ready..."
MILVUS_HOST=${MILVUS_HOST:-milvus}
MILVUS_PORT=${MILVUS_PORT:-19530}

echo "  Checking Milvus gRPC at: $MILVUS_HOST:$MILVUS_PORT"
MILVUS_READY=false
for i in $(seq 1 60); do
  echo -n "  Attempt $i/60: "
  if nc -z -w 2 "$MILVUS_HOST" "$MILVUS_PORT" 2>/dev/null; then
    echo "✅ Milvus gRPC port is accepting connections"
    echo "  Waiting 5 seconds for Milvus to stabilize..."
    sleep 5
    echo "✅ Milvus is ready"
    MILVUS_READY=true
    break
  else
    echo "❌ Milvus not ready yet"
    sleep 5
  fi
done

if [ "$MILVUS_READY" = "false" ]; then
  echo "🚨 FATAL: Milvus not ready after 5 minutes — cannot start without vector search"
  exit 1
fi

# Step 2: Wait for Redis to be ready
echo "[2/4] Waiting for Redis to be ready..."
REDIS_HOST=${REDIS_HOST:-redis}
REDIS_PORT=${REDIS_PORT:-6379}

echo "  Checking Redis at: $REDIS_HOST:$REDIS_PORT"
for i in $(seq 1 12); do
  echo -n "  Attempt $i/12: "
  if nc -z -w 2 "$REDIS_HOST" "$REDIS_PORT" 2>/dev/null; then
    echo "✅ Redis is ready"
    break
  else
    echo "❌ Redis not ready yet"
    if [ $i -eq 12 ]; then
      echo "🚨 FATAL: Redis not ready after 60 seconds"
      exit 1
    fi
    sleep 5
  fi
done

# Step 3: Wait for MCP Proxy to be ready
echo "[3/4] Waiting for MCP Proxy to be ready..."
MCP_PROXY_URL="${MCP_PROXY_URL:-http://mcp-proxy:8080}"
MCP_HEALTH_URL="${MCP_PROXY_URL}/health"

echo "  Checking MCP Proxy health at: $MCP_HEALTH_URL"
for i in $(seq 1 30); do
  echo -n "  Attempt $i/30: "
  if curl -f -s "$MCP_HEALTH_URL" >/dev/null 2>&1; then
    echo "✅ MCP Proxy health check passed"
    echo "  Waiting 5 seconds for MCP servers to fully initialize..."
    sleep 5
    echo "✅ MCP Proxy is ready"
    break
  else
    echo "❌ MCP Proxy not ready yet"
    if [ $i -eq 30 ]; then
      echo "🚨 FATAL: MCP Proxy not ready after 150 seconds — tools cannot be indexed"
      exit 1
    fi
    sleep 5
  fi
done

# Step 4: Wait for embedding model to be available
echo "[4/4] Checking embedding model availability..."
EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-ollama}"

case "$EMBEDDING_PROVIDER" in
  ollama)
    EMBEDDING_OLLAMA_BASE_URL="${EMBEDDING_OLLAMA_BASE_URL:-${OLLAMA_BASE_URL:-http://ollama:11434}}"
    EMBEDDING_MODEL="${EMBEDDING_MODEL:-embeddinggemma}"
    echo "  Testing Ollama embedding at: $EMBEDDING_OLLAMA_BASE_URL with model: $EMBEDDING_MODEL"
    for i in $(seq 1 12); do
      echo -n "  Attempt $i/12: "
      EMBED_RESULT=$(curl -s -w "%{http_code}" -o /dev/null -X POST "$EMBEDDING_OLLAMA_BASE_URL/api/embed" \
        -H "Content-Type: application/json" \
        -d "{\"model\":\"$EMBEDDING_MODEL\",\"input\":\"test\"}" 2>/dev/null)
      if [ "$EMBED_RESULT" = "200" ]; then
        echo "✅ Ollama embedding model is available"
        break
      else
        echo "❌ Ollama embedding not ready (HTTP $EMBED_RESULT)"
        if [ $i -eq 12 ]; then
          echo "🚨 FATAL: Ollama embedding model not available"
          exit 1
        fi
        sleep 5
      fi
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
# `prisma db push` is idempotent: creates missing tables on first boot,
# no-ops when the schema is already in sync. The in-process
# AutoMigrationService also calls this, but it only runs AFTER secrets
# + vault init, and InitializationService.verifyDatabase counts tables
# that may not exist yet on a brand-new DB — so pushing up front here
# guarantees the tables are there before any code tries to read them.
# `--accept-data-loss` is the standard signal to Prisma that we're OK
# with column-type coercion on first boot; it's harmless on an empty DB.
if ! ./node_modules/.bin/prisma db push --accept-data-loss --skip-generate; then
  echo "🚨 prisma db push failed. Aborting start."
  exit 1
fi
echo "✅ Schema in sync"

echo "========================================="
echo "✅ ALL dependencies ready - starting API server"
echo "========================================="

echo "Starting API server..."
exec node dist/server.js
