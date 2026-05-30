#!/usr/bin/env python3
"""
End-to-end MCP harness.

Drives the full "5 minutes to first chat" flow in four phases:

  1. Detect — which host cloud CLIs (Azure az, AWS, gcloud, kubectl)
     have usable creds. The mcp-proxy mounts ~/.azure / ~/.aws /
     ~/.config/gcloud / ~/.kube read-only, so detected creds work
     end-to-end without anything pasted into the UI.

  2. Setup — drive the in-UI first-run wizard at /setup via Playwright:
     fill admin email/password, probe Ollama, pick chat + embed models,
     hit Start. Lands in /chat. Mirrors what a real user does.

  3. Login → JWT — yank the JWT out of localStorage (the wizard's
     Start handler stored it there), reuse for the probe phase.

  4. Probe — for each detected MCP, send a chat prompt through
     /api/chat/stream and grep the response for real cloud data
     (subscription id, 12-digit AWS account, projectId, kube-system pod
     names) AND for known failure markers. Anything short of "real data
     came back" is a hard failure.

Usage:
  python3 tests/mcp-e2e.py                    # full: detect + setup + probe + teardown
  python3 tests/mcp-e2e.py --keep             # leave stack up after probing
  python3 tests/mcp-e2e.py --skip-setup       # assume the wizard's already done; just probe
  python3 tests/mcp-e2e.py --only azure,k8s   # probe just these MCPs
  python3 tests/mcp-e2e.py --headed           # watch playwright drive the browser

Env overrides:
  OLLAMA_HOST           default: http://host.docker.internal:11434
  OLLAMA_CHAT_MODEL     default: llama3.2:3b
  OLLAMA_EMBED_MODEL    default: nomic-embed-text
  API_PORT              default: 8080
  MCP_E2E_ADMIN_PASS    default: E2eMcpHarness!9
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Optional

# ─── Pretty output ──────────────────────────────────────────────────────────
RESET = "\033[0m"
BOLD = "\033[1m"
PURPLE = "\033[38;5;135m"
GREEN = "\033[38;5;46m"
YELLOW = "\033[38;5;220m"
RED = "\033[38;5;196m"
GRAY = "\033[38;5;244m"
BLUE = "\033[38;5;39m"

def banner(msg: str) -> None:
    print(f"\n{PURPLE}▸{RESET} {BOLD}{msg}{RESET}")

def info(msg: str) -> None:  print(f"  {BLUE}·{RESET} {msg}")
def ok(msg: str) -> None:    print(f"  {GREEN}✓{RESET} {msg}")
def warn(msg: str) -> None:  print(f"  {YELLOW}!{RESET} {msg}")
def fail(msg: str) -> None:  print(f"  {RED}✗{RESET} {msg}")

# ─── Paths + config ─────────────────────────────────────────────────────────
HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SETUP_DIR = REPO / "tools" / "setup"
TSX_BIN = SETUP_DIR / "node_modules" / ".bin" / "tsx"
HOME = Path.home()
ADMIN_EMAIL = "admin@openagentic.local"
ADMIN_PASS = os.environ.get("MCP_E2E_ADMIN_PASS", "E2eMcpHarness!9")
API_PORT = int(os.environ.get("API_PORT", "8080"))
API_BASE = f"http://localhost:{API_PORT}"
# OLLAMA_HOST is resolved lazily from .env after _read_env_value is defined,
# so the harness uses whatever the running stack actually points at (the
# probe POST sends this string to the api, which fetches it server-side).
OLLAMA_CHAT_MODEL = os.environ.get("OLLAMA_CHAT_MODEL", "llama3.2:3b")
OLLAMA_EMBED_MODEL = os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")

# ─── Helpers ───────────────────────────────────────────────────────────────
def _read_env_value(key: str) -> Optional[str]:
    """Pull a single VAR=value out of repo .env. Returns None if absent."""
    env_path = REPO / ".env"
    if not env_path.exists():
        return None
    for line in env_path.read_text().splitlines():
        m = re.match(rf'^\s*{re.escape(key)}\s*=\s*(.*?)\s*$', line)
        if m:
            v = m.group(1)
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            return v
    return None

# ─── Host CLI detection ────────────────────────────────────────────────────
@dataclass
class CloudCli:
    id: str                              # 'azure' / 'aws' / 'gcp' / 'kubernetes'
    label: str                           # for human output
    detect: Callable[[], Optional[str]]  # returns a one-line summary if creds exist, else None
    mcp_id: str                          # MCPS_ENABLED token (matches lib/mcps.ts ids)
    prompt: str                          # natural-language ask sent to /api/chat/stream
    success_re: re.Pattern[str]          # regex over the streamed response that indicates SUCCESS
    failure_hints: list[re.Pattern[str]] = field(default_factory=list)  # known-failure markers

def _az_summary() -> Optional[str]:
    # az is the host-side CLI; mcp-proxy reads ~/.azure inside the container.
    if not (HOME / ".azure" / "azureProfile.json").exists():
        return None
    az = shutil.which("az")
    if not az:
        # Files exist but the CLI doesn't — still works (mcp uses tokens directly).
        return f"~/.azure detected (no az CLI on PATH)"
    try:
        out = subprocess.run([az, "account", "show", "-o", "json"],
                             capture_output=True, text=True, timeout=15)
        if out.returncode != 0:
            return None
        data = json.loads(out.stdout)
        return f"{data.get('name','?')} (sub {data.get('id','?')[:8]}…)"
    except Exception:
        return None

def _aws_summary() -> Optional[str]:
    if not ((HOME / ".aws" / "credentials").exists() or (HOME / ".aws" / "config").exists()):
        return None
    aws = shutil.which("aws")
    if not aws:
        return "~/.aws detected (no aws CLI on PATH)"
    try:
        out = subprocess.run([aws, "sts", "get-caller-identity"],
                             capture_output=True, text=True, timeout=10)
        if out.returncode != 0:
            return None
        data = json.loads(out.stdout)
        return f"account {data.get('Account','?')}"
    except Exception:
        return None

def _gcp_summary() -> Optional[str]:
    gcloud_dir = HOME / ".config" / "gcloud"
    if not gcloud_dir.exists():
        return None
    gcloud = shutil.which("gcloud")
    if not gcloud:
        return "~/.config/gcloud detected (no gcloud CLI on PATH)"
    try:
        out = subprocess.run([gcloud, "config", "list", "--format=json"],
                             capture_output=True, text=True, timeout=10)
        data = json.loads(out.stdout) if out.returncode == 0 else {}
        proj = data.get("core", {}).get("project")
        return f"project {proj}" if proj else "credentials detected (no default project)"
    except Exception:
        return None

def _k8s_summary() -> Optional[str]:
    if not (HOME / ".kube" / "config").exists():
        return None
    k = shutil.which("kubectl")
    if not k:
        return "~/.kube/config detected (no kubectl CLI on PATH)"
    try:
        out = subprocess.run([k, "config", "current-context"],
                             capture_output=True, text=True, timeout=5)
        if out.returncode != 0:
            return None
        return f"context {out.stdout.strip()}"
    except Exception:
        return None

CLIS: list[CloudCli] = [
    CloudCli(
        id="azure", label="Azure",
        detect=_az_summary, mcp_id="azure",
        prompt="List my Azure subscriptions with subscriptionId, displayName, and state. Use the azure MCP.",
        success_re=re.compile(r'(?:subscriptionId|"id"\s*:\s*"/subscriptions/[0-9a-f-]{36})', re.I),
        failure_hints=[
            re.compile(r"AADSTS\d+", re.I),
            re.compile(r"InvalidAuthenticationToken", re.I),
            re.compile(r"AzureCliCredential.*failed", re.I),
        ],
    ),
    CloudCli(
        id="aws", label="AWS",
        detect=_aws_summary, mcp_id="aws",
        prompt="Use the aws MCP to call sts get-caller-identity and tell me the Account, UserId, and Arn.",
        success_re=re.compile(r'"Account"\s*:\s*"\d{12}"|arn:aws:[a-z0-9-]+::\d{12}', re.I),
        failure_hints=[
            re.compile(r"UnrecognizedClientException", re.I),
            re.compile(r"InvalidClientTokenId", re.I),
            re.compile(r"NoCredentialProviders", re.I),
        ],
    ),
    CloudCli(
        id="gcp", label="GCP",
        detect=_gcp_summary, mcp_id="gcp",
        prompt="Use the gcp MCP to list my projects (projectId, name, lifecycleState).",
        success_re=re.compile(r'"projectId"\s*:\s*"[a-z0-9-]+', re.I),
        failure_hints=[
            re.compile(r"PERMISSION_DENIED", re.I),
            re.compile(r"DefaultCredentialsError", re.I),
        ],
    ),
    CloudCli(
        id="kubernetes", label="Kubernetes",
        detect=_k8s_summary, mcp_id="kubernetes",
        prompt="Use the kubernetes MCP to list pods in the kube-system namespace; just give me the names.",
        success_re=re.compile(r"kube-(?:proxy|apiserver|scheduler|controller|dns)|coredns|metrics-server", re.I),
        failure_hints=[
            re.compile(r"Unauthorized|forbidden|x509", re.I),
            re.compile(r"connection refused", re.I),
        ],
    ),
]

def detect_clis(only: Optional[set[str]]) -> list[CloudCli]:
    out: list[CloudCli] = []
    for c in CLIS:
        if only and c.id not in only:
            continue
        summary = c.detect()
        if summary:
            ok(f"{c.label}: {summary}")
            out.append(c)
        else:
            warn(f"{c.label}: no usable host creds — will not probe this MCP")
    return out

# ─── Playwright wizard driver ──────────────────────────────────────────────
def drive_ui_setup(headed: bool = False) -> str:
    """Open the UI, walk the first-run /setup wizard, return the JWT.

    The setup wizard at /setup posts to /api/setup/complete and stores
    the returned JWT in localStorage('auth_token'), then hard-redirects
    to /chat. We yank the token out of localStorage on the chat page
    and hand it back so the probe phase can reuse it.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit(
            "playwright python package missing. Install:\n"
            "  python3 -m pip install playwright && python3 -m playwright install chromium"
        )

    info(f"Opening {API_BASE} in {'headed' if headed else 'headless'} Chromium")
    # MAGIC_BOOT_TOKEN — pull from .env so we can satisfy the setup overwrite
    # guard if InitializationService already seeded an admin user before the
    # wizard runs (common when the api boots from .env-driven admin seeding).
    magic = _read_env_value("MAGIC_BOOT_TOKEN")
    # OLLAMA_HOST — read from .env so the harness uses whatever the running
    # stack actually points at. The probe call is server-side, so the URL
    # must be reachable FROM the api container — typically `http://ollama:11434`
    # when using the in-compose ollama, or `http://host.docker.internal:11434`
    # when pointed at a host ollama.
    ollama_host = os.environ.get("OLLAMA_HOST") or _read_env_value("OLLAMA_HOST") or "http://ollama:11434"
    info(f"Using ollama at {ollama_host}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not headed)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        # Pre-seed sessionStorage.mb_token on every page in this context so the
        # Setup wizard can replay it as `magicToken` in /api/setup/complete.
        if magic:
            ctx.add_init_script(
                f"try {{ window.sessionStorage.setItem('mb_token', {json.dumps(magic)}); }} catch (e) {{}}"
            )
        page = ctx.new_page()
        page.set_default_timeout(15_000)

        # Land on /. First-run gate should redirect us to /setup.
        page.goto(API_BASE)
        try:
            page.wait_for_url("**/setup", timeout=10_000)
        except Exception:
            current = page.url
            raise SystemExit(
                f"expected redirect to /setup, got {current}. "
                f"Setup may already be done; pass --skip-setup."
            )
        ok("setup wizard opened")

        # Admin email is pre-populated with admin@openagentic.local; replace
        # it with ours in case the harness is being re-run.
        page.get_by_label("Admin email").fill(ADMIN_EMAIL)
        page.get_by_label("Admin password (≥ 8 chars)").fill(ADMIN_PASS)
        # Ollama host is pre-populated; reset to the value the harness wants
        # so a stale .env doesn't surprise us.
        page.get_by_label("Ollama host").fill(ollama_host)
        info("filled admin + ollama fields")

        # The wizard auto-probes on mount; click Probe to force a fresh one
        # using the value we just typed, then wait for the model dropdowns
        # to populate.
        page.get_by_role("button", name=re.compile("Probe Ollama", re.I)).click()
        # Wait for either the "found N chat + M embedding models" hint or
        # for the dropdowns themselves to render.
        try:
            page.wait_for_selector("text=/found \\d+ chat \\+ \\d+ embedding models/", timeout=15_000)
            ok("ollama probe succeeded")
        except Exception:
            warn("probe didn't surface model counts; continuing with whatever the form has")

        # Pick the chat + embed models if dropdowns are present.
        chat_select = page.locator('select').filter(has_text=re.compile(OLLAMA_CHAT_MODEL.split(":")[0], re.I)).first
        if chat_select.count() > 0:
            chat_select.select_option(label=OLLAMA_CHAT_MODEL)
            ok(f"chat model set to {OLLAMA_CHAT_MODEL}")
        embed_select = page.locator('select').filter(has_text=re.compile("embed|nomic", re.I)).first
        if embed_select.count() > 0:
            try:
                embed_select.select_option(label=OLLAMA_EMBED_MODEL)
                ok(f"embed model set to {OLLAMA_EMBED_MODEL}")
            except Exception:
                pass  # optional field

        # Submit. Wait for the redirect to /chat (the wizard's success path).
        page.get_by_role("button", name=re.compile("^Start$", re.I)).click()
        try:
            page.wait_for_url("**/chat", timeout=30_000)
        except Exception:
            # Surface any error the wizard displayed inline.
            err = page.locator('text=/setup failed|setup transaction failed|HTTP \\d+/').first
            err_msg = err.text_content() if err.count() > 0 else "no inline error visible"
            (REPO / ".e2e-logs").mkdir(exist_ok=True)
            page.screenshot(path=str(REPO / ".e2e-logs" / "setup-failed.png"))
            raise SystemExit(f"setup never redirected to /chat. Inline error: {err_msg}")
        ok("setup completed → /chat")

        # Pull the JWT out of localStorage.
        token = page.evaluate("() => localStorage.getItem('auth_token')")
        if not token:
            raise SystemExit("setup landed in /chat but no auth_token in localStorage")
        ctx.close()
        browser.close()
        return token

# ─── Wait for healthy ──────────────────────────────────────────────────────
def wait_for_api_healthy(timeout: int = 180) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = subprocess.run(["docker", "inspect", "--format", "{{.State.Health.Status}}",
                               "openagentic-api-1"], capture_output=True, text=True, timeout=5)
            status = r.stdout.strip()
            if status == "healthy":
                ok("api healthy")
                return
            if status == "unhealthy":
                raise SystemExit("api went unhealthy. Check `docker logs openagentic-api-1`.")
        except subprocess.SubprocessError:
            pass
        time.sleep(3)
    raise SystemExit(f"api did not go healthy in {timeout}s")

# ─── API helpers ────────────────────────────────────────────────────────────
def http_json(method: str, path: str, *, body: Optional[dict] = None,
              token: Optional[str] = None, timeout: int = 30) -> tuple[int, dict | str]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API_BASE}{path}", method=method, data=data)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read().decode()
            try:    return resp.status, json.loads(payload)
            except Exception: return resp.status, payload
    except urllib.error.HTTPError as e:
        payload = e.read().decode()
        try:    return e.code, json.loads(payload)
        except Exception: return e.code, payload

def login() -> str:
    code, body = http_json("POST", "/api/auth/local/login",
                           body={"username": ADMIN_EMAIL, "password": ADMIN_PASS})
    if code != 200 or not isinstance(body, dict) or not body.get("token"):
        raise SystemExit(f"login failed: HTTP {code} body={body!r}")
    return body["token"]

def _create_chat_session(token: str) -> str:
    """POST /api/chat/sessions → returns a sessionId we can stream messages into."""
    code, body = http_json("POST", "/api/chat/sessions", body={"title": "mcp-e2e probe"}, token=token)
    if code not in (200, 201) or not isinstance(body, dict):
        raise RuntimeError(f"could not create chat session: HTTP {code} body={body!r}")
    # api returns either { id } or { session: { id } } depending on the handler
    sid = body.get("id") or (body.get("session") or {}).get("id")
    if not sid:
        raise RuntimeError(f"chat session response missing id: {body!r}")
    return sid

def chat_stream(token: str, prompt: str, timeout: int = 120) -> str:
    """POST /api/chat/stream and concatenate everything that comes back.

    The api expects `{ message, sessionId, model? }` (singular message,
    one sessionId per chat) — not the OpenAI `messages: [...]` shape.
    """
    sid = _create_chat_session(token)
    body = json.dumps({
        "message": prompt,
        "sessionId": sid,
        "model": OLLAMA_CHAT_MODEL,
    }).encode()
    req = urllib.request.Request(f"{API_BASE}/api/chat/stream", method="POST", data=body)
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    chunks: list[str] = []
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        while True:
            line = resp.readline()
            if not line:
                break
            chunks.append(line.decode(errors="replace"))
    return "".join(chunks)

# ─── Probe ─────────────────────────────────────────────────────────────────
def probe(cli: CloudCli, token: str) -> bool:
    info(f"chatting: {cli.prompt}")
    try:
        resp = chat_stream(token, cli.prompt)
    except Exception as e:
        fail(f"{cli.label}: chat call raised {e}")
        return False

    for fp in cli.failure_hints:
        if fp.search(resp):
            fail(f"{cli.label}: response contained known-failure marker {fp.pattern!r}")
            (REPO / ".e2e-logs").mkdir(exist_ok=True)
            (REPO / ".e2e-logs" / f"mcp-{cli.id}-fail.txt").write_text(resp)
            return False

    if cli.success_re.search(resp):
        ok(f"{cli.label}: chat → tool_call → real data ✓")
        return True

    fail(f"{cli.label}: success pattern {cli.success_re.pattern!r} not found in response")
    (REPO / ".e2e-logs").mkdir(exist_ok=True)
    (REPO / ".e2e-logs" / f"mcp-{cli.id}-nomatch.txt").write_text(resp)
    return False

# ─── Main ──────────────────────────────────────────────────────────────────
def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--keep", action="store_true", help="leave the stack running after probing")
    ap.add_argument("--skip-setup", action="store_true",
                    help="setup is already done; log in via /api/auth/local/login instead of the UI wizard")
    ap.add_argument("--only", help="comma-separated MCP ids to probe (azure,aws,gcp,kubernetes)")
    ap.add_argument("--no-detect", action="store_true",
                    help="don't gate probes on host CLI detection (assumes stack already has the creds)")
    ap.add_argument("--headed", action="store_true",
                    help="run playwright in headed mode so you can watch the wizard fill itself in")
    args = ap.parse_args(argv)

    only: Optional[set[str]] = set(args.only.split(",")) if args.only else None

    banner("Detect host cloud CLIs")
    if args.no_detect:
        clis = [c for c in CLIS if not only or c.id in only]
        warn("--no-detect: probing all selected MCPs regardless of host CLI presence")
    else:
        clis = detect_clis(only)
        if not clis:
            warn("no host CLIs detected — nothing to probe; exiting cleanly")
            return 0

    # Always make sure the api is healthy before touching it. The harness
    # assumes the stack has been brought up via install.sh already; we
    # just verify, we don't boot for you.
    banner("Stack health")
    wait_for_api_healthy(timeout=60)

    if args.skip_setup:
        banner("Login (skip-setup)")
        token = login()
        ok(f"got JWT via /api/auth/local/login (len={len(token)})")
    else:
        banner("Setup wizard (Playwright)")
        token = drive_ui_setup(headed=args.headed)
        ok(f"got JWT via /setup wizard (len={len(token)})")

    banner("Probe each detected MCP")
    results = [(c.label, probe(c, token)) for c in clis]

    print()
    passed = sum(1 for _, ok_ in results if ok_)
    total = len(results)
    print(f"  {GREEN if passed == total else RED}{passed}/{total}{RESET} MCPs round-tripped real data")
    for label, ok_ in results:
        mark = f"{GREEN}✓{RESET}" if ok_ else f"{RED}✗{RESET}"
        print(f"    {mark} {label}")

    if args.keep:
        print(f"\n  {GRAY}--keep set: stack left running at {API_BASE}{RESET}")

    return 0 if passed == total else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
