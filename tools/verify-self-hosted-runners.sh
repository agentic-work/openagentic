#!/usr/bin/env bash
# Rejects any GitHub-hosted runner label in .github/workflows/*. All jobs
# must run on the self-hosted ARC pool (openagentic-runners).
#
# Used by:
#   - .github/workflows/runner-guard.yml (required PR check on main)
#   - Can be run locally:  ./tools/verify-self-hosted-runners.sh

set -eo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WF_DIR="$REPO/.github/workflows"

if [ ! -d "$WF_DIR" ]; then
  echo "no workflows directory at $WF_DIR — nothing to check."
  exit 0
fi

bad=$(grep -rEn 'runs-on:[[:space:]]*(ubuntu-latest|ubuntu-[0-9]+\.[0-9]+|macos-latest|macos-[0-9]+|windows-latest|windows-[0-9]+)' "$WF_DIR" 2>/dev/null || true)

if [ -n "$bad" ]; then
  echo "FAIL: GitHub-hosted runner label detected. All jobs must use the"
  echo "      self-hosted pool (openagentic-runners)."
  echo ""
  echo "$bad"
  exit 1
fi

echo "runners: all workflows target self-hosted (openagentic-runners)."
exit 0
