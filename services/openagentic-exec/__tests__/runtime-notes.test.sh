#!/usr/bin/env bash
# Runtime-notes lesson-persistence test.
#
# Why: the agent re-discovers known geesefs/npm/venv gotchas in every
# session because nothing in its boot context tells it about them.
# `runtime-notes.md` is a tiny markdown crib sheet shipped IN THE IMAGE
# at /etc/openagentic/runtime-notes.md so the entrypoint can export
# OPENAGENTIC_RUNTIME_NOTES — a future system-prompt hook can append it.
#
# This test only covers the static parts:
#   - file is present at the canonical path
#   - it mentions the known gotchas (npm-fast / venv-fast / Node version)
#
# We don't yet test the system-prompt injection — that lives in the
# remoteSessionDaemon and gets its own integration test once wired.

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTES="$(cd "${HERE}/.." && pwd)/runtime-notes.md"
DOCKERFILE="$(cd "${HERE}/.." && pwd)/Dockerfile"

FAILS=0
TOTAL=0

run_case() {
  local name="$1"
  shift
  TOTAL=$((TOTAL + 1))
  echo "▸ $name"
  if "$@"; then
    echo "  ok"
  else
    echo "  FAIL"
    FAILS=$((FAILS + 1))
  fi
}

assert_file_exists() {
  if [ -f "$1" ]; then
    echo "  ok: $1 exists"
  else
    echo "  FAIL: $1 missing"
    return 1
  fi
}

assert_contains_phrase() {
  local file="$1" phrase="$2"
  if grep -qF "$phrase" "$file"; then
    echo "  ok: contains '$phrase'"
  else
    echo "  FAIL: missing phrase '$phrase'"
    return 1
  fi
}

case_1_file_present() {
  assert_file_exists "$NOTES"
}

case_2_mentions_npm_fast() {
  assert_file_exists "$NOTES" || return 1
  assert_contains_phrase "$NOTES" "npm-fast"
}

case_3_mentions_venv_fast() {
  assert_file_exists "$NOTES" || return 1
  assert_contains_phrase "$NOTES" "venv-fast"
}

case_4_mentions_node_version() {
  assert_file_exists "$NOTES" || return 1
  # Either explicit "Node 20" advice or "astro@5" pinning is acceptable —
  # both communicate the same constraint.
  if grep -qE "Node 20|astro@5|astro 5" "$NOTES"; then
    echo "  ok: notes pin a working Astro / Node combo"
  else
    echo "  FAIL: notes don't mention the Node 20 / Astro 5 constraint"
    return 1
  fi
}

case_5_dockerfile_copies_notes() {
  assert_file_exists "$DOCKERFILE" || return 1
  if grep -qE "COPY .*runtime-notes\\.md" "$DOCKERFILE"; then
    echo "  ok: Dockerfile COPY references runtime-notes.md"
  else
    echo "  FAIL: Dockerfile does not COPY runtime-notes.md into the image"
    return 1
  fi
}

case_6_entrypoint_exports_path() {
  local entry="$(cd "${HERE}/.." && pwd)/docker-entrypoint.sh"
  assert_file_exists "$entry" || return 1
  if grep -qE "OPENAGENTIC_RUNTIME_NOTES" "$entry"; then
    echo "  ok: entrypoint exports OPENAGENTIC_RUNTIME_NOTES"
  else
    echo "  FAIL: entrypoint does not export OPENAGENTIC_RUNTIME_NOTES"
    return 1
  fi
}

run_case "1. runtime-notes.md exists in the source tree" case_1_file_present
run_case "2. mentions npm-fast wrapper" case_2_mentions_npm_fast
run_case "3. mentions venv-fast wrapper" case_3_mentions_venv_fast
run_case "4. mentions Node 20 / Astro 5 constraint" case_4_mentions_node_version
run_case "5. Dockerfile COPYs notes into image" case_5_dockerfile_copies_notes
run_case "6. docker-entrypoint.sh exports OPENAGENTIC_RUNTIME_NOTES" case_6_entrypoint_exports_path

echo
echo "runtime-notes: $((TOTAL - FAILS))/$TOTAL passing"
[ "$FAILS" -eq 0 ]
