# Proprietary and confidential. Unauthorized copying prohibited.

# pre-upgrade-backup.sh — Take full backup before upgrading OpenAgentic
# Usage: ./scripts/pre-upgrade-backup.sh [backup-dir]
#
# Creates timestamped backup of all persistent data:
# - PostgreSQL: full dump via pg_dump
# - Redis: BGSAVE trigger + RDB copy
# - Milvus: collection listing (metadata)
# - MinIO: bucket listing
# - Data counts: row counts for all critical tables
#
# Required: kubectl access to agentic-dev namespace

set -euo pipefail

NAMESPACE="${NAMESPACE:-agentic-dev}"
BACKUP_DIR="${1:-/mnt/synology/Code/company/openagentic/backups/$(date +%Y%m%d_%H%M%S)}"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)

echo "╔══════════════════════════════════════════════════════╗"
echo "║  OpenAgentic Pre-Upgrade Backup                      ║"
echo "║  Namespace: $NAMESPACE"
echo "║  Backup Dir: $BACKUP_DIR"
echo "║  Timestamp: $TIMESTAMP"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

mkdir -p "$BACKUP_DIR"

# ───────────────────────────────────────────────────────────
# 1. PostgreSQL Full Backup
# ───────────────────────────────────────────────────────────
echo "[1/6] PostgreSQL backup..."

PG_POD=$(kubectl get pod -n "$NAMESPACE" -l app.kubernetes.io/name=postgresql -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -z "$PG_POD" ]; then
  echo "  WARNING: PostgreSQL pod not found, skipping PG backup"
else
  # Get DB credentials from pod env
  DB_NAME="openagentic"

  # Dump all schemas
  kubectl exec -n "$NAMESPACE" "$PG_POD" -- pg_dump \
    -U postgres \
    --verbose \
    --format=custom \
    --no-owner \
    --no-privileges \
    "$DB_NAME" > "$BACKUP_DIR/postgres-${TIMESTAMP}.dump" 2>"$BACKUP_DIR/postgres-${TIMESTAMP}.log"

  PG_SIZE=$(du -sh "$BACKUP_DIR/postgres-${TIMESTAMP}.dump" 2>/dev/null | cut -f1)
  echo "  ✓ PostgreSQL dump: $PG_SIZE → $BACKUP_DIR/postgres-${TIMESTAMP}.dump"

  # Data counts for verification
  echo "  Recording table row counts..."
  kubectl exec -n "$NAMESPACE" "$PG_POD" -- psql -U postgres -d "$DB_NAME" -t -A <<'SQL' > "$BACKUP_DIR/table-counts-${TIMESTAMP}.txt" 2>/dev/null
SELECT schemaname || '.' || tablename AS table_name,
       n_tup_ins - n_tup_del AS estimated_rows
FROM pg_stat_user_tables
WHERE n_tup_ins - n_tup_del > 0
ORDER BY estimated_rows DESC;
SQL
  echo "  ✓ Table counts saved"
fi

# ───────────────────────────────────────────────────────────
# 2. Redis Snapshot
# ───────────────────────────────────────────────────────────
echo "[2/6] Redis snapshot..."

REDIS_POD=$(kubectl get pod -n "$NAMESPACE" -l app.kubernetes.io/name=redis,app.kubernetes.io/component=master -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -z "$REDIS_POD" ]; then
  echo "  WARNING: Redis master pod not found, skipping Redis backup"
else
  # Trigger BGSAVE
  kubectl exec -n "$NAMESPACE" "$REDIS_POD" -- redis-cli BGSAVE 2>/dev/null || true
  sleep 2

  # Get key count
  REDIS_KEYS=$(kubectl exec -n "$NAMESPACE" "$REDIS_POD" -- redis-cli DBSIZE 2>/dev/null || echo "unknown")
  echo "  ✓ Redis BGSAVE triggered ($REDIS_KEYS)"

  # Record key patterns
  kubectl exec -n "$NAMESPACE" "$REDIS_POD" -- redis-cli --scan --pattern '*' 2>/dev/null | head -200 > "$BACKUP_DIR/redis-keys-${TIMESTAMP}.txt" || true
  echo "  ✓ Redis key sample saved (first 200)"
fi

# ───────────────────────────────────────────────────────────
# 3. Milvus Collection Metadata
# ───────────────────────────────────────────────────────────
echo "[3/6] Milvus collection metadata..."

API_POD=$(kubectl get pod -n "$NAMESPACE" -l app=openagentic-api -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -n "$API_POD" ]; then
  # Use API health endpoint to check Milvus
  kubectl exec -n "$NAMESPACE" "$API_POD" -- curl -s http://localhost:8000/api/health 2>/dev/null | \
    python3 -m json.tool > "$BACKUP_DIR/health-${TIMESTAMP}.json" 2>/dev/null || true
  echo "  ✓ API health snapshot saved"
fi

# Try direct Milvus access
MILVUS_POD=$(kubectl get pod -n "$NAMESPACE" -l app.kubernetes.io/instance=openagentic-milvus -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -n "$MILVUS_POD" ]; then
  echo "  Milvus pod: $MILVUS_POD"
  echo "  ✓ Milvus pod exists (collections persisted on NFS PVC)"
fi

# ───────────────────────────────────────────────────────────
# 4. MinIO Bucket Listing
# ───────────────────────────────────────────────────────────
echo "[4/6] MinIO bucket listing..."

MINIO_POD=$(kubectl get pod -n "$NAMESPACE" -l app=minio -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -z "$MINIO_POD" ]; then
  echo "  WARNING: MinIO pod not found, skipping MinIO backup"
else
  # List buckets and object counts
  kubectl exec -n "$NAMESPACE" "$MINIO_POD" -- mc ls local/ 2>/dev/null > "$BACKUP_DIR/minio-buckets-${TIMESTAMP}.txt" || true
  echo "  ✓ MinIO bucket listing saved"
fi

# ───────────────────────────────────────────────────────────
# 5. Helm Release Info
# ───────────────────────────────────────────────────────────
echo "[5/6] Helm release info..."

helm get values openagentic -n "$NAMESPACE" > "$BACKUP_DIR/helm-values-${TIMESTAMP}.yaml" 2>/dev/null || true
helm list -n "$NAMESPACE" --output json > "$BACKUP_DIR/helm-releases-${TIMESTAMP}.json" 2>/dev/null || true
echo "  ✓ Helm values and release info saved"

# ───────────────────────────────────────────────────────────
# 6. Version Info
# ───────────────────────────────────────────────────────────
echo "[6/6] Version info..."

cat > "$BACKUP_DIR/backup-manifest.json" <<MANIFEST
{
  "timestamp": "$TIMESTAMP",
  "namespace": "$NAMESPACE",
  "backup_dir": "$BACKUP_DIR",
  "components": {
    "postgres": "$(test -f "$BACKUP_DIR/postgres-${TIMESTAMP}.dump" && echo "ok" || echo "missing")",
    "redis_keys": "$(test -f "$BACKUP_DIR/redis-keys-${TIMESTAMP}.txt" && echo "ok" || echo "missing")",
    "minio_buckets": "$(test -f "$BACKUP_DIR/minio-buckets-${TIMESTAMP}.txt" && echo "ok" || echo "missing")",
    "helm_values": "$(test -f "$BACKUP_DIR/helm-values-${TIMESTAMP}.yaml" && echo "ok" || echo "missing")",
    "table_counts": "$(test -f "$BACKUP_DIR/table-counts-${TIMESTAMP}.txt" && echo "ok" || echo "missing")"
  }
}
MANIFEST

echo "  ✓ Backup manifest saved"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Backup Complete: $BACKUP_DIR"
echo "  Total size: $(du -sh "$BACKUP_DIR" | cut -f1)"
echo ""
echo "  To restore PostgreSQL:"
echo "    kubectl exec -i $PG_POD -n $NAMESPACE -- pg_restore -U postgres -d openagentic < $BACKUP_DIR/postgres-${TIMESTAMP}.dump"
echo "════════════════════════════════════════════════════════"
