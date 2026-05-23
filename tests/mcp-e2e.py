#!/usr/bin/env python3
"""
End-to-end MCP harness.

Drives the install in three phases:

  1. Detect — figure out which host cloud CLIs the runner actually has
     usable creds for (Azure az, AWS, gcloud, kubectl).
  2. Wizard + boot — runs the Ink wizard via PTY (no --dry-run; this is
     the real launch path), selecting the matching cloud MCPs and the
     "Use my host CLI creds" option for each one. Waits for openagentic-api
     to report healthy.
  3. Probe — for every detected MCP, mints a JWT and sends a chat prompt
     through /api/chat/stream that should trigger that MCP's tool, then
     greps the streamed response for evidence that a real cloud API call
     succeeded (subscription id, account number, project id, pod name).

Anything short of "we saw real data come back" is a hard failure. The
point of the harness is to make "show me my Azure subs" demos reliable —
so we don't pretend a stack is healthy when chat → tool_call → cloud is
actually broken.

Usage:
  python3 tests/mcp-e2e.py                    # full: detect + boot + probe + teardown
  python3 tests/mcp-e2e.py --keep             # don't tear the stack down
  python3 tests/mcp-e2e.py --skip-wizard      # assume stack already up; just probe
  python3 tests/mcp-e2e.py --only azure,k8s   # probe just these MCPs

Env overrides:
  OLLAMA_HOST           default: http://host.docker.internal:11434
  OLLAMA_CHAT_MODEL     default: gpt-oss:20b
  COMPOSE_PROJECT       default: openagentic
  API_PORT              default: 8080 (the host port docker-compose maps)
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
OLLAMA_CHAT_MODEL = os.environ.get("OLLAMA_CHAT_MODEL", "gpt-oss:20b")


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


# ─── Wizard PTY driver ─────────────────────────────────────────────────────
def drive_wizard(enabled_mcp_ids: Iterable[str]) -> None:
    """Real launch (no WIZARD_DRY_RUN). Picks docker target, generated
    admin password, Ollama-only LLM strategy, the enabled cloud MCPs, and
    'Use my host CLI creds' for each one. Bails to docker-compose-up at
    Review."""
    try:
        import pexpect
    except ImportError:
        raise SystemExit("pexpect missing — run: pip install pexpect (or use the venv at tools/setup/tests/.venv)")

    ENTER, DOWN, SPACE, TAB = "\r", "\x1b[B", " ", "\t"
    ANSI = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")

    def expect(child, anchor: str, timeout: float = 30.0) -> None:
        deadline = time.time() + timeout
        buf = ""
        while time.time() < deadline:
            try:
                chunk = child.read_nonblocking(size=4096, timeout=0.3)
            except pexpect.TIMEOUT:
                continue
            except pexpect.EOF:
                raise AssertionError(f"wizard exited before '{anchor}'. tail:\n{buf[-1500:]}")
            text = ANSI.sub("", chunk.decode(errors="replace"))
            buf += text
            if anchor in buf:
                return
        raise AssertionError(f"timeout waiting for '{anchor}'. tail:\n{buf[-1500:]}")

    env = os.environ.copy()
    env["FORCE_COLOR"] = "0"
    env["TERM"] = "xterm-256color"
    env["ADMIN_USER_EMAIL"] = ADMIN_EMAIL
    # Real launch — DO NOT set WIZARD_DRY_RUN.

    child = pexpect.spawn(str(TSX_BIN), ["src/index.tsx"],
                          cwd=str(SETUP_DIR), env=env, encoding=None,
                          dimensions=(50, 140), timeout=30)

    expect(child, "Where do you want to run openagentic?")
    child.send(ENTER)  # docker

    expect(child, "Create your admin account")
    child.send(ENTER)
    time.sleep(0.3)
    child.send(ADMIN_PASS); time.sleep(0.3); child.send(ENTER)

    expect(child, "How should the platform call LLMs?")
    child.send(ENTER)  # Ollama-only (1st option)

    expect(child, "Where is your Ollama?")
    child.send(ENTER)  # accept default

    expect(child, "Which MCPs do you want enabled?")
    # The MCP selection step pre-checks defaults (web/knowledge/admin and
    # the cloud MCPs that defaultOn=true). Press 'a' to select-all then
    # let the auth step skip any whose creds we DON'T have.
    child.send("a"); time.sleep(0.3); child.send(ENTER)

    # For each cloud MCP that's enabled and has host-creds detected, pick
    # the host-creds option (it's the first option whenever detected).
    # For other auth screens we just hit ENTER / DOWNs as needed.
    enabled = set(enabled_mcp_ids)
    auth_order = ["aws", "azure", "gcp", "kubernetes", "github", "prometheus", "loki", "alertmanager"]
    for mcp_id in auth_order:
        label = {"aws": "AWS", "azure": "Azure", "gcp": "GCP", "kubernetes": "Kubernetes",
                 "github": "GitHub", "prometheus": "Prometheus", "loki": "Loki",
                 "alertmanager": "Alertmanager"}[mcp_id]
        try:
            expect(child, f"{label}: credentials", timeout=20)
        except AssertionError:
            continue  # this MCP wasn't selected / has no auth step
        if mcp_id in enabled:
            # host-creds is the first option when detected → ENTER picks it.
            child.send(ENTER)
        else:
            # Skip — last option. Navigate to it: DOWN until we hit "Skip".
            # Safest is to hit DOWN 3-4 times then ENTER (handles 3-4 option menus).
            for _ in range(4):
                child.send(DOWN); time.sleep(0.05)
            child.send(ENTER)

    expect(child, "Review & launch")
    child.send(ENTER)  # Launch

    # Real launch — wait for the "Open browser" task to finish or for the
    # health task to settle. Generous timeout: first boot pulls images.
    expect(child, "openagentic is running", timeout=600)
    try:
        child.terminate(force=True)
    except Exception:
        pass


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


def chat_stream(token: str, prompt: str, timeout: int = 90) -> str:
    """POST /api/chat/stream and concatenate everything that comes back."""
    body = json.dumps({
        "messages": [{"role": "user", "content": prompt}],
        "model": OLLAMA_CHAT_MODEL,
        "stream": True,
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
    ap.add_argument("--skip-wizard", action="store_true", help="assume the stack is already running")
    ap.add_argument("--only", help="comma-separated MCP ids to probe (azure,aws,gcp,kubernetes)")
    ap.add_argument("--no-detect", action="store_true",
                    help="don't gate probes on host CLI detection (assumes stack already has the creds)")
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

    if not args.skip_wizard:
        banner("Wizard + boot")
        if not TSX_BIN.exists():
            raise SystemExit(f"tsx missing — run: (cd {SETUP_DIR} && npm install)")
        drive_wizard([c.mcp_id for c in clis])
        wait_for_api_healthy()

    banner("Login")
    token = login()
    ok(f"got JWT (len={len(token)})")

    banner("Probe each detected MCP")
    results = [(c.label, probe(c, token)) for c in clis]

    print()
    passed = sum(1 for _, ok_ in results if ok_)
    total = len(results)
    print(f"  {GREEN if passed == total else RED}{passed}/{total}{RESET} MCPs round-tripped real data")
    for label, ok_ in results:
        mark = f"{GREEN}✓{RESET}" if ok_ else f"{RED}✗{RESET}"
        print(f"    {mark} {label}")

    if not args.keep and not args.skip_wizard:
        banner("Teardown")
        subprocess.run(["docker", "compose", "down"], cwd=str(REPO), check=False)
        ok("stack stopped")
    elif args.keep:
        print(f"\n  {GRAY}--keep set: stack left running at {API_BASE}{RESET}")

    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
