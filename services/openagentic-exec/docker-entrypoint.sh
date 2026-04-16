#!/bin/sh
# Proprietary and confidential. Unauthorized copying prohibited.

# =============================================================================
# OPENAGENTIC EXEC - DOCKER ENTRYPOINT
# =============================================================================
# Handles workspace storage initialization based on STORAGE_MODE.
# Supports:
#   - local: Uses mounted PVC at /workspaces (default, recommended)
#   - s3fs:  Mounts MinIO bucket via s3fs (legacy, requires FUSE)
# =============================================================================

set -e

echo "=========================================="
echo "  Openagentic Exec - Startup"
echo "=========================================="

# -----------------------------------------------------------------------------
# Mount MinIO bucket via s3fs (legacy mode - only if explicitly requested)
# -----------------------------------------------------------------------------
mount_s3fs_storage() {
  # Check if storage is configured
  if [ -z "$STORAGE_PROVIDER" ] || [ -z "$STORAGE_BUCKET" ] || [ -z "$STORAGE_ENDPOINT" ]; then
    echo "[Storage] S3FS: Not configured - using local storage"
    return 1
  fi

  if [ -z "$STORAGE_ACCESS_KEY" ] || [ -z "$STORAGE_SECRET_KEY" ]; then
    echo "[Storage] S3FS: Missing credentials - using local storage"
    return 1
  fi

  echo "[Storage] Provider: $STORAGE_PROVIDER"
  echo "[Storage] Bucket: $STORAGE_BUCKET"
  echo "[Storage] Endpoint: $STORAGE_ENDPOINT"

  # Create credentials file for s3fs
  echo "${STORAGE_ACCESS_KEY}:${STORAGE_SECRET_KEY}" > /etc/passwd-s3fs
  chmod 600 /etc/passwd-s3fs

  # Parse endpoint URL to get host for s3fs
  # STORAGE_ENDPOINT format: http://minio:9000 or https://s3.amazonaws.com
  S3FS_URL="${STORAGE_ENDPOINT}"

  # Ensure mount point exists and is empty
  mkdir -p /workspaces

  # Check if already mounted (in case of container restart)
  if mountpoint -q /workspaces; then
    echo "[Storage] /workspaces already mounted via s3fs"
    return 0
  fi

  echo "[Storage] Mounting s3://${STORAGE_BUCKET}/workspaces to /workspaces..."

  # Mount with s3fs
  s3fs "${STORAGE_BUCKET}:/workspaces" /workspaces \
    -o url="${S3FS_URL}" \
    -o use_path_request_style \
    -o allow_other \
    -o umask=0000 \
    -o uid=0 \
    -o gid=0 \
    -o nonempty \
    -o retries=3 \
    -o connect_timeout=10 \
    -o readwrite_timeout=30 \
    -o stat_cache_expire=30 \
    -o passwd_file=/etc/passwd-s3fs

  if [ $? -eq 0 ]; then
    echo "[Storage] Successfully mounted s3://${STORAGE_BUCKET}/workspaces"

    # Write mount info for the daemon to read
    echo "${STORAGE_BUCKET}" > /tmp/.workspace-bucket
    echo "${STORAGE_ENDPOINT}" > /tmp/.workspace-endpoint

    # Verify mount
    if mountpoint -q /workspaces; then
      echo "[Storage] Mount verified - workspace storage is ready"
      ls -la /workspaces 2>/dev/null || true
      return 0
    else
      echo "[Storage] WARNING: Mount verification failed"
      return 1
    fi
  else
    echo "[Storage] ERROR: Failed to mount bucket"
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Setup local storage (PVC mounted at /workspaces)
# -----------------------------------------------------------------------------
setup_local_storage() {
  echo "[Storage] Using local PVC storage at /workspaces"

  # Ensure directory exists with correct permissions
  mkdir -p /workspaces
  chmod 755 /workspaces

  # Check if this is a real mounted volume or just container filesystem
  if mountpoint -q /workspaces; then
    echo "[Storage] PVC is mounted at /workspaces"
    # Get mount info
    df -h /workspaces || true
  else
    echo "[Storage] WARNING: /workspaces is not a mount point - using container filesystem"
    echo "[Storage] Data will NOT persist across container restarts!"
  fi

  # List contents
  echo "[Storage] Current contents of /workspaces:"
  ls -la /workspaces 2>/dev/null || echo "  (empty)"
}

# -----------------------------------------------------------------------------
# Main storage initialization
# -----------------------------------------------------------------------------
init_storage() {
  # Check storage mode
  STORAGE_MODE="${STORAGE_MODE:-local}"

  echo "[Storage] Storage mode: $STORAGE_MODE"

  case "$STORAGE_MODE" in
    "local"|"pvc")
      # Use local/PVC storage (default, recommended)
      setup_local_storage
      ;;
    "s3fs"|"minio"|"s3")
      # Legacy: Try to mount S3FS
      if ! mount_s3fs_storage; then
        echo "[Storage] S3FS mount failed, falling back to local storage"
        setup_local_storage
      fi
      ;;
    *)
      echo "[Storage] Unknown storage mode: $STORAGE_MODE, using local"
      setup_local_storage
      ;;
  esac
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

# Initialize workspace storage
init_storage

# Export storage info for the daemon
export WORKSPACE_STORAGE_MODE="${STORAGE_MODE:-local}"
export WORKSPACE_PATH="${WORKSPACES_PATH:-/workspaces}"

# -----------------------------------------------------------------------------
# Install runtime tools (kubectl, helm, aws, gcloud, az, terraform, k9s, etc.)
# Run in BACKGROUND so the exec daemon starts immediately (tools install takes 60-90s)
# Cached to /opt/tools — instant on subsequent boots
# -----------------------------------------------------------------------------
export PATH="/opt/tools/bin:${PATH}"
if [ -f /app/install-runtime-tools.sh ]; then
  echo ""
  echo "[Startup] Installing runtime tools in background..."
  nohup /app/install-runtime-tools.sh > /tmp/runtime-tools.log 2>&1 &
  echo "[Startup] Runtime tools PID: $!"
fi

echo ""
echo "[Startup] Storage ready. Starting exec daemon..."
echo ""

# Execute the main process
exec "$@"
