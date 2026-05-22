#!/bin/bash
# =============================================================================
# npm-fast — wrapper that runs npm install with node_modules on /tmp
# =============================================================================
#
# Why: the per-user /workspaces volume on geesefs/MinIO-CSI strips execute
# bits on writes. That breaks any dev server that spawns binaries (Vite,
# Astro, Next.js, esbuild) with `spawn .../esbuild EACCES` because the
# downloaded binaries can't be marked executable.
#
# This wrapper: stages node_modules in /tmp (real ext4 — exec bits stick),
# symlinks the project's `./node_modules` to it, then runs npm install
# from the staging dir. Subsequent `npm run dev` / `node node_modules/...`
# resolves through the symlink and finds executable binaries.
#
# Usage:
#   npm-fast install              # stages then installs
#   npm-fast install --prefix .   # same; --prefix passes through
#   npm-fast run dev              # passes through to npm run dev (uses staged bins)
#
# Idempotent: re-runs reuse the same staging dir keyed by project path
# hash. Cleared on pod delete (tmpfs).
#
# Set OPENAGENTIC_NPM_FAST_DISABLED=1 to skip staging (raw npm passthrough).
# =============================================================================

set -e

if [ "${OPENAGENTIC_NPM_FAST_DISABLED:-0}" = "1" ]; then
  exec npm "$@"
fi

PROJECT_DIR="$(pwd)"
PROJECT_HASH="$(echo -n "$PROJECT_DIR" | md5sum | cut -c1-12)"
STAGING_ROOT="${NPM_STAGING_DIR:-/tmp/npm-staging}"
STAGING_DIR="$STAGING_ROOT/$PROJECT_HASH"
STAGING_NM="$STAGING_DIR/node_modules"

mkdir -p "$STAGING_DIR"

# If `./node_modules` exists and is NOT a symlink, move it to staging so
# subsequent calls reuse the cache. Skip if user explicitly opted out.
if [ -d "./node_modules" ] && [ ! -L "./node_modules" ]; then
  echo "[npm-fast] migrating existing node_modules → $STAGING_NM"
  rm -rf "$STAGING_NM"
  mv "./node_modules" "$STAGING_NM"
fi

# Ensure ./node_modules is a symlink to the staged copy.
if [ ! -L "./node_modules" ]; then
  rm -rf "./node_modules" 2>/dev/null || true
  ln -s "$STAGING_NM" "./node_modules"
fi

# Make sure staging exists (first install)
mkdir -p "$STAGING_NM"

# Pass through to npm — node_modules writes now hit /tmp via the symlink
exec npm "$@"
