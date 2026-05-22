#!/usr/bin/env bash
# pre-commit hook: run architecture source-regression tests
#
# Gates commits on the fast architecture invariant suite
# (src/__tests__/architecture/). Catches re-introduction of the
# module-state, orphan-route, and type-safety violations locked in
# across Phases 0-5 and Waves A-C.
#
# Setup (opt-in):
#   git config core.hooksPath scripts/
#   chmod +x scripts/pre-commit.sh
#
# Skip for non-applicable situations:
#   SKIP_ARCH_TESTS=1 git commit ...

set -euo pipefail

ARCH_DIR="services/openagentic-api/src/__tests__/architecture"

# Allow opt-out for emergency situations
if [ "${SKIP_ARCH_TESTS:-0}" = "1" ]; then
  echo "[pre-commit] SKIP_ARCH_TESTS=1 — skipping architecture regression tests"
  exit 0
fi

# Verify the test directory exists
if [ ! -d "${ARCH_DIR}" ]; then
  echo "[pre-commit] Architecture test directory not found: ${ARCH_DIR} — skipping"
  exit 0
fi

echo "[pre-commit] Running architecture source-regression tests..."
echo "[pre-commit] (set SKIP_ARCH_TESTS=1 to bypass in emergencies)"

REPO_ROOT="$(pwd)"

cd services/openagentic-api

if bun test src/__tests__/architecture/ --bail 2>&1 | tail -5; then
  echo "[pre-commit] Architecture tests PASSED"
else
  echo ""
  echo "[pre-commit] FAILED: architecture source-regression tests detected a violation."
  echo "[pre-commit] Run: cd services/openagentic-api && bun test src/__tests__/architecture/"
  echo "[pre-commit] Fix the violation, then re-commit."
  echo "[pre-commit] (set SKIP_ARCH_TESTS=1 to bypass in genuine emergencies)"
  exit 1
fi

cd "${REPO_ROOT}"

# Gitleaks scan on the staged diff — catches secrets BEFORE they reach
# the wire. CI also runs gitleaks (`.github/workflows/gitleaks.yml`) but
# direct push to main bypasses PR-diff scan; this hook closes that gap.
# Local-only scan: only the files staged for THIS commit, not full
# working tree (the audit found 257 historical hits — those are tracked
# separately in audit-fix-plan §B1 for rotation + filter-repo).
#
# Bypass with: SKIP_GITLEAKS=1 (use only for emergencies, e.g. when the
# scanner's regex misfires on a known-safe value).
if [ "${SKIP_GITLEAKS:-0}" != "1" ] && command -v gitleaks >/dev/null 2>&1; then
  STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)
  if [ -n "${STAGED_FILES}" ]; then
    echo "[pre-commit] Running gitleaks on staged diff..."
    # --staged scans the index (only files about to be committed)
    # --redact masks any matched values in the report
    # --exit-code 1 fails the commit on any hit
    if gitleaks protect --staged --redact --exit-code 1 --no-banner 2>&1 | tail -20; then
      echo "[pre-commit] gitleaks PASSED"
    else
      echo ""
      echo "[pre-commit] FAILED: gitleaks detected secrets in the staged diff."
      echo "[pre-commit] Either remove the secret values, or — if the match"
      echo "[pre-commit] is a genuine false-positive — add a baseline entry"
      echo "[pre-commit] under .gitleaks.toml. Last resort: SKIP_GITLEAKS=1 git commit"
      exit 1
    fi
  fi
elif [ "${SKIP_GITLEAKS:-0}" != "1" ]; then
  echo "[pre-commit] WARN: gitleaks not on PATH — install it for local pre-commit secret scanning."
  echo "[pre-commit]       (CI gate at .github/workflows/gitleaks.yml still applies)"
fi

# Helm-template smoke check — if the helm chart repo is staged, render
# it once locally to catch yaml errors / missing values / template
# typos before they ship. Skips when no chart files are staged.
HELM_REPO="${HOME}/openagentic-helm"
if command -v helm >/dev/null 2>&1 && [ -d "${HELM_REPO}" ]; then
  STAGED_CHART_FILES=$(git diff --cached --name-only -- 'helm/*' 'charts/*' 2>/dev/null || true)
  CHART_DIRTY=$( cd "${HELM_REPO}" && git diff --quiet 2>/dev/null; echo $? )
  # Always run the smoke when chart repo has any local changes — catches
  # bad templates regardless of which repo's commit triggered the hook.
  if [ -n "${STAGED_CHART_FILES}" ] || [ "${CHART_DIRTY}" = "1" ]; then
    echo "[pre-commit] Rendering helm chart for smoke check..."
    if ( cd "${HELM_REPO}" && helm template smoke . \
            -f values-k3s-local.yaml -f values-local-registry.yaml \
            > /dev/null 2>/tmp/openagentic-helm-smoke.err ); then
      echo "[pre-commit] Helm template render PASSED"
    else
      echo ""
      echo "[pre-commit] FAILED: helm template render error:"
      cat /tmp/openagentic-helm-smoke.err >&2 || true
      echo "[pre-commit] (set SKIP_ARCH_TESTS=1 to bypass in emergencies)"
      exit 1
    fi
  fi
fi

exit 0
