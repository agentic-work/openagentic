#!/usr/bin/env bash
# scripts/harness/e2e-int-test.sh
#
# Real E2E integration test driver — called by the GH Actions
# `.github/workflows/e2e-int-test.yml` workflow that runs INSIDE the
# cluster on the ARC self-hosted runner.
#
# Hits POST /api/admin/test-harness/run-e2e, parses the NDJSON stream,
# emits a markdown summary to $GITHUB_STEP_SUMMARY when present, and
# exits 0 if all tests passed, 1 otherwise.
#
# Required env:
#   HARNESS_USER_JWT      Admin JWT OR a TEST_HARNESS_API_KEY string.
#                         (The endpoint accepts EITHER — admin JWT OR
#                         the static key. The static key is preferable
#                         for CI because it doesn't expire mid-run.)
#
# Optional env:
#   API_BASE              Base URL for the api service. Default
#                         http://openagentic-api.agentic-dev.svc:8000
#                         (in-cluster service-name access from the
#                         ARC runner in arc-runners ns).
#   HARNESS_MODE          'full' (default) or 'smoke'.
#   HARNESS_INCLUDE_FLOWS bool, default true
#   HARNESS_INCLUDE_MCP   bool, default true
#   HARNESS_INCLUDE_T3    bool, default true
#   OUT_FILE              NDJSON dump path. Default /tmp/e2e-results.ndjson.
#
# Flags:
#   --dry-run    Print the curl command without firing.

set -o pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,28p' "$0"
      exit 0
      ;;
  esac
done

API_BASE="${API_BASE:-http://openagentic-api.agentic-dev.svc:8000}"
OUT_FILE="${OUT_FILE:-/tmp/e2e-results.ndjson}"
MODE="${HARNESS_MODE:-full}"
INCLUDE_FLOWS="${HARNESS_INCLUDE_FLOWS:-true}"
INCLUDE_MCP="${HARNESS_INCLUDE_MCP:-true}"
INCLUDE_T3="${HARNESS_INCLUDE_T3:-true}"

if [ -z "${HARNESS_USER_JWT:-}" ] && [ "$DRY_RUN" -eq 0 ]; then
  echo "::error::HARNESS_USER_JWT must be set (admin JWT or TEST_HARNESS_API_KEY)" >&2
  exit 2
fi

BODY=$(cat <<EOF
{"mode":"${MODE}","includeFlows":${INCLUDE_FLOWS},"includeMcpTools":${INCLUDE_MCP},"includeT3":${INCLUDE_T3}}
EOF
)

CMD=(curl -sS -N -X POST
  -H "Authorization: Bearer ${HARNESS_USER_JWT:-PLACEHOLDER}"
  -H "Content-Type: application/json"
  -H "Accept: application/x-ndjson"
  --max-time 600
  -d "$BODY"
  "${API_BASE}/api/admin/test-harness/run-e2e")

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[e2e-int-test] DRY RUN — would execute:"
  printf '  %q ' "${CMD[@]}"
  echo
  echo "  | tee \"$OUT_FILE\""
  echo
  echo "[e2e-int-test] body=$BODY"
  exit 0
fi

echo "[e2e-int-test] hitting $API_BASE in mode=$MODE"
"${CMD[@]}" | tee "$OUT_FILE"
RC=${PIPESTATUS[0]}
if [ "$RC" -ne 0 ]; then
  echo "::error::curl exited $RC"
  exit "$RC"
fi

# Parse summary frame and gate the exit code.
SUMMARY_LINE=$(grep -E '"type":"summary"' "$OUT_FILE" | tail -1 || true)
if [ -z "$SUMMARY_LINE" ]; then
  echo "::error::No summary frame in NDJSON stream"
  tail -50 "$OUT_FILE"
  exit 1
fi

# Use jq when present (CI image bundles it); fall back to grep otherwise.
if command -v jq >/dev/null 2>&1; then
  PASSED=$(echo "$SUMMARY_LINE" | jq -r '.passed // 0')
  FAILED=$(echo "$SUMMARY_LINE" | jq -r '.failed // 0')
  TOTAL=$(echo "$SUMMARY_LINE" | jq -r '.total // 0')
  P50=$(echo "$SUMMARY_LINE" | jq -r '.durations.p50 // 0')
  P95=$(echo "$SUMMARY_LINE" | jq -r '.durations.p95 // 0')
else
  PASSED=$(echo "$SUMMARY_LINE" | grep -oE '"passed":[0-9]+' | grep -oE '[0-9]+' | head -1)
  FAILED=$(echo "$SUMMARY_LINE" | grep -oE '"failed":[0-9]+' | grep -oE '[0-9]+' | head -1)
  TOTAL=$(echo "$SUMMARY_LINE" | grep -oE '"total":[0-9]+' | grep -oE '[0-9]+' | head -1)
  P50=$(echo "$SUMMARY_LINE" | grep -oE '"p50":[0-9]+' | grep -oE '[0-9]+' | head -1)
  P95=$(echo "$SUMMARY_LINE" | grep -oE '"p95":[0-9]+' | grep -oE '[0-9]+' | head -1)
fi

echo "[e2e-int-test] passed=$PASSED failed=$FAILED total=$TOTAL p50=${P50}ms p95=${P95}ms"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## OpenAgentic E2E Integration Sweep"
    echo
    echo "| metric | value |"
    echo "|---|---|"
    echo "| mode | $MODE |"
    echo "| total | $TOTAL |"
    echo "| passed | $PASSED |"
    echo "| failed | $FAILED |"
    echo "| p50 duration | ${P50}ms |"
    echo "| p95 duration | ${P95}ms |"
  } >> "$GITHUB_STEP_SUMMARY"
fi

if [ "${FAILED:-1}" -gt 0 ] || [ "${PASSED:-0}" -eq 0 ]; then
  echo "::error::E2E sweep had $FAILED failures of $TOTAL"
  exit 1
fi

echo "[e2e-int-test] GREEN: $PASSED/$TOTAL"
exit 0
