
"""
Tool Search synthetic MCP tool — openagentic-mcp-proxy surface.

The model-facing surface for Milvus-backed tool discovery. The proxy itself
does NOT own Milvus or the embedding client — it forwards every search
request to the api's POST /api/internal/tool-search route, which wraps
ToolSemanticCacheService.searchToolsAsOpenAIFunctions(query, k).

Three additions to the proxy:

  1. POST /v1/mcp/tools/search        ── thin forwarder, returns {tools, count}
  2. POST /v1/mcp/tool-search/dispatch ── MCP-shaped wrapper for /mcp/tool calls
                                          that name the synthetic `tool_search`
  3. GET  /health/tool-search         ── 200 only if a probe query round-trips

Plus two contract helpers:

  * SYNTHETIC_TOOL_SEARCH_DEF — the canonical tool def the model sees in
    tools/list (or as the only entry when DEFER_TOOLS=true).
  * augment_tools_list(existing) — append-or-replace logic for the
    /v1/mcp/tools handler, gated by DEFER_TOOLS.

Why a separate module: keeps main.py's heavy startup (Redis, OAuth, MCP
manager subprocess spawning) out of the unit-test path. main.py imports
this module and wires the routes/helpers via `register_routes(app)` and
`augment_tools_list(...)`.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

logger = logging.getLogger("mcp-proxy.tool_search")

# How long we wait for the api forward before giving up. Kept short because
# the synthetic tool_search is on the critical path of the model's first
# turn — a hung Milvus query must NOT block the tool list.
API_FORWARD_TIMEOUT_SECONDS = 5.0

# How long we wait for the boot-gate health probe.
HEALTH_PROBE_TIMEOUT_SECONDS = 5.0

# Default top-k when the model omits it.
DEFAULT_TOP_K = 8

# ---------------------------------------------------------------------------
# The synthetic tool_search definition — what the model sees in tools/list.
# ---------------------------------------------------------------------------
SYNTHETIC_TOOL_SEARCH_DEF: Dict[str, Any] = {
    "name": "tool_search",
    "description": (
        "Search the live MCP tool catalog for tools matching what you need. "
        "Use when the user asks for cloud resources, code execution, file ops, "
        "or anything not handled by your always-on tools. Returns 5-8 tool "
        "definitions you can call on your next turn."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": (
                    "What you're trying to do, in plain language. e.g. 'azure "
                    "cognitive services deployment', 'kubernetes pod logs', "
                    "'github pull request review'."
                ),
            },
            "k": {
                "type": "integer",
                "description": "How many tools to retrieve. Default 8.",
                "default": DEFAULT_TOP_K,
                "minimum": 1,
                "maximum": 20,
            },
        },
        "required": ["query"],
    },
}

# ---------------------------------------------------------------------------
# Pydantic request models for the proxy-facing endpoints.
# ---------------------------------------------------------------------------
class ToolSearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    k: int = Field(default=DEFAULT_TOP_K, ge=1, le=20)
    serverFilter: Optional[str] = None

class DispatchRequest(BaseModel):
    name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)
    id: Optional[str] = "1"

# ---------------------------------------------------------------------------
# Configuration helpers — read fresh from env on every call so tests can
# monkeypatch reliably and admins can hot-flip DEFER_TOOLS without restart.
# ---------------------------------------------------------------------------
def _is_defer_tools_enabled() -> bool:
    return os.getenv("DEFER_TOOLS", "false").strip().lower() in ("true", "1", "yes")

# Public alias — used by main.py's catalog handler to surface the flag in
# response metadata. The leading-underscore version stays for internal use.
def is_defer_tools_enabled() -> bool:
    """Whether DEFER_TOOLS=true. Hides the 317 backend tools in tools/list."""
    return _is_defer_tools_enabled()

def _api_base_url() -> str:
    return (
        os.getenv("TOOL_SEARCH_API_URL")
        or os.getenv("API_BASE_URL")
        or "http://openagentic-api:8000"
    ).rstrip("/")

def _internal_secret() -> str:
    return os.getenv("INTERNAL_SERVICE_SECRET", "")

# ---------------------------------------------------------------------------
# tools/list integration — main.py calls this on its catalog.
# ---------------------------------------------------------------------------
def augment_tools_list(existing: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Mix the synthetic tool_search def into the live catalog according to the
    DEFER_TOOLS flag.

      DEFER_TOOLS=true  → return [tool_search] only (the 317 backend tools
                          are HIDDEN; the model can only discover them via
                          tool_search).
      DEFER_TOOLS=false → return existing + [tool_search] (legacy / opt-in
                          path while we soak the new flow).
    """
    synthetic = dict(SYNTHETIC_TOOL_SEARCH_DEF)  # shallow copy is enough — never mutated
    synthetic.setdefault("server", "_synthetic")

    if _is_defer_tools_enabled():
        return [synthetic]
    return list(existing) + [synthetic]

# ---------------------------------------------------------------------------
# Forward to the api's internal tool-search route.
# ---------------------------------------------------------------------------
async def _forward_to_api(query: str, k: int, serverFilter: Optional[str] = None) -> Dict[str, Any]:
    """
    Forward a single tool_search query to the api. On any failure (network,
    timeout, 5xx, 4xx, malformed body) we return a degraded payload so the
    proxy can still hand the model SOMETHING — never raise. The model can
    retry on the next turn.

    Return shape:
        {"tools": [...], "count": N, "error": Optional[str]}
    """
    url = f"{_api_base_url()}/api/internal/tool-search"
    headers = {
        "x-internal-secret": _internal_secret(),
        "content-type": "application/json",
    }
    body: Dict[str, Any] = {"query": query, "k": k}
    if serverFilter:
        body["serverFilter"] = serverFilter

    try:
        async with httpx.AsyncClient(timeout=API_FORWARD_TIMEOUT_SECONDS) as client:
            resp = await client.post(url, headers=headers, json=body)
    except httpx.TimeoutException as e:
        logger.warning("tool_search forward timeout: %s", e)
        return {"tools": [], "count": 0, "error": f"timeout calling api: {e}"}
    except httpx.RequestError as e:
        logger.warning("tool_search forward connection error: %s", e)
        return {"tools": [], "count": 0, "error": f"connection error: {e}"}

    if resp.status_code != 200:
        try:
            detail = resp.json()
        except Exception:
            detail = {"error": resp.text[:200]}
        msg = detail.get("error") or f"api returned {resp.status_code}"
        logger.warning("tool_search forward non-200: %s %s", resp.status_code, msg)
        return {"tools": [], "count": 0, "error": str(msg)}

    try:
        data = resp.json()
    except Exception as e:
        logger.warning("tool_search forward malformed json: %s", e)
        return {"tools": [], "count": 0, "error": f"malformed api response: {e}"}

    tools = data.get("tools") or []
    if not isinstance(tools, list):
        return {"tools": [], "count": 0, "error": "api returned non-list tools"}

    return {"tools": tools, "count": len(tools)}

def _render_dispatch_text(query: str, tools: List[Dict[str, Any]]) -> str:
    """Pretty-print the search result for the MCP-shaped content envelope."""
    return (
        f"Found {len(tools)} tools matching '{query}':\n\n"
        + json.dumps(tools, indent=2)
    )

# ---------------------------------------------------------------------------
# Route registration — main.py calls this once at app construction.
# Exposed as a function (not a router) because the proxy's main.py is built
# ad-hoc with `app = FastAPI(...)`, and the existing endpoints are added via
# decorators directly on `app`.
# ---------------------------------------------------------------------------
def register_routes(app: FastAPI) -> None:
    """Mount the three tool_search endpoints on the given FastAPI instance."""

    @app.post("/v1/mcp/tools/search")
    async def tools_search(req: ToolSearchRequest) -> Dict[str, Any]:
        """Forward a tool-discovery query to the api. Always 200 (degraded on err)."""
        result = await _forward_to_api(req.query, req.k, req.serverFilter)
        # Pure pass-through shape: {tools, count, error?}
        return result

    @app.post("/v1/mcp/tool-search/dispatch")
    async def tools_search_dispatch(req: DispatchRequest):
        """
        Synthetic-tool dispatcher. Called by main.py's /mcp/tool when
        name == "tool_search". Returns an MCP-shaped result envelope.
        """
        if req.name != "tool_search":
            return JSONResponse(
                status_code=400,
                content={
                    "jsonrpc": "2.0",
                    "id": req.id,
                    "error": {
                        "code": -32601,
                        "message": f"tool-search dispatcher only handles 'tool_search', got '{req.name}'",
                    },
                },
            )

        query = (req.arguments or {}).get("query", "")
        k = int((req.arguments or {}).get("k", DEFAULT_TOP_K) or DEFAULT_TOP_K)
        result = await _forward_to_api(query, k)
        text = _render_dispatch_text(query, result.get("tools", []))
        return {
            "jsonrpc": "2.0",
            "id": req.id,
            "result": {
                "content": [
                    {"type": "text", "text": text},
                ]
            },
        }

    @app.get("/health/tool-search")
    async def health_tool_search():
        """
        Boot-gate-able probe. 200 only if a small forward to the api
        succeeds with no error string.
        """
        result = await _forward_to_api("hello world", 1)
        if result.get("error"):
            return JSONResponse(
                status_code=503,
                content={"status": "down", "error": result["error"]},
            )
        return {"status": "ok", "tool_count": result.get("count", 0)}
