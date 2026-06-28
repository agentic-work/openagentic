"""
OpenAgentic Entra / M365 MCP Server — app-only Microsoft 365 (Mail · Calendar).

This MCP talks to Microsoft Graph (``https://graph.microsoft.com/v1.0/users/{id}/...``)
as a single configured Azure AD **service principal** (app registration), using an
app-only Graph token minted via ``azure-identity``'s ``ClientSecretCredential``.

Authentication (OSS self-hosted pattern — mirrors oap-azure-mcp):
  ``ClientSecretCredential(tenant_id, client_id, client_secret).get_token(
      "https://graph.microsoft.com/.default")``
  built from AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET env vars.

  The operator creates an Azure AD app registration + client secret, grants it
  the required Microsoft Graph **Application** permissions (e.g. Mail.Read,
  Mail.Send, Calendars.ReadWrite), and supplies the three values via the
  environment. Every operation runs with that single service-principal identity.

There is NO on-behalf-of / delegated user-token passthrough and no per-user
credential brokering: this MCP does not depend on a user being signed in via an
external IdP.

App-only Graph tokens have no signed-in user, so the per-user ``me`` shortcut is
unavailable. Every tool therefore targets ``/users/{userId}/...``, where ``userId`` is
``meta.userEmail`` (injected by the mcp-proxy for the active user) or, when
absent, the ``GRAPH_DEFAULT_MAILBOX`` env var. If neither is present the tool
returns an honest, actionable error rather than crashing.

Tool surface:

  Mail      entra_list_mail        GET  /users/{id}/messages              (Mail.Read)
            entra_read_mail        GET  /users/{id}/messages/{mid}        (Mail.Read)
            entra_send_mail        POST /users/{id}/sendMail              (Mail.Send)   *mutation
            entra_reply_mail       POST /users/{id}/messages/{mid}/reply  (Mail.Send)   *mutation
  Calendar  entra_list_calendar    GET  /users/{id}/calendarView          (Calendars.Read)
            entra_create_meeting   POST /users/{id}/onlineMeetings        (OnlineMeetings.ReadWrite.All) *mutation
            entra_create_calendar_event
                                   POST /users/{id}/events                (Calendars.ReadWrite) *mutation

  The Teams chat/channel tools and the meeting-transcript tool are FEATURE-GATED
  behind ENTRA_TEAMS_TOOLS_ENABLED=true (see below) because they require
  application permissions — and, for online-meeting/transcript access, an
  application access policy — that most tenants do not grant by default and that
  return 403 app-only otherwise.
"""

import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Any, Dict

import httpx
from fastmcp import FastMCP

from azure.identity import ClientSecretCredential

# ---------------------------------------------------------------------------
# Logging (shared observability module if present, else stdlib).
# ---------------------------------------------------------------------------
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "shared"))
sys.path.insert(0, "/app/shared")
try:
    from observability import configure_logging  # type: ignore
    logger = configure_logging("oap-entra-mcp")
except ImportError:
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("oap-entra-mcp")

GRAPH_BASE = os.getenv("GRAPH_API_URL", "https://graph.microsoft.com/v1.0")
GRAPH_SCOPE = "https://graph.microsoft.com/.default"

# Target user for app-only /users/{id}/... calls when the proxy does not inject
# meta.userEmail (e.g. a non-interactive flow). Optional.
GRAPH_DEFAULT_MAILBOX = os.getenv("GRAPH_DEFAULT_MAILBOX", "")

# Service principal (Azure AD app registration) configuration.
AZURE_TENANT_ID = os.environ.get("AZURE_TENANT_ID", "")
AZURE_CLIENT_ID = os.environ.get("AZURE_CLIENT_ID", "")
AZURE_CLIENT_SECRET = os.environ.get("AZURE_CLIENT_SECRET", "")

# Teams chat/channel + meeting-transcript tools are off by default. They need
# Graph application permissions (and an application access policy for
# online-meeting/transcript reads) that most tenants do not grant, and 403
# app-only otherwise. Set ENTRA_TEAMS_TOOLS_ENABLED=true to register them.
TEAMS_TOOLS_ENABLED = os.getenv("ENTRA_TEAMS_TOOLS_ENABLED", "false").lower() == "true"

ENTRA_SERVER_INSTRUCTIONS = """
## OpenAgentic Entra / M365 MCP — app-only Microsoft 365 (Mail · Calendar)

This MCP acts as the configured Azure AD service principal against Microsoft
Graph (app-only). It targets a specific user's mailbox/calendar via
/users/{id}/... — the user resolved from meta.userEmail or GRAPH_DEFAULT_MAILBOX.

Reads (no approval): entra_list_mail, entra_read_mail, entra_list_calendar.
Writes (these SEND/CREATE — approval-gated): entra_send_mail, entra_reply_mail,
                     entra_create_meeting, entra_create_calendar_event.

Teams chat/channel + meeting-transcript tools are registered ONLY when
ENTRA_TEAMS_TOOLS_ENABLED=true (they need application permissions most tenants
do not grant). If a tool returns a 403 the application permission has not been
admin-consented yet — the error is surfaced verbatim. NEVER invent mail/calendar
content.
"""

mcp = FastMCP("OpenAgentic Entra M365 MCP", instructions=ENTRA_SERVER_INSTRUCTIONS)


# ===========================================================================
# AUTH — mint an app-only Graph token via the configured service principal.
# ===========================================================================
# Cached singleton ClientSecretCredential (one per process).
_sp_credential: Optional["ClientSecretCredential"] = None


def _build_service_principal_info() -> Dict[str, str]:
    """Build the executed_as badge for the configured service principal."""
    return {
        "upn": f"sp:{AZURE_CLIENT_ID}" if AZURE_CLIENT_ID else "service-principal",
        "name": "Entra Service Principal",
        "oid": AZURE_CLIENT_ID,
        "tid": AZURE_TENANT_ID,
        "auth": "service_principal",
    }


def get_service_principal_credential() -> "ClientSecretCredential":
    """Build (once) and return the ClientSecretCredential for the configured
    Azure AD service principal.

    Raises:
        ValueError: if AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET
            are not all configured.
    """
    global _sp_credential

    missing = [
        name for name, val in (
            ("AZURE_TENANT_ID", AZURE_TENANT_ID),
            ("AZURE_CLIENT_ID", AZURE_CLIENT_ID),
            ("AZURE_CLIENT_SECRET", AZURE_CLIENT_SECRET),
        ) if not val
    ]
    if missing:
        raise ValueError(
            "Entra service principal not configured. Missing environment "
            f"variable(s): {', '.join(missing)}. Create an Azure AD app "
            "registration + client secret, grant it the required Microsoft "
            "Graph application permissions (e.g. Mail.Read, Mail.Send, "
            "Calendars.ReadWrite), then set AZURE_TENANT_ID / AZURE_CLIENT_ID / "
            "AZURE_CLIENT_SECRET."
        )

    if _sp_credential is None:
        _sp_credential = ClientSecretCredential(
            tenant_id=AZURE_TENANT_ID,
            client_id=AZURE_CLIENT_ID,
            client_secret=AZURE_CLIENT_SECRET,
        )
        logger.info(f"ClientSecretCredential initialized for service principal: {AZURE_CLIENT_ID}")

    return _sp_credential


def require_graph_token(meta: Optional[Dict[str, Any]]) -> tuple[str, Dict[str, str]]:
    """Mint an app-only Microsoft Graph token via the configured service principal.

    The name + (meta) signature are retained for call-site compatibility, but the
    `meta` argument is IGNORED for authentication — OSS has no on-behalf-of flow,
    so a delegated token in meta is never read. ClientSecretCredential requests the Graph
    `.default` scope (the application permissions consented on the app
    registration bound what it can do).

    Returns:
        (token, service_principal_info) — mirrors oap-azure-mcp `require_user_token`.

    Raises:
        ValueError: if the service principal env vars are not configured.
    """
    credential = get_service_principal_credential()
    token = credential.get_token(GRAPH_SCOPE).token
    return token, _build_service_principal_info()


def require_mailbox(meta: Optional[Dict[str, Any]]) -> str:
    """Resolve the target user for app-only /users/{id}/... calls.

    App-only tokens have no signed-in user, so every mailbox/calendar call must
    name a user. Prefer the proxy-injected `meta.userEmail`; fall back to the
    `GRAPH_DEFAULT_MAILBOX` env. If neither is set, raise an honest, actionable
    error (the caller's `except` arm returns a handled envelope, never a crash).
    """
    user_id = None
    if meta and isinstance(meta, dict):
        user_id = meta.get("userEmail")
    user_id = user_id or GRAPH_DEFAULT_MAILBOX
    if not user_id:
        raise ValueError(
            "No target mailbox/user. App-only Microsoft Graph access requires a "
            "user — none was provided. Run via the platform so meta.userEmail is "
            "injected, or set the GRAPH_DEFAULT_MAILBOX environment variable."
        )
    return user_id


def _graph_headers(token: str, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if extra:
        headers.update(extra)
    return headers


def _error(exc: Exception, user_info: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Honest error envelope. A 403 is surfaced verbatim with a consent hint —
    we NEVER fabricate mail/calendar data on a permission failure."""
    out: Dict[str, Any] = {
        "success": False,
        "error": str(exc),
        "error_type": type(exc).__name__,
    }
    if user_info:
        out["executed_as"] = user_info
    return out


async def graph_request(
    method: str,
    path: str,
    token: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
    raw_text: bool = False,
) -> Any:
    """Call Microsoft Graph as the service principal. Raises ValueError with the
    Graph error body on any >=400 so the tool's `except` arm returns an honest
    envelope.

    A 403 means the application permission has not been admin-consented yet — the
    Graph error body (which names the missing permission) is surfaced verbatim.
    """
    url = f"{GRAPH_BASE}{path}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.request(
            method, url, headers=_graph_headers(token), params=params, json=json_body
        )

        if resp.status_code == 401:
            raise ValueError(
                "Microsoft Graph rejected the token (401). Verify the app "
                "registration's client secret has not expired and that "
                "AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET are correct."
            )
        if resp.status_code == 403:
            # Application permission not yet consented — surface VERBATIM, do not fabricate.
            try:
                body = resp.json().get("error", {})
                msg = body.get("message", resp.text)
            except Exception:  # noqa: BLE001
                msg = resp.text
            raise ValueError(
                f"Microsoft Graph denied this operation (403): {msg}. The required "
                f"Graph application permission for {method} {path} is likely not "
                f"admin-consented on the app registration yet."
            )
        if resp.status_code == 404:
            raise ValueError(f"Microsoft Graph resource not found (404): {method} {path}")
        if resp.status_code >= 400:
            try:
                msg = resp.json().get("error", {}).get("message", resp.text)
            except Exception:  # noqa: BLE001
                msg = resp.text
            raise ValueError(f"Microsoft Graph error ({resp.status_code}): {msg}")

        if raw_text:
            return resp.text
        return resp.json() if resp.content else {}


# ===========================================================================
# MAIL — Mail.Read (read), Mail.Send (send/reply)
# ===========================================================================
@mcp.tool(
    annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
    meta={
        "category": "m365-mail",
        "destructiveness": "read-only",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "graphEndpoint": "GET /users/{id}/messages",
        "graphScope": "Mail.Read",
        "goldenPrompts": ["list recent emails", "show the inbox", "what's in the mailbox", "summarize the day"],
    },
)
async def entra_list_mail(
    top: int = 10,
    importance: Optional[str] = None,
    unread_only: bool = False,
    folder: str = "inbox",
    meta: Optional[dict] = None,
) -> dict:
    """List recent messages from the target user's mailbox (app-only, Mail.Read).

    Args:
        top: Max messages to return (1-50).
        importance: Optional filter — 'high' | 'normal' | 'low'.
        unread_only: When true, only unread messages.
        folder: Mail folder well-known name (default 'inbox'). Use 'sentitems' etc.
    """
    try:
        token, user_info = require_graph_token(meta)
        user_id = require_mailbox(meta)
        user_info = {**user_info, "mailbox": user_id}
        top = max(1, min(int(top), 50))
        filters = []
        if importance in ("high", "normal", "low"):
            filters.append(f"importance eq '{importance}'")
        if unread_only:
            filters.append("isRead eq false")
        params: Dict[str, Any] = {
            "$top": top,
            "$select": "id,subject,from,receivedDateTime,bodyPreview,importance,isRead,webLink",
        }
        # Microsoft Graph rejects $orderby on a property different from the $filter
        # property with 400 "The restriction or sort order is too complex for this
        # operation." So apply $orderby ONLY when there is no $filter, and sort
        # client-side (newest first) whenever a filter is present.
        if filters:
            params["$filter"] = " and ".join(filters)
        else:
            params["$orderby"] = "receivedDateTime desc"
        path = (
            f"/users/{user_id}/mailFolders/{folder}/messages"
            if folder else f"/users/{user_id}/messages"
        )
        data = await graph_request("GET", path, token, params=params)
        messages = [
            {
                "id": m.get("id"),
                "subject": m.get("subject"),
                "from": (m.get("from") or {}).get("emailAddress", {}).get("address"),
                "from_name": (m.get("from") or {}).get("emailAddress", {}).get("name"),
                "received": m.get("receivedDateTime"),
                "preview": m.get("bodyPreview"),
                "importance": m.get("importance"),
                "is_read": m.get("isRead"),
                "web_link": m.get("webLink"),
            }
            for m in data.get("value", [])
        ]
        if filters:
            # ISO-8601 timestamps sort lexically; newest first.
            messages.sort(key=lambda m: m.get("received") or "", reverse=True)
        return {"success": True, "count": len(messages), "messages": messages, "executed_as": user_info}
    except ValueError as e:
        return _error(e)
    except Exception as e:  # noqa: BLE001
        return _error(e)


@mcp.tool(
    annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
    meta={
        "category": "m365-mail",
        "destructiveness": "read-only",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "graphEndpoint": "GET /users/{id}/messages/{mid}",
        "graphScope": "Mail.Read",
        "goldenPrompts": ["read this email", "open message", "show the full email body"],
    },
)
async def entra_read_mail(message_id: str, meta: Optional[dict] = None) -> dict:
    """Read a single message (full body) from the target user's mailbox (Mail.Read).

    Args:
        message_id: The Graph message id (from entra_list_mail).
    """
    try:
        token, user_info = require_graph_token(meta)
        user_id = require_mailbox(meta)
        user_info = {**user_info, "mailbox": user_id}
        params = {"$select": "id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,importance,isRead,webLink"}
        m = await graph_request("GET", f"/users/{user_id}/messages/{message_id}", token, params=params)
        return {
            "success": True,
            "message": {
                "id": m.get("id"),
                "subject": m.get("subject"),
                "from": (m.get("from") or {}).get("emailAddress", {}),
                "to": [r.get("emailAddress", {}) for r in (m.get("toRecipients") or [])],
                "cc": [r.get("emailAddress", {}) for r in (m.get("ccRecipients") or [])],
                "received": m.get("receivedDateTime"),
                "body": (m.get("body") or {}).get("content"),
                "body_type": (m.get("body") or {}).get("contentType"),
                "importance": m.get("importance"),
                "is_read": m.get("isRead"),
                "web_link": m.get("webLink"),
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return _error(e)
    except Exception as e:  # noqa: BLE001
        return _error(e)


@mcp.tool(
    annotations={"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True},
    meta={
        "category": "m365-mail",
        "destructiveness": "mutating",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "graphEndpoint": "POST /users/{id}/sendMail",
        "graphScope": "Mail.Send",
        "goldenPrompts": ["send an email to", "email this to", "draft and send a message"],
    },
)
async def entra_send_mail(
    to: list[str],
    subject: str,
    body: str,
    cc: Optional[list[str]] = None,
    body_type: str = "Text",
    meta: Optional[dict] = None,
) -> dict:
    """Send a NEW email AS the target user (Mail.Send). MUTATION — approval-gated.

    Args:
        to: Recipient email addresses.
        subject: Email subject.
        body: Email body content.
        cc: Optional CC recipient email addresses.
        body_type: 'Text' or 'HTML'.
    """
    try:
        token, user_info = require_graph_token(meta)
        user_id = require_mailbox(meta)
        user_info = {**user_info, "mailbox": user_id}
        if not to:
            raise ValueError("At least one recipient ('to') is required.")
        bt = "HTML" if str(body_type).lower() == "html" else "Text"
        payload = {
            "message": {
                "subject": subject,
                "body": {"contentType": bt, "content": body},
                "toRecipients": [{"emailAddress": {"address": a}} for a in to],
            },
            "saveToSentItems": True,
        }
        if cc:
            payload["message"]["ccRecipients"] = [{"emailAddress": {"address": a}} for a in cc]
        # sendMail returns 202 Accepted with empty body on success.
        await graph_request("POST", f"/users/{user_id}/sendMail", token, json_body=payload)
        return {"success": True, "sent": True, "to": to, "subject": subject, "executed_as": user_info}
    except ValueError as e:
        return _error(e)
    except Exception as e:  # noqa: BLE001
        return _error(e)


@mcp.tool(
    annotations={"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True},
    meta={
        "category": "m365-mail",
        "destructiveness": "mutating",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "graphEndpoint": "POST /users/{id}/messages/{mid}/reply",
        "graphScope": "Mail.Send",
        "goldenPrompts": ["reply to this email", "respond to the message", "reply all"],
    },
)
async def entra_reply_mail(
    message_id: str,
    comment: str,
    meta: Optional[dict] = None,
) -> dict:
    """Reply to a message AS the target user (Mail.Send). MUTATION — approval-gated.

    Args:
        message_id: The Graph message id to reply to (from entra_list_mail).
        comment: The reply body text prepended above the original message.
    """
    try:
        token, user_info = require_graph_token(meta)
        user_id = require_mailbox(meta)
        user_info = {**user_info, "mailbox": user_id}
        # /reply returns 202 Accepted with empty body on success.
        await graph_request(
            "POST", f"/users/{user_id}/messages/{message_id}/reply", token, json_body={"comment": comment}
        )
        return {"success": True, "replied": True, "message_id": message_id, "executed_as": user_info}
    except ValueError as e:
        return _error(e)
    except Exception as e:  # noqa: BLE001
        return _error(e)


# ===========================================================================
# CALENDAR — Calendars.Read (read), OnlineMeetings.ReadWrite.All / Calendars.ReadWrite (create)
# ===========================================================================
@mcp.tool(
    annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
    meta={
        "category": "m365-calendar",
        "destructiveness": "read-only",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "graphEndpoint": "GET /users/{id}/calendarView",
        "graphScope": "Calendars.Read",
        "goldenPrompts": ["what's on the calendar", "summarize the day", "meetings today", "the schedule"],
    },
)
async def entra_list_calendar(
    window: str = "today",
    start: Optional[str] = None,
    end: Optional[str] = None,
    top: int = 25,
    meta: Optional[dict] = None,
) -> dict:
    """List the target user's calendar events in a window (app-only, Calendars.Read).

    Uses /users/{id}/calendarView which expands recurring events. Default window is today.

    Args:
        window: 'today' | 'week' — convenience window if start/end omitted.
        start: ISO8601 start (overrides window).
        end: ISO8601 end (overrides window).
        top: Max events to return (1-100).
    """
    try:
        token, user_info = require_graph_token(meta)
        user_id = require_mailbox(meta)
        user_info = {**user_info, "mailbox": user_id}
        top = max(1, min(int(top), 100))
        if not start or not end:
            now = datetime.now(timezone.utc)
            day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            if window == "week":
                day_end = day_start + timedelta(days=7)
            else:
                day_end = day_start + timedelta(days=1)
            start = start or day_start.isoformat()
            end = end or day_end.isoformat()
        params = {
            "startDateTime": start,
            "endDateTime": end,
            "$select": "id,subject,start,end,location,organizer,attendees,isOnlineMeeting,onlineMeeting,webLink",
            "$orderby": "start/dateTime",
            "$top": top,
        }
        data = await graph_request("GET", f"/users/{user_id}/calendarView", token, params=params)
        events = [
            {
                "id": e.get("id"),
                "subject": e.get("subject"),
                "start": (e.get("start") or {}).get("dateTime"),
                "end": (e.get("end") or {}).get("dateTime"),
                "location": (e.get("location") or {}).get("displayName"),
                "organizer": (e.get("organizer") or {}).get("emailAddress", {}).get("name"),
                "attendee_count": len(e.get("attendees") or []),
                "is_online_meeting": e.get("isOnlineMeeting"),
                "join_url": (e.get("onlineMeeting") or {}).get("joinUrl"),
                "web_link": e.get("webLink"),
            }
            for e in data.get("value", [])
        ]
        return {
            "success": True,
            "count": len(events),
            "window": {"start": start, "end": end},
            "events": events,
            "executed_as": user_info,
        }
    except ValueError as e:
        return _error(e)
    except Exception as e:  # noqa: BLE001
        return _error(e)


@mcp.tool(
    annotations={"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True},
    meta={
        "category": "m365-calendar",
        "destructiveness": "mutating",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "graphEndpoint": "POST /users/{id}/onlineMeetings",
        "graphScope": "OnlineMeetings.ReadWrite.All",
        "goldenPrompts": ["create a teams meeting", "set up an online meeting", "schedule a teams call"],
    },
)
async def entra_create_meeting(
    subject: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    meta: Optional[dict] = None,
) -> dict:
    """Create a Teams online meeting for the target user (OnlineMeetings.ReadWrite.All).

    MUTATION — approval-gated. Returns the join URL. NOTE (app-only): creating an
    online meeting for a user requires both the OnlineMeetings.ReadWrite.All
    application permission AND an application access policy granting this app
    rights to that user's online meetings; otherwise Graph returns 403. Standalone
    meetings created here are NOT calendar-linked.

    Args:
        subject: Meeting subject.
        start: ISO8601 start (default now).
        end: ISO8601 end (default start + 30 min).
    """
    try:
        token, user_info = require_graph_token(meta)
        user_id = require_mailbox(meta)
        user_info = {**user_info, "mailbox": user_id}
        now = datetime.now(timezone.utc)
        start = start or now.isoformat()
        if not end:
            try:
                base = datetime.fromisoformat(start.replace("Z", "+00:00"))
            except Exception:  # noqa: BLE001
                base = now
            end = (base + timedelta(minutes=30)).isoformat()
        payload = {"subject": subject, "startDateTime": start, "endDateTime": end}
        m = await graph_request("POST", f"/users/{user_id}/onlineMeetings", token, json_body=payload)
        return {
            "success": True,
            "created": True,
            "meeting": {
                "id": m.get("id"),
                "subject": m.get("subject"),
                "join_url": m.get("joinWebUrl"),
                "start": (m.get("startDateTime") or m.get("creationDateTime")),
                "end": m.get("endDateTime"),
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return _error(e)
    except Exception as e:  # noqa: BLE001
        return _error(e)


def _graph_datetime(value: Optional[str], default: datetime) -> Dict[str, str]:
    """Build Graph's {dateTime, timeZone} object from an ISO string.

    Graph /users/{id}/events start/end are DateTimeTimeZone objects, NOT bare ISO
    strings (unlike /users/{id}/onlineMeetings which takes bare strings). We
    normalize any incoming ISO value (with or without a trailing Z) to a UTC
    dateTime so the created event is unambiguous and calendarView reads it back at
    the same instant. timeZone is always 'UTC' here.
    """
    dt = default
    if value:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:  # noqa: BLE001 — fall back to default on a bad string
            dt = default
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    # Graph wants a naive ISO local-to-the-stated-timeZone string (no offset).
    return {"dateTime": dt.replace(tzinfo=None).isoformat(), "timeZone": "UTC"}


@mcp.tool(
    annotations={"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True},
    meta={
        "category": "m365-calendar",
        "destructiveness": "mutating",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "graphEndpoint": "POST /users/{id}/events",
        "graphScope": "Calendars.ReadWrite",
        "goldenPrompts": ["put a meeting on the calendar", "schedule a calendar event", "book a teams meeting on the calendar"],
    },
)
async def entra_create_calendar_event(
    subject: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    body: Optional[str] = None,
    attendees: Optional[list[str]] = None,
    is_online_meeting: bool = True,
    meta: Optional[dict] = None,
) -> dict:
    """Create a CALENDAR-LINKED event on the target user's default calendar (Calendars.ReadWrite).

    MUTATION — approval-gated. Unlike entra_create_meeting (standalone
    /users/{id}/onlineMeetings, which is NOT visible in calendarView), this creates
    a real /users/{id}/events item that:
      * shows up in entra_list_calendar (the round-trip read-back), and
      * when is_online_meeting=True, carries a Teams join URL.

    Args:
        subject: Event subject.
        start: ISO8601 start (default now).
        end: ISO8601 end (default start + 30 min).
        body: Optional event body/agenda text.
        attendees: Optional attendee email addresses (added as 'required').
        is_online_meeting: When true, attach a Teams online meeting (default true).
    """
    try:
        token, user_info = require_graph_token(meta)
        user_id = require_mailbox(meta)
        user_info = {**user_info, "mailbox": user_id}
        now = datetime.now(timezone.utc)
        start_obj = _graph_datetime(start, now)
        # default end = start + 30 min
        try:
            base = datetime.fromisoformat(start_obj["dateTime"]).replace(tzinfo=timezone.utc)
        except Exception:  # noqa: BLE001
            base = now
        end_obj = _graph_datetime(end, base + timedelta(minutes=30))
        payload: Dict[str, Any] = {
            "subject": subject,
            "start": start_obj,
            "end": end_obj,
        }
        if body:
            payload["body"] = {"contentType": "HTML", "content": body}
        if attendees:
            payload["attendees"] = [
                {"emailAddress": {"address": a}, "type": "required"} for a in attendees
            ]
        if is_online_meeting:
            payload["isOnlineMeeting"] = True
            payload["onlineMeetingProvider"] = "teamsForBusiness"
        e = await graph_request("POST", f"/users/{user_id}/events", token, json_body=payload)
        return {
            "success": True,
            "created": True,
            "event": {
                "id": e.get("id"),
                "subject": e.get("subject"),
                "start": (e.get("start") or {}).get("dateTime"),
                "end": (e.get("end") or {}).get("dateTime"),
                "web_link": e.get("webLink"),
                "join_url": (e.get("onlineMeeting") or {}).get("joinUrl"),
                "is_online_meeting": e.get("isOnlineMeeting"),
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return _error(e)
    except Exception as e:  # noqa: BLE001
        return _error(e)


# ===========================================================================
# TEAMS + MEETING TRANSCRIPT — FEATURE-GATED (ENTRA_TEAMS_TOOLS_ENABLED=true).
#
# These rely on Graph application permissions — and, for online-meeting /
# transcript reads, an application access policy — that most tenants do NOT grant
# by default and that return 403 app-only otherwise. They are registered only
# when ENTRA_TEAMS_TOOLS_ENABLED=true so the default install ships a surface that
# works out of the box (Mail + Calendar) rather than tools that 403.
# ===========================================================================
if TEAMS_TOOLS_ENABLED:

    @mcp.tool(
        annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
        meta={
            "category": "m365-teams",
            "destructiveness": "read-only",
            "hitlRisk": "low",
            "requiresConsent": False,
            "cost": "free",
            "graphEndpoint": "GET /users/{id}/chats",
            "graphScope": "Chat.Read.All",
            "goldenPrompts": ["list the teams chats", "what teams conversations exist", "find a teams chat"],
        },
    )
    async def entra_list_teams_chats(top: int = 20, meta: Optional[dict] = None) -> dict:
        """List the target user's Teams chats (1:1 + group) to resolve a chat id.

        GATED (ENTRA_TEAMS_TOOLS_ENABLED): needs the Chat.Read.All application
        permission, which most tenants do not grant by default.

        Args:
            top: Max chats to return (1-50).
        """
        try:
            token, user_info = require_graph_token(meta)
            user_id = require_mailbox(meta)
            user_info = {**user_info, "mailbox": user_id}
            top = max(1, min(int(top), 50))
            params = {"$top": top, "$orderby": "lastMessagePreview/createdDateTime desc", "$expand": "members"}
            data = await graph_request("GET", f"/users/{user_id}/chats", token, params=params)
            chats = [
                {
                    "id": c.get("id"),
                    "topic": c.get("topic"),
                    "chat_type": c.get("chatType"),
                    "members": [
                        (mem.get("displayName") or mem.get("email"))
                        for mem in (c.get("members") or [])
                    ],
                    "last_updated": c.get("lastUpdatedDateTime"),
                    "web_url": c.get("webUrl"),
                }
                for c in data.get("value", [])
            ]
            return {"success": True, "count": len(chats), "chats": chats, "executed_as": user_info}
        except ValueError as e:
            return _error(e)
        except Exception as e:  # noqa: BLE001
            return _error(e)

    @mcp.tool(
        annotations={"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True},
        meta={
            "category": "m365-teams",
            "destructiveness": "mutating",
            "hitlRisk": "high",
            "requiresConsent": True,
            "cost": "free",
            "graphEndpoint": "POST /chats/{id}/messages",
            "graphScope": "ChatMessage.Send / Chat.ReadWrite.All",
            "goldenPrompts": ["send a teams message", "message someone on teams", "post to the teams chat"],
        },
    )
    async def entra_send_teams_chat(
        chat_id: str,
        content: str,
        content_type: str = "text",
        meta: Optional[dict] = None,
    ) -> dict:
        """Post a message to a Teams chat (Chat.ReadWrite.All). MUTATION — approval-gated.

        GATED (ENTRA_TEAMS_TOOLS_ENABLED): app-only posting to chats needs
        application permissions most tenants do not grant by default.

        Args:
            chat_id: The Teams chat id (from entra_list_teams_chats).
            content: The message body.
            content_type: 'text' or 'html'.
        """
        try:
            token, user_info = require_graph_token(meta)
            ct = "html" if str(content_type).lower() == "html" else "text"
            payload = {"body": {"contentType": ct, "content": content}}
            msg = await graph_request("POST", f"/chats/{chat_id}/messages", token, json_body=payload)
            return {
                "success": True,
                "sent": True,
                "chat_id": chat_id,
                "message_id": msg.get("id"),
                "executed_as": user_info,
            }
        except ValueError as e:
            return _error(e)
        except Exception as e:  # noqa: BLE001
            return _error(e)

    @mcp.tool(
        annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
        meta={
            "category": "m365-teams",
            "destructiveness": "read-only",
            "hitlRisk": "low",
            "requiresConsent": False,
            "cost": "free",
            "graphEndpoint": "GET /chats/{id}/messages",
            "graphScope": "Chat.Read.All",
            "goldenPrompts": ["read the teams chat", "show messages in this teams chat", "what was said in the chat"],
        },
    )
    async def entra_list_teams_chat_messages(
        chat_id: str,
        top: int = 20,
        meta: Optional[dict] = None,
    ) -> dict:
        """List the recent messages in ONE Teams chat (Chat.Read.All).

        GATED (ENTRA_TEAMS_TOOLS_ENABLED). The read-back leg for the Teams
        round-trip: confirm a posted message landed by listing the chat's messages.

        Args:
            chat_id: The Teams chat id (from entra_list_teams_chats).
            top: Max messages to return (1-50), newest first.
        """
        try:
            token, user_info = require_graph_token(meta)
            top = max(1, min(int(top), 50))
            params = {"$top": top, "$orderby": "createdDateTime desc"}
            data = await graph_request("GET", f"/chats/{chat_id}/messages", token, params=params)
            messages = [
                {
                    "id": m.get("id"),
                    "content": (m.get("body") or {}).get("content"),
                    "content_type": (m.get("body") or {}).get("contentType"),
                    "from": (((m.get("from") or {}).get("user") or {}).get("displayName")),
                    "created": m.get("createdDateTime"),
                    "message_type": m.get("messageType"),
                }
                for m in data.get("value", [])
            ]
            return {
                "success": True,
                "chat_id": chat_id,
                "count": len(messages),
                "messages": messages,
                "executed_as": user_info,
            }
        except ValueError as e:
            return _error(e)
        except Exception as e:  # noqa: BLE001
            return _error(e)

    @mcp.tool(
        annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
        meta={
            "category": "m365-teams",
            "destructiveness": "read-only",
            "hitlRisk": "low",
            "requiresConsent": False,
            "cost": "free",
            "graphEndpoint": "GET /users/{id}/joinedTeams",
            "graphScope": "Team.ReadBasic.All",
            "goldenPrompts": ["what teams am i in", "list the teams", "find a team"],
        },
    )
    async def entra_list_joined_teams(meta: Optional[dict] = None) -> dict:
        """List the Teams the target user is a member of (app-only).

        GATED (ENTRA_TEAMS_TOOLS_ENABLED). Resolve a team_id for channel messaging.
        """
        try:
            token, user_info = require_graph_token(meta)
            user_id = require_mailbox(meta)
            user_info = {**user_info, "mailbox": user_id}
            data = await graph_request("GET", f"/users/{user_id}/joinedTeams", token,
                                       params={"$select": "id,displayName,description"})
            teams = [
                {"id": t.get("id"), "name": t.get("displayName"), "description": t.get("description")}
                for t in data.get("value", [])
            ]
            return {"success": True, "count": len(teams), "teams": teams, "executed_as": user_info}
        except ValueError as e:
            return _error(e)
        except Exception as e:  # noqa: BLE001
            return _error(e)

    @mcp.tool(
        annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
        meta={
            "category": "m365-teams",
            "destructiveness": "read-only",
            "hitlRisk": "low",
            "requiresConsent": False,
            "cost": "free",
            "graphEndpoint": "GET /teams/{team-id}/channels",
            "graphScope": "Channel.ReadBasic.All",
            "goldenPrompts": ["list channels in a team", "find a channel"],
        },
    )
    async def entra_list_team_channels(team_id: str, meta: Optional[dict] = None) -> dict:
        """List channels in a team to resolve a channel_id (app-only).

        GATED (ENTRA_TEAMS_TOOLS_ENABLED).

        Args:
            team_id: The team id (from entra_list_joined_teams).
        """
        try:
            token, user_info = require_graph_token(meta)
            data = await graph_request("GET", f"/teams/{team_id}/channels", token,
                                       params={"$select": "id,displayName,description,membershipType"})
            channels = [
                {"id": c.get("id"), "name": c.get("displayName"),
                 "description": c.get("description"), "membership": c.get("membershipType")}
                for c in data.get("value", [])
            ]
            return {"success": True, "count": len(channels), "team_id": team_id,
                    "channels": channels, "executed_as": user_info}
        except ValueError as e:
            return _error(e)
        except Exception as e:  # noqa: BLE001
            return _error(e)

    @mcp.tool(
        annotations={"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True},
        meta={
            "category": "m365-teams",
            "destructiveness": "mutating",
            "hitlRisk": "high",
            "requiresConsent": True,
            "cost": "free",
            "graphEndpoint": "POST /teams/{team-id}/channels/{channel-id}/messages",
            "graphScope": "ChannelMessage.Send",
            "goldenPrompts": ["post to a team channel", "send a teams channel message", "announce in the channel"],
        },
    )
    async def entra_send_channel_message(
        team_id: str,
        channel_id: str,
        content: str,
        content_type: str = "text",
        subject: Optional[str] = None,
        meta: Optional[dict] = None,
    ) -> dict:
        """Post a message to a Teams CHANNEL (ChannelMessage.Send). MUTATION — approval-gated.

        GATED (ENTRA_TEAMS_TOOLS_ENABLED).

        Args:
            team_id: The team id (from entra_list_joined_teams).
            channel_id: The channel id (from entra_list_team_channels).
            content: The message body.
            content_type: 'text' or 'html'.
            subject: Optional channel-post subject line.
        """
        try:
            token, user_info = require_graph_token(meta)
            ct = "html" if str(content_type).lower() == "html" else "text"
            payload: Dict[str, Any] = {"body": {"contentType": ct, "content": content}}
            if subject:
                payload["subject"] = subject
            msg = await graph_request(
                "POST", f"/teams/{team_id}/channels/{channel_id}/messages", token, json_body=payload
            )
            return {
                "success": True,
                "sent": True,
                "team_id": team_id,
                "channel_id": channel_id,
                "message_id": msg.get("id"),
                "web_url": msg.get("webUrl"),
                "executed_as": user_info,
            }
        except ValueError as e:
            return _error(e)
        except Exception as e:  # noqa: BLE001
            return _error(e)

    @mcp.tool(
        annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
        meta={
            "category": "m365-meeting",
            "destructiveness": "read-only",
            "hitlRisk": "low",
            "requiresConsent": False,
            "cost": "free",
            "graphEndpoint": "GET /users/{id}/onlineMeetings/{mid}/transcripts/{tid}/content",
            "graphScope": "OnlineMeetingTranscript.Read.All",
            "goldenPrompts": ["get the meeting transcript", "summarize the meeting notes", "what was decided in the meeting"],
        },
    )
    async def entra_get_meeting_transcript(
        meeting_id: str,
        transcript_id: Optional[str] = None,
        meta: Optional[dict] = None,
    ) -> dict:
        """Fetch a meeting transcript for the target user (OnlineMeetingTranscript.Read.All).

        GATED (ENTRA_TEAMS_TOOLS_ENABLED): app-only transcript access needs the
        OnlineMeetingTranscript.Read.All application permission AND an application
        access policy; otherwise Graph returns 403. Constraints (Graph): only AFTER
        the meeting, only if transcription was ON, only for calendar-linked
        meetings, and only before the meeting expires. If transcript_id is omitted,
        the first available transcript for the meeting is fetched.

        Args:
            meeting_id: The online meeting id (calendar-linked).
            transcript_id: Optional specific transcript id; first one used if omitted.
        """
        try:
            token, user_info = require_graph_token(meta)
            user_id = require_mailbox(meta)
            user_info = {**user_info, "mailbox": user_id}
            tid = transcript_id
            if not tid:
                listing = await graph_request(
                    "GET", f"/users/{user_id}/onlineMeetings/{meeting_id}/transcripts", token
                )
                items = listing.get("value", [])
                if not items:
                    return {
                        "success": True,
                        "available": False,
                        "reason": "no transcript exists for this meeting (transcription may have been off, "
                        "or the meeting is not calendar-linked / has expired)",
                        "meeting_id": meeting_id,
                        "executed_as": user_info,
                    }
                tid = items[0].get("id")
            # The /content endpoint returns the transcript body (VTT by default).
            text = await graph_request(
                "GET",
                f"/users/{user_id}/onlineMeetings/{meeting_id}/transcripts/{tid}/content",
                token,
                params={"$format": "text/vtt"},
                raw_text=True,
            )
            return {
                "success": True,
                "available": True,
                "meeting_id": meeting_id,
                "transcript_id": tid,
                "format": "text/vtt",
                "content": text,
                "executed_as": user_info,
            }
        except ValueError as e:
            return _error(e)
        except Exception as e:  # noqa: BLE001
            return _error(e)


# Run the server (stdio when launched by the proxy via `fastmcp run -t stdio`).
if __name__ == "__main__":
    mcp.run()
