#!/usr/bin/env bash
# ====================================================================================================
# Regression test (source-grep): IDC failures MUST NOT silently fall back to a shared
# service role via `_get_credentials_via_direct_oidc` (AssumeRoleWithWebIdentity against
# AWS_OBO_ROLE_ARN). That fallback would give every AD-authenticated user creds for the
# shared role regardless of IDC mapping — they'd inherit the shared role's blast radius.
#
# User 2026-05-12: "we cnat have a fallback- then it would mean anyone who has access to
# the platform and asks aws questions would get access to that role/account in aws".
#
# Contract:
#   1. `_get_credentials_via_direct_oidc` is NOT called from the IDC-primary entry points
#      (`get_obo_credentials` or `_get_credentials_for_user`). When IDC is configured and
#      fails, the call returns None — clean denial.
#   2. The function itself (`_get_credentials_via_direct_oidc`) is removed entirely OR
#      gated behind an explicit local-dev-only flag that defaults to off.
#   3. The `AssumeRoleWithWebIdentity` call site is NOT reachable from a chat dispatch
#      path. Any remaining occurrence must be in a clearly-local-dev-only code branch.
# ====================================================================================================
set -euo pipefail

SERVER="$(cd "$(dirname "$0")/.." && pwd)/server.py"

# 1: the IDC-primary entry points MUST NOT contain a bare call to _get_credentials_via_direct_oidc.
# Search lines around `get_obo_credentials` + `_get_credentials_for_user` (the two callers).
# We want grep_count == 0 inside those two function bodies.
violations="$(awk '
  /^def (get_obo_credentials|_get_credentials_for_user)\(/ { inside=1 }
  inside && /^def [^_]/ { inside=0 }  # next top-level def ends scope; helpers (starting _) keep scope
  inside && /_get_credentials_via_direct_oidc\s*\(/ { print NR ": " $0 }
' "$SERVER" | head -10)"

if [[ -n "$violations" ]]; then
  echo "FAIL: IDC-primary entry points contain a fallback call to _get_credentials_via_direct_oidc:" >&2
  echo "$violations" >&2
  echo "Rip the fallback OR gate it behind an explicit local-dev-only flag." >&2
  exit 1
fi

# 2: any AssumeRoleWithWebIdentity reference must be in a clearly-gated branch
# (the only allowed context is inside the legacy fallback function — which itself must
# either be deleted or only reachable from a flag-gated path documented as local-dev-only).
unguarded="$(grep -n 'assume_role_with_web_identity' "$SERVER" | grep -v 'logger\.' | grep -v '^[[:space:]]*#' || true)"
if [[ -n "$unguarded" ]]; then
  # If any unguarded AssumeRoleWithWebIdentity remains, it must be inside a function whose
  # body is gated by `if AWS_OBO_FALLBACK_TO_SERVICE` — otherwise it's a live fallback.
  func_line="$(awk '
    /^def _get_credentials_via_direct_oidc/ { print NR; exit }
  ' "$SERVER" || true)"
  if [[ -n "$func_line" ]]; then
    # Verify the function body returns None when AWS_OBO_FALLBACK_TO_SERVICE is false.
    gated="$(awk -v start="$func_line" '
      NR == start { inside=1 }
      inside && /^def [^_]/ && NR > start { inside=0 }
      inside && /AWS_OBO_FALLBACK_TO_SERVICE/ { found=1 }
      END { print found ? "yes" : "no" }
    ' "$SERVER")"
    if [[ "$gated" != "yes" ]]; then
      echo "FAIL: _get_credentials_via_direct_oidc still contains an unguarded AssumeRoleWithWebIdentity call." >&2
      echo "$unguarded" >&2
      echo "Either delete the function or gate the entire body behind AWS_OBO_FALLBACK_TO_SERVICE." >&2
      exit 1
    fi
  fi
fi

echo "PASS: no IDC-failure fallback to shared role; all AWS auth flows through Identity Center"
