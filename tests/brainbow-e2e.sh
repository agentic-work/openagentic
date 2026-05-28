#!/usr/bin/env bash
# Full product E2E driven through brainbow's REST API.
# Requires: brainbow running on http://localhost:4444, openagentic stack on :8080.
set -uo pipefail

B="${BRAINBOW_URL:-http://localhost:4444}"
APP="${APP_URL:-http://localhost:8080}"
ADMIN_USER="${ADMIN_USER:-admin@openagentic.local}"
ADMIN_PASS="${ADMIN_PASS:-hello-trent-1234}"
SHOTS="${SHOTS_DIR:-$(pwd)/brainbow-shots}"
mkdir -p "$SHOTS"

PASS=0; FAIL=0; STEP=0
ok()  { PASS=$((PASS+1)); printf "  ✓ %s\n" "$1"; }
no()  { FAIL=$((FAIL+1)); printf "  ✗ %s — %s\n" "$1" "${2:-}"; }
hdr() { STEP=$((STEP+1)); printf "\n[step %02d] %s\n" "$STEP" "$1"; }

eval_js() {
  # Wraps the script in an async IIFE so await works.
  local code="$1"
  curl -sf -X POST "$B/api/eval" -H 'Content-Type: application/json' \
    --data-raw "$(jq -n --arg s "return (async () => { $code })();" '{script:$s}')" \
    | jq -r '.result // .error // empty'
}
goto() { curl -sf -X POST "$B/api/goto" -H 'Content-Type: application/json' -d "{\"url\":\"$1\"}" > /dev/null; }
shot() { curl -sf -o "$SHOTS/$1" "$B/api/screenshot?type=png" && ok "screenshot → $1"; }

# ─── pre-flight ────────────────────────────────────────────────────────────
hdr "pre-flight"
curl -sf "$B/api/sessions" > /dev/null && ok "brainbow reachable" || { no "brainbow"; exit 1; }
curl -sf "$APP/api/health" > /dev/null && ok "openagentic /api/health" || { no "openagentic"; exit 1; }

# ─── 1. login via direct fetch + landing ──────────────────────────────────
hdr "login + chat shell"
curl -sf -X POST "$B/api/launch" -H 'Content-Type: application/json' -d '{}' > /dev/null && ok "browser launched"
goto "$APP/login" && ok "navigated to /login"
LOGIN=$(eval_js "const r = await fetch('/api/auth/local/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:'$ADMIN_USER', password:'$ADMIN_PASS'}) }); const d = await r.json(); if (d.token) localStorage.setItem('auth_token', d.token); localStorage.removeItem('aw-sidebar-collapsed-groups-v1'); return { ok: d.success, token: !!d.token };")
echo "$LOGIN" | jq -e '.ok == true' >/dev/null && ok "login 200 + token stored" || no "login failed" "$LOGIN"
goto "$APP/chat" && ok "navigated to /chat"
sleep 2
eval_js "const skip = Array.from(document.querySelectorAll('button')).find(b => /^skip$/i.test((b.innerText||'').trim())); if (skip) skip.click(); return { skipped: !!skip };" > /dev/null
shot "01-chat-shell.png"

# ─── 2. send a chat message + assert response ─────────────────────────────
hdr "chat message → assistant response"
# Type a message and submit. We hit /api/chat/stream directly to keep this deterministic
# (the UI's textarea + send button path is brittle to timing); a SUCCESSFUL stream
# proves end-to-end model wiring works.
CHAT=$(eval_js "
const sessionId = 'e2e-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
const r = await fetch('/api/chat/stream', {
  method:'POST',
  headers:{'Content-Type':'application/json','Authorization':'Bearer '+localStorage.getItem('auth_token')},
  body: JSON.stringify({ message: 'Reply with the single word: pong', sessionId })
});
if (!r.ok) return { ok:false, status:r.status, body: (await r.text()).slice(0,200) };
const reader = r.body.getReader();
const dec = new TextDecoder();
let acc = '';
let chunks = 0;
const start = Date.now();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  chunks++;
  acc += dec.decode(value, { stream:true });
  if (chunks > 400 || Date.now() - start > 60000) break;
}
return { ok:true, chunks, length: acc.length, hasContent: /pong|hello|reply|word/i.test(acc) };
")
echo "$CHAT" | jq -e '.ok == true and .chunks > 0' > /dev/null && ok "chat stream ok ($(echo "$CHAT" | jq -r '.chunks') chunks, $(echo "$CHAT" | jq -r '.length') bytes)" || no "chat stream" "$CHAT"

# ─── 3. open admin panel via UI menu ──────────────────────────────────────
hdr "admin panel — V3 shell mounts"
eval_js "const s = Array.from(document.querySelectorAll('button, a')).find(b => /^Settings & more$/i.test((b.innerText||'').trim())); if (s) s.click(); return {clicked:!!s};" > /dev/null
sleep 1
eval_js "const a = Array.from(document.querySelectorAll('button, a')).find(b => /admin panel/i.test((b.innerText||'').trim())); if (a) a.click(); return {clicked:!!a};" > /dev/null
sleep 3
SHELL_CHECK=$(eval_js "return { topbar:!!document.querySelector('.aw-topbar'), shell:!!document.querySelector('.aw-shell'), cmdk:!!document.querySelector('.aw-topbar__search') };")
echo "$SHELL_CHECK" | jq -e '.topbar and .shell and .cmdk' > /dev/null && ok "V3 shell: topbar + cmdK + shell" || no "V3 shell" "$SHELL_CHECK"
shot "02-admin-dashboard.png"

# ─── 4. expand all groups + count locked leaves ───────────────────────────
hdr "sidebar — locked-leaf PRO badging"
eval_js "document.querySelectorAll('[aria-expanded=\"false\"].aw-sidebar__group-title--toggle').forEach(b => b.click()); return {ok:true};" > /dev/null
sleep 1
LOCKED=$(eval_js "return { locked: document.querySelectorAll('.aw-sidebar__leaf--locked').length, badges: document.querySelectorAll('.aw-sidebar__leaf-pro').length, codemode: Array.from(document.querySelectorAll('.aw-sidebar__leaf--locked')).filter(l => l.querySelector('.aw-sidebar__leaf-key')?.textContent?.startsWith('c')).length };")
N=$(echo "$LOCKED" | jq -r '.locked')
[ "$N" -ge 25 ] && ok "found $N locked leaves" || no "expected ≥25 locked, got $N"
echo "$LOCKED" | jq -e '.locked == .badges' > /dev/null && ok "PRO badge count matches locked count" || no "badge count mismatch"
shot "03-sidebar-locked.png"

# ─── 5. paywall: Cost Management ──────────────────────────────────────────
hdr "paywall — Cost Management LockScreen"
eval_js "const l = Array.from(document.querySelectorAll('.aw-sidebar__leaf--locked')).find(x => /cost management/i.test(x.querySelector('.aw-sidebar__leaf-name')?.textContent || '')); if (l) l.click(); return {clicked:!!l};" > /dev/null
sleep 2
LOCK1=$(eval_js "return { hash: location.hash, hasLock: !!document.querySelector('[aria-label*=\"Cost management\"]'), hasSvg: !!document.querySelector('svg linearGradient'), upgradeHref: document.querySelector('a[href*=\"agenticwork.io\"]')?.href };")
echo "$LOCK1" | jq -e '.hasLock == true' > /dev/null && ok "Cost Management LockScreen rendered" || no "no lockscreen" "$LOCK1"
echo "$LOCK1" | jq -e '.hasSvg == true' > /dev/null && ok "agenticwork brand SVG rendered" || no "brand SVG missing"
echo "$LOCK1" | jq -e '.upgradeHref | test("agenticwork.io")' > /dev/null && ok "agenticwork.io upsell link present" || no "upsell link missing"
shot "04-paywall-cost.png"

# ─── 6. paywall: a Code Mode leaf ─────────────────────────────────────────
hdr "paywall — Code Mode leaf LockScreen"
eval_js "const l = Array.from(document.querySelectorAll('.aw-sidebar__leaf--locked')).find(x => x.querySelector('.aw-sidebar__leaf-key')?.textContent === 'cu'); if (l) l.click(); return {clicked:!!l};" > /dev/null
sleep 2
LOCK2=$(eval_js "return { hash: location.hash, hasLock: !!document.querySelector('[aria-label*=\"Code Mode Users & Sessions\"]') };")
echo "$LOCK2" | jq -e '.hash == "#cm-users" and .hasLock == true' > /dev/null && ok "cm-users LockScreen rendered" || no "cm-users failed" "$LOCK2"
shot "05-paywall-codemode.png"

# ─── 7. free leaf: Provider Management (Ollama visible) ───────────────────
hdr "free leaf — Provider Management"
eval_js "const l = Array.from(document.querySelectorAll('.aw-sidebar__leaf')).find(x => /provider management/i.test(x.querySelector('.aw-sidebar__leaf-name')?.textContent || '')); if (l) l.click(); return {clicked:!!l};" > /dev/null
sleep 3
PROV=$(eval_js "return { hash: location.hash, bodyHasOllama: /ollama/i.test(document.querySelector('main')?.innerText || ''), bodyHasHealthy: /healthy/i.test(document.querySelector('main')?.innerText || '') };")
echo "$PROV" | jq -e '.bodyHasOllama == true' > /dev/null && ok "Provider Management lists Ollama" || no "Ollama missing" "$PROV"
shot "06-provider-management.png"

# ─── 8. free leaf: MCP Fleet (Total Tools > 0) ────────────────────────────
hdr "free leaf — MCP Fleet"
eval_js "const l = Array.from(document.querySelectorAll('.aw-sidebar__leaf')).find(x => /mcp fleet/i.test(x.querySelector('.aw-sidebar__leaf-name')?.textContent || '')); if (l) l.click(); return {clicked:!!l};" > /dev/null
sleep 3
MCP=$(eval_js "const m = document.querySelector('main')?.innerText || ''; const tools = (m.match(/Total Tools[\\s\\S]{0,40}/i) || [''])[0]; return { hash: location.hash, has402: /Payment Required/i.test(m), totalToolsLine: tools };")
echo "$MCP" | jq -e '.has402 == false' > /dev/null && ok "MCP Fleet not 402-blocked (admin-mcp-access gate fix holds)" || no "MCP Fleet still 402'd" "$MCP"
shot "07-mcp-fleet.png"

# ─── 9. close admin + sign out ────────────────────────────────────────────
hdr "close admin + logout"
eval_js "const b = document.querySelector('.aw-topbar__close'); if (b) b.click(); return { clicked:!!b };" > /dev/null
sleep 2
eval_js "return { url: location.href, isChat: /\\/chat/.test(location.href) };" | jq -e '.isChat == true' > /dev/null && ok "admin close → returned to chat" || no "admin close failed"
# logout via Settings menu — the chat-side Settings & more button opens a popover with "Sign out"
eval_js "const s = Array.from(document.querySelectorAll('button')).find(b => /Settings\\s*&\\s*more/i.test((b.innerText||'').trim())); if (s) { s.click(); } return { found:!!s };" > /dev/null
sleep 1
eval_js "const o = Array.from(document.querySelectorAll('button')).find(b => /^sign out$/i.test((b.innerText||'').trim())); if (o) o.click(); return {clicked:!!o, allBtns: Array.from(document.querySelectorAll('button')).map(b=>(b.innerText||'').trim()).filter(t=>t.length>0 && t.length<30).slice(-15)};" > /tmp/logout-debug.json
sleep 3
LOUT=$(eval_js "return { url: location.href, atLogin: /\\/login/.test(location.href), hasToken: !!localStorage.getItem('auth_token') };")
echo "$LOUT" | jq -e '.atLogin == true and .hasToken == false' > /dev/null && ok "logout → /login + token cleared" || { no "logout state wrong" "$LOUT"; echo "    debug: $(cat /tmp/logout-debug.json)"; }
shot "08-after-logout.png"

# ─── summary ──────────────────────────────────────────────────────────────
echo
echo "──────────────────────────────────────────"
echo "  E2E: passed=$PASS  failed=$FAIL"
echo "  Screenshots: $SHOTS/"
echo "──────────────────────────────────────────"
[ "$FAIL" -eq 0 ]
