"""
Architecture gate: MCPHTTPServer._get_tools() MUST preserve every field
the FastMCP MCP-spec Tool object carries — name, title, description,
inputSchema, outputSchema, annotations, icons, _meta.

Live capture 2026-05-01 showed the previous implementation hand-projected
only `name/description/inputSchema`, silently dropping `_meta` (cascade-
authoritative) and `annotations` (MCP-standard hints). The proxy → indexer
chain then had no goldenPrompts / hitlRisk / category to feed the cascade.

This regression test ships ONE tool with a fully-populated metadata block
through `_get_tools()` and asserts every field reaches the wire dict.
"""
import os
import sys
from pathlib import Path

import pytest

# Make the shared module importable from this test
SHARED_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SHARED_DIR))

# Stub modules that http_transport tries to import at module load time.
import types as _types
sys.modules.setdefault('opentelemetry', _types.ModuleType('opentelemetry'))
sys.modules.setdefault('opentelemetry.instrumentation', _types.ModuleType('opentelemetry.instrumentation'))
sys.modules.setdefault('opentelemetry.instrumentation.fastapi', _types.ModuleType('opentelemetry.instrumentation.fastapi'))
sys.modules.setdefault('opentelemetry.instrumentation.httpx', _types.ModuleType('opentelemetry.instrumentation.httpx'))

# Reset prometheus_client default registry so re-imports don't double-register.
# http_transport.py registers global Counters at module load.
from prometheus_client import REGISTRY as _PROM_REGISTRY
for _c in list(_PROM_REGISTRY._collector_to_names.keys()):
    try:
        _PROM_REGISTRY.unregister(_c)
    except Exception:
        pass

from mcp.server.fastmcp import FastMCP

from http_transport import MCPHTTPServer  # noqa: E402

def _build_fastmcp_with_full_metadata():
    """Spin a tiny FastMCP that has 1 tool with every brief-spec field set."""
    m = FastMCP(name='test', host='127.0.0.1', port=18999)

    @m.tool(
        annotations={
            'readOnlyHint': True,
            'destructiveHint': False,
            'idempotentHint': True,
            'openWorldHint': True,
        },
        meta={
            'category': 'cloud-list',
            'hitlRisk': 'low',
            'requiresConsent': False,
            'cost': 'free',
            'averageLatencyMs': 1500,
            'goldenPrompts': [
                'list my azure subscriptions',
                'show me azure subs',
            ],
            'failureModes': ['not_found', 'auth_expired'],
        },
    )
    async def example_list_tool(x: int = 1) -> dict:
        """Sufficiently long description that satisfies the brief contract."""
        return {'ok': True, 'x': x}

    return m

@pytest.mark.asyncio
async def test_get_tools_preserves_meta_and_annotations():
    mcp = _build_fastmcp_with_full_metadata()
    srv = MCPHTTPServer(mcp_server=mcp, name='test', version='1.0.0', port=18999)
    tools = await srv._get_tools()
    assert len(tools) == 1, f'expected 1 tool, got {len(tools)}'
    t = tools[0]

    # Required spec fields
    assert t['name'] == 'example_list_tool'
    assert 'description' in t
    assert 'inputSchema' in t

    # Cascade-authoritative metadata MUST reach the wire
    assert '_meta' in t, f'_meta missing from wire form. keys={list(t.keys())}'
    meta = t['_meta']
    assert meta.get('category') == 'cloud-list'
    assert meta.get('hitlRisk') == 'low'
    assert meta.get('goldenPrompts') == ['list my azure subscriptions', 'show me azure subs']
    assert meta.get('failureModes') == ['not_found', 'auth_expired']

    # MCP-standard hints MUST reach the wire
    assert 'annotations' in t, f'annotations missing from wire form. keys={list(t.keys())}'
    ann = t['annotations']
    assert ann.get('readOnlyHint') is True
    assert ann.get('destructiveHint') is False
    assert ann.get('idempotentHint') is True
    assert ann.get('openWorldHint') is True

@pytest.mark.asyncio
async def test_get_tools_uses_aliased_field_names():
    """_meta MUST be the wire field, NOT meta. Pydantic alias must take effect."""
    mcp = _build_fastmcp_with_full_metadata()
    srv = MCPHTTPServer(mcp_server=mcp, name='test', version='1.0.0', port=18999)
    tools = await srv._get_tools()
    t = tools[0]
    assert '_meta' in t, '_meta required (MCP spec canonical name)'
    # The unaliased Python attr `meta` must not leak — that violates the spec
    assert 'meta' not in t, 'meta (un-aliased) leaked instead of _meta'

@pytest.mark.asyncio
async def test_standalone_fastmcp_does_not_serialize_fn_callable():
    """Regression for live failure 2026-05-01:
    aws-mcp uses `from fastmcp import FastMCP` (standalone). Its
    list_tools() returns FastMCP Tool objects that carry the `fn`
    callable as a Pydantic field. A naive model_dump(mode='json') raises
      PydanticSerializationError: Unable to serialize <class 'function'>
    The serializer MUST exclude `fn` (preferably via tool.to_mcp_tool()).
    """
    try:
        from fastmcp import FastMCP as StandaloneFastMCP
    except ImportError:
        pytest.skip('standalone fastmcp not installed')

    # Standalone fastmcp 3.x rejects host/port kwargs in __init__ — they
    # belong on run_http_async(). We just need the in-memory list_tools().
    m = StandaloneFastMCP(name='standalone-test')

    @m.tool(
        annotations={'readOnlyHint': True, 'destructiveHint': False},
        meta={'category': 'cloud-list', 'goldenPrompts': ['list things']},
    )
    async def standalone_tool(x: int = 1) -> dict:
        """Sufficiently long description for the test fixture."""
        return {}

    srv = MCPHTTPServer(mcp_server=m, name='standalone-test', version='1.0.0', port=18997)
    # Must not raise PydanticSerializationError
    tools = await srv._get_tools()
    assert len(tools) == 1
    t = tools[0]
    assert t.get('name') == 'standalone_tool'
    # `fn` MUST NOT leak to the wire (it's a callable, not JSON-serializable)
    assert 'fn' not in t, f'fn field leaked to wire: {list(t.keys())}'
    assert 'fn_metadata' not in t, f'fn_metadata leaked to wire: {list(t.keys())}'
    # _meta + annotations should still be there
    assert '_meta' in t
    assert t['_meta'].get('category') == 'cloud-list'
    assert 'annotations' in t

@pytest.mark.asyncio
async def test_get_tools_excludes_none_fields():
    """Tools without optional fields shouldn't pollute the wire with nulls."""
    mcp = FastMCP(name='test2', host='127.0.0.1', port=18998)

    @mcp.tool()  # no annotations, no meta
    async def minimal_tool(x: int = 1) -> dict:
        """Sufficiently long description for the test fixture."""
        return {}

    srv = MCPHTTPServer(mcp_server=mcp, name='test2', version='1.0.0', port=18998)
    tools = await srv._get_tools()
    t = tools[0]
    # No null-valued keys should appear (exclude_none=True keeps wire lean)
    assert 'icons' not in t or t['icons']
    assert 'outputSchema' not in t or t['outputSchema']
