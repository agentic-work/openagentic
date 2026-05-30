#!/usr/bin/env bash
# codemode-api-e2e.sh — Code Mode API end-to-end test
#
# Tests the Code Mode session lifecycle via direct HTTP.
# Requires: curl, jq, a running openagentic stack on :8080.
#
# Hard assertions (MUST pass for CI to succeed):
#   - /api/health returns 200
#   - login returns a token
#   - POST /api/code/sessions returns 200 (NOT 402 — would mean free-gate regressed)
#   - GET  /api/code/sessions/:id returns 200
#   - GET  /api/admin/agenticode/api-keys returns 402 (admin mgmt stays enterprise-gated)
#   - DELETE /api/code/sessions/:id returns 200
#
# All assertions in this script are HARD.

set -uo pipefail

APP="${APP_URL:-http://localhost:8080}"
ADMIN_USER="${ADMIN_USER:-admin@openagentic.local}"
ADMIN_PASS="${ADMIN_PASS:-changeme}"

PASS=0; FAIL=0; STEP=0
ok()  { PASS=$((PASS+1)); printf "  ✓ %s\n" "$1"; }
no()  { FAIL=$((FAIL+1)); printf "  ✗ %s — %s\n" "$1" "${2:-}"; }
hdr() { STEP=$((STEP+1)); printf "\n[step %02d] %s\n" "$STEP" "$1"; }

# ─── pre-flight ───────────────────────────────────────────────────────────────
hdr "pre-flight: api health"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$APP/api/health")
[ "$HTTP" = "200" ] && ok "/api/health → 200" || { no "/api/health failed" "HTTP $HTTP"; exit 1; }

# ─── 1. login ─────────────────────────────────────────────────────────────────
hdr "login"
LOGIN_RESP=$(curl -s -X POST "$APP/api/auth/local/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

TOKEN=$(echo "$LOGIN_RESP" | jq -r '.token // empty')
LOGIN_OK=$(echo "$LOGIN_RESP" | jq -r '.success // false')

[ "$LOGIN_OK" = "true" ] && ok "login success" || no "login failed" "$LOGIN_RESP"
[ -n "$TOKEN" ] && ok "token received" || { no "no token in response" "$LOGIN_RESP"; exit 1; }

# ─── 2. POST /api/code/sessions (must be 200, NOT 402) ────────────────────────
hdr "POST /api/code/sessions — free gate"
SESSION_RESP=$(curl -s -w "\n__HTTP_CODE__%{http_code}" \
  -X POST "$APP/api/code/sessions" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":""}')

SESSION_HTTP=$(echo "$SESSION_RESP" | tail -n1 | sed 's/__HTTP_CODE__//')
SESSION_BODY=$(echo "$SESSION_RESP" | sed '$d')

if [ "$SESSION_HTTP" = "402" ]; then
  no "POST /api/code/sessions returned 402 — FREE-GATE REGRESSION" \
     "This route must be free. Got: $SESSION_BODY"
  # Still count as hard fail — set FAIL but keep going for diagnostics
elif [ "$SESSION_HTTP" = "200" ]; then
  ok "POST /api/code/sessions → 200 (free, not paywalled)"
else
  no "POST /api/code/sessions unexpected status" "HTTP $SESSION_HTTP — $SESSION_BODY"
fi

SESSION_ID=$(echo "$SESSION_BODY" | jq -r '.sessionId // empty')
[ -n "$SESSION_ID" ] && ok "sessionId present: $SESSION_ID" || no "no sessionId in response" "$SESSION_BODY"

WORKSPACE=$(echo "$SESSION_BODY" | jq -r '.workspacePath // empty')
[ -n "$WORKSPACE" ] && ok "workspacePath present: $WORKSPACE" || no "no workspacePath in response" "$SESSION_BODY"

STATUS_VAL=$(echo "$SESSION_BODY" | jq -r '.status // empty')
[ -n "$STATUS_VAL" ] && ok "status field present: $STATUS_VAL" || no "no status field in response" "$SESSION_BODY"

# ─── 3. GET /api/code/sessions/:id ────────────────────────────────────────────
hdr "GET /api/code/sessions/:id"
if [ -n "$SESSION_ID" ]; then
  GET_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    "$APP/api/code/sessions/$SESSION_ID" \
    -H "Authorization: Bearer $TOKEN")
  [ "$GET_HTTP" = "200" ] && ok "GET /api/code/sessions/$SESSION_ID → 200" \
    || no "GET session failed" "HTTP $GET_HTTP"
else
  no "skipping GET (no sessionId)" "prior step failed"
fi

# ─── 4. admin mgmt 402 contrast (enterprise gate must hold) ──────────────────
hdr "GET /api/admin/agenticode/api-keys — enterprise gate (expect 402)"
GATE_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  "$APP/api/admin/agenticode/api-keys" \
  -H "Authorization: Bearer $TOKEN")
[ "$GATE_HTTP" = "402" ] && ok "GET /api/admin/agenticode/api-keys → 402 (enterprise gate holds)" \
  || no "expected 402 from admin agenticode/api-keys" "HTTP $GATE_HTTP (gate may be broken or removed)"

# ─── 5. DELETE /api/code/sessions/:id ─────────────────────────────────────────
hdr "DELETE /api/code/sessions/:id"
if [ -n "$SESSION_ID" ]; then
  DEL_RESP=$(curl -s -w "\n__HTTP_CODE__%{http_code}" \
    -X DELETE "$APP/api/code/sessions/$SESSION_ID" \
    -H "Authorization: Bearer $TOKEN")
  DEL_HTTP=$(echo "$DEL_RESP" | tail -n1 | sed 's/__HTTP_CODE__//')
  DEL_BODY=$(echo "$DEL_RESP" | sed '$d')
  [ "$DEL_HTTP" = "200" ] && ok "DELETE /api/code/sessions/$SESSION_ID → 200" \
    || no "DELETE session failed" "HTTP $DEL_HTTP — $DEL_BODY"
else
  no "skipping DELETE (no sessionId)" "prior step failed"
fi

# ─── 6. unauthenticated request must 401 ──────────────────────────────────────
hdr "POST /api/code/sessions without auth — expect 401"
UNAUTH_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$APP/api/code/sessions" \
  -H 'Content-Type: application/json' \
  -d '{"model":""}')
[ "$UNAUTH_HTTP" = "401" ] && ok "unauthenticated POST → 401" \
  || no "expected 401 for unauthenticated request" "HTTP $UNAUTH_HTTP"

# ─── summary ──────────────────────────────────────────────────────────────────
echo
echo "──────────────────────────────────────────────────────"
echo "  codemode-api-e2e: passed=$PASS  failed=$FAIL"
echo "──────────────────────────────────────────────────────"
[ "$FAIL" -eq 0 ]
