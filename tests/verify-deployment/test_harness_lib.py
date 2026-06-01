#!/usr/bin/env python3
"""
Unit tests for harness_lib — the PURE helpers behind the Helm
deployment-acceptance harness. No cluster, no network, no kubectl.

Run:
  python3 -m pytest tests/verify-deployment/test_harness_lib.py -q
  # or, dependency-free:
  python3 tests/verify-deployment/test_harness_lib.py
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness_lib import (  # noqa: E402
    ALL_MCP_IDS,
    MCP_PROBES,
    McpClusterState,
    Row,
    Status,
    audit_row_matches,
    classify_audit_decision,
    decide_mcp_skip,
    exit_code_for,
    find_audit_match,
    format_matrix,
    probe_for,
    summarize,
)


# ─── probe table ─────────────────────────────────────────────────────────────
def test_probe_table_covers_all_14_mcps():
    expected = {
        "aws", "azure", "gcp", "kubernetes", "prometheus", "loki",
        "alertmanager", "github", "admin", "agent-architect", "incident",
        "knowledge", "runbook", "web",
    }
    assert set(ALL_MCP_IDS) == expected
    assert len(MCP_PROBES) == 14
    # ids unique
    assert len(set(ALL_MCP_IDS)) == 14


def test_every_probe_is_well_formed():
    for p in MCP_PROBES:
        assert p.probe_prompt and isinstance(p.probe_prompt, str)
        assert p.expect_tools and all(t for t in p.expect_tools)
        assert callable(p.sanity)
        assert p.server


def test_credential_free_mcps_flagged():
    free = {p.mcp for p in MCP_PROBES if not p.needs_creds}
    # The open-dev default set + safe built-ins.
    assert {"web", "knowledge", "admin"}.issubset(free)
    # Cloud + monitoring + github require creds.
    for needs in ("aws", "azure", "gcp", "kubernetes", "github", "prometheus", "loki", "alertmanager"):
        assert probe_for(needs).needs_creds is True


def test_sanity_checks_are_meaningful():
    aws = probe_for("aws")
    assert aws.sanity('{"Account":"123456789012"}') is True
    assert aws.sanity("arn:aws:iam::123456789012:user/x") is True
    assert aws.sanity("the weather is nice") is False
    k8s = probe_for("kubernetes")
    assert k8s.sanity("coredns-abc Running") is True
    web = probe_for("web")
    assert web.sanity("x") is False
    assert web.sanity("a long enough summary of the top web result " * 2) is True


# ─── skip policy ─────────────────────────────────────────────────────────────
def test_skip_when_not_enabled():
    d = decide_mcp_skip(probe_for("aws"), McpClusterState(enabled=False, creds_present=True))
    assert d.probe is False
    assert "not enabled" in d.reason


def test_skip_cred_gated_without_creds():
    d = decide_mcp_skip(probe_for("aws"), McpClusterState(enabled=True, creds_present=False))
    assert d.probe is False
    assert "no creds" in d.reason


def test_probe_cred_gated_with_creds():
    d = decide_mcp_skip(
        probe_for("aws"),
        McpClusterState(enabled=True, creds_present=True, tools_listed=True),
    )
    assert d.probe is True


def test_credfree_mcp_probed_when_enabled():
    d = decide_mcp_skip(
        probe_for("web"),
        McpClusterState(enabled=True, creds_present=None, tools_listed=True),
    )
    assert d.probe is True


def test_credfree_mcp_probed_when_enablement_unknown():
    # web has needs_creds=False, so unknown enablement should still probe
    d = decide_mcp_skip(probe_for("web"), McpClusterState())
    assert d.probe is True


def test_cred_gated_unknown_signal_skips_not_false_fails():
    # aws needs creds; cluster gave NO signal → must SKIP honestly, never FAIL.
    d = decide_mcp_skip(probe_for("aws"), McpClusterState())
    assert d.probe is False
    assert "unknown" in d.reason


def test_enabled_but_no_tools_skips():
    d = decide_mcp_skip(
        probe_for("knowledge"),
        McpClusterState(enabled=True, creds_present=None, tools_listed=False),
    )
    assert d.probe is False
    assert "no tools" in d.reason


# ─── audit oracle ────────────────────────────────────────────────────────────
def test_audit_match_by_tool_name_substring():
    p = probe_for("aws")
    row = {"tool_name": "openagentic_aws.aws_sts_get_caller_identity", "server_name": "aws", "decision": "auto"}
    assert audit_row_matches(p, row) is True


def test_audit_match_by_bare_tool_name():
    p = probe_for("kubernetes")
    row = {"tool_name": "k8s_list_pods", "server_name": None, "decision": "auto"}
    assert audit_row_matches(p, row) is True


def test_audit_match_by_server_fallback():
    p = probe_for("loki")
    # tool name we didn't enumerate, but server attributes to loki + tool present
    row = {"tool_name": "loki_tail_stream", "server_name": "loki", "decision": "auto"}
    assert audit_row_matches(p, row) is True


def test_audit_no_match_for_other_mcp():
    p = probe_for("aws")
    row = {"tool_name": "k8s_list_pods", "server_name": "kubernetes", "decision": "auto"}
    assert audit_row_matches(p, row) is False


def test_audit_no_match_on_empty_row():
    p = probe_for("aws")
    assert audit_row_matches(p, {"tool_name": "", "server_name": ""}) is False
    assert audit_row_matches(p, {}) is False


def test_find_audit_match_returns_first():
    p = probe_for("web")
    rows = [
        {"tool_name": "k8s_list_pods", "server_name": "kubernetes"},
        {"tool_name": "web_search", "server_name": "web", "decision": "auto"},
        {"tool_name": "web_fetch", "server_name": "web"},
    ]
    hit = find_audit_match(p, rows)
    assert hit is not None
    assert hit["tool_name"] == "web_search"


def test_find_audit_match_none():
    assert find_audit_match(probe_for("aws"), []) is None
    assert find_audit_match(probe_for("aws"), [{"tool_name": "x", "server_name": "y"}]) is None


def test_classify_audit_decision():
    assert classify_audit_decision({"decision": "AUTO"}) == "auto"
    assert classify_audit_decision({"decision": "approved"}) == "approved"
    assert classify_audit_decision({}) == "unknown"


# ─── matrix formatter ────────────────────────────────────────────────────────
def test_format_matrix_contains_all_rows():
    rows = [
        Row("HEALTH", Status.PASS, "all green"),
        Row("MCP:aws", Status.SKIP, "no creds"),
        Row("MCP:web", Status.FAIL, "tool did not execute"),
    ]
    out = format_matrix(rows)
    assert "HEALTH" in out and "PASS" in out
    assert "MCP:aws" in out and "SKIP" in out
    assert "MCP:web" in out and "FAIL" in out
    assert "all green" in out


def test_format_matrix_empty():
    assert "no checks" in format_matrix([]).lower()


def test_format_matrix_color_wraps_ansi():
    out = format_matrix([Row("X", Status.PASS, "y")], color=True)
    assert "\033[32m" in out  # green for PASS


# ─── summary + exit code ─────────────────────────────────────────────────────
def test_summarize_counts_and_ok():
    rows = [
        Row("A", Status.PASS),
        Row("B", Status.SKIP, "skipped"),
        Row("C", Status.PASS),
    ]
    s = summarize(rows)
    assert s["ok"] is True
    assert s["counts"] == {"PASS": 2, "FAIL": 0, "SKIP": 1, "TOTAL": 3}
    assert s["failed_checks"] == []
    # round-trips as JSON
    json.dumps(s)


def test_summarize_with_failure():
    rows = [Row("A", Status.PASS), Row("B", Status.FAIL, "boom")]
    s = summarize(rows)
    assert s["ok"] is False
    assert s["failed_checks"] == ["B"]


def test_exit_code_zero_when_no_failures():
    rows = [Row("A", Status.PASS), Row("B", Status.SKIP)]
    assert exit_code_for(rows) == 0


def test_exit_code_nonzero_on_any_fail():
    rows = [Row("A", Status.PASS), Row("B", Status.FAIL), Row("C", Status.SKIP)]
    assert exit_code_for(rows) == 1


def test_exit_code_skip_only_is_zero():
    # An all-SKIP run (nothing configured) is not a failure.
    rows = [Row("A", Status.SKIP), Row("B", Status.SKIP)]
    assert exit_code_for(rows) == 0


def test_exit_code_empty_matrix_is_failure():
    # Nothing verified → treat as failure (non-vacuous).
    assert exit_code_for([]) == 1


# ─── tiny dependency-free runner ─────────────────────────────────────────────
def _main() -> int:
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"  ok   {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  ERR  {fn.__name__}: {type(e).__name__}: {e}")
    total = len(fns)
    print(f"\n{total - failed}/{total} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_main())
