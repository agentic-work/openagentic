
"""
Boot-time JWT key validation + no-credentials-401 path in mcp-proxy.

These tests assert TWO invariants:

  1. `bootstrap_jwt_keys()` fail-CLOSED: missing key OR `dev-secret*` value
     raises `BootError`. Server boot will refuse to come up rather than run
     with a bad signing key.

  2. The Authorization-less request path returns 401 `missing_authorization`
     and NEVER grants `is_admin=True` from the no-creds branch.

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

