"""Kubernetes MCP tool groups.

Each submodule imports the shared ``mcp`` instance and helpers from
``kubernetes_mcp_server._core`` and registers its ``@mcp.tool`` handlers as an
import side-effect. ``kubernetes_mcp_server.server`` side-effect-imports every
submodule so the full tool registry is populated when the server module loads.
"""
