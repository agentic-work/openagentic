

"""
OpenAgentic Grafana MCP Server

Provides MCP tools for listing Grafana dashboards, datasources, alert rules,
and querying datasources.
"""

from .server import mcp

__all__ = ['mcp']
