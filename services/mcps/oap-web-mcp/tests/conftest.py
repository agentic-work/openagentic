

"""Stub heavy/network-bound imports so server.py is importable in unit tests.

server.py top-level imports:
- ``fastmcp`` (FastMCP runtime — not pip-installed in CI sandboxes)
- ``markdownify`` (HTML→Markdown — usually available, stubbed defensively)
- ``bs4`` / ``BeautifulSoup`` (always available — left alone)
- ``shared.observability`` (added via sys.path manipulation in server.py;
  ImportError already handled there with a fallback)

Everything else is stdlib or httpx, which the sandbox has.
"""

import sys
import types
from unittest.mock import MagicMock

def _ensure_stubbed(name: str, attrs: dict | None = None) -> None:
    """Insert a MagicMock-backed module into ``sys.modules`` if missing."""
    if name in sys.modules:
        return
    mod = types.ModuleType(name)
    if attrs:
        for k, v in attrs.items():
            setattr(mod, k, v)

    # Anything not pre-seeded yields a MagicMock — keeps top-level imports
    # like ``from fastmcp import FastMCP`` working without a real wheel.
    def _missing_attr(item):
        m = MagicMock(name=f"{name}.{item}")
        setattr(mod, item, m)
        return m

    mod.__getattr__ = _missing_attr  # type: ignore[attr-defined]
    sys.modules[name] = mod

# Stub fastmcp — server.py does ``from fastmcp import FastMCP`` and then
# instantiates ``FastMCP(name=..., instructions=...)`` at import time.
class _FastMCPStub:
    def __init__(self, *args, **kwargs):
        self._tools = {}

    def tool(self, *_args, **_kwargs):
        # Return a passthrough decorator so @mcp.tool(...) works at import.
        def decorator(fn):
            return fn
        return decorator

    def run(self, *_args, **_kwargs):
        pass

_ensure_stubbed("fastmcp", {"FastMCP": _FastMCPStub})

# bs4 (BeautifulSoup) — server.py uses it at top-level for parsing fetched
# HTML. Tests don't exercise the parsing path; a no-op stub is fine.
try:
    import bs4  # noqa: F401
except ImportError:
    class _SoupStub:
        def __init__(self, *_args, **_kwargs):
            self.title = None
        def find(self, *_args, **_kwargs):
            return None
        def find_all(self, *_args, **_kwargs):
            return []
        def get_text(self, *_args, **_kwargs):
            return ""
    _ensure_stubbed("bs4", {"BeautifulSoup": _SoupStub})

# markdownify — same story.
try:
    import markdownify  # noqa: F401
except ImportError:
    _ensure_stubbed("markdownify", {"markdownify": lambda x, **_kw: x})
