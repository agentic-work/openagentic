#!/usr/bin/env python3
"""
harness_lib — PURE, side-effect-free helpers for the Helm deployment-acceptance
harness (verify_deployment.py).

Everything in this module is deterministic and importable so it can be unit
tested WITHOUT a live cluster, a network, or kubectl:

  * MCP_PROBES        — the per-MCP probe table (9 MCPs): probe prompt,
                        expected tool name(s)/server, data sanity check.
  * Status / Row      — the matrix value types.
  * audit_row_matches — the "did this MCP's tool actually execute?" oracle that
                        matches a GET /api/admin/audit-log row against an MCP probe.
  * find_audit_match  — scan a page of audit rows for the first match.
  * decide_mcp_skip   — the credential/feature-aware SKIP policy: given what the
                        cluster reports as enabled+configured, decide whether an
                        MCP should be PROBED or SKIPPED (with a reason).
  * sanity_check_*     — the per-MCP data sanity checks (pure regex/predicate).
  * format_matrix      — render the human-readable PASS/FAIL/SKIP table.
  * summarize          — machine-readable JSON summary + the exit-code rule.
  * exit_code_for      — the single exit-code rule (non-zero iff any non-skip fails).

The live runner (verify_deployment.py) does all the I/O — kubectl, HTTP, polling —
and calls into these helpers. Keeping them pure is what makes the harness
trustworthy: the matrix logic is tested, not just asserted live.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Iterable, Optional


# ─────────────────────────────────────────────────────────────────────────────
# Status + row types
# ─────────────────────────────────────────────────────────────────────────────
class Status(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    SKIP = "SKIP"

    def __str__(self) -> str:  # so f"{status}" prints PASS not Status.PASS
        return self.value


@dataclass
class Row:
    """One row in the acceptance matrix."""
    check: str          # e.g. "MCP:aws" / "HEALTH" / "FLOW:incident-triage"
    status: Status
    detail: str = ""

    def as_dict(self) -> dict:
        return {"check": self.check, "status": self.status.value, "detail": self.detail}


# ─────────────────────────────────────────────────────────────────────────────
# Per-MCP probe table
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class McpProbe:
    """
    Everything the harness needs to (a) decide if an MCP is configured, and
    (b) prove ONE known READ tool of that MCP actually executed in chat.

    expect_tools : tool names that, if any appears in an audit row's tool_name,
                   prove THIS MCP's READ tool ran. Matched loosely (substring,
                   case-insensitive) because the audit log stores the model-facing
                   tool name which may be server-prefixed (e.g.
                   "openagentic_aws.aws_sts_get_caller_identity" or just
                   "aws_sts_get_caller_identity").
    server       : the MCP proxy server id, also matched against audit
                   `server_name` as a fallback oracle.
    sanity       : predicate over the streamed chat response text — a cheap
                   "did real data come back" check. Returns True when the data
                   looks real. Used only as a secondary signal; the audit row is
                   the PRIMARY execution oracle.
    needs_creds  : True for MCPs that require external credentials (cloud, github,
                   monitoring). web/admin are credential-free and ship
                   enabled by default.
    """
    mcp: str
    label: str
    server: str
    probe_prompt: str
    expect_tools: tuple[str, ...]
    sanity: Callable[[str], bool]
    needs_creds: bool = True


def _has(pattern: str) -> Callable[[str], bool]:
    rx = re.compile(pattern, re.I)
    return lambda text: bool(rx.search(text or ""))


def _nonempty_min(n: int) -> Callable[[str], bool]:
    return lambda text: len((text or "").strip()) >= n


# The 9 built-in MCPs. The probe prompt is phrased to trigger exactly ONE
# known, side-effect-free READ tool per MCP. expect_tools are the audit
# tool_name fragments that prove that tool ran.
MCP_PROBES: tuple[McpProbe, ...] = (
    McpProbe(
        mcp="aws", label="AWS", server="aws",
        probe_prompt="Use the aws MCP to call STS get-caller-identity and report the Account, UserId and Arn.",
        expect_tools=("aws_sts_get_caller_identity", "get_caller_identity", "sts"),
        sanity=_has(r'"?Account"?\s*[:=]\s*"?\d{12}|arn:aws:'),
    ),
    McpProbe(
        mcp="azure", label="Azure", server="azure",
        probe_prompt="Use the azure MCP to list my Azure subscriptions (subscriptionId, displayName, state).",
        expect_tools=("azure_list_subscriptions", "list_subscriptions", "subscriptions"),
        sanity=_has(r'subscriptionId|/subscriptions/[0-9a-f-]{36}'),
    ),
    McpProbe(
        mcp="gcp", label="GCP", server="gcp",
        probe_prompt="Use the gcp MCP to list my GCP projects (projectId, name, lifecycleState).",
        expect_tools=("gcp_list_projects", "list_projects", "projects"),
        sanity=_has(r'projectId|lifecycleState'),
    ),
    McpProbe(
        mcp="kubernetes", label="Kubernetes", server="kubernetes",
        probe_prompt="Use the kubernetes MCP to list pods in the kube-system namespace; just the names.",
        expect_tools=("k8s_list_pods", "list_pods", "get_pods"),
        sanity=_has(r'kube-(?:proxy|apiserver|scheduler|controller|dns)|coredns|metrics-server|Running'),
    ),
    McpProbe(
        mcp="prometheus", label="Prometheus", server="prometheus",
        probe_prompt="Use the prometheus MCP to run the instant PromQL query `up` and tell me how many targets are up.",
        expect_tools=("prometheus_query", "prom_query", "query"),
        sanity=_has(r'\bup\b|value|metric|target'),
    ),
    McpProbe(
        mcp="loki", label="Loki", server="loki",
        probe_prompt="Use the loki MCP to search for recent error log lines in the last 15 minutes.",
        expect_tools=("loki_search_errors", "loki_query", "search_errors"),
        sanity=_has(r'error|log|stream|line|no results|0 results'),
    ),
    McpProbe(
        mcp="github", label="GitHub", server="github",
        probe_prompt="Use the github MCP to get the authenticated user (login, name).",
        expect_tools=("github_get_me", "get_authenticated_user", "get_me", "get_user"),
        sanity=_has(r'"?login"?\s*[:=]|github\.com'),
    ),
    McpProbe(
        mcp="admin", label="Admin", server="admin",
        probe_prompt="Use the admin MCP to report the platform health / status summary.",
        expect_tools=("admin_health", "admin_status", "get_health", "health", "status"),
        sanity=_has(r'health|status|ok|connected|user'),
        needs_creds=False,
    ),
    McpProbe(
        mcp="web", label="Web", server="web",
        probe_prompt="Use the web MCP to search the web for 'OpenAgentic open source agentic platform' and summarize the top result.",
        expect_tools=("web_search", "search_web", "web_fetch", "fetch"),
        sanity=_nonempty_min(40),
        needs_creds=False,
    ),
)

# The canonical 9-MCP id list (order = probe order).
ALL_MCP_IDS: tuple[str, ...] = tuple(p.mcp for p in MCP_PROBES)


def probe_for(mcp: str) -> Optional[McpProbe]:
    for p in MCP_PROBES:
        if p.mcp == mcp:
            return p
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Credential / feature-aware SKIP policy
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class McpClusterState:
    """
    What the cluster (kubectl / helm / proxy tool-list) reports about an MCP.
    All fields default to the conservative "unknown / off" so a partial probe
    never produces a false PASS.

    enabled       : the mcp-proxy reports this server enabled (env flag /
                    /servers/enabled / MCPS_ENABLED). None = unknown.
    creds_present : a non-empty credential signal exists (k8s secret key, mounted
                    cloud-secret, env var). None = unknown.
    tools_listed  : the proxy/api lists >=1 tool for this server. None = unknown.
    """
    enabled: Optional[bool] = None
    creds_present: Optional[bool] = None
    tools_listed: Optional[bool] = None


@dataclass
class SkipDecision:
    probe: bool          # True → run the chat+audit probe; False → SKIP
    reason: str          # human-readable reason (always set)


def decide_mcp_skip(probe: McpProbe, state: McpClusterState) -> SkipDecision:
    """
    Decide whether to PROBE or SKIP an MCP, credential/feature-aware.

    Rules (a SKIP must always carry a precise reason — never a false FAIL):
      1. Explicitly disabled on the proxy → SKIP "not enabled".
      2. Needs creds AND no creds detected → SKIP "no creds".
      3. Enabled but proxy lists zero tools for it → SKIP "enabled but no tools listed".
      4. Otherwise → PROBE.

    A credential-free MCP (web/admin) with enabled in (True, None)
    is probed; it only skips if explicitly disabled or tool-less.
    """
    if state.enabled is False:
        return SkipDecision(False, "not enabled on this deployment")

    if probe.needs_creds and state.creds_present is False:
        return SkipDecision(False, "no creds configured on this deployment")

    # Enabled (or unknown) but the proxy explicitly lists no tools for it.
    if state.tools_listed is False and state.enabled is True:
        return SkipDecision(False, "enabled but proxy lists no tools (not ready)")

    if state.enabled is None and probe.needs_creds and state.creds_present is None:
        # Cred-gated MCP, cluster gave us no signal either way → can't safely
        # assert it works; skip honestly rather than false-fail.
        return SkipDecision(False, "enablement/creds unknown (no cluster signal)")

    return SkipDecision(True, "enabled and configured")


# ─────────────────────────────────────────────────────────────────────────────
# Audit-log execution oracle
# ─────────────────────────────────────────────────────────────────────────────
def _norm(s: Any) -> str:
    return str(s or "").strip().lower()


def audit_row_matches(probe: McpProbe, row: dict) -> bool:
    """
    Did THIS audit row prove `probe`'s READ tool executed?

    An audit row (GET /api/admin/audit-log → data[]) looks like:
      { tool_name, server_name, classification, decision, ... }

    Match if EITHER:
      * any of probe.expect_tools is a substring of row.tool_name, OR
      * row.server_name matches probe.server (covers tool names we didn't enumerate).
    The audit log is the execution oracle: a row existing at all means the tool
    was dispatched through the audited seam.
    """
    tool_name = _norm(row.get("tool_name"))
    server_name = _norm(row.get("server_name"))
    if not tool_name and not server_name:
        return False

    for frag in probe.expect_tools:
        if _norm(frag) and _norm(frag) in tool_name:
            return True

    # server fallback: the audit row attributes to this MCP's server.
    if server_name and (_norm(probe.server) == server_name
                        or _norm(probe.server) in server_name
                        or server_name in _norm(probe.server)):
        # require the tool_name to at least be non-empty (a real dispatch)
        return bool(tool_name)

    return False


def find_audit_match(probe: McpProbe, rows: Iterable[dict]) -> Optional[dict]:
    """Return the first audit row that proves probe's tool ran, else None."""
    for row in rows or []:
        if audit_row_matches(probe, row):
            return row
    return None


def classify_audit_decision(row: dict) -> str:
    """Normalize the audit decision field ('auto'|'approved'|'denied'|'pending'|…)."""
    return _norm(row.get("decision")) or "unknown"


# ─────────────────────────────────────────────────────────────────────────────
# Matrix formatter + JSON summary + exit-code rule
# ─────────────────────────────────────────────────────────────────────────────
_STATUS_GLYPH = {
    Status.PASS: "PASS",
    Status.FAIL: "FAIL",
    Status.SKIP: "SKIP",
}


def format_matrix(rows: list[Row], color: bool = False) -> str:
    """
    Render the acceptance matrix as a fixed-width table:

        CHECK                STATUS  DETAIL
        ───────────────────  ──────  ────────────────────────────
        HEALTH               PASS    db/redis/milvus connected; 9 pods Ready
        MCP:aws              SKIP    no creds configured on this deployment
        ...
    """
    if not rows:
        return "(no checks ran)"

    check_w = max(5, max(len(r.check) for r in rows))
    status_w = 6

    def colorize(status: Status, text: str) -> str:
        if not color:
            return text
        code = {Status.PASS: "\033[32m", Status.FAIL: "\033[31m", Status.SKIP: "\033[33m"}[status]
        return f"{code}{text}\033[0m"

    header = f"{'CHECK'.ljust(check_w)}  {'STATUS'.ljust(status_w)}  DETAIL"
    sep = f"{'─' * check_w}  {'─' * status_w}  {'─' * 40}"
    lines = [header, sep]
    for r in rows:
        glyph = _STATUS_GLYPH[r.status].ljust(status_w)
        lines.append(f"{r.check.ljust(check_w)}  {colorize(r.status, glyph)}  {r.detail}")
    return "\n".join(lines)


def summarize(rows: list[Row]) -> dict:
    """Machine-readable summary: counts + the full matrix + pass/fail verdict."""
    counts = {"PASS": 0, "FAIL": 0, "SKIP": 0, "TOTAL": len(rows)}
    for r in rows:
        counts[r.status.value] += 1
    failed = [r.check for r in rows if r.status is Status.FAIL]
    return {
        "ok": counts["FAIL"] == 0,
        "counts": counts,
        "failed_checks": failed,
        "matrix": [r.as_dict() for r in rows],
    }


def exit_code_for(rows: list[Row]) -> int:
    """
    The single exit-code rule: non-zero iff ANY non-skipped check FAILED.
    SKIP never contributes to the exit code (skips are honest, not failures).
    An empty matrix is a failure (nothing was verified).
    """
    if not rows:
        return 1
    return 1 if any(r.status is Status.FAIL for r in rows) else 0
