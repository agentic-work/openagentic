#!/usr/bin/env bash
# scripts/rotate-csi-s3-secret.sh
#
# Task #638 — operator runbook to rotate the CSI-S3 storage-class secret
# after bitnami/MinIO auto-rotates the usermin admin password (causes
# pre-existing PVCs to fail mount with "Timeout waiting for mount").
#
# Symptoms:
#   - kubectl describe pvc <name> -n agentic-dev shows: Bound but unmounted
#   - kubectl describe pod openagentic-<userhash> -n agentic-dev shows:
#     MountVolume.MountDevice failed → "rpc error: code = Unknown desc =
#     Timeout waiting for mount"
#   - csi-s3 + csi-s3-provisioner pods all 2/2 Running (driver healthy)
#   - PVCs Bound (volume binding succeeded) but pods stuck on attach
#
# Root cause: the CSI-S3 storage-class params reference the OLD usermin
# password; MinIO has rotated. Fix: read current usermin admin/secret
# from agentic-dev's user-minio secret, update the CSI-S3 storage-class
# secret in the k8s-csi-s3 namespace (or wherever your driver expects).
#
# Usage:
#   ./scripts/rotate-csi-s3-secret.sh [namespace] [csi-s3-secret-name]
#
#   Defaults:
#     namespace             = agentic-dev
#     csi-s3-secret-name    = csi-s3-secret  (k8s-csi-s3 ns)
#
# Idempotent — safe to re-run.
set -euo pipefail

NS="${1:-agentic-dev}"
CSI_SECRET_NAME="${2:-csi-s3-secret}"
CSI_SECRET_NS="${CSI_S3_NS:-k8s-csi-s3}"
USERMIN_SECRET="${USERMIN_SECRET:-user-minio}"

echo "[#638] Reading current usermin admin creds from $NS/$USERMIN_SECRET..."
CURRENT_KEY=$(kubectl get secret -n "$NS" "$USERMIN_SECRET" -o jsonpath='{.data.root-user}' | base64 -d 2>/dev/null || true)
CURRENT_SECRET=$(kubectl get secret -n "$NS" "$USERMIN_SECRET" -o jsonpath='{.data.root-password}' | base64 -d 2>/dev/null || true)

if [[ -z "$CURRENT_KEY" || -z "$CURRENT_SECRET" ]]; then
  echo "ERROR: failed to read usermin admin/secret from $NS/$USERMIN_SECRET" >&2
  echo "       check: kubectl get secret -n $NS $USERMIN_SECRET -o yaml" >&2
  exit 1
fi

echo "[#638] Current usermin key length: ${#CURRENT_KEY}, secret length: ${#CURRENT_SECRET}"

echo "[#638] Updating $CSI_SECRET_NS/$CSI_SECRET_NAME with rotated creds..."
kubectl create secret generic "$CSI_SECRET_NAME" -n "$CSI_SECRET_NS" \
  --from-literal=accessKeyID="$CURRENT_KEY" \
  --from-literal=secretAccessKey="$CURRENT_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "[#638] Restarting CSI-S3 driver pods to pick up new secret..."
kubectl rollout restart daemonset/csi-s3 -n "$CSI_SECRET_NS" 2>/dev/null \
  || kubectl delete pods -n "$CSI_SECRET_NS" -l app=csi-s3 --ignore-not-found

kubectl rollout restart statefulset/csi-s3-provisioner -n "$CSI_SECRET_NS" 2>/dev/null \
  || kubectl delete pod -n "$CSI_SECRET_NS" csi-s3-provisioner-0 --ignore-not-found

echo "[#638] Identifying user-pod PVCs that need recreation (the openagentic session PVC is regenerable)..."
STUCK_PVCS=$(kubectl get pvc -n "$NS" \
  -o jsonpath='{range .items[?(@.spec.storageClassName=="minio-csi")]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)

if [[ -n "$STUCK_PVCS" ]]; then
  echo "[#638] Found $(echo "$STUCK_PVCS" | wc -l) minio-csi PVC(s)."
  echo "$STUCK_PVCS" | sed 's/^/    /'
  echo
  echo "To recreate them (deletes pods + recreates session PVCs; user data survives in their per-user MinIO bucket):"
  echo "  kubectl delete pvc -n $NS \\"
  echo "$STUCK_PVCS" | sed 's/^/    /' | tr '\n' ' '
  echo
  echo "  kubectl delete pod -n $NS -l app.kubernetes.io/component=openagentic-user-pod"
  echo
  echo "Code-manager will re-provision PVCs on next session login."
else
  echo "[#638] No minio-csi PVCs found — nothing to recreate."
fi

echo
echo "[#638] DONE. Verify with:"
echo "  kubectl describe pvc -n $NS <pvc-name>"
echo "  kubectl get events -n $NS --sort-by='.lastTimestamp' | grep csi-s3"
