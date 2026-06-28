"""
Kubernetes MCP Server - FastMCP Implementation for K8s Administration

IMPORTANT: This MCP server is ONLY available to ADMIN users.
Non-admin users should NOT have access to any tools in this server.
The MCP proxy validates admin status before routing requests here.

CRITICAL SECURITY:
- The namespace where OpenAgentic is deployed is READ-ONLY
- No modifications, deletions, or changes can be made to that protected namespace
- The protected namespace is determined by the OPENAGENTIC_NAMESPACE env var

Module layout
-------------
This module is the thin entry point. The implementation is split into:

  - ``kubernetes_mcp_server._core``      — the ``mcp`` FastMCP instance, the lazy
    Kubernetes clients, ``get_k8s_client()``, the namespace-protection helpers,
    config and the structured logger.
  - ``kubernetes_mcp_server.tools.*``    — one module per K8s domain. Each module
    imports ``mcp`` + helpers from ``_core`` and registers its ``@mcp.tool``
    handlers as an import side-effect.

Importing THIS module constructs ``mcp`` (via ``_core``) and side-effect-imports
every tools module so the FULL tool registry is populated. Every tool function
and every shared helper is re-exported at module scope so that
``getattr(server, "<tool>")`` and ``patch.object(server, "<helper>")`` continue
to resolve against this module exactly as they did before the split.
"""

import os

# Core: the FastMCP instance, lazy K8s clients, helpers, config, logger.
# Re-exported so `server.mcp`, `server.get_k8s_client`, `server.PROTECTED_NAMESPACE`,
# `server.is_protected_namespace`, and `server.validate_namespace_write_access`
# resolve against this module (preserving getattr/patch.object targets).
from ._core import (  # noqa: F401
    mcp,
    logger,
    PROTECTED_NAMESPACE,
    is_protected_namespace,
    validate_namespace_write_access,
    get_k8s_client,
)

# Side-effect-import + re-export every tool group. The `import *` triggers each
# module's `@mcp.tool` registrations AND binds every tool function onto this
# module's namespace (each tools module declares __all__), so the entire tool
# surface stays reachable via `getattr(server, "<tool>")`.
from .tools.namespaces import *  # noqa: F401,F403
from .tools.pods import *  # noqa: F401,F403
from .tools.deployments import *  # noqa: F401,F403
from .tools.services import *  # noqa: F401,F403
from .tools.config_secrets import *  # noqa: F401,F403
from .tools.workloads import *  # noqa: F401,F403
from .tools.nodes import *  # noqa: F401,F403
from .tools.cluster import *  # noqa: F401,F403
from .tools.apply import *  # noqa: F401,F403
from .tools.rollouts import *  # noqa: F401,F403
from .tools.context import *  # noqa: F401,F403
from .tools.discovery import *  # noqa: F401,F403
from .tools.node_management import *  # noqa: F401,F403
from .tools.cleanup import *  # noqa: F401,F403
from .tools.helm import *  # noqa: F401,F403

# ============================================================================
# FASTMCP SERVER INITIALIZATION
# ============================================================================

def main():
    """Main entry point for the Kubernetes MCP server"""
    logger.info("=" * 80)
    logger.info("Starting Kubernetes MCP Server (FastMCP)")
    logger.info("ADMIN USERS ONLY - Non-admin users will be rejected")
    logger.info(f"PROTECTED NAMESPACE: {PROTECTED_NAMESPACE} (read-only)")
    logger.info("=" * 80)

    # Test Kubernetes connection
    try:
        get_k8s_client()
        logger.info("Kubernetes client initialized successfully")
    except Exception as e:
        logger.warning(f"Kubernetes client initialization deferred: {e}")

    # Use shared HTTP transport when deployed as a pod-per-MCP service;
    # fall back to stdio when http_transport isn't on sys.path (local dev).
    try:
        from http_transport import run_with_http_support
        logger.info("Kubernetes MCP Server ready - waiting for requests")
        run_with_http_support(
            mcp_server=mcp,
            name="oap-kubernetes-mcp",
            version="1.0.0",
            default_port=int(os.environ.get("MCP_SERVER_PORT", "8086")),
        )
    except ImportError:
        logger.info("Kubernetes MCP Server ready - waiting for requests (stdio)")
        mcp.run()

if __name__ == "__main__":
    main()
