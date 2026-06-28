"""Pytest bootstrap for the oap-google-mcp test suite.

`server.py` does `from fastmcp import FastMCP` at import time and decorates every
tool with `@mcp.tool(annotations=..., meta=...)`. fastmcp may not be installed in
the local/CI test venv, and even if it were, the real decorator would wrap each
tool so the tests could not call the genuine `async def` coroutines.

We stub `fastmcp` BEFORE `server` is first imported with an IDENTITY-decorator
FastMCP that ALSO records every decorated tool name (and its `meta`) on the
instance, so the tool-registry regression test can introspect the registered
surface + the HITL/scope metadata without a live FastMCP runtime.

`httpx` is real and installed, so the Gmail HTTP layer is exercised by
monkeypatching `httpx.AsyncClient` per-test. The DWD token-minting leg
(`google-auth`) is NOT required to run the suite — `server._mint_access_token`
is monkeypatched per-test, so no google-auth dependency is needed.
"""
import sys
import types


# --- stub fastmcp with an identity-decorator FastMCP that records names -----
if "fastmcp" not in sys.modules:
    _fastmcp = types.ModuleType("fastmcp")

    class _FastMCPStub:  # noqa: D401 - test stub
        def __init__(self, *args, **kwargs):
            self.registered_tool_names: set = set()
            # tool_name -> the meta dict passed to @mcp.tool(meta=...), so the
            # HITL/scope regression test can assert mutating tools carry
            # requiresConsent=True etc.
            self.registered_tool_meta: dict = {}

        def tool(self, *args, **kwargs):
            meta = kwargs.get("meta", {})

            def _identity(fn):
                self.registered_tool_names.add(fn.__name__)
                self.registered_tool_meta[fn.__name__] = meta
                return fn

            return _identity

        def run(self, *args, **kwargs):
            pass

    class _ContextStub:  # typing placeholder if `ctx: Context` ever appears
        pass

    _fastmcp.FastMCP = _FastMCPStub
    _fastmcp.Context = _ContextStub
    sys.modules["fastmcp"] = _fastmcp
