# Proprietary and confidential. Unauthorized copying prohibited.
"""
Substrate fix S1 — boot-time JWT key validation, no-credentials-401 path,
and OBO failure-closed behavior in mcp-proxy.

Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §3 S1
Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md
      tasks 1.10 (RED) + 1.11 (GREEN).

These tests assert THREE invariants:

  1. `bootstrap_jwt_keys()` fail-CLOSED: missing key OR `dev-secret*` value
     raises `BootError`. Server boot will refuse to come up rather than run
     with a bad signing key.

  2. The Authorization-less request path returns 401 `missing_authorization`
     and NEVER grants `is_admin=True` from the no-creds branch.

  3. OBO exchange failure surfaces as HTTPException 401 `obo_failed`. The
     proxy MUST NOT silently fall back to passing the user's original AAD
     token to the upstream MCP. A single helper `require_obo_token` wraps
     `exchange_token_for_azure` and converts `TokenExchangeError` into a
     401 with the audience attached.

These tests deliberately import `src/main.py` directly (unlike the
existing test_tool_search.py which avoids it). Boot-time eval of the
new `bootstrap_jwt_keys()` is exactly what we want to verify.
"""
from __future__ import annotations

import importlib
import os
import sys
import time
from pathlib import Path
from typing import Iterator

import pytest

# Make `src/` importable as a top-level package (mirrors conftest.py).
_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

TEST_SIGNING_KEY = "test-signing-key-not-for-production-but-not-dev-secret"

@pytest.fixture
def reset_main_module() -> Iterator[None]:
    """
    Boot-time hardening tests need a fresh module evaluation per test
    so that `bootstrap_jwt_keys()` re-reads the env we monkey-patched.
    """
    if "main" in sys.modules:
        del sys.modules["main"]
    if "src.main" in sys.modules:
        del sys.modules["src.main"]
    yield
    if "main" in sys.modules:
        del sys.modules["main"]
    if "src.main" in sys.modules:
        del sys.modules["src.main"]

# ---------------------------------------------------------------------------
# 1. Boot-time JWT key validation
# ---------------------------------------------------------------------------

class TestBootHardening:
    def test_boot_fails_when_no_jwt_key_in_env(self, monkeypatch, reset_main_module):
        for key in (
            "JWT_SIGNING_KEY",
            "OPENAGENTIC_JWT_KEY",
            "AAD_PUBLIC_KEY",
            "JWT_SECRET",
            "SIGNING_SECRET",
            "INTERNAL_JWT_SECRET",
        ):
            monkeypatch.delenv(key, raising=False)
        import main  # noqa: WPS433
        with pytest.raises(main.BootError, match="JWT signing key required"):
            main.bootstrap_jwt_keys()

    def test_boot_rejects_dev_secret_literal(self, monkeypatch, reset_main_module):
        for key in (
            "JWT_SIGNING_KEY",
            "OPENAGENTIC_JWT_KEY",
            "AAD_PUBLIC_KEY",
            "JWT_SECRET",
            "SIGNING_SECRET",
            "INTERNAL_JWT_SECRET",
        ):
            monkeypatch.delenv(key, raising=False)
        monkeypatch.setenv("JWT_SIGNING_KEY", "dev-secret-change-in-production")
        import main
        with pytest.raises(main.BootError, match="dev-secret"):
            main.bootstrap_jwt_keys()

    def test_boot_rejects_dev_secret_prefix(self, monkeypatch, reset_main_module):
        for key in (
            "JWT_SIGNING_KEY",
            "OPENAGENTIC_JWT_KEY",
            "AAD_PUBLIC_KEY",
            "JWT_SECRET",
            "SIGNING_SECRET",
            "INTERNAL_JWT_SECRET",
        ):
            monkeypatch.delenv(key, raising=False)
        monkeypatch.setenv("JWT_SIGNING_KEY", "dev-secret-anything-else")
        import main
        with pytest.raises(main.BootError, match="dev-secret"):
            main.bootstrap_jwt_keys()

    def test_boot_succeeds_with_real_key(self, monkeypatch, reset_main_module):
        monkeypatch.setenv("JWT_SIGNING_KEY", TEST_SIGNING_KEY)
        import main
        result = main.bootstrap_jwt_keys()
        assert result.get("signing_key") == TEST_SIGNING_KEY

    def test_boot_accepts_legacy_jwt_secret_env(self, monkeypatch, reset_main_module):
        # Existing prod env uses JWT_SECRET (line 755) — keep it as a valid
        # source so we don't break the warm path. The constraint is value-only:
        # it must not be a dev-secret literal.
        monkeypatch.delenv("JWT_SIGNING_KEY", raising=False)
        monkeypatch.delenv("OPENAGENTIC_JWT_KEY", raising=False)
        monkeypatch.delenv("AAD_PUBLIC_KEY", raising=False)
        monkeypatch.setenv("JWT_SECRET", TEST_SIGNING_KEY)
        import main
        result = main.bootstrap_jwt_keys()
        assert result.get("signing_key") == TEST_SIGNING_KEY

# ---------------------------------------------------------------------------
# 2. No-credentials request path
# ---------------------------------------------------------------------------

class TestNoCredsPath:
    """
    Request without Authorization header → get_user_info MUST raise 401, not
    silently return a system-admin context. Tested at the dependency level
    (no FastAPI lifespan needed) by calling get_user_info directly with
    credentials=None — that's how `Depends(security)` would wire when the
    HTTPBearer's auto_error=False matches no header.
    """

    @pytest.fixture
    def main_module(self, monkeypatch, reset_main_module):
        monkeypatch.setenv("JWT_SIGNING_KEY", TEST_SIGNING_KEY)
        import main
        return main

    @pytest.mark.asyncio
    async def test_no_authorization_raises_401(self, main_module):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as excinfo:
            await main_module.get_user_info(credentials=None)
        assert excinfo.value.status_code == 401
        # Surface a structured 'missing_authorization' marker in the detail.
        detail = excinfo.value.detail
        if isinstance(detail, dict):
            assert detail.get("error") == "missing_authorization"
        else:
            assert "missing_authorization" in str(detail)

    @pytest.mark.asyncio
    async def test_no_admin_grant_on_missing_creds(self, main_module):
        # The no-creds path should NEVER set is_admin=True. Asserted via the
        # 401 raise above, but we double-check no implicit admin context
        # leaks by ensuring the function does NOT return a dict at all.
        from fastapi import HTTPException
        try:
            result = await main_module.get_user_info(credentials=None)
        except HTTPException as e:
            assert e.status_code == 401
            return
        # If it didn't raise, it must NOT have admin context.
        pytest.fail(
            "Expected HTTPException(401), got dict instead. "
            f"is_admin={result.get('is_admin') if isinstance(result, dict) else 'n/a'}"
        )

# ---------------------------------------------------------------------------
# 3. OBO failure → 401 (never original-token passthrough)
# ---------------------------------------------------------------------------

class TestOboFailureFailsClosed:
    """
    `require_obo_token(original_token, audience)` is a new helper that wraps
    `exchange_token_for_azure` and converts ANY exchange failure into a
    structured HTTPException 401 with `error=obo_failed` and the audience.

    Existing call sites (lines 1175, 1197, 2227, 2240, 2478) silently swallow
    `TokenExchangeError` and fall back to passing the user's original AAD
    token to the upstream MCP. The S1 fix is to route those call sites
    through `require_obo_token` instead.

    This test verifies the helper's contract; rewiring the call sites is
    spec-mandated but tested at the live-verify level (Task 1.12).
    """

    @pytest.fixture
    def main_module(self, monkeypatch, reset_main_module):
        monkeypatch.setenv("JWT_SIGNING_KEY", TEST_SIGNING_KEY)
        import main
        return main

    @pytest.mark.asyncio
    async def test_obo_failure_raises_401_obo_failed(self, main_module, monkeypatch):
        from fastapi import HTTPException

        async def fake_exchange(*args, **kwargs):
            raise main_module.TokenExchangeError("AAD refused OBO", 502)

        monkeypatch.setattr(main_module, "exchange_token_for_azure", fake_exchange)

        with pytest.raises(HTTPException) as excinfo:
            await main_module.require_obo_token(
                "user-original-token-abc",
                audience="https://management.azure.com/.default",
            )
        assert excinfo.value.status_code == 401
        detail = excinfo.value.detail
        if isinstance(detail, dict):
            assert detail.get("error") == "obo_failed"
            assert "management.azure.com" in (detail.get("audience") or "")
        else:
            assert "obo_failed" in str(detail)
            assert "management.azure.com" in str(detail)

    @pytest.mark.asyncio
    async def test_obo_helper_does_not_passthrough_original_token(
        self, main_module, monkeypatch
    ):
        # CRITICAL: on failure, the helper must NOT return the original
        # token. The old code at line 1197 does:
        #   user_token = azure_tokens.get("userAccessToken") or access_token
        # which silently passes the AAD token to upstream MCP. The helper's
        # contract is fail-CLOSED — never returns on exchange failure.
        from fastapi import HTTPException

        async def fake_exchange(*args, **kwargs):
            raise main_module.TokenExchangeError("simulated failure", 502)

        monkeypatch.setattr(main_module, "exchange_token_for_azure", fake_exchange)

        original = "user-original-token-NEVER-PASS-THROUGH"
        try:
            result = await main_module.require_obo_token(
                original,
                audience="https://graph.microsoft.com/.default",
            )
        except HTTPException as e:
            assert e.status_code == 401
            # Helper must not echo the original token back in the error body.
            detail_str = str(e.detail)
            assert original not in detail_str, (
                "OBO helper leaked the user's original AAD token in the "
                f"error body: {detail_str}"
            )
            return
        pytest.fail(
            f"require_obo_token returned {result!r} instead of raising 401. "
            "The fix is fail-CLOSED: never return original token on OBO failure."
        )

    @pytest.mark.asyncio
    async def test_obo_helper_returns_exchanged_token_on_success(
        self, main_module, monkeypatch
    ):
        async def fake_exchange(token, scope=None):
            return f"exchanged::{scope}"

        monkeypatch.setattr(main_module, "exchange_token_for_azure", fake_exchange)

        result = await main_module.require_obo_token(
            "user-tok",
            audience="https://management.azure.com/.default",
        )
        assert result == "exchanged::https://management.azure.com/.default"

# ---------------------------------------------------------------------------
# 4. Multi-audience OBO helper + call-site rewire
# ---------------------------------------------------------------------------

class TestMultiAudienceObo:
    """
    `acquire_azure_obo_tokens(obo_token, audiences, ...)` is the multi-audience
    parallel-exchange helper that the 3 OBO call sites in main.py
    (proxy_mcp_request line 1326+, batch_call_tools line 2379+,
    call_mcp_tool line 2629+) must route through.

    The legacy code at each site does:

        async def exchange_for_audience(token_key, scope):
            try:
                exchanged = await exchange_token_for_azure(obo_token, scope=scope)
                return (token_key, exchanged)
            except Exception:
                return (token_key, None)
        ...
        results = await asyncio.gather(*tasks, return_exceptions=True)
        # Filter out None tokens, keep silent passthrough as fallback

    That swallows all OBO failures and silently passes the user's original
    AAD token to the upstream Azure MCP. The S1 fix is fail-CLOSED: ANY
    audience exchange failure raises HTTPException(401) with error=obo_failed
    and the audience attached.
    """

    @pytest.fixture
    def main_module(self, monkeypatch, reset_main_module):
        monkeypatch.setenv("JWT_SIGNING_KEY", TEST_SIGNING_KEY)
        import main
        return main

    @pytest.mark.asyncio
    async def test_helper_raises_401_when_any_audience_fails(
        self, main_module, monkeypatch
    ):
        from fastapi import HTTPException

        # Simulate: ARM exchange succeeds, Graph exchange fails.
        async def fake_exchange(token, scope=None):
            if "graph.microsoft.com" in (scope or ""):
                raise main_module.TokenExchangeError("Graph denied", 502)
            return f"exchanged::{scope}"

        monkeypatch.setattr(main_module, "exchange_token_for_azure", fake_exchange)

        audiences = {
            "userAccessToken": "https://management.azure.com/.default",
            "graphAccessToken": "https://graph.microsoft.com/.default",
        }
        with pytest.raises(HTTPException) as excinfo:
            await main_module.acquire_azure_obo_tokens(
                "user-token-abc",
                audiences=audiences,
                user_name="alice",
            )
        assert excinfo.value.status_code == 401
        detail = excinfo.value.detail
        if isinstance(detail, dict):
            assert detail.get("error") == "obo_failed"
            assert "graph.microsoft.com" in (detail.get("audience") or "")
        else:
            assert "obo_failed" in str(detail)
            assert "graph.microsoft.com" in str(detail)

    @pytest.mark.asyncio
    async def test_helper_returns_token_dict_on_success(
        self, main_module, monkeypatch
    ):
        async def fake_exchange(token, scope=None):
            return f"tok::{scope}"

        monkeypatch.setattr(main_module, "exchange_token_for_azure", fake_exchange)

        audiences = {
            "userAccessToken": "https://management.azure.com/.default",
            "graphAccessToken": "https://graph.microsoft.com/.default",
            "keyvaultAccessToken": "https://vault.azure.net/.default",
        }
        result = await main_module.acquire_azure_obo_tokens(
            "user-token-abc",
            audiences=audiences,
            user_name="alice",
        )
        assert isinstance(result, dict)
        assert result["userAccessToken"] == "tok::https://management.azure.com/.default"
        assert result["graphAccessToken"] == "tok::https://graph.microsoft.com/.default"
        assert result["keyvaultAccessToken"] == "tok::https://vault.azure.net/.default"

    @pytest.mark.asyncio
    async def test_helper_skips_audiences_already_acquired(
        self, main_module, monkeypatch
    ):
        # When the original access token has ARM audience, ARM is already
        # acquired and should be passed via `skip` — the helper must NOT
        # re-exchange it, and the absent key must NOT appear in the result.
        calls = []

        async def fake_exchange(token, scope=None):
            calls.append(scope)
            return f"tok::{scope}"

        monkeypatch.setattr(main_module, "exchange_token_for_azure", fake_exchange)

        audiences = {
            "userAccessToken": "https://management.azure.com/.default",
            "graphAccessToken": "https://graph.microsoft.com/.default",
        }
        result = await main_module.acquire_azure_obo_tokens(
            "user-token-abc",
            audiences=audiences,
            user_name="alice",
            skip={"userAccessToken"},
        )
        assert "userAccessToken" not in result
        assert result["graphAccessToken"] == "tok::https://graph.microsoft.com/.default"
        # ARM scope must NOT have been requested.
        assert "https://management.azure.com/.default" not in calls

    @pytest.mark.asyncio
    async def test_helper_does_not_leak_original_token_in_error(
        self, main_module, monkeypatch
    ):
        from fastapi import HTTPException

        async def fake_exchange(token, scope=None):
            raise main_module.TokenExchangeError("simulated failure", 502)

        monkeypatch.setattr(main_module, "exchange_token_for_azure", fake_exchange)

        original = "user-original-token-NEVER-LEAK"
        with pytest.raises(HTTPException) as excinfo:
            await main_module.acquire_azure_obo_tokens(
                original,
                audiences={
                    "userAccessToken": "https://management.azure.com/.default",
                },
                user_name="alice",
            )
        assert excinfo.value.status_code == 401
        assert original not in str(excinfo.value.detail), (
            "Multi-audience OBO helper leaked the user's original AAD "
            f"token in the error body: {excinfo.value.detail}"
        )

# ---------------------------------------------------------------------------
# 5. Call-site rewire — assert call sites no longer silently passthrough
# ---------------------------------------------------------------------------

class TestCallSitesRoutedThroughRequireObo:
    """
    Source-regression tests: the 3 OBO call sites in src/main.py must
    route through `require_obo_token` / `acquire_azure_obo_tokens`,
    not the legacy `try: exchange_token_for_azure ... except: pass` shape.

    These are line-level assertions on the post-rewire shape so a future
    refactor that re-introduces the silent passthrough fails CI.
    """

    SRC = Path(__file__).resolve().parent.parent / "src" / "main.py"

    def _read_source(self) -> str:
        return self.SRC.read_text(encoding="utf-8")

    def test_no_silent_passthrough_on_obo_failure(self):
        """
        The legacy passthrough comments and patterns must be GONE from
        the post-rewire code:

            user_token = azure_tokens.get("userAccessToken") or access_token
            user_token = azure_tokens.get("userAccessToken") or user_info.get('token')
            azure_tokens["userAccessToken"] = access_token  # All exchanges failed
            azure_tokens["userAccessToken"] = user_info['token']  # All exchanges failed

        and the warning log line that announces the silent passthrough.
        """
        src = self._read_source()
        # The legacy "passing original Azure AD token directly" warning is
        # the smoking-gun marker for silent passthrough.
        assert (
            "passing original Azure AD token directly" not in src
        ), (
            "Legacy silent-passthrough warning found in main.py — the OBO "
            "call sites must fail-CLOSED via require_obo_token / "
            "acquire_azure_obo_tokens, NOT fall back to the user's "
            "original AAD token."
        )

    def test_call_sites_route_through_helper(self):
        """
        Each of the 3 OBO call sites must call `acquire_azure_obo_tokens`
        (or `require_obo_token` directly). Count must be >= 3.
        """
        src = self._read_source()
        # Total occurrences across the 3 call sites — proxy_mcp_request,
        # batch_call_tools, call_mcp_tool. A direct require_obo_token call
        # also counts (single-audience pattern).
        helper_calls = src.count("acquire_azure_obo_tokens(") + src.count(
            "await require_obo_token("
        )
        # The helper definition itself uses both names once. Subtract those.
        # `acquire_azure_obo_tokens(` appears in the def — minus 1.
        # `await require_obo_token(` appears in acquire_azure_obo_tokens body — minus 1.
        # Plus the existing helper-test fixtures don't count (test file).
        # We expect 3 production call-site uses minimum.
        assert helper_calls >= 4, (
            f"Expected >=4 helper invocations in main.py (1 def + >=3 call "
            f"sites), found {helper_calls}. The 3 OBO call sites "
            f"(proxy_mcp_request, batch_call_tools, call_mcp_tool) must "
            f"route through acquire_azure_obo_tokens or require_obo_token."
        )

    def test_legacy_exchange_for_audience_inner_func_removed(self):
        """
        The legacy inner `async def exchange_for_audience(...)` function
        was the per-site silent-passthrough wrapper. After rewire it must
        be replaced by the shared `acquire_azure_obo_tokens` helper. Only
        non-docstring occurrences count — the helper's docstring may
        reference the legacy name historically.
        """
        src = self._read_source()
        # Strip docstrings (rough — drop lines that are inside `"""..."""`).
        # We look for the actual `async def` token at the start of a
        # statement, not in a docstring backtick.
        non_doc_count = sum(
            1
            for line in src.splitlines()
            if line.lstrip().startswith("async def exchange_for_audience(")
        )
        assert non_doc_count == 0, (
            f"Found {non_doc_count} legacy `async def exchange_for_audience` "
            "inner-function definitions in main.py — these silently swallow "
            "OBO failures. Rewire to acquire_azure_obo_tokens."
        )
