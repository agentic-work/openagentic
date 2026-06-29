"""
OpenAgentic Google Workspace / Gmail MCP Server — unattended mail automation
via a DOMAIN-WIDE-DELEGATED (DWD) service account that impersonates a Workspace
user.

This MCP is app-only. It loads ONE Workspace service-account key from the
GOOGLE_WORKSPACE_SA_JSON env var (raw JSON or base64), mints a short-lived
OAuth access token, and impersonates a named Workspace user via the `subject`
leg of domain-wide delegation. There is no per-user OAuth consent step.

AUTH CAVEAT — DWD is a domain super-credential. A single SA key, once granted
domain-wide delegation for a Gmail scope in the Workspace Admin console, can
impersonate ANY user in the domain, and end-users cannot revoke it. It is
convenient for unattended automation but it is NOT least-privilege. Per-user
OAuth (user-consent) is the least-privilege follow-up; it is not built here.

CRITICAL SECURITY GUARANTEES:
  - NO HARDCODED CREDENTIALS. The SA key is read ONLY from the
    GOOGLE_WORKSPACE_SA_JSON env var (raw JSON or base64). There is no key on
    disk, no key literal in source, no fallback identity.
  - HARD FAIL / FAIL-CLOSED. If GOOGLE_WORKSPACE_SA_JSON is absent, EVERY tool
    returns an honest error and NEVER attempts an unauthenticated call. If no
    impersonation subject can be resolved, the tool refuses (a DWD token is
    meaningless without a `subject`).
  - SUBJECT = THE SIGNED-IN USER. The impersonation subject is `meta.userEmail`
    (the proxy injects userEmail for every context-needing server), falling
    back to the GOOGLE_WORKSPACE_SUBJECT env default for fully-unattended runs.
    The SA acts AS that user's mailbox — `userId=me` on the Gmail REST API.
  - LEAST PRIVILEGE SCOPES. Reads mint a gmail.readonly token; the send mutation
    mints a gmail.send token. The Workspace admin's DWD grant is the outer cage.

Tool surface (Gmail REST v1, userId=me under impersonation):

  google_gmail_list_messages  GET  /users/me/messages          (gmail.readonly)
  google_gmail_get_message    GET  /users/me/messages/{id}      (gmail.readonly)
  google_gmail_send           POST /users/me/messages/send      (gmail.send)  *mutation/HITL

Token Flow:
  Workspace Admin grants DWD(SA, [gmail.readonly, gmail.send])
  -> oap-google-mcp loads SA from GOOGLE_WORKSPACE_SA_JSON
  -> mints a short-lived access token with subject=meta.userEmail
  -> calls gmail.googleapis.com/gmail/v1/users/me/... AS that user.
"""

import os
import sys
import json
import base64
import logging
from email.message import EmailMessage
from typing import Optional, Any, Dict, List
from urllib.parse import quote

import httpx
from fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Logging (shared observability module if present, else stdlib).
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "shared"))
sys.path.insert(0, "/app/shared")
try:
    from observability import configure_logging  # type: ignore
    logger = configure_logging("oap-google-mcp")
except ImportError:
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("oap-google-mcp")

GMAIL_BASE = os.getenv("GMAIL_API_URL", "https://gmail.googleapis.com/gmail/v1")

# Least-privilege Gmail scopes. The DWD grant in the Workspace Admin console is
# the outer authorization boundary; these are the scopes we REQUEST per tool.
SCOPE_READONLY = "https://www.googleapis.com/auth/gmail.readonly"
SCOPE_SEND = "https://www.googleapis.com/auth/gmail.send"

GOOGLE_SERVER_INSTRUCTIONS = """
## OpenAgentic Google Workspace / Gmail MCP — unattended mail via DWD impersonation

This MCP acts AS a Google Workspace user's mailbox using a domain-wide-delegated
service account that impersonates that user (subject = the signed-in user's
email). DWD is a domain super-credential — one key can impersonate any user in
the domain and end-users cannot revoke it; per-user OAuth consent is the
least-privilege follow-up and is not built here.

Reads (no approval): google_gmail_list_messages, google_gmail_get_message.
Writes (SENDS on the user's behalf — approval-gated): google_gmail_send.

If the service-account credential is not configured, or no impersonation subject
is available, every tool returns an honest error — it NEVER fabricates mail.
"""

mcp = FastMCP("OpenAgentic Google Workspace MCP", instructions=GOOGLE_SERVER_INSTRUCTIONS)


# ===========================================================================
# AUTH — env-only SA + DWD subject impersonation. NO hardcoded credentials.
# ===========================================================================
def _load_sa_info() -> Dict[str, Any]:
    """Load the Workspace service-account key from GOOGLE_WORKSPACE_SA_JSON.

    Accepts raw JSON or base64-encoded JSON (k8s Secrets are commonly base64).
    HARD FAIL with an actionable ValueError when the env var is absent/empty —
    this MCP has NO on-disk key, NO key literal, and NO fallback identity, so a
    missing SA means it MUST refuse to run (fail-closed), never call Gmail
    unauthenticated.
    """
    raw = os.getenv("GOOGLE_WORKSPACE_SA_JSON", "").strip()
    if not raw:
        raise ValueError(
            "No Google Workspace service-account credential configured "
            "(GOOGLE_WORKSPACE_SA_JSON is unset). This MCP requires a "
            "domain-wide-delegated SA key — set GOOGLE_WORKSPACE_SA_JSON to the "
            "SA JSON (raw or base64). It will not run with no credential."
        )
    # Try raw JSON first; if that fails, try base64-decoding then JSON.
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    try:
        decoded = base64.b64decode(raw).decode("utf-8")
        return json.loads(decoded)
    except Exception as e:  # noqa: BLE001
        raise ValueError(
            "GOOGLE_WORKSPACE_SA_JSON is set but is neither valid JSON nor "
            f"base64-encoded JSON: {e}"
        )


def _resolve_subject(meta: Optional[Dict[str, Any]]) -> str:
    """Resolve the impersonation subject (the user the SA acts AS).

    Priority: the proxy-injected meta.userEmail (the signed-in user), then the
    GOOGLE_WORKSPACE_SUBJECT env default for fully-unattended deployments. A DWD
    token is meaningless without a subject, so HARD FAIL if neither is present.
    """
    subject = None
    if meta and isinstance(meta, dict):
        subject = meta.get("userEmail") or meta.get("subject")
    subject = subject or os.getenv("GOOGLE_WORKSPACE_SUBJECT", "").strip() or None
    if not subject:
        raise ValueError(
            "No impersonation subject available. The DWD service account must "
            "impersonate a specific Workspace user — sign in to OpenAgentic so "
            "meta.userEmail is injected, or set GOOGLE_WORKSPACE_SUBJECT."
        )
    return subject


def _mint_access_token(sa_info: Dict[str, Any], subject: str, scopes: List[str]) -> str:
    """Mint a short-lived OAuth access token for the SA impersonating `subject`.

    Uses google-auth service_account credentials with `.with_subject(subject)`
    (the domain-wide-delegation impersonation leg). Imported lazily so the unit
    suite can monkeypatch this function without google-auth installed, and so a
    missing google-auth produces an actionable error rather than an import-time
    crash.
    """
    try:
        from google.oauth2 import service_account  # type: ignore
        from google.auth.transport.requests import Request  # type: ignore
    except ImportError as e:  # noqa: BLE001
        raise ValueError(
            "google-auth is not installed in this runtime; cannot mint the DWD "
            f"access token ({e}). Add google-auth to requirements.txt."
        )
    creds = service_account.Credentials.from_service_account_info(
        sa_info, scopes=scopes
    ).with_subject(subject)
    creds.refresh(Request())
    return creds.token


def require_google_auth(
    meta: Optional[Dict[str, Any]], scopes: List[str]
) -> tuple[str, str]:
    """The single auth boundary: load the env SA, resolve the subject, mint a
    DWD access token. Returns (access_token, subject).

    Order matters for fail-closed honesty: the SA env is checked FIRST so a
    deployment with no credential refuses before any user/subject logic and
    before any network call.
    """
    sa_info = _load_sa_info()          # raises if no SA env (fail-closed)
    subject = _resolve_subject(meta)   # raises if no subject
    token = _mint_access_token(sa_info, subject, scopes)
    return token, subject


# ---------------------------------------------------------------------------
# PATH-SEGMENT HARDENING (defensive) — any user-controlled value interpolated
# into the Gmail URL PATH (the message id) is percent-encoded so it cannot form a
# new path segment. httpx performs RFC-3986 dot-segment normalization CLIENT-SIDE,
# so a raw id like "../../{evil}" would escape /users/me/ BEFORE the request is
# sent. Encoding "/" -> %2F keeps a quoted "../../X" a SINGLE literal segment so
# normalization can no longer pop the impersonated /users/me/ mailbox.
# ---------------------------------------------------------------------------
def _seg(v: Any) -> str:
    """Percent-encode a value for safe use as ONE URL path segment (safe="" so
    the "/" and "\\" path separators are encoded; "." is left intact but a quoted
    ".." can no longer act as a dot-segment)."""
    return quote(str(v), safe="")


def _gmail_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


def _error(exc: Exception, subject: Optional[str] = None) -> Dict[str, Any]:
    """Honest error envelope — never fabricates mail on a failure."""
    out: Dict[str, Any] = {
        "success": False,
        "error": str(exc),
        "error_type": type(exc).__name__,
    }
    if subject:
        out["executed_as"] = subject
    return out


async def gmail_request(
    method: str,
    path: str,
    token: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
) -> Any:
    """Call the Gmail REST API as the impersonated user. Raises ValueError with
    the Gmail error body on any >=400 so each tool's `except` arm returns an
    honest envelope.

    A 403 typically means the DWD grant for the requested scope is missing in
    the Workspace Admin console — surfaced verbatim, never fabricated.
    """
    url = f"{GMAIL_BASE}{path}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.request(
            method, url, headers=_gmail_headers(token), params=params, json=json_body
        )
        if resp.status_code == 401:
            raise ValueError(
                "Gmail rejected the token (401). The DWD access token may have "
                "expired or the subject is not a valid Workspace user."
            )
        if resp.status_code == 403:
            try:
                msg = resp.json().get("error", {}).get("message", resp.text)
            except Exception:  # noqa: BLE001
                msg = resp.text
            raise ValueError(
                f"Gmail denied this operation (403): {msg}. The domain-wide "
                f"delegation grant for the required scope is likely missing on "
                f"the service account in the Workspace Admin console."
            )
        if resp.status_code == 404:
            raise ValueError(f"Gmail resource not found (404): {method} {path}")
        if resp.status_code >= 400:
            try:
                msg = resp.json().get("error", {}).get("message", resp.text)
            except Exception:  # noqa: BLE001
                msg = resp.text
            raise ValueError(f"Gmail error ({resp.status_code}): {msg}")
        return resp.json() if resp.content else {}


def _header_value(headers: List[Dict[str, str]], name: str) -> Optional[str]:
    """Pull a header value (case-insensitive) out of a Gmail payload headers list."""
    for h in headers or []:
        if (h.get("name") or "").lower() == name.lower():
            return h.get("value")
    return None


# ===========================================================================
# GMAIL — list / get (gmail.readonly), send (gmail.send, mutation/HITL)
# ===========================================================================
@mcp.tool(
    annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
    meta={
        "category": "google-gmail",
        "destructiveness": "read-only",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "gmailEndpoint": "GET /users/me/messages",
        "gmailScope": SCOPE_READONLY,
        "goldenPrompts": ["list my gmail", "show my unread gmail", "search my gmail for invoices", "what's in my google inbox"],
    },
)
async def google_gmail_list_messages(
    query: Optional[str] = None,
    unread_only: bool = False,
    max: int = 10,
    meta: Optional[dict] = None,
) -> dict:
    """List Gmail messages for the impersonated user (DWD, gmail.readonly).

    Args:
        query: Optional Gmail search query (same syntax as the Gmail search box,
            e.g. "from:boss@x.com newer_than:7d").
        unread_only: When true, restricts to unread mail (adds `is:unread`).
        max: Max messages to return (1-100).
    """
    subject = None
    try:
        token, subject = require_google_auth(meta, [SCOPE_READONLY])
        # `max` is the param name (shadows the builtin) — clamp explicitly to 1..100.
        try:
            max_results = int(max)
        except Exception:  # noqa: BLE001
            max_results = 10
        max_results = 1 if max_results < 1 else (100 if max_results > 100 else max_results)
        q_parts = []
        if query:
            q_parts.append(str(query))
        if unread_only:
            q_parts.append("is:unread")
        params: Dict[str, Any] = {"maxResults": max_results}
        if q_parts:
            params["q"] = " ".join(q_parts)
        data = await gmail_request("GET", "/users/me/messages", token, params=params)
        messages = [
            {"id": m.get("id"), "thread_id": m.get("threadId")}
            for m in data.get("messages", [])
        ]
        return {
            "success": True,
            "count": len(messages),
            "result_size_estimate": data.get("resultSizeEstimate"),
            "messages": messages,
            "executed_as": subject,
        }
    except ValueError as e:
        return _error(e, subject)
    except Exception as e:  # noqa: BLE001
        return _error(e, subject)


@mcp.tool(
    annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
    meta={
        "category": "google-gmail",
        "destructiveness": "read-only",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "gmailEndpoint": "GET /users/me/messages/{id}",
        "gmailScope": SCOPE_READONLY,
        "goldenPrompts": ["read this gmail", "open the gmail message", "show the full email body"],
    },
)
async def google_gmail_get_message(id: str, meta: Optional[dict] = None) -> dict:
    """Read a single Gmail message (headers + snippet) for the impersonated user
    (DWD, gmail.readonly).

    Args:
        id: The Gmail message id (from google_gmail_list_messages).
    """
    subject = None
    try:
        token, subject = require_google_auth(meta, [SCOPE_READONLY])
        if not id:
            raise ValueError("A message 'id' is required.")
        # format=metadata returns headers + snippet without the full raw body,
        # which is enough to summarize; bump to 'full' if the body is needed.
        params = {
            "format": "metadata",
            "metadataHeaders": ["Subject", "From", "To", "Cc", "Date"],
        }
        m = await gmail_request("GET", f"/users/me/messages/{_seg(id)}", token, params=params)
        headers = (m.get("payload") or {}).get("headers", [])
        return {
            "success": True,
            "message": {
                "id": m.get("id"),
                "thread_id": m.get("threadId"),
                "label_ids": m.get("labelIds", []),
                "snippet": m.get("snippet"),
                "subject": _header_value(headers, "Subject"),
                "from": _header_value(headers, "From"),
                "to": _header_value(headers, "To"),
                "cc": _header_value(headers, "Cc"),
                "date": _header_value(headers, "Date"),
            },
            "executed_as": subject,
        }
    except ValueError as e:
        return _error(e, subject)
    except Exception as e:  # noqa: BLE001
        return _error(e, subject)


@mcp.tool(
    annotations={"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True},
    meta={
        "category": "google-gmail",
        "destructiveness": "mutating",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "gmailEndpoint": "POST /users/me/messages/send",
        "gmailScope": SCOPE_SEND,
        "goldenPrompts": ["send a gmail to", "email this via gmail", "send an email from my google account"],
    },
)
async def google_gmail_send(
    to: str,
    subject: str,
    body: str,
    cc: Optional[str] = None,
    meta: Optional[dict] = None,
) -> dict:
    """Send an email AS the impersonated user via Gmail (DWD, gmail.send).
    MUTATION — approval-gated.

    Builds an RFC-2822 MIME message and submits it base64url-encoded as the
    `raw` field, per the Gmail send API.

    Args:
        to: Recipient email address(es), comma-separated.
        subject: Email subject.
        body: Plain-text email body.
        cc: Optional CC recipient address(es), comma-separated.
    """
    s = None
    try:
        token, s = require_google_auth(meta, [SCOPE_SEND])
        if not to:
            raise ValueError("At least one recipient ('to') is required.")
        msg = EmailMessage()
        msg["To"] = to
        msg["From"] = s  # the impersonated user is the sender
        msg["Subject"] = subject
        if cc:
            msg["Cc"] = cc
        msg.set_content(body or "")
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
        sent = await gmail_request(
            "POST", "/users/me/messages/send", token, json_body={"raw": raw}
        )
        return {
            "success": True,
            "sent": True,
            "to": to,
            "subject": subject,
            "message_id": sent.get("id"),
            "thread_id": sent.get("threadId"),
            "executed_as": s,
        }
    except ValueError as e:
        return _error(e, s)
    except Exception as e:  # noqa: BLE001
        return _error(e, s)


# Run the server (stdio when launched by the proxy via `fastmcp run -t stdio`).
if __name__ == "__main__":
    mcp.run()
