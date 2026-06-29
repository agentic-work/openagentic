"""
Shared pytest fixtures for mcp-proxy tests.

We deliberately do NOT import `src/main.py` directly because that module's
top-level + lifespan pulls in Redis, Azure OAuth, MCP-manager subprocess
spawning, and a stack of heavy third-party SDKs we don't need to exercise
the new tool_search surface.

Instead, every test that needs an HTTP surface builds a minimal FastAPI app
that mounts ONLY the routes under test (via `tool_search.register_routes`).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# Make `src/` importable as a top-level package so `import tool_search` works
# the same way main.py imports `mcp_manager`, `user_session_manager`, etc.
_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch):
    """Each test starts with a clean tool_search-relevant env."""
    monkeypatch.delenv("DEFER_TOOLS", raising=False)
    monkeypatch.delenv("TOOL_SEARCH_API_URL", raising=False)
    monkeypatch.delenv("INTERNAL_SERVICE_SECRET", raising=False)
    monkeypatch.delenv("API_BASE_URL", raising=False)
    yield

@pytest.fixture
def make_app():
    """Factory that returns a FastAPI test app with tool_search routes mounted."""
    import tool_search

    def _factory() -> FastAPI:
        app = FastAPI()
        tool_search.register_routes(app)
        return app

    return _factory

@pytest.fixture
def client(make_app):
    """Convenience TestClient for tests that don't need to customize the app."""
    app = make_app()
    return TestClient(app)
