"""Azure MCP tool groups.

Each submodule imports the shared ``mcp`` instance + helpers + Azure SDK client
classes from ``_core`` (via ``from _core import *``) and registers its
``@mcp.tool`` handlers as an import side-effect. ``server`` side-effect-imports
every submodule so the full registry is populated when the server loads.
"""
