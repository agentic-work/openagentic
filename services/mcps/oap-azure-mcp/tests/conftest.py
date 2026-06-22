"""Make azure SDK imports stubbable for unit tests so server.py can be imported
without azure-mgmt-* and azure.identity wheels installed locally.

Strategy: install a sys.meta_path finder that fabricates a MagicMock-backed
module for any `azure.*` import. We pre-seed a few real classes
(AccessToken, TokenCredential, AzureError) because server.py uses them in
isinstance/type-annotation positions.
"""

import importlib.abc
import importlib.machinery
import sys
import types
from unittest.mock import MagicMock

# Pre-seed real classes that server.py references in non-stubbable positions
# (isinstance / except / inheritance).
class AccessToken:
    def __init__(self, token=None, expires_on=None):
        self.token = token or "fake"
        self.expires_on = expires_on or 0

class TokenCredential:
    def get_token(self, *_args, **_kwargs):
        return AccessToken()

class AzureError(Exception):
    pass

class HttpResponseError(AzureError):
    def __init__(self, message="", response=None, status_code=None):
        super().__init__(message)
        self.message = message
        self.response = response
        self.status_code = status_code

class ClientAuthenticationError(AzureError):
    pass

# Maps fully-qualified module name → dict of attributes to set on the
# fabricated module. Anything not pre-seeded is a MagicMock.
_PRESEED = {
    "azure.core.credentials": {"AccessToken": AccessToken, "TokenCredential": TokenCredential},
    "azure.core.exceptions": {
        "AzureError": AzureError,
        "HttpResponseError": HttpResponseError,
        "ClientAuthenticationError": ClientAuthenticationError,
    },
}

class _AzureStubFinder(importlib.abc.MetaPathFinder):
    """Catch any `azure.*` import and yield a MagicMock-backed module."""

    def find_spec(self, fullname, path, target=None):
        if not (fullname == "azure" or fullname.startswith("azure.")):
            return None
        if fullname in sys.modules:
            return None
        spec = importlib.machinery.ModuleSpec(fullname, _AzureStubLoader(), is_package=True)
        return spec

class _AzureStubLoader(importlib.abc.Loader):
    def create_module(self, spec):
        mod = types.ModuleType(spec.name)
        mod.__path__ = []  # mark as package so `from azure.mgmt.foo import Bar` works
        # Pre-seed known attributes; anything else attribute-accessed becomes a MagicMock.
        for k, v in _PRESEED.get(spec.name, {}).items():
            setattr(mod, k, v)

        # Default: any attribute lookup returns a MagicMock with the right name.
        original_getattr = mod.__getattribute__

        def __getattr__(name):
            if name.startswith("__"):
                raise AttributeError(name)
            stub = MagicMock(name=f"{spec.name}.{name}")
            setattr(mod, name, stub)
            return stub

        mod.__getattr__ = __getattr__  # type: ignore[attr-defined]
        return mod

    def exec_module(self, module):
        # Nothing to execute — already populated in create_module.
        return None

# Install once per test session.
if not any(isinstance(f, _AzureStubFinder) for f in sys.meta_path):
    sys.meta_path.insert(0, _AzureStubFinder())

# Stub FastMCP so the @mcp.tool() decorator is a no-op and server.py loads.
# We record every decorated function name on the instance so regression
# tests can assert which tools are registered without standing up a real
# FastMCP runtime. The set is class-level (shared across instances) because
# server.py creates its FastMCP at import time.
class _StubFastMCP:
    registered_tool_names: set = set()

    def __init__(self, *_args, **_kwargs):
        pass

    def tool(self, *_args, **_kwargs):
        def decorator(fn):
            _StubFastMCP.registered_tool_names.add(fn.__name__)
            return fn
        return decorator

    def run(self):
        pass

_mcp_pkg = types.ModuleType("mcp")
_mcp_pkg.__path__ = []
_mcp_server = types.ModuleType("mcp.server")
_mcp_server.__path__ = []
_mcp_fastmcp = types.ModuleType("mcp.server.fastmcp")
_mcp_fastmcp.FastMCP = _StubFastMCP

sys.modules.setdefault("mcp", _mcp_pkg)
sys.modules.setdefault("mcp.server", _mcp_server)
sys.modules.setdefault("mcp.server.fastmcp", _mcp_fastmcp)

# Some Azure imports happen via msgraph. Stub it.
class _MetaStub(importlib.abc.MetaPathFinder):
    PREFIXES = ("msgraph", "fastmcp", "uvicorn", "starlette")

    def find_spec(self, fullname, path, target=None):
        if not any(fullname == p or fullname.startswith(p + ".") for p in self.PREFIXES):
            return None
        if fullname in sys.modules:
            return None
        spec = importlib.machinery.ModuleSpec(fullname, _AzureStubLoader(), is_package=True)
        return spec

if not any(isinstance(f, _MetaStub) for f in sys.meta_path):
    sys.meta_path.insert(0, _MetaStub())
