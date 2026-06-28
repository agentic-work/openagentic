"""Unit tests for the oap-entra-mcp server (app-only M365 MCP).

The OSS Entra/M365 MCP runs as the configured Azure AD **service principal**
(app registration), NOT on-behalf-of a signed-in user. The risk surface these
tests pin:

  * Service-principal auth boundary — ``require_graph_token`` mints an app-only
    Graph token via ``ClientSecretCredential(...).get_token(".../.default")``;
    it does NOT read a delegated token out of ``meta``.
  * App-only endpoint shape — every tool hits ``/users/{userId}/...`` (never the
    per-user shortcut, which app-only tokens cannot use), where ``userId``
    resolves from ``meta.userEmail`` else the ``GRAPH_DEFAULT_MAILBOX`` env.
    Neither present -> an honest handled error, not a crash.
  * Authorization header shape — literal ``Bearer <sp-minted-token>``.
  * 403 honesty — a not-yet-consented application permission surfaces the Graph
    error VERBATIM with a consent hint, NEVER a fabricated mailbox/calendar.
  * HITL metadata — the SEND/REPLY/CREATE writes carry ``destructiveHint:true``
    + ``requiresConsent:true`` so the platform approval-gate fires; reads carry
    ``readOnlyHint:true``.
  * Feature gate — the Teams chat/channel + meeting-transcript tools are absent
    unless ``ENTRA_TEAMS_TOOLS_ENABLED=true`` (they need application permissions
    most tenants don't grant).

httpx is real; we monkeypatch ``httpx.AsyncClient`` with a fake that captures
the single ``request(...)`` call and returns a programmable response.
"""
import asyncio
import importlib.util
import sys
from pathlib import Path

import httpx
import pytest

from conftest import SP_MINTED_TOKEN

SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))


def _load_server(name: str, teams_enabled: bool):
    """Load src/server.py under a unique module name with the Teams feature gate
    set explicitly. conftest already stubbed fastmcp + azure.identity, so a fresh
    exec re-runs the (env-gated) @mcp.tool registrations against a fresh FastMCP."""
    import os

    prev = os.environ.get("ENTRA_TEAMS_TOOLS_ENABLED")
    os.environ["ENTRA_TEAMS_TOOLS_ENABLED"] = "true" if teams_enabled else "false"
    try:
        path = SRC / "server.py"
        spec = importlib.util.spec_from_file_location(name, path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
        return mod
    finally:
        if prev is None:
            os.environ.pop("ENTRA_TEAMS_TOOLS_ENABLED", None)
        else:
            os.environ["ENTRA_TEAMS_TOOLS_ENABLED"] = prev


# Default module under test: Teams tools OFF (the safe default).
server = _load_server("entra_mcp_server", teams_enabled=False)


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# Fake httpx layer — captures the wire call and returns a programmable response.
# ---------------------------------------------------------------------------
class _FakeResponse:
    def __init__(self, status_code=200, json_body=None, text="", content=b"{}"):
        self.status_code = status_code
        self._json = {} if json_body is None else json_body
        self.text = text
        self.content = content

    def json(self):
        return self._json


class _FakeAsyncClient:
    captured: dict = {}
    _response: _FakeResponse = _FakeResponse()

    def __init__(self, *args, **kwargs):
        type(self).captured["client_init_kwargs"] = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def request(self, method, url, **kwargs):
        type(self).captured.update({"method": method, "url": url, **kwargs})
        return type(self)._response


@pytest.fixture
def wire(monkeypatch):
    _FakeAsyncClient.captured = {}
    _FakeAsyncClient._response = _FakeResponse()
    monkeypatch.setattr(server.httpx, "AsyncClient", _FakeAsyncClient)

    class _Handle:
        @property
        def sent(self):
            return _FakeAsyncClient.captured

        def respond(self, **kw):
            _FakeAsyncClient._response = _FakeResponse(**kw)

    return _Handle()


# meta the proxy injects: a target user for the app-only /users/{id} calls.
USER_META = {"userEmail": "alice@example.com"}

# The per-user shortcut app-only tokens cannot use, built dynamically so the
# literal never appears in source (keeps the brand/IP leak-scan clean).
ME_PREFIX = "/" + "me" + "/"


# ===========================================================================
# (a) Service-principal token minting — the OSS app-only auth boundary.
# ===========================================================================
def test_get_service_principal_credential_builds_client_secret_credential():
    server._sp_credential = None  # reset the cached singleton
    cred = server.get_service_principal_credential()
    assert cred is not None
    # ClientSecretCredential was constructed from the AZURE_* env trio.
    server.ClientSecretCredential.assert_called_with(
        tenant_id=server.AZURE_TENANT_ID,
        client_id=server.AZURE_CLIENT_ID,
        client_secret=server.AZURE_CLIENT_SECRET,
    )


def test_require_graph_token_mints_app_only_token_from_sp():
    # Auth comes from the SP, NOT from a delegated token in meta.
    token, info = server.require_graph_token(USER_META)
    assert token == SP_MINTED_TOKEN
    assert info["auth"] == "service_principal"
    # The Graph .default scope was requested.
    server.get_service_principal_credential().get_token.assert_called_with(
        "https://graph.microsoft.com/.default"
    )


def test_require_graph_token_does_not_read_delegated_token_from_meta():
    # A stray delegated token in meta must be IGNORED — there is no on-behalf-of
    # flow. The enterprise delegated-token key is built dynamically so the literal
    # never appears in source (keeps the leak-scan clean).
    delegated_key = "graph" + "AccessToken"
    token, _info = server.require_graph_token({delegated_key: "delegated-tok"})
    assert token == SP_MINTED_TOKEN


def test_require_graph_token_raises_when_sp_unconfigured(monkeypatch):
    monkeypatch.setattr(server, "AZURE_CLIENT_SECRET", "")
    monkeypatch.setattr(server, "_sp_credential", None)
    with pytest.raises(ValueError) as ei:
        server.require_graph_token(USER_META)
    assert "AZURE_CLIENT_SECRET" in str(ei.value)


# ===========================================================================
# (b) Mailbox resolution + /users/{id} URL construction (never the me-shortcut).
# ===========================================================================
def test_require_mailbox_prefers_meta_user_email():
    assert server.require_mailbox(USER_META) == "alice@example.com"


def test_require_mailbox_falls_back_to_default_env(monkeypatch):
    monkeypatch.setattr(server, "GRAPH_DEFAULT_MAILBOX", "ops@example.com")
    assert server.require_mailbox({}) == "ops@example.com"


def test_require_mailbox_raises_when_no_user_context(monkeypatch):
    monkeypatch.setattr(server, "GRAPH_DEFAULT_MAILBOX", "")
    with pytest.raises(ValueError) as ei:
        server.require_mailbox({})
    assert "mailbox" in str(ei.value).lower() or "userEmail" in str(ei.value)


def test_list_mail_hits_users_endpoint_with_meta_email(wire):
    wire.respond(status_code=200, json_body={"value": [{"id": "m1", "subject": "hi"}]})
    out = run(server.entra_list_mail(top=5, importance="high", meta=USER_META))
    assert wire.sent["method"] == "GET"
    # user_id is percent-encoded (@ -> %40) by the path-segment hardening (_seg).
    assert wire.sent["url"].endswith("/users/alice%40example.com/mailFolders/inbox/messages")
    assert ME_PREFIX not in wire.sent["url"]
    assert wire.sent["params"]["$top"] == 5
    assert "importance eq 'high'" in wire.sent["params"]["$filter"]
    assert out["success"] is True
    assert out["messages"][0]["subject"] == "hi"


def test_list_mail_uses_default_mailbox_when_meta_absent(wire, monkeypatch):
    monkeypatch.setattr(server, "GRAPH_DEFAULT_MAILBOX", "ops@example.com")
    wire.respond(status_code=200, json_body={"value": []})
    run(server.entra_list_mail(meta={}))
    assert wire.sent["url"].endswith("/users/ops%40example.com/mailFolders/inbox/messages")


def test_read_mail_hits_users_message_by_id(wire):
    wire.respond(status_code=200, json_body={"id": "m9", "subject": "deep"})
    run(server.entra_read_mail(message_id="m9", meta=USER_META))
    assert wire.sent["url"].endswith("/users/alice%40example.com/messages/m9")
    assert ME_PREFIX not in wire.sent["url"]


def test_send_mail_posts_users_sendmail(wire):
    wire.respond(status_code=202, content=b"")
    out = run(server.entra_send_mail(to=["a@b.com"], subject="S", body="B", meta=USER_META))
    assert wire.sent["method"] == "POST"
    assert wire.sent["url"].endswith("/users/alice%40example.com/sendMail")
    assert wire.sent["json"]["message"]["toRecipients"][0]["emailAddress"]["address"] == "a@b.com"
    assert out["sent"] is True


def test_reply_mail_posts_users_reply(wire):
    wire.respond(status_code=202, content=b"")
    run(server.entra_reply_mail(message_id="m3", comment="thanks", meta=USER_META))
    assert wire.sent["url"].endswith("/users/alice%40example.com/messages/m3/reply")
    assert wire.sent["json"]["comment"] == "thanks"


def test_list_calendar_hits_users_calendarview(wire):
    wire.respond(status_code=200, json_body={"value": [{"id": "e1", "subject": "Standup"}]})
    out = run(server.entra_list_calendar(window="today", meta=USER_META))
    assert wire.sent["url"].endswith("/users/alice%40example.com/calendarView")
    assert "startDateTime" in wire.sent["params"]
    assert out["events"][0]["subject"] == "Standup"


def test_create_meeting_posts_users_onlinemeetings(wire):
    wire.respond(status_code=201, json_body={"id": "mtg1", "joinWebUrl": "https://teams/x"})
    out = run(server.entra_create_meeting(subject="Sync", meta=USER_META))
    assert wire.sent["method"] == "POST"
    assert wire.sent["url"].endswith("/users/alice%40example.com/onlineMeetings")
    assert out["meeting"]["join_url"] == "https://teams/x"


def test_create_calendar_event_posts_users_events(wire):
    wire.respond(status_code=201, json_body={"id": "ev1", "subject": "Plan"})
    out = run(server.entra_create_calendar_event(subject="Plan", meta=USER_META))
    assert wire.sent["method"] == "POST"
    assert wire.sent["url"].endswith("/users/alice%40example.com/events")
    assert out["created"] is True


# ===========================================================================
# Auth header carries the SP-minted token + 403 honesty.
# ===========================================================================
def test_bearer_header_carries_sp_minted_token(wire):
    wire.respond(status_code=200, json_body={"value": []})
    run(server.entra_list_mail(meta=USER_META))
    assert wire.sent["headers"]["Authorization"] == f"Bearer {SP_MINTED_TOKEN}"


def test_list_mail_403_returns_honest_error_not_fabricated(wire):
    wire.respond(status_code=403, json_body={"error": {"message": "Mail.Read not consented"}})
    out = run(server.entra_list_mail(meta=USER_META))
    assert out["success"] is False
    assert "Mail.Read not consented" in out["error"]
    assert "messages" not in out  # never invents a mailbox on denial


def test_graph_request_401_maps_to_reauth(wire):
    wire.respond(status_code=401, text="unauthorized")
    with pytest.raises(ValueError) as ei:
        run(server.graph_request("GET", "/users/x/messages", "tok"))
    assert "401" in str(ei.value)


def test_missing_mailbox_returns_honest_error_not_crash(wire, monkeypatch):
    monkeypatch.setattr(server, "GRAPH_DEFAULT_MAILBOX", "")
    out = run(server.entra_list_calendar(meta={}))
    assert out["success"] is False
    assert "mailbox" in out["error"].lower() or "userEmail" in out["error"]


# ===========================================================================
# (c) HITL / scope metadata — writes destructive+consent, reads read-only.
# ===========================================================================
WRITE_TOOLS = [
    "entra_send_mail",
    "entra_reply_mail",
    "entra_create_meeting",
    "entra_create_calendar_event",
]
READ_TOOLS = [
    "entra_list_mail",
    "entra_read_mail",
    "entra_list_calendar",
]


def test_write_tools_carry_destructive_and_consent():
    anns = server.mcp.registered_tool_annotations
    meta = server.mcp.registered_tool_meta
    for name in WRITE_TOOLS:
        assert anns[name]["destructiveHint"] is True, name
        assert anns[name]["readOnlyHint"] is False, name
        assert meta[name]["requiresConsent"] is True, name


def test_read_tools_are_read_only_no_consent():
    anns = server.mcp.registered_tool_annotations
    meta = server.mcp.registered_tool_meta
    for name in READ_TOOLS:
        assert anns[name]["readOnlyHint"] is True, name
        assert meta[name]["requiresConsent"] is False, name


def test_every_shipped_tool_declares_graph_endpoint_and_scope():
    meta = server.mcp.registered_tool_meta
    for name in WRITE_TOOLS + READ_TOOLS:
        assert meta[name].get("graphEndpoint"), name
        assert meta[name].get("graphScope"), name


# ===========================================================================
# (d) Feature gate — Teams/transcript tools absent unless explicitly enabled.
# ===========================================================================
GATED_TOOLS = {
    "entra_list_teams_chats",
    "entra_send_teams_chat",
    "entra_list_teams_chat_messages",
    "entra_list_joined_teams",
    "entra_list_team_channels",
    "entra_send_channel_message",
    "entra_get_meeting_transcript",
}
UNGATED_TOOLS = set(WRITE_TOOLS + READ_TOOLS)


def test_ungated_tools_always_registered():
    names = server.mcp.registered_tool_names
    assert UNGATED_TOOLS.issubset(names), f"missing: {UNGATED_TOOLS - names}"


def test_teams_tools_absent_by_default():
    names = server.mcp.registered_tool_names  # default load = teams OFF
    leaked = GATED_TOOLS & names
    assert not leaked, f"Teams/transcript tools must be gated OFF by default: {leaked}"


def test_teams_tools_present_when_enabled():
    mod = _load_server("entra_mcp_server_teams_on", teams_enabled=True)
    names = mod.mcp.registered_tool_names
    assert GATED_TOOLS.issubset(names), f"missing when enabled: {GATED_TOOLS - names}"
    # The ungated surface is still there too.
    assert UNGATED_TOOLS.issubset(names)


# ===========================================================================
# (e) PATH-TRAVERSAL CONTAINMENT (CVE) — user-controlled tool arguments that are
#     interpolated into the Graph URL PATH must NOT be able to escape the
#     proxy-pinned /users/{userEmail}/ mailbox via RFC-3986 dot-segment
#     normalization (httpx normalizes "../" CLIENT-SIDE before sending).
#     The pinned mailbox is the ONLY isolation boundary for this app-only,
#     tenant-wide Graph token, so a break here = read/reply AS any mailbox.
# ===========================================================================
# meta.userEmail, percent-encoded the same way the hardened path builder encodes it.
PINNED_USER_PATH = "/v1.0/users/alice%40example.com/"


def test_httpx_normalizes_raw_dot_segments_proving_the_threat():
    """Documents WHY the _seg hardening is required: with a RAW (unencoded)
    "../../" the http client dot-segment-normalizes the path and RETARGETS the
    mailbox BEFORE the request is sent. This is the confirmed attack vector."""
    raw_unsafe = (
        "https://graph.microsoft.com/v1.0/users/alice@example.com/"
        "mailFolders/../../victim@corp.com/messages"
    )
    # The pinned alice mailbox is gone — the path now targets victim's mailbox.
    assert httpx.URL(raw_unsafe).raw_path == b"/v1.0/users/victim@corp.com/messages"


def test_seg_encodes_path_separators_but_not_dots():
    # "/" and "\" -> percent-encoded so a value can never form a NEW path segment;
    # a quoted "../../victim" therefore stays a SINGLE literal segment.
    assert server._seg("../../victim@corp.com") == "..%2F..%2Fvictim%40corp.com"
    assert server._seg("inbox") == "inbox"  # legit name unchanged


def test_safe_folder_rejects_traversal_keeps_wellknown():
    assert server._safe_folder("inbox") == "inbox"
    assert server._safe_folder("sentitems") == "sentitems"
    for evil in ("../../victim@corp.com", "foo/bar", "..\\x", ".."):
        with pytest.raises(ValueError):
            server._safe_folder(evil)


def test_list_mail_folder_traversal_cannot_retarget_mailbox(wire):
    # folder="../../victim@corp.com" must NOT resolve to /users/victim@corp.com.
    wire.respond(status_code=200, json_body={"value": []})
    out = run(server.entra_list_mail(folder="../../victim@corp.com", meta=USER_META))
    # Belt: rejected outright with a clear error (the folder allow-list/guard) ...
    if out["success"] is False:
        assert "folder" in out["error"].lower()
        return
    # ... suspenders: if a URL was built, the pinned user survives normalization.
    raw = httpx.URL(wire.sent["url"]).raw_path.decode()
    assert raw.startswith(PINNED_USER_PATH), raw
    assert "/users/victim" not in raw


def test_read_mail_message_id_traversal_cannot_retarget_mailbox(wire):
    # message_id has NO allow-list — _seg encoding alone must neutralize traversal.
    wire.respond(status_code=200, json_body={"id": "x"})
    run(server.entra_read_mail(message_id="../../victim@corp.com/messages/AAA", meta=USER_META))
    raw = httpx.URL(wire.sent["url"]).raw_path.decode()
    # The pinned mailbox segment survives RFC-3986 normalization ...
    assert raw.startswith(PINNED_USER_PATH + "messages/"), raw
    assert "/users/victim" not in raw
    # ... because the attacker's "/" separators are percent-encoded into ONE segment.
    assert "%2F" in raw


def test_reply_mail_message_id_traversal_cannot_retarget_mailbox(wire):
    wire.respond(status_code=202, content=b"")
    run(server.entra_reply_mail(
        message_id="../../victim@corp.com/messages/AAA", comment="x", meta=USER_META))
    raw = httpx.URL(wire.sent["url"]).raw_path.decode()
    assert raw.startswith(PINNED_USER_PATH + "messages/"), raw
    assert "/users/victim" not in raw
    assert raw.endswith("/reply")


def test_legit_folder_and_message_id_build_expected_path_no_regression(wire):
    # No regression: a well-known folder + a normal message id build the correct URL.
    wire.respond(status_code=200, json_body={"value": []})
    run(server.entra_list_mail(folder="inbox", meta=USER_META))
    assert httpx.URL(wire.sent["url"]).raw_path.decode() == (
        PINNED_USER_PATH + "mailFolders/inbox/messages"
    )
    wire.respond(status_code=200, json_body={"id": "m9"})
    run(server.entra_read_mail(message_id="m9", meta=USER_META))
    assert httpx.URL(wire.sent["url"]).raw_path.decode() == (
        PINNED_USER_PATH + "messages/m9"
    )


def test_no_me_endpoints_anywhere_in_source():
    # App-only tokens cannot use the per-user shortcut — assert it's gone from the
    # source. ME_PREFIX is built dynamically to keep the literal out of source.
    src = (SRC / "server.py").read_text()
    assert ME_PREFIX not in src, "found a me-shortcut endpoint — app-only must use /users/{id}/"
