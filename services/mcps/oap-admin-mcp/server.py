# Proprietary and confidential. Unauthorized copying prohibited.

"""
OpenAgentic Admin MCP Server - FastMCP Entry Point

This is the entry point for the Admin MCP server.
It imports and exports the FastMCP server from the admin_mcp_server module.

IMPORTANT: This MCP server is ONLY available to ADMIN users.
Non-admin users should NOT have access to any tools in this server.
The MCP proxy validates admin status before routing requests here.
"""

import sys
import os

# Add src directory to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

# Import the mcp instance - FastMCP loader expects module-level 'mcp', 'server', or 'app'
from admin_mcp_server.server import mcp

# Export for FastMCP discovery
__all__ = ['mcp']

if __name__ == "__main__":
    from admin_mcp_server.server import main
    main()
