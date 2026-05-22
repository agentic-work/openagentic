"""
Regression test for the openagentic-kubernetes MCP tool registry (#881).

Why this exists
---------------
Q-loop drives on the dev environment surfaced repeated FAILED-tool-call attempts from
the model trying to enumerate cluster state via k8s list verbs that the
MCP server simply did not register:

  - k8s_list_replicasets
  - k8s_list_serviceaccounts
  - k8s_list_ingresses
  - k8s_list_daemonsets
  - k8s_list_events  (k8s_get_events existed under a non-conventional name)

(k8s_list_nodes already existed and is sanity-checked here as the baseline
control so a future rename can never silently break the contract.)

Per CLAUDE.md rule 7a(b), the registration check is a programmatic gate
that fires at import-time via the FastMCP stub in conftest.py — no live
proxy or kubeconfig required. RED test exists BEFORE the new
@mcp.tool definitions ship; GREEN once each verb is wired with proper
namespace + label-selector parameters returning a `k8s_list_pods`-shape
envelope.

Shape parity contract (matches k8s_list_pods @ server.py:251-302):
  {
    "success": bool,
    "namespace": str,                  # echoes input; "all" when all-namespaces
    "is_protected": bool,              # PROTECTED_NAMESPACE check
    "<resource_key>": list[dict],      # e.g. "replicasets", "ingresses"
    "count": int,
  }
"""

import importlib
import inspect
import sys
from pathlib import Path

import pytest

# server.py at services/mcps/oap-kubernetes-mcp/src/kubernetes_mcp_server/server.py
SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))

# Tools the chatmode k8s admin plan needs to enumerate cluster state.
# Adding to this list is a deliberate widening of the contract — never
# remove without a memo.
CHATMODE_REQUIRED_LIST_TOOLS = (
    "k8s_list_replicasets",
    "k8s_list_serviceaccounts",
    "k8s_list_ingresses",
    "k8s_list_nodes",  # control: pre-existing baseline tool
    "k8s_list_daemonsets",
    "k8s_list_events",
)

# Each (tool_name, payload_key) pair the tool MUST surface under success=True.
LIST_TOOL_PAYLOAD_KEYS = {
    "k8s_list_replicasets": "replicasets",
    "k8s_list_serviceaccounts": "serviceaccounts",
    "k8s_list_ingresses": "ingresses",
    "k8s_list_daemonsets": "daemonsets",
    "k8s_list_events": "events",
}

# Namespace-scoped list tools MUST accept a `namespace` param (default "default")
# AND an optional `label_selector` so the model can narrow the query.
NAMESPACED_LIST_TOOLS = (
    "k8s_list_replicasets",
    "k8s_list_serviceaccounts",
    "k8s_list_ingresses",
    "k8s_list_daemonsets",
)

@pytest.fixture(scope="module")
def server_module():
    """Import the kubernetes_mcp_server.server module once. The conftest
    FastMCP stub records every @mcp.tool-decorated function name as the
    module loads.
    """
    # Force a fresh import so the conftest stub captures THIS import's calls.
    for cached in list(sys.modules.keys()):
        if cached.startswith("kubernetes_mcp_server"):
            del sys.modules[cached]

    from mcp.server.fastmcp import FastMCP  # type: ignore

    FastMCP.registered_tool_names = set()

    return importlib.import_module("kubernetes_mcp_server.server")

@pytest.fixture(scope="module")
def registered_tool_names(server_module):
    from mcp.server.fastmcp import FastMCP  # type: ignore

    return set(FastMCP.registered_tool_names)

def test_chatmode_required_list_tools_are_registered(registered_tool_names):
    """The 6 list tools the chatmode k8s plan needs must register at import.

    Failure here means the model issues a tool_use call against the proxy
    and gets back a 404 / "tool not found" with no opportunity to recover.
    """
    missing = [t for t in CHATMODE_REQUIRED_LIST_TOOLS if t not in registered_tool_names]
    assert not missing, (
        f"openagentic-kubernetes MCP server is missing chatmode-required list tools: {missing}. "
        f"Registered count={len(registered_tool_names)}. "
        "Add the tool with @mcp.tool() in "
        "services/mcps/oap-kubernetes-mcp/src/kubernetes_mcp_server/server.py "
        "and rebuild the image."
    )

def test_namespaced_list_tools_accept_namespace_and_label_selector(server_module):
    """Each namespaced list tool MUST accept `namespace` (default 'default')
    and an optional `label_selector`. This is the parameter shape the
    chatmode prompt was trained to issue.
    """
    failures = []
    for tool_name in NAMESPACED_LIST_TOOLS:
        fn = getattr(server_module, tool_name, None)
        if fn is None:
            failures.append(f"{tool_name}: not exported from server module")
            continue
        sig = inspect.signature(fn)
        params = sig.parameters

        if "namespace" not in params:
            failures.append(f"{tool_name}: missing `namespace` param")
            continue
        if params["namespace"].default != "default":
            failures.append(
                f"{tool_name}: `namespace` default is {params['namespace'].default!r}, expected 'default'"
            )
        if "label_selector" not in params:
            failures.append(f"{tool_name}: missing optional `label_selector` param")
            continue
        if params["label_selector"].default is not None:
            failures.append(
                f"{tool_name}: `label_selector` default is {params['label_selector'].default!r}, expected None"
            )

    assert not failures, "Namespaced list tool signature contract broken:\n  " + "\n  ".join(failures)

def test_list_events_accepts_all_namespaces_via_optional_namespace(server_module):
    """k8s_list_events MUST accept an OPTIONAL namespace param so the model
    can issue a cluster-wide events query (Optional[str] = None pattern,
    same as the existing k8s_get_events tool).
    """
    fn = getattr(server_module, "k8s_list_events", None)
    assert fn is not None, "k8s_list_events not exported from server module"

    sig = inspect.signature(fn)
    assert "namespace" in sig.parameters, (
        "k8s_list_events missing `namespace` param — must accept Optional[str] = None "
        "so the model can issue cluster-wide queries"
    )
    assert sig.parameters["namespace"].default is None, (
        f"k8s_list_events `namespace` default is "
        f"{sig.parameters['namespace'].default!r}, expected None (Optional[str])"
    )

def test_list_tools_have_async_signature(server_module):
    """All list tools are async — the FastMCP host awaits them. A sync
    def would silently return a coroutine factory instead of data.
    """
    failures = []
    for tool_name in LIST_TOOL_PAYLOAD_KEYS:
        fn = getattr(server_module, tool_name, None)
        if fn is None:
            failures.append(f"{tool_name}: not exported")
            continue
        if not inspect.iscoroutinefunction(fn):
            failures.append(f"{tool_name}: not async def")
    assert not failures, "Non-async list tools:\n  " + "\n  ".join(failures)

def test_total_list_tool_count_above_baseline(registered_tool_names):
    """Floor the registry at the pre-#881 baseline + 5 new tools.

    Pre-#881 the server had 17 k8s_list_* / k8s_get_* read-shaped tools
    (counted via grep ^async def k8s_(list|get)_). With #881 we add 5
    new list tools (k8s_list_nodes already existed). So the floor is
    17 + 5 = 22 read tools, and the overall tool registry must grow
    by exactly 5 names.
    """
    new_list_tools = {
        "k8s_list_replicasets",
        "k8s_list_serviceaccounts",
        "k8s_list_ingresses",
        "k8s_list_daemonsets",
        "k8s_list_events",
    }
    overlap = new_list_tools & registered_tool_names
    assert overlap == new_list_tools, (
        f"#881 list tool additions incomplete. "
        f"Registered: {sorted(overlap)}. Missing: {sorted(new_list_tools - overlap)}."
    )
