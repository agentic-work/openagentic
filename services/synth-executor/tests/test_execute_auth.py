# Proprietary and confidential. Unauthorized copying prohibited.

"""
Substrate fix S2 — synth-executor `/execute` endpoint must require a
service-JWT signed by the api's chatmode internal key.

Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §3 S2

Before this fix, the `/execute` endpoint had ZERO auth — only
NetworkPolicy `app=openagentic-api` ingress label gated it. Anyone in
the cluster who could label their pod got free arbitrary-Python.

These tests pin the contract:

  - Boot fails CLOSED if SERVICE_JWT_KEY env unset
  - Boot fails CLOSED if SERVICE_JWT_KEY starts with "dev-secret"
  - POST /execute without Authorization → 401 missing_authorization
  - POST /execute with wrong audience → 401 invalid_audience
  - POST /execute with wrong issuer  → 401 invalid_issuer
  - POST /execute with expired token → 401 expired
  - POST /execute with tampered sig  → 401 invalid_signature
  - POST /execute with valid token   → NOT 401/403 (sandbox path runs)
  - GET  /health (k8s probe)         → 200 without auth
"""

from __future__ import annotations

import importlib
import sys
import time
from typing import Any

import jwt as pyjwt
import pytest
from fastapi.testclient import TestClient

TEST_SIGNING_KEY = "test-signing-key-not-for-production-but-not-dev-secret"

def _clear_prom_collectors() -> None:
    """
    server.py registers prometheus_client metrics at module-import time.
    The default `REGISTRY` is a process-global singleton, so re-importing
    the module under pytest collides with the existing registrations.
    Clear them before each reload so boot/auth tests can run independently.
    """
    try:
        from prometheus_client import REGISTRY
    except Exception:  # pragma: no cover — prom client always present here
        return

    # Snapshot collectors then unregister each. We can't iterate the
    # registry's internal dict during mutation, so copy first.
    for collector in list(REGISTRY._collector_to_names.keys()):  # noqa: SLF001
        try:
            REGISTRY.unregister(collector)
        except Exception:
            pass

def _reload_server_module() -> Any:
    """
    Re-import synth_executor.server so any module-level boot validation
    runs again with the env we just monkeypatched. Returns the module.
    """
    # Drop cached module so the next import re-executes the boot block.
    sys.modules.pop("synth_executor.server", None)
    _clear_prom_collectors()
    return importlib.import_module("synth_executor.server")

@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """
    Boot the FastAPI app with a valid signing key in env, return a
    TestClient. Each test gets a fresh module (so boot validation
    re-runs against the monkeypatched env).
    """
    monkeypatch.setenv("SERVICE_JWT_KEY", TEST_SIGNING_KEY)
    server = _reload_server_module()
    return TestClient(server.app)

def make_jwt(signing_key: str, **overrides: Any) -> str:
    payload = {
        "iss": "openagentic-api",
        "aud": "synth-executor",
        "sub": "user-1",
        "sid": "session-1",
        "exp": int(time.time()) + 300,
        **overrides,
    }
    return pyjwt.encode(payload, signing_key, algorithm="HS256")

# ============================================================================
# Boot hardening — fail-CLOSED on missing or dev-secret signing key
# ============================================================================

class TestBootHardening:
    def test_boot_fails_when_no_signing_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("SERVICE_JWT_KEY", raising=False)
        sys.modules.pop("synth_executor.server", None)
        _clear_prom_collectors()
        with pytest.raises(Exception, match="SERVICE_JWT_KEY"):
            importlib.import_module("synth_executor.server")

    def test_boot_rejects_dev_secret_literal(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SERVICE_JWT_KEY", "dev-secret-change-in-production")
        sys.modules.pop("synth_executor.server", None)
        _clear_prom_collectors()
        with pytest.raises(Exception, match="dev-secret"):
            importlib.import_module("synth_executor.server")

# ============================================================================
# /execute auth — JWT verify middleware
# ============================================================================

def _exec_body() -> dict:
    """
    Minimal valid ExecutionRequest body. The auth middleware must run
    BEFORE pydantic body validation, so even a no-op body shape is OK
    for negative cases. For the positive case we use a real shape so
    the request flows past pydantic into the executor (which we don't
    need to actually run — we just assert NOT 401/403).
    """
    return {
        "execution_id": "exec-1",
        "code": "print(1+1)",
        "intent": "smoke",
        "user_id": "user-1",
    }

class TestExecuteAuth:
    def test_no_authorization_returns_401(self, client: TestClient) -> None:
        resp = client.post("/execute", json=_exec_body())
        assert resp.status_code == 401, resp.text
        body = resp.json()
        assert body.get("error") == "missing_authorization"

    def test_wrong_audience_returns_401(self, client: TestClient) -> None:
        token = make_jwt(TEST_SIGNING_KEY, aud="some-other-service")
        resp = client.post(
            "/execute",
            headers={"Authorization": f"Bearer {token}"},
            json=_exec_body(),
        )
        assert resp.status_code == 401, resp.text
        body = resp.json()
        assert body.get("error") == "invalid_audience"

    def test_wrong_issuer_returns_401(self, client: TestClient) -> None:
        token = make_jwt(TEST_SIGNING_KEY, iss="evil-service")
        resp = client.post(
            "/execute",
            headers={"Authorization": f"Bearer {token}"},
            json=_exec_body(),
        )
        assert resp.status_code == 401, resp.text
        body = resp.json()
        assert body.get("error") == "invalid_issuer"

    def test_expired_token_returns_401(self, client: TestClient) -> None:
        token = make_jwt(TEST_SIGNING_KEY, exp=int(time.time()) - 60)
        resp = client.post(
            "/execute",
            headers={"Authorization": f"Bearer {token}"},
            json=_exec_body(),
        )
        assert resp.status_code == 401, resp.text
        body = resp.json()
        assert body.get("error") == "expired"

    def test_tampered_signature_returns_401(self, client: TestClient) -> None:
        # Sign with a different key — verify must reject.
        token = make_jwt("WRONG_KEY_DEFINITELY_NOT_THE_SERVER_KEY")
        resp = client.post(
            "/execute",
            headers={"Authorization": f"Bearer {token}"},
            json=_exec_body(),
        )
        assert resp.status_code == 401, resp.text
        body = resp.json()
        assert body.get("error") in ("invalid_signature", "invalid_token")

    def test_malformed_authorization_header_returns_401(
        self, client: TestClient
    ) -> None:
        resp = client.post(
            "/execute",
            headers={"Authorization": "NotBearer xxxxxx"},
            json=_exec_body(),
        )
        assert resp.status_code == 401, resp.text
        body = resp.json()
        assert body.get("error") == "missing_authorization"

    def test_valid_token_allows_request(self, client: TestClient) -> None:
        """
        Valid JWT must pass auth — request must proceed to the sandbox
        path. We don't care what the sandbox does (could 200, could
        500 if executor not initialized in test env) — just NOT 401/403.
        """
        token = make_jwt(TEST_SIGNING_KEY)
        resp = client.post(
            "/execute",
            headers={"Authorization": f"Bearer {token}"},
            json=_exec_body(),
        )
        assert resp.status_code != 401, resp.text
        assert resp.status_code != 403, resp.text

# ============================================================================
# Health probes — must NOT require auth (k8s liveness/readiness)
# ============================================================================

class TestHealthEndpointBypassesAuth:
    def test_health_no_auth(self, client: TestClient) -> None:
        resp = client.get("/health")
        # Health doesn't require auth — k8s probes don't carry JWTs.
        # 200 expected; even if executor isn't initialized in test the
        # status should at least not be 401.
        assert resp.status_code != 401, resp.text

    def test_metrics_no_auth(self, client: TestClient) -> None:
        resp = client.get("/metrics")
        assert resp.status_code != 401, resp.text
