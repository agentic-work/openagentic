"""
Audience-aware OBO strategy for Azure tool calls.

Background — live capture 2026-05-13 on the Flows azure-advisor-savings-report
execution (dev, mcp-tester session):

    OBO token exchange failed: invalid_grant — AADSTS500131:
    Assertion audience does not match the Client app presenting the assertion.
    The audience in the assertion was 'https://management.azure.com' and the
    expected audience is 'api://<proxy-client-id>'.

Root cause: at the legacy /call and /batch-call endpoints, the OBO branch
unconditionally calls `acquire_azure_obo_tokens(original_token, audiences=...)`
for the 5 SECONDARY Azure audiences (Graph, KeyVault, Storage, SQL,
LogAnalytics) even when the user's access_token already has ARM audience.
ARM-audience tokens CANNOT be used as JWT-bearer OBO grant assertions — AAD
rejects every exchange with AADSTS500131. `acquire_azure_obo_tokens` is
fail-CLOSED, so the first audience failure raises HTTPException(401)
`obo_failed` — killing the entire /call request even for tools (Advisor,
list-subscriptions, etc.) that only need the ARM token.

The site-1 endpoint (/mcp via `proxy_mcp_request`) was fixed in commit
8f2ffe56 with this exact pattern. This module extracts that decision into
a small, pure, unit-testable helper so /call and /batch-call can reuse it.

The mirror behavior:

  - access_token has audience 'https://management.azure.com'
    → strategy = 'direct_arm'
      seed `azure_tokens['userAccessToken']` with the token verbatim
      DO NOT attempt OBO for secondary audiences (would fail with AADSTS500131)
      tools requiring Graph/KV/Storage/SQL/LogAnalytics scope will surface a
      clean "no token" error from their upstream MCP server — NOT an opaque
      AAD failure
  - access_token has audience 'api://<client-id>' (proxy app id)
    → strategy = 'full_obo'
      the access_token is a valid OBO assertion; caller exchanges for all
      6 audiences via `acquire_azure_obo_tokens`
  - any other audience / undecodable token
    → strategy = 'full_obo' (best-effort)
      let AAD reject if the audience is wrong; better than silently
      dropping authentication

Long-term: the api side should request `api://<proxy-client-id>/.default`
during user login and persist that as a second access_token (different DB
column). That would unblock the secondary audiences too. Until that lands,
ARM-scope Azure tools work and secondary-scope ones fail cleanly.
"""
from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass, field
from typing import Dict, Mapping, Optional

logger = logging.getLogger("mcp-proxy.azure-obo-strategy")

@dataclass(frozen=True)
class AzureOboStrategy:
    """Output of `decide_azure_obo_strategy`.

    Attributes:
        strategy: One of:
            - 'direct_arm': caller pre-seeds `azure_tokens['userAccessToken']`
              with the token and SKIPS `acquire_azure_obo_tokens`.
            - 'full_obo': caller invokes `acquire_azure_obo_tokens` with
              `obo_assertion_token` against the full audience map.
        azure_tokens: Pre-seeded azure_tokens dict the caller should merge
            into its working dict BEFORE invoking the multi-audience helper.
            Empty for 'full_obo'.
        obo_assertion_token: Token to pass as the JWT-bearer assertion to
            `acquire_azure_obo_tokens`. None for 'direct_arm' (caller skips
            the call entirely).
    """
    strategy: str
    azure_tokens: Dict[str, str] = field(default_factory=dict)
    obo_assertion_token: Optional[str] = None

def _decode_audience(access_token: str) -> str:
    """Extract the `aud` claim from a JWT-shaped string. Returns '' on any
    decode failure — caller treats that as 'unknown audience' and falls back
    to using the token as an OBO assertion."""
    try:
        parts = access_token.split(".")
        if len(parts) < 2:
            return ""
        payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
        # Tolerate both URL-safe and standard base64.
        try:
            decoded = base64.urlsafe_b64decode(payload_b64)
        except Exception:
            decoded = base64.b64decode(payload_b64)
        payload = json.loads(decoded)
        aud = payload.get("aud", "")
        if isinstance(aud, list):
            # AAD sometimes emits aud as a list — take the first string.
            aud = next((a for a in aud if isinstance(a, str)), "")
        return aud if isinstance(aud, str) else ""
    except Exception:
        return ""

def decide_azure_obo_strategy(
    access_token: str,
    audiences: Mapping[str, str],
) -> AzureOboStrategy:
    """Decide whether the given access_token can drive a multi-audience OBO
    exchange or must be used directly for ARM only.

    See module docstring for the full rationale.

    Args:
        access_token: The user's AAD access_token from the inbound bearer.
        audiences: Map of {token_key: scope_url} — keys we MIGHT need to
            acquire. Currently unused for the decision itself (the strategy
            depends only on the access_token's audience), but kept in the
            signature so the helper can grow into per-audience policy later.

    Returns:
        AzureOboStrategy describing what the caller should do.
    """
    # `audiences` is intentionally accepted but unused for now.
    _ = audiences

    aud = _decode_audience(access_token)

    if aud and "management.azure.com" in aud:
        # ARM-scoped — direct use, no OBO.
        logger.info(
            "[obo-strategy] direct_arm — access_token has ARM audience; "
            "skipping multi-audience OBO exchange (AADSTS500131 mitigation)"
        )
        return AzureOboStrategy(
            strategy="direct_arm",
            azure_tokens={"userAccessToken": access_token},
            obo_assertion_token=None,
        )

    # App-audience or anything else: treat as a potential OBO assertion and
    # let AAD reject if it can't. Quiet log for the common app-audience case.
    if aud and aud.startswith("api://"):
        logger.info(
            "[obo-strategy] full_obo — access_token has app audience; "
            "using for multi-audience OBO exchange"
        )
    else:
        logger.info(
            "[obo-strategy] full_obo (best-effort) — access_token audience "
            "is %r; using as OBO assertion, AAD will reject if wrong",
            aud or "<undecodable>",
        )

    return AzureOboStrategy(
        strategy="full_obo",
        azure_tokens={},
        obo_assertion_token=access_token,
    )
