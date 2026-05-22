# Proprietary and confidential. Unauthorized copying prohibited.
"""
Substrate fix S1 — JWT auth + system-token HMAC verification (Tasks 1.10/1.11).

Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §3 S1
Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md
      tasks 1.10 (RED) + 1.11 (GREEN).

Six test cases:

  1. Boot fails CLOSED if all 3 candidate envs (JWT_SECRET, SIGNING_SECRET,
     INTERNAL_JWT_SECRET) unset.
  2. Boot fails CLOSED if any of those equals
     `dev-secret-change-in-production`.
  3. Request without Authorization → 401 missing_authorization
     (regression confirm).
  4. Bearer awc_system_<bad-suffix> → 401 (currently passes — fix this).
  5. Bearer awc_system_<HMAC_of_INTERNAL_SERVICE_SECRET> → 200 with
     system-admin context.
  6. Bearer awc_<user-key> → validates against api /api/auth/me.

The HMAC contract:

    suffix = base64url(HMAC_SHA256(INTERNAL_SERVICE_SECRET, "openagentic-system-token"))

Both api side (ToolSemanticCacheService.ts:527) and mcp-proxy side
(get_user_info awc_system_ branch) MUST compute the same suffix and use
hmac.compare_digest for constant-time compare.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import sys
from pathlib import Path
from typing import Iterator

import pytest

# Make `src/` importable as a top-level package (mirrors conftest.py).
_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

TEST_SIGNING_KEY = "test-signing-key-not-for-production-but-not-dev-secret"
TEST_INTERNAL_SECRET = "test-internal-service-secret-DO-NOT-USE-IN-PROD"
SYSTEM_TOKEN_LABEL = "openagentic-system-token"

def _expected_system_suffix(secret: str) -> str:
    """Reference HMAC suffix used by both api and mcp-proxy.

    Both sides MUST compute identically:
        suffix = base64url(HMAC_SHA256(secret, "openagentic-system-token"))

    Strip base64 padding so the suffix is URL-safe alpha-numeric.
    """
    mac = hmac.new(
        secret.encode("utf-8"),
        SYSTEM_TOKEN_LABEL.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(mac).rstrip(b"=").decode("ascii")

@pytest.fixture
def reset_main_module() -> Iterator[None]:
    """
    Boot-time hardening tests need a fresh module evaluation per test
    so that bootstrap_jwt_keys() re-reads the env we monkey-patched.
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
# 1. Boot fail-CLOSED if no JWT signing key in env (across candidate vars)
# ---------------------------------------------------------------------------

class TestBootFailsClosedNoJwtKey:
    def test_no_jwt_key_in_any_candidate_env_raises_boot_error(
        self, monkeypatch, reset_main_module
    ):
        # Clear all candidates the resolver looks at.
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

# ---------------------------------------------------------------------------
# 2. Boot fail-CLOSED if any candidate equals dev-secret-change-in-production
# ---------------------------------------------------------------------------

class TestBootFailsClosedDevSecret:
    @pytest.mark.parametrize(
        "env_var",
        [
            "JWT_SECRET",
            "SIGNING_SECRET",
            "INTERNAL_JWT_SECRET",
        ],
    )
    def test_dev_secret_literal_in_any_legacy_env_raises_boot_error(
        self, monkeypatch, reset_main_module, env_var
    ):
        # Clear higher-priority candidates so the legacy var is what gets read.
        for key in (
            "JWT_SIGNING_KEY",
            "OPENAGENTIC_JWT_KEY",
            "AAD_PUBLIC_KEY",
            "JWT_SECRET",
            "SIGNING_SECRET",
            "INTERNAL_JWT_SECRET",
        ):
            monkeypatch.delenv(key, raising=False)
        monkeypatch.setenv(env_var, "dev-secret-change-in-production")
        import main
        with pytest.raises(main.BootError, match="dev-secret"):
            main.bootstrap_jwt_keys()

# ---------------------------------------------------------------------------
# 3. Request without Authorization → 401 missing_authorization
# ---------------------------------------------------------------------------

class TestNoAuthorizationHeader:
    @pytest.fixture
    def main_module(self, monkeypatch, reset_main_module):
        monkeypatch.setenv("JWT_SIGNING_KEY", TEST_SIGNING_KEY)
        import main
        return main

    @pytest.mark.asyncio
    async def test_missing_credentials_returns_401_missing_authorization(
        self, main_module
    ):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as excinfo:
            await main_module.get_user_info(credentials=None)
        assert excinfo.value.status_code == 401
        detail = excinfo.value.detail
        if isinstance(detail, dict):
            assert detail.get("error") == "missing_authorization"
        else:
            assert "missing_authorization" in str(detail)

# ---------------------------------------------------------------------------
# 4. Bearer awc_system_<bad-suffix> → 401 (HMAC mismatch)
# ---------------------------------------------------------------------------

class TestSystemTokenBadSuffix:
    @pytest.fixture
    def main_module(self, monkeypatch, reset_main_module):
        monkeypatch.setenv("JWT_SIGNING_KEY", TEST_SIGNING_KEY)
        monkeypatch.setenv("INTERNAL_SERVICE_SECRET", TEST_INTERNAL_SECRET)
        import main
        return main

    @pytest.mark.asyncio
    async def test_bad_suffix_rejected_with_401(self, main_module):
        from fastapi import HTTPException
        from fastapi.security import HTTPAuthorizationCredentials

        creds = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="awc_system_this-is-a-fake-suffix-not-the-hmac",
        )

        with pytest.raises(HTTPException) as excinfo:
            await main_module.get_user_info(credentials=creds)
        assert excinfo.value.status_code == 401
        detail = excinfo.value.detail
        # Should NOT have granted system-admin context.
        if isinstance(detail, dict):
            assert detail.get("error") in (
                "invalid_system_token",
                "invalid_token",
                "missing_authorization",
            )

    @pytest.mark.asyncio
    async def test_legacy_plain_secret_suffix_rejected(self, main_module):
        # Pre-fix shape: `awc_system_<INTERNAL_SERVICE_SECRET>` raw.
        # Post-fix: that plain-secret suffix MUST NOT pass — only the HMAC
        # of the secret keyed by SYSTEM_TOKEN_LABEL is accepted.
        from fastapi import HTTPException
        from fastapi.security import HTTPAuthorizationCredentials

        creds = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=f"awc_system_{TEST_INTERNAL_SECRET}",
        )

        with pytest.raises(HTTPException) as excinfo:
            await main_module.get_user_info(credentials=creds)
        assert excinfo.value.status_code == 401

    @pytest.mark.asyncio
    async def test_empty_suffix_rejected(self, main_module):
        from fastapi import HTTPException
        from fastapi.security import HTTPAuthorizationCredentials

        creds = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="awc_system_",
        )

        with pytest.raises(HTTPException) as excinfo:
            await main_module.get_user_info(credentials=creds)
        assert excinfo.value.status_code == 401

    @pytest.mark.asyncio
    async def test_internal_secret_unset_rejects_any_system_token(
        self, monkeypatch, reset_main_module
    ):
        monkeypatch.setenv("JWT_SIGNING_KEY", TEST_SIGNING_KEY)
        monkeypatch.delenv("INTERNAL_SERVICE_SECRET", raising=False)
        import main

        from fastapi import HTTPException
        from fastapi.security import HTTPAuthorizationCredentials

        # Even a token of the "right shape" must be rejected when there is
        # no secret configured to verify against.
        creds = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="awc_system_anything",
        )

        with pytest.raises(HTTPException) as excinfo:
            await main.get_user_info(credentials=creds)
        assert excinfo.value.status_code == 401

# ---------------------------------------------------------------------------
# 5. Bearer awc_system_<HMAC_of_INTERNAL_SERVICE_SECRET> → 200 system admin
# ---------------------------------------------------------------------------

class TestSystemTokenHmacAccepted:
    @pytest.fixture
    def main_module(self, monkeypatch, reset_main_module):
        monkeypatch.setenv("JWT_SIGNING_KEY", TEST_SIGNING_KEY)
        monkeypatch.setenv("INTERNAL_SERVICE_SECRET", TEST_INTERNAL_SECRET)
        import main
        return main

    @pytest.mark.asyncio
    async def test_correct_hmac_suffix_grants_system_admin(self, main_module):
        from fastapi.security import HTTPAuthorizationCredentials

        suffix = _expected_system_suffix(TEST_INTERNAL_SECRET)
        creds = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=f"awc_system_{suffix}",
        )

        result = await main_module.get_user_info(credentials=creds)
        assert isinstance(result, dict)
        assert result.get("is_admin") is True
        assert result.get("user_id") == "system-root"
        assert result.get("token") == "SYSTEM_SP_AUTH"

    @pytest.mark.asyncio
    async def test_module_exposes_system_token_helpers(self, main_module):
        # Ensure main exposes the HMAC compute helper so the api side and
        # mcp-proxy side can stay in sync. Both should compute the same
        # suffix from the same secret.
        suffix_a = main_module.compute_system_token_suffix(TEST_INTERNAL_SECRET)
        suffix_b = _expected_system_suffix(TEST_INTERNAL_SECRET)
        assert suffix_a == suffix_b

# ---------------------------------------------------------------------------
# 6. Bearer awc_<user-key> → validates against api /api/auth/me
# ---------------------------------------------------------------------------

class TestUserApiKeyValidation:
    @pytest.fixture
    def main_module(self, monkeypatch, reset_main_module):
        monkeypatch.setenv("JWT_SIGNING_KEY", TEST_SIGNING_KEY)
        monkeypatch.setenv("INTERNAL_SERVICE_SECRET", TEST_INTERNAL_SECRET)
        monkeypatch.setenv("API_INTERNAL_URL", "http://test-api:8000")
        import main
        return main

    @pytest.mark.asyncio
    async def test_user_api_key_validated_against_auth_me(
        self, main_module, monkeypatch
    ):
        # Stub httpx.AsyncClient.get → return 200 with user payload.
        captured = {}

        class _StubResponse:
            def __init__(self, status_code, payload):
                self.status_code = status_code
                self._payload = payload

            def json(self):
                return self._payload

        class _StubClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def get(self, url, headers=None):
                captured["url"] = url
                captured["headers"] = headers
                return _StubResponse(
                    200,
                    {
                        "userId": "user-123",
                        "name": "Alice",
                        "email": "alice@example.com",
                        "groups": ["users"],
                        "isAdmin": False,
                    },
                )

        monkeypatch.setattr(main_module.httpx, "AsyncClient", _StubClient)

        from fastapi.security import HTTPAuthorizationCredentials

        creds = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="awc_user-api-key-abc123",
        )

        result = await main_module.get_user_info(credentials=creds)
        assert isinstance(result, dict)
        assert result.get("user_id") == "user-123"
        assert result.get("email") == "alice@example.com"
        assert result.get("is_admin") is False
        assert captured.get("url", "").endswith("/api/auth/me")
        assert captured["headers"]["Authorization"].startswith("Bearer awc_")
