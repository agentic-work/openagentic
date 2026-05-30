"""
Regression test for the openagentic-azure MCP tool registry.

Why this exists
---------------
2026-04-29: chatmode logs falsely claimed the live MCP proxy exposed only
4 ``azure_*`` tools (``azure_list_resources``, ``azure_create_vm``,
``azure_cost_analysis``, ``azure_advisor_recommendations``). Direct curl
against ``http://openagentic-mcp-proxy:8080/tools`` actually returned 71
azure tools — the chatmode "log" was reading a hard-coded
``defaultTools`` array in
``services/openagentic-api/src/services/SubagentOrchestrator.ts:223``
that lists 2 phantom names not present in this server at all.

This test pins the registry on the MCP-server side so the SoT can never
silently regress: if a future commit stops registering one of the three
tools the chatmode plan calls for (or any of the broader baseline of
verbs the cloud-ops subagent depends on), pytest fails at import-time
introspection — no live proxy needed.

The test relies on the FastMCP stub installed in ``conftest.py``, which
records every ``@mcp.tool()``-decorated function name on
``_StubFastMCP.registered_tool_names`` as ``server`` is imported.
"""

import importlib
import sys
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))

# Tools the chatmode v0.7.0 cloud-ops plan calls out by name. These MUST
# exist on the MCP server so subagent-orchestrator and ToolRanker can
# surface them. Adding to this list is a deliberate widening of the
# contract — never remove without a memo.
CHATMODE_REQUIRED_TOOLS = (
    "azure_list_subscriptions",
    "azure_list_resource_groups",
    "azure_resource_graph_query",
    # #857 — batch RG inventory tool. Replaces 10-15 model tool calls
    # (list_vms, list_disks, list_vnets, list_nsgs, list_storage_accounts,
    # list_key_vaults, list_aks, list_web_apps, etc.) with one fan-out call
    # that returns the entire RG inventory in parallel.
    "azure_get_resource_group_inventory",
)

@pytest.fixture(scope="module")
def registered_tool_names():
    """Import server.py once and return the set of registered tool names.

    Imports are module-scoped because ``server.py`` is ~6.7k lines and
    has heavy decorator side-effects; doing it per-test would pay that
    cost N times for no value.
    """
    # Force a fresh import so the conftest stub captures names from
    # scratch (other tests may have already triggered the import).
    sys.modules.pop("server", None)
    from mcp.server.fastmcp import FastMCP  # type: ignore

    # Reset the class-level registry so we measure THIS import's calls.
    FastMCP.registered_tool_names = set()

    importlib.import_module("server")
    return set(FastMCP.registered_tool_names)

def test_chatmode_required_tools_are_registered(registered_tool_names):
    """The 3 tools the chatmode plan needs must register at server import.

    Failure here means a downstream chatmode prompt that references one
    of these names by string-literal will silently no-op against a live
    proxy. This is the smoke test for the 2026-04-29 regression.
    """
    missing = [t for t in CHATMODE_REQUIRED_TOOLS if t not in registered_tool_names]
    assert not missing, (
        f"openagentic-azure MCP server is missing chatmode-required tools: {missing}. "
        f"Registered count={len(registered_tool_names)}. "
        "Add the tool with @mcp.tool() in services/mcps/oap-azure-mcp/src/server.py "
        "and rebuild the image."
    )

def test_total_tool_count_above_baseline(registered_tool_names):
    """Floor the registry at 65 tools.

    The live proxy reports 71 azure_* tools as of 2026-04-29. We pin a
    floor of 65 (rather than ==71) so additive PRs don't fail this test
    while still catching a wholesale-removal regression. If the count
    legitimately drops below 65, raise the floor in a separate commit
    with rationale in the body.
    """
    assert len(registered_tool_names) >= 65, (
        f"openagentic-azure tool registry collapsed to {len(registered_tool_names)} tools "
        f"(floor=65). Names registered: {sorted(registered_tool_names)}"
    )
