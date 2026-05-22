#!/bin/bash
# =============================================================================
# venv-fast — wrapper that creates Python venvs on /tmp instead of /workspaces
# =============================================================================
#
# Why: same class of bug as npm-fast.sh solves for npm. The per-user
# /workspaces volume on geesefs/MinIO-CSI strips execute bits on writes,
# so binaries inside `./venv/bin/` (python, pip, uvicorn, fastapi, etc.)
# come out without +x and `./venv/bin/uvicorn` errors out with
# `Permission denied`. Surfaced 2026-05-08 in the capstone-2026 build:
# the agent created a venv with `python3 -m venv venv`, the binaries
# ended up unrunnable, and the agent thrashed for minutes trying to
# diagnose what looked like a permission issue but was actually the
# CSI driver behaviour.
#
# This wrapper: stages the venv on /tmp/venv-staging/<projectHash>/<name>
# (real ext4 — exec bits stick), symlinks `./<name>` to it, then runs
# `python3 -m venv` against the staging path. Subsequent invocations
# of `./venv/bin/*` resolve through the symlink and find executable
# binaries.
#
# Usage:
#   venv-fast create venv             # creates ./venv → /tmp/venv-staging/<hash>/venv
#   venv-fast create .my-env          # any name works
#   venv-fast create venv --upgrade-deps   # extra args pass through to venv module
#
# Idempotent: re-running create on an existing staged venv reuses it
# (does NOT recreate the binaries — keeps cached pip-installed packages).
# Cleared on pod delete (tmpfs).
#
# Env knobs:
#   OPENAGENTIC_VENV_FAST_DISABLED=1     skip staging, run plain python3 -m venv
#   VENV_STAGING_DIR=/path              override default /tmp/venv-staging
#
# Pairs with /usr/local/bin/npm-fast — same hash + same staging conventions
# so debugging "where did my files go" is consistent across both wrappers.
# =============================================================================

set -e

# Subcommand dispatch — only `create` is intercepted; anything else
# falls through to plain python3 -m venv so users have a clean escape.
SUBCOMMAND="${1:-}"

if [ "${OPENAGENTIC_VENV_FAST_DISABLED:-0}" = "1" ] || [ "$SUBCOMMAND" != "create" ]; then
  shift_args=()
  for arg in "$@"; do shift_args+=("$arg"); done
  exec python3 -m venv "${shift_args[@]}"
fi

# Consume the `create` subcommand
shift

VENV_NAME="${1:-venv}"
shift || true   # extra venv args pass through

PROJECT_DIR="$(pwd)"
PROJECT_HASH="$(echo -n "$PROJECT_DIR" | md5sum | cut -c1-12)"
STAGING_ROOT="${VENV_STAGING_DIR:-/tmp/venv-staging}"
STAGING_DIR="$STAGING_ROOT/$PROJECT_HASH"
STAGING_VENV="$STAGING_DIR/$VENV_NAME"

mkdir -p "$STAGING_DIR"

# If the project already has a non-symlink ./<name>, migrate it. This
# handles cases where the user created a venv via plain `python3 -m venv`
# first and then switched to venv-fast on the next try.
if [ -e "$PROJECT_DIR/$VENV_NAME" ] && [ ! -L "$PROJECT_DIR/$VENV_NAME" ]; then
  echo "[venv-fast] migrating existing venv → $STAGING_VENV"
  rm -rf "$STAGING_VENV"
  mv "$PROJECT_DIR/$VENV_NAME" "$STAGING_VENV"
fi

# Ensure the symlink. If we already have one pointing at staging,
# leave it alone (idempotent).
if [ ! -L "$PROJECT_DIR/$VENV_NAME" ]; then
  rm -rf "$PROJECT_DIR/$VENV_NAME" 2>/dev/null || true
  ln -s "$STAGING_VENV" "$PROJECT_DIR/$VENV_NAME"
fi

# Create the venv ONLY if the staging dir doesn't already have one —
# the existence of bin/python is our signal that a real venv is staged.
if [ ! -x "$STAGING_VENV/bin/python" ]; then
  python3 -m venv "$STAGING_VENV" "$@"
fi
