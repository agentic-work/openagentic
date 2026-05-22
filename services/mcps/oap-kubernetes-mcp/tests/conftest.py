"""
Test scaffolding for oap-kubernetes-mcp.

The server.py at src/kubernetes_mcp_server/server.py imports:
  - mcp.server.fastmcp.FastMCP (the @mcp.tool decorator host)
  - kubernetes.client / kubernetes.config (lazy via get_k8s_client())
  - dotenv (env loader)
  - observability (shared logging module)

We stub all of them so the module imports without those wheels installed,
and so the FastMCP @mcp.tool decorator becomes a no-op that records
every registered function name on a class-level set (mirrors the
oap-azure-mcp/tests/conftest.py pattern from #857).
"""

import importlib.abc
import importlib.machinery
import sys
import types
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# FastMCP stub — @mcp.tool() becomes a recording no-op decorator.
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# dotenv stub — server.py calls dotenv.load_dotenv(...) at import time.
# ---------------------------------------------------------------------------
_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda *_args, **_kwargs: None
sys.modules.setdefault("dotenv", _dotenv)

# ---------------------------------------------------------------------------
# observability stub — shared logging module not installed in test env.
# ---------------------------------------------------------------------------
class _StubLogger:
    def info(self, *_args, **_kwargs):
        pass

    def warning(self, *_args, **_kwargs):
        pass

    def error(self, *_args, **_kwargs):
        pass

    def debug(self, *_args, **_kwargs):
        pass

_observability = types.ModuleType("observability")
_observability.configure_logging = lambda _name: _StubLogger()
sys.modules.setdefault("observability", _observability)

# ---------------------------------------------------------------------------
# kubernetes client stub. The decorator-host @mcp.tool() registers the fn
# name at IMPORT TIME — handlers are never called during a registry test,
# so a MagicMock-backed kubernetes.* is enough.
# ---------------------------------------------------------------------------
class _KubernetesStubFinder(importlib.abc.MetaPathFinder):
    PREFIXES = ("kubernetes",)

    def find_spec(self, fullname, path, target=None):
        if not any(fullname == p or fullname.startswith(p + ".") for p in self.PREFIXES):
            return None
        if fullname in sys.modules:
            return None
        return importlib.machinery.ModuleSpec(
            fullname, _KubernetesStubLoader(), is_package=True
        )

class _KubernetesStubLoader(importlib.abc.Loader):
    def create_module(self, spec):
        mod = types.ModuleType(spec.name)
        mod.__path__ = []

        def __getattr__(name):
            if name.startswith("__"):
                raise AttributeError(name)
            stub = MagicMock(name=f"{spec.name}.{name}")
            setattr(mod, name, stub)
            return stub

        mod.__getattr__ = __getattr__  # type: ignore[attr-defined]
        return mod

    def exec_module(self, module):
        return None

if not any(isinstance(f, _KubernetesStubFinder) for f in sys.meta_path):
    sys.meta_path.insert(0, _KubernetesStubFinder())
