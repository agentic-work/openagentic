"""Unit tests for the oap-google-mcp server (Google Workspace / Gmail MCP).

The Google MCP acts AS a Workspace user's mailbox via a domain-wide-delegated
(DWD) service account that impersonates the user (subject = meta.userEmail). The
credential is a STATIC SA key held in the GOOGLE_WORKSPACE_SA_JSON env var. The
risk surface these tests pin:

  * Env-only credential contract — the SA key is read ONLY from
    GOOGLE_WORKSPACE_SA_JSON. With NO env var, every tool MUST fail-closed
    (honest error, no network call, no fabricated mailbox). No hardcoded creds.
  * DWD subject impersonation — `_resolve_subject` prefers meta.userEmail, falls
    back to GOOGLE_WORKSPACE_SUBJECT, and HARD-FAILS when neither is present (a
    DWD token is meaningless without a subject).
  * Auth ordering — `require_google_auth` checks the SA env FIRST, so a
    no-credential deployment refuses before any subject/network logic.
  * Tool -> Gmail endpoint mapping — every tool hits the EXACT Gmail REST route
    (method + path) with the intended query/body, userId=me under impersonation.
  * Authorization header shape — literal `Bearer <minted-token>`.
  * Request shaping — list adds `is:unread` for unread_only; send submits a
    base64url-encoded RFC-2822 MIME message as `raw`.
  * 403 honesty — a missing DWD grant surfaces the Gmail error VERBATIM with a
    hint, NEVER a fabricated mailbox.
  * HITL metadata — the SEND write carries destructiveness='mutating' +
    requiresConsent=True; the reads carry read-only + requiresConsent=False.
  * Registered tool surface (3 tools) so a refactor can't silently drop one.

`google-auth` is NOT required to run: `server._mint_access_token` is
monkeypatched to a fake token, so the DWD leg is exercised without the dep.
`httpx` is real; `httpx.AsyncClient` is monkeypatched to capture the wire call.
"""
import asyncio
import base64
import importlib.util
import json
import sys
from pathlib import Path

import httpx
import pytest

# Make THIS package's `src/` the import root regardless of CWD.
SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))


def _load_local_server():
    """Load THIS package's server.py under a unique module name (a plain
    `import server` would collide with sibling MCP suites in a shared session)."""
    path = SRC / "server.py"
    spec = importlib.util.spec_from_file_location("google_mcp_server", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["google_mcp_server"] = mod
    spec.loader.exec_module(mod)  # conftest stubs fastmcp before this runs
    return mod


server = _load_local_server()


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


FAKE_SA = json.dumps(
    {
        "type": "service_account",
        "project_id": "test-proj",
        "private_key_id": "kid",
        "private_key": "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n",
        "client_email": "dwd@test-proj.iam.gserviceaccount.com",
        "client_id": "123",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
)
GOOD_META = {"userEmail": "user@workspace.example"}


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


@pytest.fixture
def auth(monkeypatch):
    """SA env present + the DWD token-minting leg stubbed to a fixed token.

    This is the 'credential configured' state — the env-only contract is
    satisfied and `_mint_access_token` returns a deterministic token so the wire
    tests can assert the exact Bearer value without google-auth installed.
    """
    monkeypatch.setenv("GOOGLE_WORKSPACE_SA_JSON", FAKE_SA)
    monkeypatch.delenv("GOOGLE_WORKSPACE_SUBJECT", raising=False)
    monkeypatch.setattr(
        server, "_mint_access_token", lambda sa_info, subject, scopes: "fake-dwd-token"
    )
    return {"token": "fake-dwd-token"}


# ===========================================================================
# ENV-ONLY CREDENTIAL CONTRACT — no SA env => fail-closed, no hardcoded creds.
# ===========================================================================
def test_load_sa_info_raises_when_env_absent(monkeypatch):
    monkeypatch.delenv("GOOGLE_WORKSPACE_SA_JSON", raising=False)
    with pytest.raises(ValueError) as ei:
        server._load_sa_info()
    assert "GOOGLE_WORKSPACE_SA_JSON" in str(ei.value)


def test_tool_refuses_to_run_with_no_sa_env(monkeypatch):
    # The headline security contract: with NO service-account env configured the
    # tool MUST fail-closed — honest error, no fabricated mailbox, no network.
    monkeypatch.delenv("GOOGLE_WORKSPACE_SA_JSON", raising=False)
    out = run(server.google_gmail_list_messages(meta=GOOD_META))
    assert out["success"] is False
    assert "GOOGLE_WORKSPACE_SA_JSON" in out["error"]
    assert "messages" not in out  # never invents a mailbox when uncredentialed


def test_load_sa_info_accepts_raw_json(monkeypatch):
    monkeypatch.setenv("GOOGLE_WORKSPACE_SA_JSON", FAKE_SA)
    info = server._load_sa_info()
    assert info["client_email"] == "dwd@test-proj.iam.gserviceaccount.com"


def test_load_sa_info_accepts_base64_json(monkeypatch):
    b64 = base64.b64encode(FAKE_SA.encode("utf-8")).decode("ascii")
    monkeypatch.setenv("GOOGLE_WORKSPACE_SA_JSON", b64)
    info = server._load_sa_info()
    assert info["type"] == "service_account"


def test_load_sa_info_rejects_garbage(monkeypatch):
    monkeypatch.setenv("GOOGLE_WORKSPACE_SA_JSON", "not-json-not-b64-$$$")
    with pytest.raises(ValueError):
        server._load_sa_info()


# ===========================================================================
# DWD subject impersonation — meta.userEmail, env fallback, hard-fail none.
# ===========================================================================
def test_resolve_subject_prefers_user_email():
    assert server._resolve_subject({"userEmail": "a@x.com"}) == "a@x.com"


def test_resolve_subject_falls_back_to_env(monkeypatch):
    monkeypatch.setenv("GOOGLE_WORKSPACE_SUBJECT", "svc@x.com")
    assert server._resolve_subject(None) == "svc@x.com"


def test_resolve_subject_hard_fails_with_no_subject(monkeypatch):
    monkeypatch.delenv("GOOGLE_WORKSPACE_SUBJECT", raising=False)
    with pytest.raises(ValueError) as ei:
        server._resolve_subject({})
    assert "subject" in str(ei.value).lower()


def test_require_google_auth_checks_sa_env_before_subject(monkeypatch):
    # Fail-closed ordering: no SA env must raise the SA error EVEN when a subject
    # is available, so an uncredentialed deploy never reaches subject/network.
    monkeypatch.delenv("GOOGLE_WORKSPACE_SA_JSON", raising=False)
    with pytest.raises(ValueError) as ei:
        server.require_google_auth({"userEmail": "a@x.com"}, [server.SCOPE_READONLY])
    assert "GOOGLE_WORKSPACE_SA_JSON" in str(ei.value)


def test_require_google_auth_returns_token_and_subject(auth):
    token, subject = server.require_google_auth(GOOD_META, [server.SCOPE_READONLY])
    assert token == "fake-dwd-token"
    assert subject == "user@workspace.example"


# ===========================================================================
# Tool -> Gmail endpoint mapping + request shaping (the load-bearing contract).
# ===========================================================================
def test_list_messages_hits_messages_endpoint_with_bearer(wire, auth):
    wire.respond(status_code=200, json_body={"messages": [{"id": "m1", "threadId": "t1"}], "resultSizeEstimate": 1})
    out = run(server.google_gmail_list_messages(query="from:boss", max=5, meta=GOOD_META))
    assert wire.sent["method"] == "GET"
    assert wire.sent["url"].endswith("/users/me/messages")
    assert wire.sent["headers"]["Authorization"] == "Bearer fake-dwd-token"
    assert wire.sent["params"]["maxResults"] == 5
    assert wire.sent["params"]["q"] == "from:boss"
    assert out["success"] is True
    assert out["messages"][0]["id"] == "m1"
    assert out["executed_as"] == "user@workspace.example"


def test_list_messages_unread_only_adds_is_unread(wire, auth):
    wire.respond(status_code=200, json_body={"messages": []})
    run(server.google_gmail_list_messages(unread_only=True, meta=GOOD_META))
    assert "is:unread" in wire.sent["params"]["q"]


def test_list_messages_clamps_max(wire, auth):
    wire.respond(status_code=200, json_body={"messages": []})
    run(server.google_gmail_list_messages(max=9999, meta=GOOD_META))
    assert wire.sent["params"]["maxResults"] == 100


def test_get_message_hits_message_by_id_and_parses_headers(wire, auth):
    wire.respond(
        status_code=200,
        json_body={
            "id": "m9",
            "threadId": "t9",
            "labelIds": ["INBOX", "UNREAD"],
            "snippet": "hello there",
            "payload": {"headers": [{"name": "Subject", "value": "Deep"}, {"name": "From", "value": "a@b.com"}]},
        },
    )
    out = run(server.google_gmail_get_message(id="m9", meta=GOOD_META))
    assert wire.sent["method"] == "GET"
    assert wire.sent["url"].endswith("/users/me/messages/m9")
    assert wire.sent["params"]["format"] == "metadata"
    assert out["message"]["subject"] == "Deep"
    assert out["message"]["from"] == "a@b.com"
    assert out["message"]["snippet"] == "hello there"


def test_send_posts_send_endpoint_with_base64url_mime(wire, auth):
    wire.respond(status_code=200, json_body={"id": "sent1", "threadId": "th1"})
    out = run(server.google_gmail_send(to="a@b.com", subject="Hi", body="Body text", meta=GOOD_META))
    assert wire.sent["method"] == "POST"
    assert wire.sent["url"].endswith("/users/me/messages/send")
    raw = wire.sent["json"]["raw"]
    # raw must be a decodable base64url RFC-2822 message carrying the headers.
    decoded = base64.urlsafe_b64decode(raw).decode("utf-8")
    assert "To: a@b.com" in decoded
    assert "Subject: Hi" in decoded
    assert "From: user@workspace.example" in decoded  # the impersonated sender
    assert "Body text" in decoded
    assert out["sent"] is True
    assert out["message_id"] == "sent1"


def test_send_includes_cc_when_provided(wire, auth):
    wire.respond(status_code=200, json_body={"id": "s2"})
    run(server.google_gmail_send(to="a@b.com", subject="S", body="B", cc="c@d.com", meta=GOOD_META))
    decoded = base64.urlsafe_b64decode(wire.sent["json"]["raw"]).decode("utf-8")
    assert "Cc: c@d.com" in decoded


def test_send_requires_recipient(auth):
    out = run(server.google_gmail_send(to="", subject="S", body="B", meta=GOOD_META))
    assert out["success"] is False
    assert "recipient" in out["error"].lower()


# ===========================================================================
# PATH-TRAVERSAL CONTAINMENT — a user-controlled message id interpolated into the
# Gmail URL PATH must NOT escape /users/me/ via RFC-3986 dot-segment normalization
# (httpx normalizes "../" CLIENT-SIDE before sending). Defensive hardening: even
# though the DWD token is subject-scoped, the message id is percent-encoded so it
# can never form a new path segment.
# ===========================================================================
def test_httpx_normalizes_raw_dot_segments_proving_the_threat():
    """Documents the attack vector: a RAW "../../" in the id escapes /users/me/."""
    raw_unsafe = "https://gmail.googleapis.com/gmail/v1/users/me/messages/../../victim@corp.com"
    assert httpx.URL(raw_unsafe).raw_path == b"/gmail/v1/users/victim@corp.com"


def test_seg_encodes_path_separators_but_not_dots():
    assert server._seg("../../victim@corp.com") == "..%2F..%2Fvictim%40corp.com"
    assert server._seg("18f0c") == "18f0c"  # legit gmail id unchanged


def test_get_message_id_traversal_cannot_escape_users_me(wire, auth):
    wire.respond(status_code=200, json_body={"id": "x", "payload": {"headers": []}})
    run(server.google_gmail_get_message(id="../../victim@corp.com", meta=GOOD_META))
    raw = httpx.URL(wire.sent["url"]).raw_path.decode()
    # The pinned /users/me/ survives RFC-3986 normalization ...
    assert raw.startswith("/gmail/v1/users/me/messages/"), raw
    assert "/users/victim" not in raw
    # ... because the "/" separators in the id are percent-encoded to one segment.
    assert "%2F" in raw


def test_get_message_legit_id_no_regression(wire, auth):
    wire.respond(status_code=200, json_body={"id": "m9", "payload": {"headers": []}})
    run(server.google_gmail_get_message(id="m9", meta=GOOD_META))
    assert httpx.URL(wire.sent["url"]).raw_path.decode() == "/gmail/v1/users/me/messages/m9"


# ===========================================================================
# 403 honesty — a missing DWD grant returns an honest envelope, never fake data.
# ===========================================================================
def test_gmail_request_403_surfaces_verbatim_with_hint(wire, auth):
    wire.respond(status_code=403, json_body={"error": {"message": "Delegation denied for gmail.send"}})
    with pytest.raises(ValueError) as ei:
        run(server.gmail_request("GET", "/users/me/messages", "tok"))
    msg = str(ei.value)
    assert "403" in msg
    assert "Delegation denied for gmail.send" in msg  # verbatim Gmail message
    assert "delegation" in msg.lower()


def test_list_403_returns_honest_error_not_fabricated(wire, auth):
    wire.respond(status_code=403, json_body={"error": {"message": "gmail.readonly not granted"}})
    out = run(server.google_gmail_list_messages(meta=GOOD_META))
    assert out["success"] is False
    assert "gmail.readonly not granted" in out["error"]
    assert "messages" not in out  # never invents a mailbox on denial


def test_gmail_request_401_maps_to_token_error(wire, auth):
    wire.respond(status_code=401, text="unauthorized")
    with pytest.raises(ValueError) as ei:
        run(server.gmail_request("GET", "/users/me/messages", "tok"))
    assert "401" in str(ei.value)


# ===========================================================================
# HITL / scope metadata — the SEND write must be approval-gated, reads not.
# ===========================================================================
WRITE_TOOLS = ["google_gmail_send"]
READ_TOOLS = ["google_gmail_list_messages", "google_gmail_get_message"]


def test_write_tool_carries_hitl_consent_metadata():
    meta = server.mcp.registered_tool_meta
    for name in WRITE_TOOLS:
        assert meta[name]["destructiveness"] == "mutating", name
        assert meta[name]["requiresConsent"] is True, name


def test_read_tools_are_read_only_no_consent():
    meta = server.mcp.registered_tool_meta
    for name in READ_TOOLS:
        assert meta[name]["destructiveness"] == "read-only", name
        assert meta[name]["requiresConsent"] is False, name


def test_every_tool_declares_gmail_endpoint_and_scope():
    meta = server.mcp.registered_tool_meta
    for name in WRITE_TOOLS + READ_TOOLS:
        assert meta[name].get("gmailEndpoint"), name
        assert meta[name].get("gmailScope"), name


# ===========================================================================
# Registered tool surface — a refactor can't silently drop a tool.
# ===========================================================================
def test_registered_tool_surface_is_complete():
    names = server.mcp.registered_tool_names
    expected = set(WRITE_TOOLS + READ_TOOLS)
    assert expected.issubset(names), f"missing: {expected - names}"
    assert len(expected) == 3
