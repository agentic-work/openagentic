# Proprietary and confidential. Unauthorized copying prohibited.

"""
OpenAgentic Prometheus MCP Server

Provides MCP tools for querying Prometheus metrics, alerts, and targets.
"""

from .server import mcp

__all__ = ['mcp']
