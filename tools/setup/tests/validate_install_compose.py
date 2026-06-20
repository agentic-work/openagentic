#!/usr/bin/env python3
"""Dry-run validation of the install-compose.tape keystroke sequence:
Both (gpt-oss:20b + Bedrock host-creds) + ALL 9 MCPs via host creds / blank fields.
WIZARD_DRY_RUN=1 → only writes .env, no docker. Backs up + restores the live .env."""
import os, sys, shutil, time
from pathlib import Path
import pexpect

REPO = Path(os.environ.get("REPO", Path(__file__).resolve().parents[3]))
ENV = REPO / ".env"
BAK = Path("/tmp/.env.live.bak")
ENTER, DOWN, SPACE = "\r", "\x1b[B", " "

def strip(s):
    import re; return re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", s)

def expect(child, anchor, timeout=12.0):
    buf = ""
    end = time.time() + timeout
    while time.time() < end:
        try:
            child.expect(r".+", timeout=1.0)
            buf += child.before + child.after
            if anchor in strip(buf):
                return True
        except pexpect.TIMEOUT:
            if anchor in strip(buf): return True
        except pexpect.EOF:
            break
    print(f"  ✗ MISSING ANCHOR: {anchor!r}\n  last screen:\n{strip(buf)[-600:]}")
    return False

def send(child, s, settle=0.35):
    child.send(s); time.sleep(settle)

# back up live .env
if ENV.exists(): shutil.copy(ENV, BAK)
env = os.environ.copy()
env["WIZARD_DRY_RUN"] = "1"
# Ensure `node` is reachable; honor NODE_BIN if the harness runs under a version
# manager whose shims aren't on the non-interactive PATH.
_node_bin = os.environ.get("NODE_BIN")
if _node_bin:
    env["PATH"] = _node_bin + os.pathsep + env["PATH"]

child = pexpect.spawn("bash install.sh --wizard", cwd=str(REPO), env=env, encoding="utf-8", timeout=30, dimensions=(50, 160))
ok = True
try:
    ok &= expect(child, "Where do you want to run openagentic?", 30); send(child, ENTER)
    ok &= expect(child, "Create your admin account"); send(child, ENTER); time.sleep(0.4)
    send(child, "DemoPass123!"); send(child, ENTER)
    ok &= expect(child, "How should the platform call LLMs?"); send(child, DOWN); send(child, DOWN); send(child, ENTER)
    ok &= expect(child, "Ollama"); send(child, ENTER)
    ok &= expect(child, "Bedrock"); send(child, ENTER, 0.6)   # host-creds = first option
    time.sleep(0.6); send(child, ENTER, 0.6)                  # region (us-east-1 prefilled)
    ok &= expect(child, "Which MCPs"); send(child, "a", 0.5); send(child, ENTER, 0.6)
    # McpAuth: aws/azure/gcp/k8s host-creds (1 Enter), github(1), prometheus(3), loki(3)
    for n, enters in [("1 of 7",1),("2 of 7",1),("3 of 7",1),("4 of 7",1),("5 of 7",1),("6 of 7",3),("7 of 7",3)]:
        ok &= expect(child, n, 10)
        for _ in range(enters): send(child, ENTER, 0.45)
    ok &= expect(child, "Review", 10); send(child, ENTER)
    ok &= expect(child, "dry-run", 20)
    time.sleep(1.5)
except Exception as e:
    print(f"  EXCEPTION: {e}"); ok = False
finally:
    try: child.close()
    except Exception: pass

# parse the dry-run .env
def parse(p):
    d = {}
    for line in p.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); d[k] = v
    return d

print("\n=== keystroke walk:", "CLEAN ✓" if ok else "DESYNC ✗")
if ENV.exists():
    e = parse(ENV)
    checks = {
        "OLLAMA_CHAT_MODEL": "gpt-oss:20b",
        "BOOTSTRAP_PROVIDER_TYPE": "aws-bedrock",
        "OpenAgentic_AWS_MCP_DISABLED": "false",
        "OpenAgentic_AZURE_MCP_DISABLED": "false",
        "OpenAgentic_GCP_MCP_DISABLED": "false",
        "OpenAgentic_KUBERNETES_MCP_DISABLED": "false",
        "OpenAgentic_GITHUB_MCP_DISABLED": "false",
        "OpenAgentic_PROMETHEUS_MCP_DISABLED": "false",
        "OpenAgentic_LOKI_MCP_DISABLED": "false",
        "OpenAgentic_WEB_MCP_DISABLED": "false",
        "OpenAgentic_ADMIN_MCP_DISABLED": "false",
    }
    print("=== .env assertions ===")
    allpass = True
    for k, want in checks.items():
        got = e.get(k)
        flag = "✓" if got == want else "✗"
        if got != want: allpass = False
        print(f"  {flag} {k} = {got!r}  (want {want!r})")
    # no inline AWS keys (host-creds path)
    leak = "AWS_ACCESS_KEY_ID" in e
    print(f"  {'✗' if leak else '✓'} no inline AWS_ACCESS_KEY_ID (host-creds path): {'LEAK' if leak else 'clean'}")
    print(f"\n=== RESULT: {'ALL PASS ✓' if (ok and allpass and not leak) else 'FAIL ✗'}")
# restore live .env
if BAK.exists(): shutil.copy(BAK, ENV)
print("(.env restored to live value)")
