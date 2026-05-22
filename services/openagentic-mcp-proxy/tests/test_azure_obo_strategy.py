"""
RED-first regression for the OBO audience-mismatch bug at sites 2 (/call) and
3 (/batch-call) — the bug captured live 2026-05-13 on the Flows
azure-advisor-savings-report execution:

> AADSTS500131: Assertion audience does not match the Client app presenting
> the assertion. The audience in the assertion was 'https://management.azure.com'
> and the expected audience is 'api://<proxy-client-id>'.

Pre-existing site 1 fix at commit 8f2ffe56 added the audience-check + skip
pattern to `proxy_mcp_request` (/mcp endpoint). Sites 2/3 (/call and
/batch-call) still call `acquire_azure_obo_tokens` for the 5 SECONDARY
audiences (Graph/KV/Storage/SQL/LogAnalytics) using the ARM-audience token
as the JWT-bearer assertion. AAD rejects → fail-CLOSED → the entire call
returns 401 even for tools (azure_advisor_*, azure_list_subscriptions,
etc.) that only need ARM scope.

Fix: extract the audience-aware OBO strategy decision into a small pure
helper (`decide_azure_obo_strategy`) and call it from /call + /batch-call.
When the access_token has ARM audience, return strategy=`direct_arm` —
caller uses the token directly for ARM and SKIPS the multi-audience OBO
exchange. Mirrors the 8f2ffe56 behavior already shipped at site 1.

This test exercises the helper directly so it's fast + does NOT require
booting FastAPI / Redis / Azure OAuth / MCP-manager.
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import pytest

# Make `src/` importable as a top-level package (same shape as conftest.py).
_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

AZURE_AUDIENCES = {
    "userAccessToken": "https://management.azure.com/.default",
    "graphAccessToken": "https://graph.microsoft.com/.default",
    "keyvaultAccessToken": "https://vault.azure.net/.default",
    "storageAccessToken": "https://storage.azure.com/.default",
    "sqlAccessToken": "https://database.windows.net/.default",
    "logAnalyticsAccessToken": "https://api.loganalytics.io/.default",
}

def _mint_unsigned_jwt(aud: str) -> str:
    """Mint a JWT-shaped string with the given `aud` claim. Signature is
    not validated by `decide_azure_obo_strategy` (it only base64-decodes the
    payload to read `aud`), so an unsigned shape is fine for the unit test."""
    header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(
        json.dumps({"aud": aud, "sub": "test-user"}).encode()
    ).rstrip(b"=").decode()
    sig = ""
    return f"{header}.{payload}.{sig}"

class TestDecideAzureOboStrategy:
    """Pin the audience-aware OBO strategy decision used by /call + /batch-call."""

    def test_arm_audience_token_returns_direct_arm_strategy_and_skips_other_audiences(self):
        """When the access_token has audience `https://management.azure.com`,
        the strategy must:
          1. Pre-seed `azure_tokens['userAccessToken']` with the token (direct ARM).
          2. Return `obo_assertion_token = None` so the caller SKIPS the
             multi-audience OBO exchange — the token would fail with
             AADSTS500131 against any other audience.
        Mirrors the site-1 fix at commit 8f2ffe56.
        """
        from azure_obo_strategy import decide_azure_obo_strategy

        arm_token = _mint_unsigned_jwt("https://management.azure.com")
        decision = decide_azure_obo_strategy(arm_token, AZURE_AUDIENCES)

        # Pre-seeded ARM token — caller uses this directly for `userAccessToken`.
        assert decision.azure_tokens == {"userAccessToken": arm_token}, (
            "ARM-audience token must be pre-seeded as the direct ARM token"
        )
        # No OBO assertion → caller skips `acquire_azure_obo_tokens`.
        assert decision.obo_assertion_token is None, (
            "ARM-audience tokens CANNOT be used as JWT-bearer OBO assertions "
            "(AADSTS500131). Caller must skip the multi-audience exchange."
        )
        # Strategy label for log emission.
        assert decision.strategy == "direct_arm"

    def test_app_audience_token_returns_full_obo_strategy(self):
        """When the access_token has audience `api://<client-id>`, it's a
        valid OBO assertion. Strategy must return it for the multi-audience
        exchange and NOT pre-seed `azure_tokens`."""
        from azure_obo_strategy import decide_azure_obo_strategy

        app_token = _mint_unsigned_jwt("api://00000000-1111-2222-3333-444444444444")
        decision = decide_azure_obo_strategy(app_token, AZURE_AUDIENCES)

        assert decision.azure_tokens == {}, (
            "App-audience token is NOT a direct ARM token — must be exchanged"
        )
        assert decision.obo_assertion_token == app_token
        assert decision.strategy == "full_obo"

    def test_undecodable_token_falls_back_to_obo_assertion(self):
        """A malformed/opaque token (no JWT shape) still gets used as the
        OBO assertion — let AAD reject it with a clear error rather than
        silently dropping authentication."""
        from azure_obo_strategy import decide_azure_obo_strategy

        decision = decide_azure_obo_strategy("not-a-jwt", AZURE_AUDIENCES)

        assert decision.azure_tokens == {}
        assert decision.obo_assertion_token == "not-a-jwt"
        assert decision.strategy == "full_obo"

    def test_other_audience_falls_back_to_obo_assertion(self):
        """An access_token with neither ARM nor the proxy app audience —
        we still treat it as a possible OBO assertion. AAD will reject if
        the audience is wrong; better that than silently dropping it."""
        from azure_obo_strategy import decide_azure_obo_strategy

        other = _mint_unsigned_jwt("https://graph.microsoft.com")
        decision = decide_azure_obo_strategy(other, AZURE_AUDIENCES)

        assert decision.azure_tokens == {}
        assert decision.obo_assertion_token == other
        assert decision.strategy == "full_obo"
