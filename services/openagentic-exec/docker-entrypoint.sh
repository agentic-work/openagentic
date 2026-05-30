#!/bin/sh
set -e

# /workspaces is a named volume mounted root-owned on first start.
# chown it so uid 10001 (claudeuser) can create workspace subdirs.
mkdir -p "${WORKSPACES_PATH:-/workspaces}"
chown -R 10001:10001 "${WORKSPACES_PATH:-/workspaces}" 2>/dev/null || true

# Drop from root → uid 10001:10001 and exec node.
# gosu keeps the same PID so signals are delivered correctly.
exec gosu 10001:10001 node dist/index.js
