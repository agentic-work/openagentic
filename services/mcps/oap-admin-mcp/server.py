#!/usr/bin/env python3
# Copyright 2026 Gnomus.ai
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

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
