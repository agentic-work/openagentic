#!/usr/bin/env bash
# Lightweight sanity check for the OSS build:
#   - the edition flag is 'oss'
#   - the core install artifacts are present
# Used by:
#   - .github/workflows/oss-integrity.yml (PR check on main)
#   - .githooks/pre-commit                  (local commit gate)
#   - Dockerfile RUN step                   (build-time gate)
#
# Exit 0 = ok, Exit 1 = problem.

set -eo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail=0

FEATURES="$REPO/services/openagentic-api/src/features.ts"
if [ ! -f "$FEATURES" ] || ! grep -qF "EDITION: 'oss' | 'enterprise' = 'oss'" "$FEATURES"; then
  echo "SANITY FAIL: EDITION flag is not 'oss' in services/openagentic-api/src/features.ts"
  fail=1
fi

for f in install.sh docker-compose.yml; do
  if [ ! -f "$REPO/$f" ]; then
    echo "SANITY FAIL: missing core install artifact — $f"
    fail=1
  fi
done

if [ $fail -ne 0 ]; then
  exit 1
fi

echo "OSS sanity: ok."
exit 0
