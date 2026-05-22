#!/usr/bin/env bash
# scripts/harness/chat-probe.sh — REAL platform end-to-end probe.
#
# Hits the running api at /api/chat/stream with a test API key, captures
# the canonical NDJSON wire frame stream, writes it to an evidence dir,
# and prints a one-line summary + frame-type tally.
#
# This is the gate per `feedback_prompt_rule_tests_must_be_real_model_gates`
# — NO MOCKS. The platform itself is the test harness. Every Sev-0/Sev-1
# fix that touches prompt rules / artifact emission / streaming shape
# should round-trip through this script before being claimed GREEN.
#
# Usage:
#   OPENAGENTIC_TEST_KEY=awc_xxxx scripts/harness/chat-probe.sh \
#     "<prompt-slug>" "<user-message>" [extra-payload-json]
#
# Examples:
#   OPENAGENTIC_TEST_KEY=$KEY scripts/harness/chat-probe.sh \
#     trivial-2plus2 "what is 2+2"
#
#   OPENAGENTIC_TEST_KEY=$KEY scripts/harness/chat-probe.sh \
#     mock-01-azure-subs "show me my Azure subscriptions and what's in each resource group" \
#     '{"modelOverride":"us.anthropic.claude-sonnet-4-6"}'
#
# Env:
#   OPENAGENTIC_TEST_KEY  — required. API key minted via /api/admin/tokens or
#                          via direct DB insert (see docs/test-harness.md).
#                          Falls back to `cat ~/.openagentic-test-key` if unset.
#   OPENAGENTIC_HOST      — defaults to https://chat-dev.openagentic.io.
#   OPENAGENTIC_TIMEOUT   — seconds. Default 180.
#   EVIDENCE_DIR          — defaults to reports/verify-cadence/<git-sha>/.
#
# The script never mocks. If the api or model is wedged, you'll see it.
# That's the point.

set -euo pipefail

SLUG="${1:?usage: chat-probe.sh <slug> <message> [extra-json]}"
MSG="${2:?usage: chat-probe.sh <slug> <message> [extra-json]}"
EXTRA_JSON="${3:-}"

HOST="${OPENAGENTIC_HOST:-https://chat-dev.openagentic.io}"
TIMEOUT="${OPENAGENTIC_TIMEOUT:-180}"
KEY="${OPENAGENTIC_TEST_KEY:-$(test -f ~/.openagentic-test-key && cat ~/.openagentic-test-key)}"
test -n "$KEY" || { echo "ERROR: OPENAGENTIC_TEST_KEY not set and ~/.openagentic-test-key not found" >&2; exit 2; }

SHA="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
DIR="${EVIDENCE_DIR:-reports/verify-cadence/harness-$SHA}"
mkdir -p "$DIR"
OUT="$DIR/$SLUG.ndjson"
META="$DIR/$SLUG.meta.txt"

# 1) Mint a fresh session so SESSION_NOT_OWNED never fires.
SESSION_JSON="$(curl -sS \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -X POST "$HOST/api/chat/sessions" \
  --data "{\"title\":\"harness-$SLUG\"}")"
SID="$(printf '%s' "$SESSION_JSON" | python3 -c \
  'import sys,json;d=json.load(sys.stdin);print(d.get("session",{}).get("id") or d.get("id") or d.get("sessionId"))')"
test -n "$SID" -a "$SID" != "None" || { echo "ERROR: could not parse session id from: $SESSION_JSON" >&2; exit 3; }

# 2) Build the request body. Caller-supplied JSON is shallow-merged.
# Pass MSG via env var so apostrophes/quotes in the prompt don't break the
# python literal — the old `'$MSG'` embedding was a quoting hazard.
if [ -n "$EXTRA_JSON" ]; then
  BODY="$(MSG="$MSG" SID="$SID" EXTRA_JSON="$EXTRA_JSON" python3 -c "
import json, os
e = json.loads(os.environ['EXTRA_JSON'])
e.update({'message': os.environ['MSG'], 'sessionId': os.environ['SID']})
print(json.dumps(e))
")"
else
  BODY="$(MSG="$MSG" SID="$SID" python3 -c "
import json, os
print(json.dumps({'message': os.environ['MSG'], 'sessionId': os.environ['SID']}))
")"
fi

# 3) Stream the response straight to disk. -N disables buffering so we
# preserve per-line timing.
START_TS="$(date +%s)"
curl -sS -N \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -X POST "$HOST/api/chat/stream" \
  --data-binary "$BODY" \
  --max-time "$TIMEOUT" \
  --output "$OUT"
END_TS="$(date +%s)"
ELAPSED=$((END_TS - START_TS))

# 4) Meta file — re-runnable record of what we sent.
{
  echo "slug:       $SLUG"
  echo "host:       $HOST"
  echo "sessionId:  $SID"
  echo "git_sha:    $SHA"
  echo "elapsed_s:  $ELAPSED"
  echo "timeout_s:  $TIMEOUT"
  echo "body:       $BODY"
  echo "out:        $OUT"
} > "$META"

# 5) Summary to stdout — enough to spot regressions in CI.
LINES="$(wc -l < "$OUT" | tr -d ' ')"
BYTES="$(wc -c < "$OUT" | tr -d ' ')"
MODEL="$(grep -E '"type":"done"' "$OUT" | head -1 | python3 -c 'import sys,json;d=json.loads(sys.stdin.read());print(d.get("model","?"))' 2>/dev/null || echo '?')"
TALLY="$(jq -r '.type' "$OUT" 2>/dev/null | sort | uniq -c | sort -rn | tr '\n' '|' || echo '?')"
CHIP_HITS="$(grep -cE 'followup_chips|"→"|\\u2192' "$OUT" || true)"

echo "=== HARNESS PROBE OK ==="
echo "slug:       $SLUG"
echo "out:        $OUT"
echo "elapsed:    ${ELAPSED}s   lines: $LINES   bytes: $BYTES"
echo "model:      $MODEL"
echo "chip frames: $CHIP_HITS  (0 = no follow-up chips emitted)"
echo "tally:      $TALLY"
