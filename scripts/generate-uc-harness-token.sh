#!/usr/bin/env bash
# Mint a short-lived local JWT for UC-harness runs.
#
# The openagentic-api chat middleware accepts either Azure AD tokens or
# local HS256 JWTs signed with JWT_SECRET or SIGNING_SECRET (see
# services/openagentic-api/src/routes/chat/middleware/auth.middleware.ts).
# For deterministic harness runs we sign our own local token so we don't
# depend on interactive SSO flows.
#
# Usage:
#   scripts/generate-uc-harness-token.sh [--ttl 3600] [--out .uc-harness-token]
#
# Env overrides:
#   UC_HARNESS_USER_ID    override DB id (default: mcp-tester lookup)
#   UC_HARNESS_EMAIL      override user email
#   UC_HARNESS_NAMESPACE  k8s namespace (default: agentic-dev)
#   UC_HARNESS_SECRET     raw JWT_SECRET (skip kubectl lookup)
#
# Output:
#   Writes the JWT to the --out path (default .uc-harness-token) AND echoes
#   the raw token to stdout so it can be captured via `export
#   UC_HARNESS_TOKEN=$(scripts/generate-uc-harness-token.sh)`.

set -euo pipefail

TTL_SECONDS=3600
OUT_PATH=".uc-harness-token"
NAMESPACE="${UC_HARNESS_NAMESPACE:-agentic-dev}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ttl)   TTL_SECONDS="$2"; shift 2 ;;
    --out)   OUT_PATH="$2"; shift 2 ;;
    -h|--help)
      grep -E '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

secret="${UC_HARNESS_SECRET:-}"
if [[ -z "$secret" ]]; then
  if ! command -v kubectl >/dev/null 2>&1; then
    echo "kubectl not found and UC_HARNESS_SECRET not set — cannot mint token" >&2
    exit 1
  fi
  secret=$(kubectl get secret openagentic-api-secrets -n "$NAMESPACE" \
    -o jsonpath='{.data.JWT_SECRET}' 2>/dev/null | base64 -d 2>/dev/null || true)
  if [[ -z "$secret" ]]; then
    echo "failed to read JWT_SECRET from secret/openagentic-api-secrets in namespace $NAMESPACE" >&2
    exit 1
  fi
fi

user_id="${UC_HARNESS_USER_ID:-}"
email="${UC_HARNESS_EMAIL:-mcp-tester@phatoldsungmail.onmicrosoft.com}"
if [[ -z "$user_id" ]]; then
  # Canonical mcp-tester id — confirmed live 2026-04-18.
  user_id="azure_696cf712-372c-4bb0-94c6-a881d8d033d9"
fi

now=$(date +%s)
exp=$((now + TTL_SECONDS))

# Minimal claim set matching validateAnyToken()'s "local" detection.
# CRITICAL: validateAnyToken classifies a token as LOCAL only if it has
# `userId` AND does NOT have `tid` or `oid` (those mark it as Azure AD and
# route it to JWKS validation which obviously fails for a self-signed
# HMAC token). See services/openagentic-api/src/auth/tokenValidator.ts:113.
# So we deliberately OMIT oid + tid here. The unifiedAuth layer then
# re-loads azure_oid from the database for the user_id, which gives OBO
# paths what they need for downstream Azure calls.
payload_json=$(cat <<JSON
{"sub":"$user_id","userId":"$user_id","email":"$email","name":"OpenAgentic MCP Tester (UC harness)","groups":["OpenAgenticAdmins"],"isAdmin":true,"iat":$now,"exp":$exp}
JSON
)

b64u() { openssl base64 -A | tr -d '=' | tr '/+' '_-'; }
header=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64u)
body=$(printf '%s' "$payload_json" | b64u)
signing_input="${header}.${body}"
sig=$(printf '%s' "$signing_input" \
  | openssl dgst -binary -sha256 -hmac "$secret" \
  | b64u)

token="${signing_input}.${sig}"

printf '%s' "$token" > "$OUT_PATH"
chmod 600 "$OUT_PATH"
printf '%s\n' "$token"
