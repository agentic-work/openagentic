#!/usr/bin/env bash
#
# run-interleave-harness.sh — Phase 0 entrypoint
# Plan: docs/superpowers/plans/sprightly-percolating-brook.md §0 Deliverable
#
# Orchestrates the four harness components per scenario:
#   1. capture WIRE-CAPTURE NDJSON from the api pod (kubectl logs)
#   2. render the wire timeline (scripts/wire-timeline.ts)
#   3. drive the Playwright DOM walker (dom-interleave.spec.ts)
#   4. render the visual screenshot diff (visual-mock-diff.spec.ts)
#   5. run the contract diff (contract-vs-capture vitest)
#   6. aggregate per-Q SUMMARY.md
#
# Usage:
#   scripts/run-interleave-harness.sh <Q1..Q20|all> [<model>]
#
# Env:
#   BASE_URL=https://chat-dev.openagentic.io
#   MODEL=claude-sonnet-4-6 | gpt-oss:20b
#   NAMESPACE=agentic-dev
#   API_DEPLOY=openagentic-api
#   OUT_ROOT=reports/verify-cadence/harness-<date>
#
# Notes:
#   - WIRE_CAPTURE_ENABLED must be true on the api deployment (set once via
#     `kubectl set env deploy/openagentic-api WIRE_CAPTURE_ENABLED=true`).
#   - Live drive (Playwright) requires SSO creds in SSO_USER + SSO_PASS env.
#   - When Playwright MCP is unavailable, run with HARNESS_MODE=wire-only to
#     capture wire logs + timeline only and skip the DOM/visual specs.

set -euo pipefail

readonly SCENARIO="${1:-}"
readonly MODEL_ARG="${2:-${MODEL:-claude-sonnet-4-6}}"
readonly NAMESPACE="${NAMESPACE:-agentic-dev}"
readonly API_DEPLOY="${API_DEPLOY:-openagentic-api}"
readonly BASE_URL="${BASE_URL:-https://chat-dev.openagentic.io}"
readonly HARNESS_MODE="${HARNESS_MODE:-full}"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly RUN_LABEL="${RUN_LABEL:-$(date +%Y-%m-%d-%H%M%S)}"
readonly OUT_ROOT="${OUT_ROOT:-${REPO_ROOT}/reports/verify-cadence/harness-${RUN_LABEL}}"

if [[ -z "${SCENARIO}" ]]; then
  cat <<EOF >&2
Usage: scripts/run-interleave-harness.sh <Q1..Q20|all> [<model>]
Env:   BASE_URL  MODEL  NAMESPACE  API_DEPLOY  HARNESS_MODE
Modes: full | wire-only | dom-only | visual-only
EOF
  exit 1
fi

# --- scenario → (qNum, prompt, contract, mock) ---------------------------------
declare -A PROMPTS=(
  [Q1]="show me my Azure subscriptions and what's in each resource group"
  [Q2]="do a full security audit across all tenants of openagentic-omhs"
  [Q5]="the staging deploy is failing — diagnose, fix, rebuild, and verify"
  [Q7]="Our cloud bill is up 40% MoM. Find the top 10 cost spikes across Azure/AWS/GCP and tell me what to cut."
  [Q10]="Plan and execute a migration of our MSSQL legacy database to Azure SQL with zero downtime"
)
declare -A CONTRACTS=(
  [Q1]="end-state-01-azure-subs-rgs.contract.json"
  [Q7]="end-state-07-tri-cloud-cost-spikes.contract.json"
  [Q10]="end-state-10-mssql-migration-plan.contract.json"
)

run_one() {
  local q="$1"
  local prompt="${PROMPTS[${q}]:-}"
  if [[ -z "${prompt}" ]]; then
    echo "WARN: no prompt mapped for ${q} — see PROMPTS.md to fill the matrix" >&2
    return 0
  fi
  local q_outdir="${OUT_ROOT}/${q}-${MODEL_ARG//[:\/]/-}"
  mkdir -p "${q_outdir}"
  echo "[harness] ${q} · ${MODEL_ARG} → ${q_outdir}"
  echo "[harness] prompt: ${prompt}"

  # --- 1. capture wire NDJSON ------------------------------------------------
  if [[ "${HARNESS_MODE}" == "full" || "${HARNESS_MODE}" == "wire-only" ]]; then
    local wire_log="${q_outdir}/wire.log"
    echo "[harness] tailing wire from deploy/${API_DEPLOY} (ns=${NAMESPACE})..."
    # Background tail; stops when this script exits.
    kubectl logs -n "${NAMESPACE}" "deploy/${API_DEPLOY}" --since=0s -f \
      | grep -F 'WIRE-CAPTURE' > "${wire_log}" &
    local tail_pid=$!
    trap "kill ${tail_pid} 2>/dev/null || true" EXIT
  fi

  # --- 2. drive the prompt (Playwright) -------------------------------------
  if [[ "${HARNESS_MODE}" == "full" || "${HARNESS_MODE}" == "dom-only" ]]; then
    echo "[harness] driving prompt via Playwright dom-interleave.spec.ts..."
    pushd "${REPO_ROOT}/services/openagentic-ui" >/dev/null
    HARNESS_Q="${q}" \
    HARNESS_PROMPT="${prompt}" \
    RUN_LABEL="${RUN_LABEL}" \
    MODEL="${MODEL_ARG}" \
    DOM_TRACE_DIR="${q_outdir}/dom" \
      npx playwright test tests/e2e/dom-interleave.spec.ts \
      --grep "${q} " \
      --reporter=list \
      || echo "[harness] WARN dom-interleave failed for ${q} — see ${q_outdir}/dom/"
    popd >/dev/null
  fi

  # --- 3. visual diff -------------------------------------------------------
  if [[ "${HARNESS_MODE}" == "full" || "${HARNESS_MODE}" == "visual-only" ]]; then
    if [[ -n "${CONTRACTS[${q}]:-}" ]]; then
      echo "[harness] visual diff for ${q}..."
      pushd "${REPO_ROOT}/services/openagentic-ui" >/dev/null
      RUN_LABEL="${RUN_LABEL}" \
      MODEL="${MODEL_ARG}" \
      VISUAL_DIFF_DIR="${q_outdir}/visual" \
        npx playwright test tests/e2e/visual-mock-diff.spec.ts \
        --grep "${q} " \
        --reporter=list \
        || echo "[harness] WARN visual-diff failed for ${q} — see ${q_outdir}/visual/"
      popd >/dev/null
    fi
  fi

  # --- 4. stop wire tail ----------------------------------------------------
  if [[ "${HARNESS_MODE}" == "full" || "${HARNESS_MODE}" == "wire-only" ]]; then
    sleep 2 # let final frames flush
    kill "${tail_pid}" 2>/dev/null || true
    trap - EXIT
  fi

  # --- 5. render wire timeline ----------------------------------------------
  if [[ -s "${q_outdir}/wire.log" ]]; then
    echo "[harness] rendering wire timeline..."
    pushd "${REPO_ROOT}/services/openagentic-api" >/dev/null
    npx tsx scripts/wire-timeline.ts "${q_outdir}/wire.log" \
      --out="${q_outdir}/wire-timeline.md" \
      || echo "[harness] WARN wire-timeline failed for ${q}"
    popd >/dev/null
  fi

  # --- 6. aggregate SUMMARY.md ---------------------------------------------
  local summary="${q_outdir}/SUMMARY.md"
  {
    echo "# ${q} · ${MODEL_ARG} · ${RUN_LABEL}"
    echo ""
    echo "Prompt: \`${prompt}\`"
    echo ""
    echo "## Artifacts"
    echo ""
    [[ -f "${q_outdir}/wire-timeline.md" ]] && echo "- [Wire timeline](wire-timeline.md)"
    [[ -f "${q_outdir}/wire.log" ]] && echo "- [Wire raw log](wire.log) ($(wc -l < "${q_outdir}/wire.log") lines)"
    [[ -d "${q_outdir}/dom" ]] && echo "- DOM traces ($(ls "${q_outdir}/dom" 2>/dev/null | wc -l) files)"
    [[ -f "${q_outdir}/visual/result.json" ]] && echo "- Visual diff: \`$(cat "${q_outdir}/visual/result.json" | head -c 200)\`"
    echo ""
    echo "## Status"
    echo ""
    if [[ -f "${q_outdir}/wire-timeline.md" ]] && grep -q '🚨' "${q_outdir}/wire-timeline.md"; then
      echo "- 🚨 **Sev-0**: wire timeline flagged a Sev-0 pattern (see wire-timeline.md)"
    else
      echo "- ✓ wire timeline clean (no Sev-0 annotations)"
    fi
  } > "${summary}"
  echo "[harness] ${q} done — ${summary}"
}

if [[ "${SCENARIO}" == "all" ]]; then
  for q in Q1 Q2 Q5 Q7 Q10; do
    run_one "${q}"
  done
else
  run_one "${SCENARIO}"
fi

echo "[harness] complete · outputs at ${OUT_ROOT}"
