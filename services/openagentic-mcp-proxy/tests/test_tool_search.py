"""
Tests for the Milvus-backed `tool_search` synthetic MCP tool surface in
mcp-proxy. The proxy itself owns NO Milvus / embedding code — it forwards
to the api's POST /api/internal/tool-search endpoint, which wraps
ToolSemanticCacheService.searchToolsAsOpenAIFunctions.

the design notes
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

# Sample OpenAI-shape tool defs we expect the api to return. The proxy
# must pass them through verbatim.
FAKE_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "azure_list_resource_groups",
            "description": "List Azure resource groups in a subscription.",
            "parameters": {
                "type": "object",
                "properties": {
                    "subscription_id": {"type": "string"},
                },
                "required": ["subscription_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "azure_get_cognitive_services_account",
            "description": "Get one Azure Cognitive Services account by name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "resource_group": {"type": "string"},
                    "account_name": {"type": "string"},
                },
                "required": ["resource_group", "account_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "azure_list_deployments",
            "description": "List model deployments inside a Cognitive Services account.",
            "parameters": {
                "type": "object",
                "properties": {"account_name": {"type": "string"}},
                "required": ["account_name"],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# 1. POST /v1/mcp/tools/search forwards to the api
# ---------------------------------------------------------------------------
@respx.mock
def test_tool_search_endpoint_forwards_to_api(client: TestClient, monkeypatch):
    monkeypatch.setenv("TOOL_SEARCH_API_URL", "http://fake-api:8000")
    monkeypatch.setenv("INTERNAL_SERVICE_SECRET", "unit-test-secret")

    route = respx.post("http://fake-api:8000/api/internal/tool-search").mock(
        return_value=httpx.Response(200, json={"tools": FAKE_TOOLS})
    )

    res = client.post(
        "/v1/mcp/tools/search",
        json={"query": "azure cognitive services deployment", "k": 5},
    )

    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 3
    assert body["tools"] == FAKE_TOOLS
    assert "error" not in body or body.get("error") in (None, "")

    # Verify the api was called with the right header + body shape.
    assert route.called
    sent = route.calls.last.request
    assert sent.headers.get("x-internal-secret") == "unit-test-secret"
    import json
    payload = json.loads(sent.content.decode())
    assert payload["query"] == "azure cognitive services deployment"
    assert payload["k"] == 5

# ---------------------------------------------------------------------------
# 2. api error → 200 with empty tools + error string (degraded)
# ---------------------------------------------------------------------------
@respx.mock
def test_tool_search_endpoint_handles_api_error(client: TestClient, monkeypatch):
    monkeypatch.setenv("TOOL_SEARCH_API_URL", "http://fake-api:8000")
    monkeypatch.setenv("INTERNAL_SERVICE_SECRET", "unit-test-secret")

    respx.post("http://fake-api:8000/api/internal/tool-search").mock(
        return_value=httpx.Response(503, json={"error": "service down"})
    )

    res = client.post("/v1/mcp/tools/search", json={"query": "azure", "k": 3})

    assert res.status_code == 200
    body = res.json()
    assert body["tools"] == []
    assert body["count"] == 0
    assert body.get("error")  # non-empty

# ---------------------------------------------------------------------------
# 3. timeout → 200 with empty tools + error string (degraded)
# ---------------------------------------------------------------------------
@respx.mock
def test_tool_search_endpoint_handles_timeout(client: TestClient, monkeypatch):
    monkeypatch.setenv("TOOL_SEARCH_API_URL", "http://fake-api:8000")
    monkeypatch.setenv("INTERNAL_SERVICE_SECRET", "unit-test-secret")

    # respx supports raising on the side_effect to simulate timeout
    respx.post("http://fake-api:8000/api/internal/tool-search").mock(
        side_effect=httpx.ConnectTimeout("simulated timeout")
    )

    res = client.post("/v1/mcp/tools/search", json={"query": "azure", "k": 3})

    assert res.status_code == 200
    body = res.json()
    assert body["tools"] == []
    assert body["count"] == 0
    assert body.get("error")
    assert "timeout" in body["error"].lower() or "connect" in body["error"].lower()

# ---------------------------------------------------------------------------
# 4. /v1/mcp/tools includes tool_search at END when DEFER_TOOLS=false
# ---------------------------------------------------------------------------
def test_v1_mcp_tools_includes_tool_search_when_defer_off(make_app, monkeypatch):
    """
    With DEFER_TOOLS=false (default), the existing catalog stays untouched
    and tool_search is APPENDED. The integration into the *production*
    endpoint /v1/mcp/tools is exercised via the contract helper
    `tool_search.augment_tools_list` so we don't have to spin up the full
    main.py app (with Redis + MCP-manager). The test asserts the helper's
    behaviour, which is what main.py wires into its real handler.
    """
    monkeypatch.delenv("DEFER_TOOLS", raising=False)  # default = false
    import tool_search

    existing = [
        {"server": "azure", "name": "azure_list_resource_groups",
         "description": "List azure resource groups."},
        {"server": "aws", "name": "aws_list_buckets",
         "description": "List S3 buckets."},
    ]

    augmented = tool_search.augment_tools_list(existing)

    assert isinstance(augmented, list)
    assert len(augmented) == len(existing) + 1
    # tool_search is the LAST entry
    assert augmented[-1]["name"] == "tool_search"
    # Original tools are intact and ahead of tool_search
    assert augmented[0] == existing[0]
    assert augmented[1] == existing[1]

# ---------------------------------------------------------------------------
# 5. /v1/mcp/tools is ONLY tool_search when DEFER_TOOLS=true
# ---------------------------------------------------------------------------
def test_v1_mcp_tools_only_tool_search_when_defer_on(make_app, monkeypatch):
    monkeypatch.setenv("DEFER_TOOLS", "true")
    import tool_search

    existing = [
        {"server": "azure", "name": "azure_list_resource_groups", "description": "..."},
        {"server": "aws", "name": "aws_list_buckets", "description": "..."},
    ]

    augmented = tool_search.augment_tools_list(existing)

    assert isinstance(augmented, list)
    assert len(augmented) == 1
    assert augmented[0]["name"] == "tool_search"

# ---------------------------------------------------------------------------
# 6. /mcp/tool dispatches name=tool_search to the synthetic handler
# ---------------------------------------------------------------------------
@respx.mock
def test_mcp_tool_endpoint_dispatches_tool_search(client: TestClient, monkeypatch):
    """
    The contract is that calling the synthetic tool by name returns an
    MCP-shaped envelope:  result.content[0].text  with the tool list
    stringified inside.
    """
    monkeypatch.setenv("TOOL_SEARCH_API_URL", "http://fake-api:8000")
    monkeypatch.setenv("INTERNAL_SERVICE_SECRET", "unit-test-secret")

    respx.post("http://fake-api:8000/api/internal/tool-search").mock(
        return_value=httpx.Response(200, json={"tools": FAKE_TOOLS})
    )

    res = client.post(
        "/v1/mcp/tool-search/dispatch",
        json={"name": "tool_search", "arguments": {"query": "azure", "k": 3}, "id": "abc"},
    )

    assert res.status_code == 200
    body = res.json()
    assert body["jsonrpc"] == "2.0"
    assert body["id"] == "abc"
    text = body["result"]["content"][0]["text"]
    # Each tool name should appear in the rendered text payload
    for tool in FAKE_TOOLS:
        assert tool["function"]["name"] in text

# ---------------------------------------------------------------------------
# 7. /health/tool-search 200 when api responds
# ---------------------------------------------------------------------------
@respx.mock
def test_health_tool_search_passes_when_api_responds(client: TestClient, monkeypatch):
    monkeypatch.setenv("TOOL_SEARCH_API_URL", "http://fake-api:8000")
    monkeypatch.setenv("INTERNAL_SERVICE_SECRET", "unit-test-secret")

    respx.post("http://fake-api:8000/api/internal/tool-search").mock(
        return_value=httpx.Response(200, json={"tools": [FAKE_TOOLS[0]]})
    )

    res = client.get("/health/tool-search")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

# ---------------------------------------------------------------------------
# 8. /health/tool-search 503 when api 503s
# ---------------------------------------------------------------------------
@respx.mock
def test_health_tool_search_fails_when_api_503(client: TestClient, monkeypatch):
    monkeypatch.setenv("TOOL_SEARCH_API_URL", "http://fake-api:8000")
    monkeypatch.setenv("INTERNAL_SERVICE_SECRET", "unit-test-secret")

    respx.post("http://fake-api:8000/api/internal/tool-search").mock(
        return_value=httpx.Response(503, json={"error": "down"})
    )

    res = client.get("/health/tool-search")
    assert res.status_code == 503

# ---------------------------------------------------------------------------
# 9. The synthesized tool_search def has the canonical shape
# ---------------------------------------------------------------------------
def test_tool_search_def_shape():
    import tool_search

    defn = tool_search.SYNTHETIC_TOOL_SEARCH_DEF

    assert defn["name"] == "tool_search"
    # Description must mention the catalog so models know what they're searching.
    desc = defn["description"]
    assert "tool catalog" in desc.lower() or "tool" in desc.lower()
    # The canonical OpenAI-style parameters block.
    params = defn["parameters"]
    assert params["type"] == "object"
    assert "query" in params["properties"]
    assert params["properties"]["query"]["type"] == "string"
    assert "k" in params["properties"]
    assert params["properties"]["k"].get("default") == 8
    assert params["required"] == ["query"]
