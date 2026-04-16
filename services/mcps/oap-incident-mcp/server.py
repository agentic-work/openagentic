# Proprietary and confidential. Unauthorized copying prohibited.

"""
OpenAgentic Incident MCP Server - FastMCP Entry Point

This is the entry point for the Incident MCP server.
It provides tools to manage the incident lifecycle.

IMPORTANT: This MCP server is available to ADMIN users only.
"""

import sys
import os

# Add src directory to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

# Import the mcp instance - FastMCP loader expects module-level 'mcp', 'server', or 'app'
from incident_mcp_server.server import mcp

# Export for FastMCP discovery
__all__ = ['mcp']

if __name__ == "__main__":
    from incident_mcp_server.server import main
    main()
