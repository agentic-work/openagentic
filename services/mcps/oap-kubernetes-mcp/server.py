# Proprietary and confidential. Unauthorized copying prohibited.

"""
OpenAgentic Kubernetes MCP Server - FastMCP Entry Point

This is the entry point for the Kubernetes MCP server.
It imports and exports the FastMCP server from the kubernetes_mcp_server module.

IMPORTANT: This MCP server is ONLY available to ADMIN users.
Non-admin users should NOT have access to any tools in this server.
The MCP proxy validates admin status before routing requests here.

CRITICAL SECURITY: The namespace where OpenAgentic is deployed is READ-ONLY.
No modifications, deletions, or changes can be made to that namespace.
"""

import sys
import os

# Add src directory to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

# Import the mcp instance - FastMCP loader expects module-level 'mcp', 'server', or 'app'
from kubernetes_mcp_server.server import mcp

# Export for FastMCP discovery
__all__ = ['mcp']

if __name__ == "__main__":
    from kubernetes_mcp_server.server import main
    main()
