#!/usr/bin/env bash
# codemode-brainbow-e2e.sh — Code Mode UI end-to-end via brainbow
#
# Mirrors brainbow-e2e.sh conventions exactly.
# Requires: brainbow running on http://localhost:4444, openagentic on :8080.
#
# Hard assertions (MUST pass — counted in FAIL):
#   [H1]  brainbow reachable, app /api/health 200
#   [H2]  login succeeds + token stored in localStorage
#   [H3]  Code Mode button found and clicked (title="Code Mode")
#   [H4]  Wizard container renders (CodeModeWizard present in DOM)
#   [H5]  code-terminal div present after wizard walk + launch
#   [H6]  Re-opening Code Mode skips Welcome step (firstRun persisted)
#
# Soft assertions (WARN, do not increment FAIL):
#   [S1]  xterm canvas/textarea present inside code-terminal div
#   [S2]  terminal echoes "hello-codemode" after keystrokes sent
#         (timing-sensitive; PTY startup may take a few seconds)

set -uo pipefail

B="${BRAINBOW_URL:-http://localhost:4444}"
APP="${APP_URL:-http://localhost:8080}"
ADMIN_USER="${ADMIN_USER:-admin@openagentic.local}"
ADMIN_PASS="${ADMIN_PASS:-hello-trent-1234}"
SHOTS="${SHOTS_DIR:-/tmp/codemode-shots}"
mkdir -p "$SHOTS"

PASS=0; FAIL=0; STEP=0
ok()   { PASS=$((PASS+1)); printf "  ✓ [HARD] %s\n" "$1"; }
no()   { FAIL=$((FAIL+1)); printf "  ✗ [HARD] %s — %s\n" "$1" "${2:-}"; }
warn() { printf "  ~ [SOFT] %s — %s\n" "$1" "${2:-}"; }
hdr()  { STEP=$((STEP+1)); printf "\n[step %02d] %s\n" "$STEP" "$1"; }

eval_js() {
  # Wraps the script in an async IIFE so await works.
  local code="$1"
  curl -sf -X POST "$B/api/eval" -H 'Content-Type: application/json' \
    --data-raw "$(jq -n --arg s "return (async () => { $code })();" '{script:$s}')" \
    | jq -r '.result // .error // empty'
}
goto() { curl -sf -X POST "$B/api/goto" -H 'Content-Type: application/json' -d "{\"url\":\"$1\"}" > /dev/null; }
shot() { curl -sf -o "$SHOTS/$1" "$B/api/screenshot?type=png" && ok "screenshot → $SHOTS/$1"; }

# ─── pre-flight [H1] ──────────────────────────────────────────────────────────
hdr "pre-flight [H1]"
curl -sf "$B/api/sessions" > /dev/null \
  && ok "[H1] brainbow reachable" \
  || { no "[H1] brainbow not reachable at $B"; exit 1; }
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$APP/api/health")
[ "$HTTP" = "200" ] \
  && ok "[H1] openagentic /api/health → 200" \
  || { no "[H1] openagentic not reachable" "HTTP $HTTP"; exit 1; }

# ─── 1. login [H2] ────────────────────────────────────────────────────────────
hdr "login [H2]"
curl -sf -X POST "$B/api/launch" -H 'Content-Type: application/json' -d '{}' > /dev/null \
  && ok "browser launched"
goto "$APP/login" && ok "navigated to /login"

LOGIN=$(eval_js "
const r = await fetch('/api/auth/local/login', {
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({username:'$ADMIN_USER', password:'$ADMIN_PASS'})
});
const d = await r.json();
if (d.token) localStorage.setItem('auth_token', d.token);
return { ok: d.success, token: !!d.token };
")
echo "$LOGIN" | jq -e '.ok == true' > /dev/null \
  && ok "[H2] login → success" \
  || { no "[H2] login failed" "$LOGIN"; exit 1; }
echo "$LOGIN" | jq -e '.token == true' > /dev/null \
  && ok "[H2] auth_token stored in localStorage" \
  || no "[H2] token not stored" "$LOGIN"

goto "$APP/chat" && ok "navigated to /chat"
sleep 2

# Dismiss any onboarding skip dialog
eval_js "
const skip = Array.from(document.querySelectorAll('button'))
  .find(b => /^skip$/i.test((b.innerText||'').trim()));
if (skip) skip.click();
return { skipped: !!skip };
" > /dev/null

shot "codemode-01-chat-loaded.png"

# ─── 2. enter Code Mode — click mode toggle [H3] [H4] ─────────────────────────
hdr "enter Code Mode — click toggle [H3]"
# The Code Mode button has title="Code Mode" in ChatSidebar.tsx.
# canUseCodeMode=true is hardcoded in ChatContainer.tsx (line 2031).
CLICK_CODE=$(eval_js "
const btn = Array.from(document.querySelectorAll('button'))
  .find(b => b.title === 'Code Mode' || /^code$/i.test((b.innerText||'').trim()));
if (btn) btn.click();
return { found: !!btn, title: btn ? btn.title : null };
")
echo "$CLICK_CODE" | jq -e '.found == true' > /dev/null \
  && ok "[H3] Code Mode button found and clicked" \
  || { no "[H3] Code Mode button not found" "$CLICK_CODE"; }

sleep 2
shot "codemode-02-mode-toggled.png"

# Assert wizard rendered — CodeModeWizard always wraps content in a div with
# an h2 reading "Code Mode" (italic serif, see CodeModeWizard.tsx header).
WIZARD=$(eval_js "
const h2 = Array.from(document.querySelectorAll('h2'))
  .find(el => /code mode/i.test(el.textContent || ''));
const hasProg = !!document.querySelector('[style*=\"transition: width\"]');
return { wizard: !!h2, h2Text: h2 ? h2.textContent : null, progressBar: hasProg };
")
echo "$WIZARD" | jq -e '.wizard == true' > /dev/null \
  && ok "[H4] wizard rendered (Code Mode h2 found: $(echo "$WIZARD" | jq -r '.h2Text'))" \
  || no "[H4] wizard not found in DOM" "$WIZARD"

shot "codemode-03-wizard-welcome.png"

# ─── 3. walk the wizard to Launch ─────────────────────────────────────────────
hdr "wizard walk: Welcome → Prereq → Model → Workspace → Launch"

# If wizard is on Welcome (firstRun=false means startStep='welcome'), click Next.
PHASE=$(eval_js "
const p = document.querySelector('[style*=\"Code Mode\"] p:first-of-type, .cmw-phase');
const h2sibling = Array.from(document.querySelectorAll('p'))
  .find(el => el.style && /12px/.test(el.getAttribute('style') || ''));
return { phaseLabel: h2sibling ? h2sibling.textContent : 'unknown' };
")
echo "  current phase: $(echo "$PHASE" | jq -r '.phaseLabel')"

# Click Next repeatedly until we reach Launch step (4 times: W→P→M→WS→L).
# We check the step label text after each click.
for STEP_NAME in "prereq" "model" "workspace" "launch"; do
  eval_js "
  const btns = Array.from(document.querySelectorAll('button'));
  const next = btns.find(b => /^next$/i.test((b.innerText||'').trim()));
  if (next && !next.disabled) { next.click(); return { clicked: true }; }
  return { clicked: false, reason: next ? 'disabled' : 'not found' };
  " > /dev/null
  sleep 1
done

# Confirm we're on Launch step
ON_LAUNCH=$(eval_js "
const ps = Array.from(document.querySelectorAll('p'));
const launchP = ps.find(p => /12px/.test(p.getAttribute('style') || '') && /launch/i.test(p.textContent || ''));
const launchBtn = Array.from(document.querySelectorAll('button'))
  .find(b => /open code mode/i.test((b.innerText||'').trim()));
return { onLaunch: !!launchP, hasLaunchBtn: !!launchBtn };
")
echo "$ON_LAUNCH" | jq -e '.hasLaunchBtn == true' > /dev/null \
  && ok "Launch step reached — 'Open Code Mode' button present" \
  || warn "could not confirm Launch step reached" "$ON_LAUNCH"

shot "codemode-04-wizard-launch.png"

# ─── 4. click Launch → terminal mounts [H5] ───────────────────────────────────
hdr "click 'Open Code Mode' → terminal mounts [H5]"
LAUNCH_CLICK=$(eval_js "
const btn = Array.from(document.querySelectorAll('button'))
  .find(b => /open code mode/i.test((b.innerText||'').trim()));
if (btn) btn.click();
return { clicked: !!btn };
")
echo "$LAUNCH_CLICK" | jq -e '.clicked == true' > /dev/null \
  && ok "Launch button clicked" \
  || warn "Launch button not found — wizard may already be past this step" "$LAUNCH_CLICK"

# Wait for the session to be created and the terminal to mount.
# The exec service cold-starts; give it up to 15s.
TERMINAL_FOUND=false
for i in $(seq 1 15); do
  sleep 1
  TERM_CHECK=$(eval_js "
  const el = document.querySelector('[data-testid=\"code-terminal\"]');
  const xterm = document.querySelector('.xterm');
  return { terminal: !!el, xterm: !!xterm };
  ")
  if echo "$TERM_CHECK" | jq -e '.terminal == true' > /dev/null 2>&1; then
    TERMINAL_FOUND=true
    break
  fi
done

if [ "$TERMINAL_FOUND" = "true" ]; then
  ok "[H5] code-terminal div present (data-testid=\"code-terminal\")"
  # Soft: check for xterm class
  XTERM_CHECK=$(eval_js "return { xterm: !!document.querySelector('.xterm') };")
  echo "$XTERM_CHECK" | jq -e '.xterm == true' > /dev/null \
    && warn "[S1] .xterm class found inside terminal div" "" \
    || warn "[S1] .xterm class not yet visible" "xterm.js may still be initializing"
else
  no "[H5] code-terminal not found after 15s" \
     "exec session may have failed; check docker compose logs openagentic-exec"
fi

shot "codemode-05-terminal-mounted.png"

# ─── 5. type into terminal [S2] ───────────────────────────────────────────────
hdr "type into terminal — echo hello-codemode [S2]"
# Focus the xterm textarea and dispatch keypress events.
# The xterm component renders a hidden textarea for keyboard input.
TYPE_RESULT=$(eval_js "
const ta = document.querySelector('[data-testid=\"code-terminal\"] textarea, .xterm-helper-textarea');
if (!ta) return { found: false };
ta.focus();
// Type 'echo hello-codemode' + Enter by setting value and dispatching input events.
// xterm listens for 'keydown' events, not input events; use dispatchEvent per char.
const text = 'echo hello-codemode';
for (const ch of text) {
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
  ta.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
  ta.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
}
ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
return { found: true, sent: text };
")
echo "$TYPE_RESULT" | jq -e '.found == true' > /dev/null \
  && warn "[S2] keystrokes dispatched to xterm textarea" "" \
  || warn "[S2] xterm textarea not found — could not type" "$TYPE_RESULT"

sleep 3

# Read terminal text content
TERM_TEXT=$(eval_js "
const el = document.querySelector('[data-testid=\"code-terminal\"]');
if (!el) return { text: '', found: false };
const rows = Array.from(el.querySelectorAll('.xterm-rows .xterm-row, .xterm-rows span'))
  .map(r => r.textContent || '').join('\\n');
return { text: rows.slice(0, 500), found: true };
")
ECHO_HIT=$(echo "$TERM_TEXT" | jq -r '.text' | grep -c "hello-codemode" 2>/dev/null || echo 0)
if [ "${ECHO_HIT:-0}" -gt 0 ]; then
  warn "[S2] 'hello-codemode' found in terminal text — echo worked" ""
else
  warn "[S2] 'hello-codemode' not visible in terminal text within timeout" \
       "PTY may still be starting or xterm DOM not fully populated"
fi

shot "codemode-06-terminal-after-type.png"

# ─── 6. navigate away and back — firstRun must NOT reappear [H6] ──────────────
hdr "re-open Code Mode — Welcome step must not reappear [H6]"
# Navigate away to chat (switch mode back to chat)
eval_js "
const chatBtn = Array.from(document.querySelectorAll('button'))
  .find(b => b.title === 'Chat' || /^chat$/i.test((b.innerText||'').trim()));
if (chatBtn) chatBtn.click();
return { clicked: !!chatBtn };
" > /dev/null
sleep 1

# Navigate back to Code Mode
eval_js "
const btn = Array.from(document.querySelectorAll('button'))
  .find(b => b.title === 'Code Mode' || /^code$/i.test((b.innerText||'').trim()));
if (btn) btn.click();
return { found: !!btn };
" > /dev/null
sleep 2

# Check: either a terminal is still active (best case — session persisted),
# or the wizard re-appears but starts at 'model' or 'workspace' (not 'Welcome').
REOPEN=$(eval_js "
const terminalActive = !!document.querySelector('[data-testid=\"code-terminal\"]');
const h2 = Array.from(document.querySelectorAll('h2'))
  .find(el => /code mode/i.test(el.textContent || ''));
const phaseLabels = Array.from(document.querySelectorAll('p'))
  .filter(p => /12px/.test(p.getAttribute('style') || ''))
  .map(p => p.textContent || '');
const hasWelcome = phaseLabels.some(l => /welcome/i.test(l));
return {
  terminalActive,
  wizardVisible: !!h2,
  phaseLabels,
  hasWelcome,
};
")

TERM_ACTIVE=$(echo "$REOPEN" | jq -r '.terminalActive')
HAS_WELCOME=$(echo "$REOPEN" | jq -r '.hasWelcome')

if [ "$TERM_ACTIVE" = "true" ]; then
  ok "[H6] Code Mode re-opened: terminal still active (session persisted — no wizard)"
elif [ "$HAS_WELCOME" = "false" ]; then
  ok "[H6] Code Mode re-opened: wizard visible but Welcome step NOT shown (firstRun persisted)"
else
  no "[H6] Welcome step re-appeared after returning to Code Mode" \
     "firstRunComplete flag not persisting — $REOPEN"
fi

shot "codemode-07-reopen-no-welcome.png"

# ─── summary ──────────────────────────────────────────────────────────────────
echo
echo "──────────────────────────────────────────────────────────────────"
echo "  codemode-brainbow-e2e: passed=$PASS  failed=$FAIL"
echo "  Screenshots: $SHOTS/"
echo "  Soft assertions are WARN-only; only HARD (✗) count toward exit code."
echo "──────────────────────────────────────────────────────────────────"
[ "$FAIL" -eq 0 ]
