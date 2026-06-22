#!/usr/bin/env python3
"""
PTY harness that drives the Ink setup wizard end-to-end and asserts the
resulting .env matches the expected shape. Every variation runs with
WIZARD_DRY_RUN=1 so no docker / helm call is made — only .env is written.

Usage:
  tools/setup/tests/.venv/bin/python tools/setup/tests/pty_harness.py [variation...]

If no variation names are given, all of them run.
"""
from __future__ import annotations

import os
import re
import sys
import time
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import pexpect

HERE = Path(__file__).resolve().parent
SETUP_DIR = HERE.parent
REPO_ROOT = SETUP_DIR.parent.parent
ENV_FILE = REPO_ROOT / ".env"
ENV_EXAMPLE = REPO_ROOT / ".env.example"
TSX_BIN = SETUP_DIR / "node_modules" / ".bin" / "tsx"

# ANSI stripper — Ink redraws mean match buffers are noisy.
ANSI = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")

# ─── Key helpers ────────────────────────────────────────────────────────────
ENTER = "\r"
TAB = "\t"
CTRL_D = "\x04"
BKSP = "\x7f"
UP = "\x1b[A"
DOWN = "\x1b[B"
SPACE = " "


@dataclass
class Variation:
    name: str
    script: Callable[[pexpect.spawn], None]
    assertions: Callable[[dict[str, str]], list[str]]  # returns list of failures
    description: str = ""
    env_overrides: dict[str, str] = field(default_factory=dict)


def strip_ansi(s: str) -> str:
    return ANSI.sub("", s)


def parse_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$", line)
        if not m:
            continue
        k, v = m.group(1), m.group(2)
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]
        out[k] = v
    return out


VERBOSE = os.environ.get("PTY_VERBOSE") == "1"


def expect_screen(child: pexpect.spawn, anchor: str, timeout: float = 8.0) -> None:
    """Wait until `anchor` (literal substring, post-ANSI-strip) appears."""
    deadline = time.time() + timeout
    buf = ""
    while time.time() < deadline:
        try:
            chunk = child.read_nonblocking(size=4096, timeout=0.25)
        except pexpect.TIMEOUT:
            chunk = b""
        except pexpect.EOF:
            raise AssertionError(f"wizard exited before screen '{anchor}' appeared; buf=\n{buf[-2000:]}")
        if chunk:
            text = strip_ansi(chunk.decode(errors="replace"))
            buf += text
            if VERBOSE:
                sys.stderr.write(text)
                sys.stderr.flush()
            if anchor in buf:
                return
    raise AssertionError(f"timeout waiting for '{anchor}' (timeout={timeout}s)\n---buf tail---\n{buf[-2000:]}")


def send(child: pexpect.spawn, s: str, settle: float = 0.2) -> None:
    child.send(s)
    time.sleep(settle)


def type_and_enter(child: pexpect.spawn, text: str, settle: float = 0.3) -> None:
    """Ink's keypress parser treats a buffered `text\\r` write as one keypress,
    so the `\\r` is appended as a character instead of firing onSubmit. Split
    the two writes with a pause to get distinct keypress events."""
    if text:
        child.send(text)
        time.sleep(settle)
    child.send(ENTER)
    time.sleep(settle)


def clear_and_enter(child: pexpect.spawn, text: str, prefilled_len: int = 20, settle: float = 0.3) -> None:
    """Like type_and_enter but first clears a prefilled TextInput (e.g. the
    Bedrock region field, which defaults to us-east-1) with backspaces so the
    typed value replaces rather than appends to the default."""
    for _ in range(prefilled_len):
        child.send(BKSP)
    time.sleep(0.1)
    type_and_enter(child, text, settle=settle)


# ─── Variation scripts ──────────────────────────────────────────────────────
def script_minimal(child: pexpect.spawn) -> None:
    """Accept every default (Both: Ollama embeddings + Bedrock chat); 1 MCP, no MCP auth."""
    expect_screen(child, "Where do you want to run openagentic?")
    send(child, ENTER)  # docker

    expect_screen(child, "Create your admin account")
    # email field is pre-populated with admin@openagentic.local — accept
    send(child, ENTER)
    # password — must be >= 8 chars
    type_and_enter(child, "hunter2!!")

    expect_screen(child, "Which LLM provider should the platform use?")
    send(child, DOWN); send(child, DOWN); send(child, DOWN); send(child, DOWN)  # "Both" (skips the no-provider sentinel + ollama/cloud/vertex)
    send(child, ENTER)

    expect_screen(child, "Where is your Ollama?")
    send(child, ENTER)  # accept host.docker.internal:11434 default

    # AWS Bedrock IAM picker (no ~/.aws in sandbox → inline first).
    expect_screen(child, "AWS Bedrock (Claude via IAM)")
    send(child, ENTER)                        # "Enter IAM access key"
    expect_screen(child, "IAM access key")
    clear_and_enter(child, "us-east-1")        # region (clear default)
    type_and_enter(child, "AKIA-MIN")         # access key id
    type_and_enter(child, "min-secret")       # secret access key

    expect_screen(child, "Which MCPs do you want enabled?")
    send(child, "n")                          # clear all
    send(child, SPACE)                        # web on (cursor starts at 0 = web)
    send(child, ENTER)


    expect_screen(child, "Review & launch")
    send(child, ENTER)                        # Launch

    expect_screen(child, "dry-run", timeout=15.0)


def assert_minimal(env: dict[str, str]) -> list[str]:
    fails = []
    if env.get("ADMIN_SEED_PASSWORD") != "hunter2!!":
        fails.append(f"ADMIN_SEED_PASSWORD expected 'hunter2!!' got {env.get('ADMIN_SEED_PASSWORD')!r}")
    if env.get("BOOTSTRAP_PROVIDER_TYPE") != "aws-bedrock":
        fails.append(f"BOOTSTRAP_PROVIDER_TYPE expected 'aws-bedrock', got {env.get('BOOTSTRAP_PROVIDER_TYPE')!r}")
    if env.get("AWS_ACCESS_KEY_ID") != "AKIA-MIN":
        fails.append(f"AWS_ACCESS_KEY_ID expected 'AKIA-MIN', got {env.get('AWS_ACCESS_KEY_ID')!r}")
    if env.get("ANTHROPIC_API_KEY"):
        fails.append(f"ANTHROPIC_API_KEY must NOT be written (IAM-only), got {env.get('ANTHROPIC_API_KEY')!r}")
    if env.get("MCPS_ENABLED") != "web":
        fails.append(f"MCPS_ENABLED expected 'web' got {env.get('MCPS_ENABLED')!r}")
    if env.get("OpenAgentic_AWS_MCP_DISABLED") != "true":
        fails.append("AWS MCP should be DISABLED=true")
    if env.get("OpenAgentic_WEB_MCP_DISABLED") != "false":
        fails.append("Web MCP should be DISABLED=false")
    return fails


def script_all_mcps_inline(child: pexpect.spawn) -> None:
    """Every MCP on. For cloud MCPs (env-file type) pick 'paste inline'.
    For field MCPs, paste values."""
    expect_screen(child, "Where do you want to run openagentic?")
    send(child, ENTER)

    expect_screen(child, "Create your admin account")
    send(child, ENTER)
    type_and_enter(child, "supersecret")

    expect_screen(child, "Which LLM provider should the platform use?")
    send(child, DOWN); send(child, DOWN); send(child, DOWN); send(child, DOWN)  # "Both" (skips the no-provider sentinel + ollama/cloud/vertex)
    send(child, ENTER)

    expect_screen(child, "Where is your Ollama?")
    send(child, ENTER)

    # AWS Bedrock picker — exercise the named-profile path (no ~/.aws in
    # sandbox → menu is [inline, profile]; DOWN once = profile).
    expect_screen(child, "AWS Bedrock (Claude via IAM)")
    send(child, DOWN)
    send(child, ENTER)                        # "Use a named AWS profile"
    expect_screen(child, "named profile")
    clear_and_enter(child, "us-east-1")        # region (clear default)
    clear_and_enter(child, "myprofile", prefilled_len=8)  # profile (clear default 'default')

    expect_screen(child, "Which MCPs do you want enabled?")
    send(child, "a", settle=0.5)              # select all — give React a beat to re-render
    send(child, ENTER)

    # AWS — env-file MCP. Options are listed top-down; the first option on a
    # fresh system is "Create empty ~/.openagentic/cloud-secrets/aws.env stub"
    # because no real file exists. We want "Paste credentials inline now"
    # which is always the second-to-last option.
    expect_screen(child, "AWS: credentials")
    send(child, DOWN)                         # move to "Paste inline"
    send(child, ENTER)
    type_and_enter(child, "AKIA-TEST-AAA")
    type_and_enter(child, "secret-aaa")
    type_and_enter(child, "us-east-1")

    expect_screen(child, "Azure: credentials")
    send(child, DOWN)
    send(child, ENTER)
    type_and_enter(child, "tenant-xyz")
    type_and_enter(child, "client-xyz")
    type_and_enter(child, "secret-xyz")
    type_and_enter(child, "sub-xyz")

    expect_screen(child, "GCP: credentials")
    send(child, DOWN)
    send(child, ENTER)
    type_and_enter(child, "proj-gcp")
    type_and_enter(child, "us-central1")
    type_and_enter(child, "/run/secrets/gcp.json")

    expect_screen(child, "Kubernetes: credentials")
    type_and_enter(child, "/tmp/kcfg")

    expect_screen(child, "GitHub: credentials")
    type_and_enter(child, "ghp_test")

    expect_screen(child, "Prometheus: credentials")
    type_and_enter(child, "https://prom.test")
    send(child, ENTER)                        # skip optional user
    send(child, ENTER)                        # skip optional pass

    expect_screen(child, "Loki: credentials")
    type_and_enter(child, "https://loki.test")
    send(child, ENTER)
    send(child, ENTER)


    expect_screen(child, "Review & launch")
    send(child, ENTER)

    expect_screen(child, "dry-run", timeout=15.0)


def assert_all_mcps_inline(env: dict[str, str]) -> list[str]:
    fails = []
    mcps = env.get("MCPS_ENABLED", "").split(",")
    expected = {"web", "admin",
                "aws", "azure", "gcp", "kubernetes", "github",
                "prometheus", "loki"}
    missing = expected - set(mcps)
    if missing:
        fails.append(f"MCPS_ENABLED missing: {missing}")
    creds = [
        ("AWS_ACCESS_KEY_ID", "AKIA-TEST-AAA"),
        ("AWS_SECRET_ACCESS_KEY", "secret-aaa"),
        ("AWS_REGION", "us-east-1"),
        ("AZURE_TENANT_ID", "tenant-xyz"),
        ("AZURE_CLIENT_ID", "client-xyz"),
        ("AZURE_CLIENT_SECRET", "secret-xyz"),
        ("AZURE_SUBSCRIPTION_ID", "sub-xyz"),
        ("GCP_PROJECT_ID", "proj-gcp"),
        ("GCP_REGION", "us-central1"),
        ("GCP_CREDENTIALS_FILE", "/run/secrets/gcp.json"),
        ("KUBECONFIG", "/tmp/kcfg"),
        ("GITHUB_TOKEN", "ghp_test"),
        ("PROMETHEUS_URL", "https://prom.test"),
        ("LOKI_URL", "https://loki.test"),
        # Bedrock named-profile path writes AWS_PROFILE (region is then
        # overwritten by the AWS-MCP inline AWS_REGION=us-east-1 above).
        ("AWS_PROFILE", "myprofile"),
        ("BOOTSTRAP_PROVIDER_TYPE", "aws-bedrock"),
    ]
    for k, want in creds:
        got = env.get(k)
        if got != want:
            fails.append(f"{k} expected {want!r} got {got!r}")
    # IAM-only: no raw provider API keys, ever.
    for forbidden in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        if env.get(forbidden):
            fails.append(f"{forbidden} must NOT be written (IAM-only), got {env.get(forbidden)!r}")
    for mcp_env in ("OpenAgentic_AWS_MCP_DISABLED", "OpenAgentic_AZURE_MCP_DISABLED",
                    "OpenAgentic_GCP_MCP_DISABLED", "OpenAgentic_KUBERNETES_MCP_DISABLED",
                    "OpenAgentic_GITHUB_MCP_DISABLED"):
        if env.get(mcp_env) != "false":
            fails.append(f"{mcp_env} should be false, got {env.get(mcp_env)!r}")
    return fails


def script_skip_all_cloud(child: pexpect.spawn) -> None:
    """Enable all MCPs, but skip each env-file MCP when asked for creds."""
    expect_screen(child, "Where do you want to run openagentic?")
    send(child, ENTER)
    expect_screen(child, "Create your admin account")
    send(child, ENTER)
    type_and_enter(child, "passw0rd!")
    expect_screen(child, "Which LLM provider should the platform use?")
    send(child, DOWN); send(child, DOWN); send(child, DOWN); send(child, DOWN)  # "Both" (skips the no-provider sentinel + ollama/cloud/vertex)
    send(child, ENTER)
    expect_screen(child, "Where is your Ollama?")
    send(child, ENTER)
    # AWS Bedrock picker — inline IAM (no ~/.aws in sandbox).
    expect_screen(child, "AWS Bedrock (Claude via IAM)")
    send(child, ENTER)                        # "Enter IAM access key"
    expect_screen(child, "IAM access key")
    clear_and_enter(child, "eu-west-1")        # region (clear default us-east-1)
    type_and_enter(child, "AKIA-SKIP")        # access key id
    type_and_enter(child, "skip-secret")      # secret access key

    expect_screen(child, "Which MCPs do you want enabled?")
    send(child, "a")                          # all on
    send(child, ENTER)

    # Skip AWS / Azure / GCP. Kubernetes/GitHub/etc. are fields-type (no skip),
    # so we just press Enter through them leaving values empty.
    expect_screen(child, "AWS: credentials")
    send(child, DOWN)                         # past stub
    send(child, DOWN)                         # past paste
    send(child, ENTER)                        # Skip

    expect_screen(child, "Azure: credentials")
    send(child, DOWN)
    send(child, DOWN)
    send(child, ENTER)

    expect_screen(child, "GCP: credentials")
    send(child, DOWN)
    send(child, DOWN)
    send(child, ENTER)

    expect_screen(child, "Kubernetes: credentials")
    send(child, ENTER)                        # empty kubeconfig
    expect_screen(child, "GitHub: credentials")
    send(child, ENTER)                        # empty token
    expect_screen(child, "Prometheus: credentials")
    send(child, ENTER); send(child, ENTER); send(child, ENTER)
    expect_screen(child, "Loki: credentials")
    send(child, ENTER); send(child, ENTER); send(child, ENTER)


    expect_screen(child, "Review & launch")
    send(child, ENTER)

    expect_screen(child, "dry-run", timeout=15.0)


def assert_skip_all_cloud(env: dict[str, str]) -> list[str]:
    fails = []
    mcps = set(env.get("MCPS_ENABLED", "").split(","))
    for skipped in ("aws", "azure", "gcp"):
        if skipped in mcps:
            fails.append(f"{skipped} should have been skipped out of MCPS_ENABLED, got {mcps}")
        # per-MCP var should be true (disabled)
        evar = {"aws": "OpenAgentic_AWS_MCP_DISABLED",
                "azure": "OpenAgentic_AZURE_MCP_DISABLED",
                "gcp": "OpenAgentic_GCP_MCP_DISABLED"}[skipped]
        if env.get(evar) != "true":
            fails.append(f"{evar} should be true after skip, got {env.get(evar)!r}")
    # Fields-type MCPs with empty values are still "enabled" (user said yes to the MCP),
    # so github/kubernetes/prometheus/loki must remain in MCPS_ENABLED.
    for still_on in ("kubernetes", "github", "prometheus", "loki"):
        if still_on not in mcps:
            fails.append(f"{still_on} expected to remain enabled (fields blank is OK)")
    return fails


def script_cloud_only(child: pexpect.spawn) -> None:
    """LLM strategy = AWS Bedrock (cloud) only. Verifies the Ollama step is
    skipped and the Bedrock IAM picker (inline keys path) is captured. The
    sandboxed HOME has no ~/.aws so the host-creds option is NOT offered —
    the mode menu is [inline, profile] with inline first."""
    expect_screen(child, "Where do you want to run openagentic?")
    send(child, ENTER)
    expect_screen(child, "Create your admin account")
    send(child, ENTER)
    type_and_enter(child, "passw0rd!")

    expect_screen(child, "Which LLM provider should the platform use?")
    send(child, DOWN); send(child, DOWN)                      # "AWS Bedrock" (skips the no-provider sentinel + ollama)
    send(child, ENTER)

    # Ollama step MUST be skipped — we should land on the Bedrock picker next.
    expect_screen(child, "AWS Bedrock (Claude via IAM)")
    send(child, ENTER)                         # pick "Enter IAM access key" (first, no ~/.aws)

    expect_screen(child, "IAM access key")     # the inline IAM field screen
    clear_and_enter(child, "us-west-2")        # region (clear default us-east-1)
    type_and_enter(child, "AKIA-CLOUD-ONLY")   # access key id
    type_and_enter(child, "cloud-only-secret") # secret access key

    expect_screen(child, "Which MCPs do you want enabled?")
    send(child, "n")                           # clear all
    send(child, SPACE)                         # web on
    send(child, ENTER)

    expect_screen(child, "Review & launch")
    send(child, ENTER)
    expect_screen(child, "dry-run", timeout=15.0)


# The Claude Sonnet 4.6 Bedrock model id the wizard seeds as the default chat
# (and flows) model. MUST stay in lockstep with Launch.tsx BEDROCK_CHAT_MODEL.
BEDROCK_CHAT_MODEL = "anthropic.claude-sonnet-4-6"


def assert_cloud_only(env: dict[str, str]) -> list[str]:
    fails = []
    # Ollama fully off in cloud-only mode.
    if env.get("OLLAMA_ENABLED") != "false":
        fails.append(f"OLLAMA_ENABLED expected 'false', got {env.get('OLLAMA_ENABLED')!r}")
    if env.get("OLLAMA_HOST"):
        fails.append(f"OLLAMA_HOST should NOT be set in cloud-only mode, got {env.get('OLLAMA_HOST')!r}")

    # AWS Bedrock inline-IAM env.
    if env.get("AWS_REGION") != "us-west-2":
        fails.append(f"AWS_REGION expected 'us-west-2', got {env.get('AWS_REGION')!r}")
    if env.get("AWS_ACCESS_KEY_ID") != "AKIA-CLOUD-ONLY":
        fails.append(f"AWS_ACCESS_KEY_ID expected 'AKIA-CLOUD-ONLY', got {env.get('AWS_ACCESS_KEY_ID')!r}")
    if env.get("AWS_SECRET_ACCESS_KEY") != "cloud-only-secret":
        fails.append(f"AWS_SECRET_ACCESS_KEY expected 'cloud-only-secret', got {env.get('AWS_SECRET_ACCESS_KEY')!r}")

    # Bootstrap provider must be aws-bedrock with Sonnet 4.6 as default chat.
    if env.get("BOOTSTRAP_PROVIDER_TYPE") != "aws-bedrock":
        fails.append(f"BOOTSTRAP_PROVIDER_TYPE expected 'aws-bedrock', got {env.get('BOOTSTRAP_PROVIDER_TYPE')!r}")
    if env.get("BOOTSTRAP_PROVIDER_NAME") != "aws-bedrock":
        fails.append(f"BOOTSTRAP_PROVIDER_NAME expected 'aws-bedrock', got {env.get('BOOTSTRAP_PROVIDER_NAME')!r}")
    defaults = env.get("BOOTSTRAP_PROVIDER_DEFAULTS", "")
    try:
        import json as _json
        chat = _json.loads(defaults).get("chat")
    except Exception:
        chat = None
    if chat != BEDROCK_CHAT_MODEL:
        fails.append(f"BOOTSTRAP_PROVIDER_DEFAULTS.chat expected {BEDROCK_CHAT_MODEL!r}, got {chat!r} (raw={defaults!r})")
    cfg = env.get("BOOTSTRAP_PROVIDER_CONFIG", "")
    if '"region"' not in cfg or "us-west-2" not in cfg:
        fails.append(f"BOOTSTRAP_PROVIDER_CONFIG should carry region us-west-2, got {cfg!r}")
    if not env.get("SEEDER_VERSION"):
        fails.append("SEEDER_VERSION should be set on a Bedrock install")

    # NO raw provider API keys may EVER be written (IAM-only product decision).
    for forbidden in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY",
                      "GOOGLE_GENERATIVE_AI_API_KEY", "AZURE_OPENAI_API_KEY"):
        if env.get(forbidden):
            fails.append(f"{forbidden} must NOT be written (IAM-only), got {env.get(forbidden)!r}")
    return fails


def script_bedrock_both(child: pexpect.spawn) -> None:
    """LLM strategy = Both (gpt-oss:20b local + AWS Bedrock chat default,
    Ollama embeddings), inline IAM. Asserts OLLAMA_CHAT_MODEL=gpt-oss:20b is
    written (so the secondary-Ollama seeder lands a SECOND, selectable chat
    model at lower precedence) while Bedrock stays the bootstrap chat default."""
    expect_screen(child, "Where do you want to run openagentic?")
    send(child, ENTER)
    expect_screen(child, "Create your admin account")
    send(child, ENTER)
    type_and_enter(child, "passw0rd!")

    expect_screen(child, "Which LLM provider should the platform use?")
    send(child, DOWN); send(child, DOWN); send(child, DOWN); send(child, DOWN)  # "Both" (skips the no-provider sentinel + ollama/cloud/vertex)
    send(child, ENTER)

    expect_screen(child, "Where is your Ollama?")
    send(child, ENTER)                         # accept default host

    # Bedrock IAM picker (no ~/.aws → inline first).
    expect_screen(child, "AWS Bedrock (Claude via IAM)")
    send(child, ENTER)                         # "Enter IAM access key"
    expect_screen(child, "IAM access key")
    clear_and_enter(child, "us-east-1")        # region (clear prefilled default, don't append)
    type_and_enter(child, "AKIA-BOTH-XYZ")
    type_and_enter(child, "both-secret-xyz")

    expect_screen(child, "Which MCPs do you want enabled?")
    send(child, "n")
    send(child, SPACE)                         # web on
    send(child, ENTER)

    expect_screen(child, "Review & launch")
    send(child, ENTER)
    expect_screen(child, "dry-run", timeout=15.0)


def assert_bedrock_both(env: dict[str, str]) -> list[str]:
    fails = []
    # Ollama ON for embeddings.
    if env.get("OLLAMA_ENABLED") != "true":
        fails.append(f"OLLAMA_ENABLED expected 'true' (embeddings), got {env.get('OLLAMA_ENABLED')!r}")
    if env.get("OLLAMA_EMBED_MODEL") != "nomic-embed-text":
        fails.append(f"OLLAMA_EMBED_MODEL expected 'nomic-embed-text', got {env.get('OLLAMA_EMBED_MODEL')!r}")
    # SECOND chat model: gpt-oss:20b is seeded as a selectable Ollama chat
    # provider at LOWER precedence (priority 50 > Bedrock's 10), so Bedrock
    # stays the default while gpt-oss:20b is also pickable.
    if env.get("OLLAMA_CHAT_MODEL") != "gpt-oss:20b":
        fails.append(f"OLLAMA_CHAT_MODEL expected 'gpt-oss:20b' under 'both', got {env.get('OLLAMA_CHAT_MODEL')!r}")
    # Bedrock is the sole chat bootstrap provider.
    if env.get("BOOTSTRAP_PROVIDER_TYPE") != "aws-bedrock":
        fails.append(f"BOOTSTRAP_PROVIDER_TYPE expected 'aws-bedrock', got {env.get('BOOTSTRAP_PROVIDER_TYPE')!r}")
    import json as _json
    try:
        d = _json.loads(env.get("BOOTSTRAP_PROVIDER_DEFAULTS", ""))
    except Exception:
        d = {}
    if d.get("chat") != BEDROCK_CHAT_MODEL:
        fails.append(f"DEFAULTS.chat expected {BEDROCK_CHAT_MODEL!r}, got {d.get('chat')!r}")
    if d.get("embedding") != "nomic-embed-text":
        fails.append(f"DEFAULTS.embedding expected 'nomic-embed-text', got {d.get('embedding')!r}")
    if d.get("embeddingDimension") != 768:
        fails.append(f"DEFAULTS.embeddingDimension expected 768, got {d.get('embeddingDimension')!r}")
    # Region must be exactly the typed value — guards the prefilled-field append bug
    # (clear_and_enter, not type_and_enter) that produced AWS_REGION=us-east-1us-east-1.
    if env.get("AWS_REGION") != "us-east-1":
        fails.append(f"AWS_REGION expected 'us-east-1', got {env.get('AWS_REGION')!r}")
    if "us-east-1us-east-1" in env.get("BOOTSTRAP_PROVIDER_CONFIG", ""):
        fails.append(f"BOOTSTRAP_PROVIDER_CONFIG has a doubled region (prefill-append bug): {env.get('BOOTSTRAP_PROVIDER_CONFIG')!r}")
    if env.get("AWS_ACCESS_KEY_ID") != "AKIA-BOTH-XYZ":
        fails.append(f"AWS_ACCESS_KEY_ID expected 'AKIA-BOTH-XYZ', got {env.get('AWS_ACCESS_KEY_ID')!r}")
    for forbidden in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        if env.get(forbidden):
            fails.append(f"{forbidden} must NOT be written (IAM-only), got {env.get(forbidden)!r}")
    return fails


VARIATIONS: list[Variation] = [
    Variation(
        name="minimal",
        description="Accept defaults (Both: Ollama embed + Bedrock chat), 1 MCP (web), no raw keys",
        script=script_minimal,
        assertions=assert_minimal,
    ),
    Variation(
        name="all-mcps-inline",
        description="Enable every MCP, paste creds inline",
        script=script_all_mcps_inline,
        assertions=assert_all_mcps_inline,
    ),
    Variation(
        name="skip-all-cloud",
        description="Enable all MCPs but skip aws/azure/gcp when asked",
        script=script_skip_all_cloud,
        assertions=assert_skip_all_cloud,
    ),
    Variation(
        name="cloud-only",
        description="AWS Bedrock only → no Ollama, inline IAM, Sonnet 4.6 default, no raw keys",
        script=script_cloud_only,
        assertions=assert_cloud_only,
    ),
    Variation(
        name="bedrock-both",
        description="Both: gpt-oss:20b (2nd chat) + Bedrock default chat + Ollama embeddings; OLLAMA_CHAT_MODEL=gpt-oss:20b",
        script=script_bedrock_both,
        assertions=assert_bedrock_both,
    ),
]


def run(variation: Variation) -> bool:
    # Fresh repo-root .env each run so assertions are hermetic.
    if ENV_FILE.exists():
        ENV_FILE.unlink()

    env = os.environ.copy()
    env["WIZARD_DRY_RUN"] = "1"
    env["FORCE_COLOR"] = "0"          # ink honours this — fewer ANSI codes
    env["TERM"] = "xterm-256color"
    # Ink disables interactivity in CI; drop those vars even if our parent has them.
    for k in ("CI", "GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI", "TRAVIS"):
        env.pop(k, None)

    # Sandbox HOME so the new hostCreds.detect() probes (~/.aws, ~/.azure,
    # ~/.config/gcloud, ~/.kube) return false consistently — otherwise the
    # menu grows an extra "Use my host CLI creds" option and the existing
    # DOWN-press counts in each script go off by one.
    import tempfile
    sandbox_home = tempfile.mkdtemp(prefix="oa-wizard-pty-")
    env["HOME"] = sandbox_home

    env.update(variation.env_overrides)

    child = pexpect.spawn(
        str(TSX_BIN), ["src/index.tsx"],
        cwd=str(SETUP_DIR),
        env=env,
        encoding=None,                # raw bytes so we strip ANSI ourselves
        dimensions=(50, 140),
        timeout=10,
    )

    try:
        variation.script(child)
    except AssertionError as e:
        print(f"\n  ✗ {variation.name}: {e}")
        try: child.terminate(force=True)
        except Exception: pass
        return False
    finally:
        try: child.expect(pexpect.EOF, timeout=5)
        except Exception: pass
        try: child.close(force=True)
        except Exception: pass

    env_out = parse_env(ENV_FILE)
    fails = variation.assertions(env_out)
    if fails:
        print(f"\n  ✗ {variation.name}: .env assertions failed:")
        for f in fails: print(f"      - {f}")
        return False
    print(f"  ✓ {variation.name}: {variation.description}")
    return True


def main() -> int:
    if not TSX_BIN.exists():
        print(f"tsx not found at {TSX_BIN}. Run 'npm install' in tools/setup first.")
        return 2
    if not ENV_EXAMPLE.exists():
        print(f"missing {ENV_EXAMPLE}. Wizard needs it as a template.")
        return 2

    requested = set(sys.argv[1:])
    runs = [v for v in VARIATIONS if not requested or v.name in requested]
    if not runs:
        print(f"no variations matched {requested}; known: {[v.name for v in VARIATIONS]}")
        return 2

    print(f"openagentic wizard PTY harness — {len(runs)} variation(s)\n")
    results = [(v.name, run(v)) for v in runs]

    print("\nsummary:")
    for name, ok in results:
        print(f"  {'✓' if ok else '✗'}  {name}")
    return 0 if all(ok for _, ok in results) else 1


if __name__ == "__main__":
    sys.exit(main())
