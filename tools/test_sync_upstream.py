#!/usr/bin/env python3
"""
Round-trip regression for tools/sync-upstream.py's brand-rewrite pass.

The headline guarantee: the LEGIT vendored package scope `@agentic-work/...`
(and the container registry org `ghcr.io/agentic-work`) MUST survive a rewrite
pass untouched. A prior `AGENTIC_PREFIX` regex corrupted `@agentic-work/llm-sdk`
→ `@openagentic-work/llm-sdk` on every sync, breaking ~40 non-preserved consumer
imports against the (preserved) package name. This test pins that fix and makes
sure the prefix rewrite still folds the genuinely-proprietary `agentic-…` ids.

Run:
  python3 tools/test_sync_upstream.py      # exits non-zero on any failure
"""
import importlib.util
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))


def _load_sync_module():
    """Import sync-upstream.py (hyphenated filename) without running main()."""
    path = os.path.join(_HERE, "sync-upstream.py")
    spec = importlib.util.spec_from_file_location("sync_upstream", path)
    mod = importlib.util.module_from_spec(spec)
    # main() is guarded by `if __name__ == '__main__'`; module load only binds
    # constants/functions (no filesystem I/O), so this is side-effect free.
    spec.loader.exec_module(mod)
    return mod


SYNC = _load_sync_module()


# (input, expected) — exhaustive cases covering the org-scope carve-out AND the
# proprietary-id folding that must keep working.
CASES = [
    # ── the org/scope `agentic-work` must NEVER be rewritten ──────────────────
    ("@agentic-work/llm-sdk", "@agentic-work/llm-sdk"),
    ("import x from '@agentic-work/llm-sdk';", "import x from '@agentic-work/llm-sdk';"),
    ('"@agentic-work/llm-sdk": "workspace:*"', '"@agentic-work/llm-sdk": "workspace:*"'),
    ("ghcr.io/agentic-work", "ghcr.io/agentic-work"),
    ("ghcr.io/agentic-work/openagentic-api:latest", "ghcr.io/agentic-work/openagentic-api:latest"),
    ("agentic-work", "agentic-work"),
    ("agentic_work", "agentic_work"),
    ("the agentic-work platform", "the agentic-work platform"),
    # ── genuinely-proprietary `agentic-…` ids must STILL fold to openagentic ──
    ("agentic-memory-mcp", "oap-memory-mcp"),  # …-mcp also folds to oap- via MCP_KEBAB
    ("agentic_proxy", "openagentic_proxy"),
    ("agentic-workflows", "openagentic-workflows"),  # `workflows` != the `work` org token
    ("agentic-worker", "openagentic-worker"),
    # ── never touch the word inside openagentic / mid-word ───────────────────
    ("openagentic-api", "openagentic-api"),
    ("reagentic-foo", "reagentic-foo"),
]


def test_rewrite_round_trip():
    failures = []
    for src, expected in CASES:
        got = SYNC.rewrite(src)
        if got != expected:
            failures.append(f"  rewrite({src!r}) -> {got!r}  (expected {expected!r})")
    assert not failures, "brand-rewrite regressions:\n" + "\n".join(failures)


def test_agentic_work_survives_double_pass():
    """Idempotence: re-running rewrite on already-synced text is a no-op for the
    org scope (a sync may run repeatedly; the package name must stay stable)."""
    once = SYNC.rewrite("@agentic-work/llm-sdk")
    twice = SYNC.rewrite(once)
    assert once == "@agentic-work/llm-sdk", once
    assert twice == "@agentic-work/llm-sdk", twice


def test_preserve_prefixes_cover_approval_and_audit():
    """The approval/ + audit/ trust-seam dirs must be preserved by prefix so new
    files added to them also survive a sync."""
    prefixes = SYNC.PRESERVE_PREFIXES
    for must in (
        "services/openagentic-api/src/services/approval/",
        "services/openagentic-api/src/services/audit/",
    ):
        assert must in prefixes, f"missing PRESERVE_PREFIX: {must}"
    # a representative file under each prefix is treated as preserved
    sample = "services/openagentic-api/src/services/approval/auditAndGate.ts"
    assert any(sample.startswith(p) for p in prefixes), sample


def test_dispatch_tool_and_drop_fix_preserved():
    """dispatchTool + the Ollama drop-fix trio + the LLM provider iface are in
    the exact-match PRESERVE set."""
    for must in (
        "services/openagentic-api/src/routes/chat/pipeline/chat/dispatchTool.ts",
        "services/openagentic-api/src/routes/chat/pipeline/chat/streamProvider.ts",
        "services/openagentic-api/src/routes/chat/pipeline/chat/chatLoop.ts",
        "services/openagentic-api/src/services/llm-providers/OllamaProvider.ts",
        "services/openagentic-api/src/services/llm-providers/ILLMProvider.ts",
        "services/openagentic-ui/src/styles/theme.css",
    ):
        assert must in SYNC.PRESERVE, f"missing PRESERVE: {must}"


def _main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(_main())
