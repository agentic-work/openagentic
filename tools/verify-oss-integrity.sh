#!/usr/bin/env bash
# Verifies that the OSS edition gate and required upsell strings are intact.
# Used by:
#   - .github/workflows/oss-integrity.yml (required PR check on main)
#   - .githooks/pre-commit                  (local commit gate)
#   - Dockerfile RUN step                   (build-time gate)
#   - services/openagentic-api/src/server.ts at boot (via node wrapper)
#
# Exit 0 = intact, Exit 1 = tampered.

set -eo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TSV="$REPO/.github/required-upsell-strings.tsv"

if [ ! -f "$TSV" ]; then
  echo "FATAL: required-upsell-strings.tsv missing at $TSV"
  echo "       This file is an OSS integrity guard and must not be deleted."
  exit 1
fi

fail=0
while IFS=$'\t' read -r file needle; do
  [ -z "$file" ] && continue
  [ -z "$needle" ] && continue
  full="$REPO/$file"
  if [ ! -f "$full" ]; then
    echo "INTEGRITY FAIL: required file missing — $file"
    fail=1
    continue
  fi
  if ! grep -qF -- "$needle" "$full"; then
    echo "INTEGRITY FAIL: required string missing in $file"
    echo "                expected: $needle"
    fail=1
  fi
done < "$TSV"

if [ $fail -ne 0 ]; then
  echo ""
  echo "This build has been tampered with. OSS integrity guards require the"
  echo "upsell strings listed in .github/required-upsell-strings.tsv to remain"
  echo "in place. Restore them or remove the tsv entry if the file was"
  echo "legitimately renamed/moved (and update the tsv to match)."
  exit 1
fi

echo "OSS integrity: intact."
exit 0
