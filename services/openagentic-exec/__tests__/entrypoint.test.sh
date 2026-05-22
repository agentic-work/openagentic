#!/usr/bin/env bash
# Task 6 (CSI-S3 rollout) shell test harness for docker-entrypoint.sh.
#
# Drives the real entrypoint with a PATH that stubs:
#   - `node`     — exits 0 or 1 based on STUB_NODE_EXIT
#   - `dumb-init`— prints "dumb-init called" then exits 0
#   - `mountpoint`,`chmod`,`mkdir`,`df`,`nohup` — minimal stubs as needed
#
# Bats is not installed in this repo, so this is plain bash with a simple
# pass/fail contract: exit 0 = all cases pass, exit 1 = at least one case failed.

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="$(cd "${HERE}/.." && pwd)/docker-entrypoint.sh"

if [ ! -f "$ENTRYPOINT" ]; then
  echo "FAIL: entrypoint not found at $ENTRYPOINT"
  exit 1
fi

FAILS=0
TOTAL=0

assert_contains() {
  local haystack="$1" needle="$2" msg="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    echo "  ok: $msg"
  else
    echo "  FAIL: $msg"
    echo "  expected to find: $needle"
    echo "  output was:"
    echo "$haystack" | sed 's/^/    /'
    FAILS=$((FAILS + 1))
  fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" msg="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    echo "  FAIL: $msg"
    echo "  unexpected to find: $needle"
    echo "  output was:"
    echo "$haystack" | sed 's/^/    /'
    FAILS=$((FAILS + 1))
  else
    echo "  ok: $msg"
  fi
}

setup_stub_dir() {
  local stub_dir="$1"
  local node_exit="$2"
  local node_msg="$3"
  mkdir -p "$stub_dir"

  # node stub
  cat > "$stub_dir/node" <<EOF
#!/usr/bin/env bash
echo "${node_msg}"
exit ${node_exit}
EOF

  # dumb-init stub
  cat > "$stub_dir/dumb-init" <<'EOF'
#!/usr/bin/env bash
echo "dumb-init called"
exit 0
EOF

  # mountpoint stub: always "not a mountpoint" (exit 1)
  cat > "$stub_dir/mountpoint" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  # df stub: benign
  cat > "$stub_dir/df" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  # mkdir / chmod stubs: don't actually touch /workspaces on the host.
  cat > "$stub_dir/mkdir" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cat > "$stub_dir/chmod" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  # nohup stub: don't actually background anything
  cat > "$stub_dir/nohup" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  # openagentic stub — in case `exec dumb-init openagentic ...` reaches past dumb-init stub
  cat > "$stub_dir/openagentic" <<'EOF'
#!/usr/bin/env bash
echo "openagentic called"
exit 0
EOF

  chmod +x "$stub_dir"/*
}

run_entrypoint() {
  local stub_dir="$1"; shift
  local -a extra_env=("$@")
  # Run in a subshell with a tightly scoped PATH so we don't leak env.
  env -i PATH="$stub_dir:/usr/bin:/bin" \
      HOME=/tmp \
      OPENAGENTIC_SESSION_ID="test-session-xyz" \
      "${extra_env[@]}" \
      bash "$ENTRYPOINT" 2>&1
  return $?
}

echo "== Case 1: USER_WORKSPACE_PATH unset => warning logged, proceeds to exec dumb-init =="
TOTAL=$((TOTAL + 1))
STUB_DIR="$(mktemp -d)"
# Node stub emits the USER_WORKSPACE_PATH warning string (simulates the real
# verifier's warn-on-missing-env branch).
setup_stub_dir "$STUB_DIR" 0 "[mount-verify] WARNING: USER_WORKSPACE_PATH not set"
# Intentionally pass an env that does NOT set USER_WORKSPACE_PATH.
OUT="$(run_entrypoint "$STUB_DIR")"
RC=$?
assert_contains "$OUT" "USER_WORKSPACE_PATH" "warning mentions USER_WORKSPACE_PATH"
assert_contains "$OUT" "dumb-init called" "proceeds to dumb-init"
rm -rf "$STUB_DIR"

echo ""
echo "== Case 2: USER_WORKSPACE_PATH set + verify exits 0 => proceeds to exec dumb-init =="
TOTAL=$((TOTAL + 1))
STUB_DIR="$(mktemp -d)"
setup_stub_dir "$STUB_DIR" 0 "probe ok"
OUT="$(run_entrypoint "$STUB_DIR" USER_WORKSPACE_PATH=/workspaces/user-123)"
RC=$?
assert_contains "$OUT" "probe ok" "verifier stdout reached"
assert_contains "$OUT" "dumb-init called" "proceeds to dumb-init"
rm -rf "$STUB_DIR"

echo ""
echo "== Case 3: USER_WORKSPACE_PATH set + verify exits 1 => shell exits !=0, dumb-init NOT called =="
TOTAL=$((TOTAL + 1))
STUB_DIR="$(mktemp -d)"
setup_stub_dir "$STUB_DIR" 1 "probe failed"
OUT="$(run_entrypoint "$STUB_DIR" USER_WORKSPACE_PATH=/workspaces/user-123)"
RC=$?
assert_contains "$OUT" "probe failed" "verifier stdout reached"
assert_not_contains "$OUT" "dumb-init called" "dumb-init NOT called when verify fails"
if [ "$RC" = "0" ]; then
  echo "  FAIL: shell exited 0 but verify failed"
  FAILS=$((FAILS + 1))
else
  echo "  ok: shell exit=$RC (non-zero)"
fi
rm -rf "$STUB_DIR"

echo ""
echo "== Summary =="
echo "Total cases: $TOTAL  Failed assertions: $FAILS"
if [ "$FAILS" -eq 0 ]; then
  echo "PASS"
  exit 0
fi
echo "FAIL"
exit 1
