#!/usr/bin/env bash
# venv-fast wrapper — same contract as npm-fast.sh but for python venvs.
#
# Why: the per-user /workspaces volume on geesefs/MinIO-CSI strips execute
# bits on writes. `python3 -m venv ./venv` creates `./venv/bin/python` etc;
# those binaries lose +x and `./venv/bin/uvicorn` errors with
# `Permission denied`. Same class of bug as npm-fast solves for esbuild.
#
# Contract:
#   - Located at /usr/local/bin/venv-fast in the openagentic-exec image
#   - Subcommand: `venv-fast create <dir>` — creates a venv at
#     /tmp/venv-staging/<projectHash>/<dir>, symlinks ./<dir> to it
#   - Pass-through: `venv-fast <subcommand> ...` falls through to plain
#     python3 -m venv (lets users opt out)
#   - Idempotent — re-running create on an existing venv reuses the
#     staging copy (does NOT recreate)
#   - Set OPENAGENTIC_VENV_FAST_DISABLED=1 to skip staging entirely
#
# This test runs the script in a fake workspace dir under /tmp and asserts
# the symlink + binary +x outcomes. No docker required — pure shell.

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(cd "${HERE}/.." && pwd)/venv-fast.sh"

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

assert_eq() {
  local actual="$1" expected="$2" msg="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ok: $msg"
  else
    echo "  FAIL: $msg — expected '$expected', got '$actual'"
    return 1
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" msg="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    echo "  ok: $msg"
  else
    echo "  FAIL: $msg — '$needle' not in '$haystack'"
    return 1
  fi
}

# Pre-flight: script must exist
if [ ! -f "$SCRIPT" ]; then
  echo "FAIL: venv-fast.sh not found at $SCRIPT"
  exit 1
fi
chmod +x "$SCRIPT"

# Fake workspace + isolated staging root for each test
TMP_ROOT="$(mktemp -d -t venv-fast-test.XXXXXX)"
trap "rm -rf '$TMP_ROOT'" EXIT

# Test 1: `create venv` makes a symlink to /tmp/venv-staging/<hash>/venv
case_1_creates_symlink() {
  local proj="$TMP_ROOT/case1"
  mkdir -p "$proj"
  cd "$proj"
  VENV_STAGING_DIR="$TMP_ROOT/case1-stage" "$SCRIPT" create venv >/dev/null 2>&1 || return 1
  [ -L "$proj/venv" ] || { echo "  FAIL: ./venv is not a symlink"; return 1; }
  local target
  target="$(readlink "$proj/venv")"
  assert_contains "$target" "$TMP_ROOT/case1-stage" "symlink target lives in staging dir"
}

# Test 2: the python interpreter in the venv has +x set
case_2_python_executable() {
  local proj="$TMP_ROOT/case2"
  mkdir -p "$proj"
  cd "$proj"
  VENV_STAGING_DIR="$TMP_ROOT/case2-stage" "$SCRIPT" create venv >/dev/null 2>&1 || return 1
  local py="$proj/venv/bin/python"
  [ -x "$py" ] || { echo "  FAIL: $py is not executable"; ls -l "$py" 2>&1 | sed 's/^/    /'; return 1; }
  # Sanity: the venv directory ITSELF is the symlink we control. Reading
  # only the FIRST hop ensures we land in staging — readlink -f would
  # follow venv/bin/python → /usr/bin/python3.x (the system interpreter
  # the venv was built from), which is not what we're asserting here.
  local first_hop
  first_hop="$(readlink "$proj/venv")"
  assert_contains "$first_hop" "$TMP_ROOT/case2-stage" "venv symlink hop lands in staging"
}

# Test 3: idempotent — re-running on the same dir reuses the existing venv
case_3_idempotent() {
  local proj="$TMP_ROOT/case3"
  mkdir -p "$proj"
  cd "$proj"
  VENV_STAGING_DIR="$TMP_ROOT/case3-stage" "$SCRIPT" create venv >/dev/null 2>&1 || return 1
  # Touch a marker file inside the venv staging dir
  local marker="$(readlink "$proj/venv")/MARKER"
  echo "first-run" > "$marker"
  # Re-run create — marker should still be there
  VENV_STAGING_DIR="$TMP_ROOT/case3-stage" "$SCRIPT" create venv >/dev/null 2>&1 || return 1
  local content
  content="$(cat "$marker" 2>/dev/null || echo MISSING)"
  assert_eq "$content" "first-run" "second create call did not blow away existing venv"
}

# Test 4: OPENAGENTIC_VENV_FAST_DISABLED=1 falls back to plain python3 -m venv (no symlink)
case_4_disabled_passthrough() {
  local proj="$TMP_ROOT/case4"
  mkdir -p "$proj"
  cd "$proj"
  OPENAGENTIC_VENV_FAST_DISABLED=1 VENV_STAGING_DIR="$TMP_ROOT/case4-stage" "$SCRIPT" create venv >/dev/null 2>&1 || return 1
  if [ -L "$proj/venv" ]; then
    echo "  FAIL: ./venv should NOT be a symlink when disabled"
    return 1
  fi
  [ -d "$proj/venv" ] && [ -x "$proj/venv/bin/python" ] || { echo "  FAIL: real venv not created in passthrough mode"; return 1; }
  echo "  ok: passthrough creates a real (non-staged) venv"
}

# Test 5: project hash is stable for the same cwd (so re-runs hit the same staging dir)
case_5_stable_hash() {
  local proj="$TMP_ROOT/case5"
  mkdir -p "$proj"
  cd "$proj"
  VENV_STAGING_DIR="$TMP_ROOT/case5-stage" "$SCRIPT" create venv >/dev/null 2>&1 || return 1
  local first_target second_target
  first_target="$(readlink "$proj/venv")"
  rm "$proj/venv"
  VENV_STAGING_DIR="$TMP_ROOT/case5-stage" "$SCRIPT" create venv >/dev/null 2>&1 || return 1
  second_target="$(readlink "$proj/venv")"
  assert_eq "$first_target" "$second_target" "second invocation resolves to same staging dir"
}

run_case "1. create symlinks ./venv → staging" case_1_creates_symlink
run_case "2. ./venv/bin/python is executable" case_2_python_executable
run_case "3. idempotent: re-run does not destroy existing venv" case_3_idempotent
run_case "4. OPENAGENTIC_VENV_FAST_DISABLED=1 falls through to real python3 -m venv" case_4_disabled_passthrough
run_case "5. project hash is stable across invocations" case_5_stable_hash

echo
echo "venv-fast: $((TOTAL - FAILS))/$TOTAL passing"
[ "$FAILS" -eq 0 ]
