"""Pytest bootstrap for the oap-entra-mcp test suite.

``server.py`` does ``from fastmcp import FastMCP`` and
``from azure.identity import ClientSecretCredential`` at import time, then
decorates every tool with ``@mcp.tool(annotations=..., meta=...)``.

We stub BOTH dependencies BEFORE ``server`` is first imported so the tests run
with zero network and zero heavy wheels:

* ``fastmcp`` -> an IDENTITY-decorator ``FastMCP`` that records every decorated
  tool name (and its ``annotations`` + ``meta``) on the instance, so the
  tool-registry / HITL-metadata / feature-gate tests can introspect the
  registered surface without a live FastMCP runtime.
* ``azure.identity`` -> a fabricated module whose ``ClientSecretCredential`` is a
  MagicMock returning a credential whose ``get_token(scope).token`` is a known
  sentinel. This lets the app-only service-principal token-minting path be
  asserted deterministically (mirrors ``oap-azure-mcp/tests/conftest.py`` which
  fabricates the ``azure.*`` SDK modules).

``httpx`` is real and installed, so the HTTP layer is exercised by
monkeypatching ``httpx.AsyncClient`` per-test — that lets us assert on the exact
method/url/headers/params/json each tool builds.

The shared ``observability`` module is optional in server.py (try/except
ImportError) so it does not need stubbing.
"""
import os
import sys
import types
from unittest.mock import MagicMock

# tests/ is a package (has __init__.py), so pytest loads this file as
# `tests.conftest`. Expose its directory on sys.path too, so the suite's
# `from conftest import SP_MINTED_TOKEN` resolves under a plain `pytest tests/`
# from the MCP root (not only when tests/ is already on PYTHONPATH).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Service-principal env so get_service_principal_credential() succeeds, plus a
# default mailbox so mailbox resolution works when meta.userEmail is absent.
os.environ.setdefault("AZURE_TENANT_ID", "00000000-0000-0000-0000-000000000000")
os.environ.setdefault("AZURE_CLIENT_ID", "11111111-1111-1111-1111-111111111111")
os.environ.setdefault("AZURE_CLIENT_SECRET", "test-secret")
os.environ.setdefault("GRAPH_DEFAULT_MAILBOX", "ops@example.com")

# Sentinel token the fake ClientSecretCredential mints — tests assert this value
# flows into the Bearer header to prove the app-only SP path is wired.
SP_MINTED_TOKEN = "sp-minted-graph-token"


def _build_azure_identity_stub() -> types.ModuleType:
    fake_token = MagicMock()
    fake_token.token = SP_MINTED_TOKEN
    cred_instance = MagicMock(name="ClientSecretCredentialInstance")
    cred_instance.get_token.return_value = fake_token
    client_secret_credential = MagicMock(
        name="ClientSecretCredential", return_value=cred_instance
    )

    azure_pkg = sys.modules.get("azure")
    if azure_pkg is None:
        azure_pkg = types.ModuleType("azure")
        azure_pkg.__path__ = []  # mark as package
        sys.modules["azure"] = azure_pkg

    identity_mod = types.ModuleType("azure.identity")
    identity_mod.ClientSecretCredential = client_secret_credential
    sys.modules["azure.identity"] = identity_mod
    azure_pkg.identity = identity_mod  # type: ignore[attr-defined]
    return identity_mod


_build_azure_identity_stub()


# --- stub fastmcp with an identity-decorator FastMCP that records names -------
if "fastmcp" not in sys.modules:
    _fastmcp = types.ModuleType("fastmcp")

    class _FastMCPStub:  # noqa: D401 - test stub
        def __init__(self, *args, **kwargs):
            self.registered_tool_names: set = set()
            # tool_name -> meta dict passed to @mcp.tool(meta=...)
            self.registered_tool_meta: dict = {}
            # tool_name -> annotations dict passed to @mcp.tool(annotations=...)
            self.registered_tool_annotations: dict = {}

        def tool(self, *args, **kwargs):
            meta = kwargs.get("meta", {})
            annotations = kwargs.get("annotations", {})

            def _identity(fn):
                self.registered_tool_names.add(fn.__name__)
                self.registered_tool_meta[fn.__name__] = meta
                self.registered_tool_annotations[fn.__name__] = annotations
                return fn

            return _identity

        def run(self, *args, **kwargs):
            pass

    class _ContextStub:  # typing placeholder if `ctx: Context` ever appears
        pass

    _fastmcp.FastMCP = _FastMCPStub
    _fastmcp.Context = _ContextStub
    sys.modules["fastmcp"] = _fastmcp
