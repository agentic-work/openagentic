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
Loki MCP Server - FastMCP Implementation

Provides tools to query logs via Loki (Grafana's log aggregation system).
This enables LLMs to analyze logs, search for errors, and investigate incidents.

IMPORTANT: This MCP server is available to ADMIN users only.
"""

import os
import sys
import json
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
import re

import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

# Configure structured logging via shared observability module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-loki-mcp')
except ImportError:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        stream=sys.stderr
    )
    logger = logging.getLogger("loki-mcp")

# Initialize FastMCP server
mcp = FastMCP("Loki MCP Server - Query Logs and Analyze Events")

# Loki configuration
LOKI_URL = os.getenv("LOKI_URL", "http://loki:3100")


# ============================================================================
# LOKI CLIENT
# ============================================================================

class LokiClient:
    """Client for interacting with Loki API"""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=60.0)

    def _parse_time(self, time_str: str) -> str:
        """Convert human-readable time to nanoseconds timestamp"""
        if time_str.isdigit():
            return time_str

        # Handle relative times like "1h", "30m", "1d"
        match = re.match(r'^(\d+)([smhdw])$', time_str.lower())
        if match:
            value, unit = int(match.group(1)), match.group(2)
            multipliers = {'s': 1, 'm': 60, 'h': 3600, 'd': 86400, 'w': 604800}
            seconds_ago = value * multipliers[unit]
            timestamp = datetime.utcnow() - timedelta(seconds=seconds_ago)
            return str(int(timestamp.timestamp() * 1e9))

        # Try parsing as ISO format
        try:
            dt = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
            return str(int(dt.timestamp() * 1e9))
        except ValueError:
            pass

        return time_str

    async def query(
        self,
        query: str,
        limit: int = 1000,
        start: Optional[str] = None,
        end: Optional[str] = None,
        direction: str = "backward"
    ) -> Dict[str, Any]:
        """Execute LogQL query"""
        params = {
            "query": query,
            "limit": limit,
            "direction": direction
        }

        if start:
            params["start"] = self._parse_time(start)
        if end:
            params["end"] = self._parse_time(end)

        response = await self.client.get(
            f"{self.base_url}/loki/api/v1/query_range",
            params=params
        )
        response.raise_for_status()
        return response.json()

    async def query_instant(self, query: str, time: Optional[str] = None) -> Dict[str, Any]:
        """Execute instant query"""
        params = {"query": query}
        if time:
            params["time"] = self._parse_time(time)

        response = await self.client.get(
            f"{self.base_url}/loki/api/v1/query",
            params=params
        )
        response.raise_for_status()
        return response.json()

    async def get_labels(self) -> Dict[str, Any]:
        """Get all label names"""
        response = await self.client.get(f"{self.base_url}/loki/api/v1/labels")
        response.raise_for_status()
        return response.json()

    async def get_label_values(self, label: str) -> Dict[str, Any]:
        """Get values for a specific label"""
        response = await self.client.get(
            f"{self.base_url}/loki/api/v1/label/{label}/values"
        )
        response.raise_for_status()
        return response.json()

    async def get_series(
        self,
        match: List[str],
        start: Optional[str] = None,
        end: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get series matching selectors"""
        params = {"match[]": match}
        if start:
            params["start"] = self._parse_time(start)
        if end:
            params["end"] = self._parse_time(end)

        response = await self.client.get(
            f"{self.base_url}/loki/api/v1/series",
            params=params
        )
        response.raise_for_status()
        return response.json()

    async def tail(
        self,
        query: str,
        delay_for: int = 0,
        limit: int = 100,
        start: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get recent logs (simulates tail -f)"""
        # For HTTP polling, just get the most recent entries
        if not start:
            start = "5m"  # Last 5 minutes

        return await self.query(query, limit=limit, start=start, direction="backward")

    async def stats(self, query: str) -> Dict[str, Any]:
        """Get query statistics"""
        params = {"query": query}
        response = await self.client.get(
            f"{self.base_url}/loki/api/v1/index/stats",
            params=params
        )
        response.raise_for_status()
        return response.json()


# Global client instance
loki_client = LokiClient(LOKI_URL)


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def format_log_entry(entry, stream: Dict[str, str]) -> str:
    """Format a single log entry for display

    Entry can be:
    - A list: [timestamp_ns, log_line] (Loki query_range format)
    - A dict: {"ts": timestamp, "line": log_line} or {"timestamp": ..., "message": ...}
    """
    if isinstance(entry, list):
        # Loki returns [timestamp_ns, log_line] format
        timestamp = entry[0] if len(entry) > 0 else ""
        line = entry[1] if len(entry) > 1 else ""
    else:
        # Dict format
        timestamp = entry.get("ts") or entry.get("timestamp", "")
        line = entry.get("line") or entry.get("message", "")

    # Parse timestamp if it's a nanosecond timestamp
    if isinstance(timestamp, (int, str)) and str(timestamp).isdigit():
        ts = int(timestamp) // 1_000_000_000
        timestamp = datetime.utcfromtimestamp(ts).strftime('%Y-%m-%d %H:%M:%S')

    # Get key labels
    app = stream.get("app", stream.get("container", stream.get("job", "unknown")))
    namespace = stream.get("namespace", "")
    pod = stream.get("pod", "")

    prefix = f"[{timestamp}]"
    if namespace:
        prefix += f" [{namespace}/{pod}]" if pod else f" [{namespace}]"
    elif app:
        prefix += f" [{app}]"

    return f"{prefix} {line}"


# ============================================================================
# TOOL DEFINITIONS
# ============================================================================

@mcp.tool()
async def loki_query(
    query: str = Field(description="LogQL query to execute (e.g., '{app=\"nginx\"}', '{namespace=\"openagentic\"} |= \"error\"')"),
    limit: int = Field(default=100, description="Maximum number of log lines to return (default: 100, max: 5000)"),
    start: str = Field(default="1h", description="Start time (e.g., '1h', '30m', '1d', or RFC3339 timestamp)"),
    end: Optional[str] = Field(default=None, description="End time (defaults to now)")
) -> str:
    """
    Query logs from Loki using LogQL.

    LogQL examples:
    - {app="nginx"} - All logs from nginx app
    - {namespace="openagentic"} |= "error" - Logs containing "error" from openagentic namespace
    - {job="kubernetes-pods"} |~ "(?i)exception" - Case-insensitive regex match
    - {app="api"} | json | status >= 500 - Parse JSON and filter by status

    Returns formatted log lines with timestamps and labels.
    """
    try:
        limit = min(limit, 5000)  # Cap at 5000
        result = await loki_client.query(query, limit=limit, start=start, end=end)

        if result.get("status") != "success":
            return f"Query failed: {result.get('error', 'Unknown error')}"

        data = result.get("data", {})
        result_type = data.get("resultType", "unknown")
        results = data.get("result", [])

        if not results:
            return f"No logs found for query: {query}\nTime range: last {start}"

        output = [
            f"Query: {query}",
            f"Time range: last {start}",
            f"Streams: {len(results)}",
            "=" * 60,
            ""
        ]

        total_lines = 0
        for stream_result in results:
            stream = stream_result.get("stream", {})
            values = stream_result.get("values", [])
            total_lines += len(values)

            for entry in values:
                formatted = format_log_entry(entry, stream)
                output.append(formatted)

        output.insert(3, f"Total log lines: {total_lines}")

        return "\n".join(output)

    except httpx.HTTPError as e:
        return f"HTTP error querying Loki: {str(e)}"
    except Exception as e:
        logger.error(f"Error in loki_query: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def loki_search_errors(
    namespace: str = Field(default="", description="Kubernetes namespace to search (leave empty for all)"),
    app: str = Field(default="", description="Application/container name to filter"),
    time_range: str = Field(default="1h", description="Time range to search (e.g., '30m', '1h', '6h', '1d')"),
    limit: int = Field(default=200, description="Maximum number of log lines")
) -> str:
    """
    Search for error logs across the system.

    Searches for common error patterns: error, exception, fatal, panic, failed, crash.
    Useful for quick incident investigation.
    """
    try:
        # Build query based on filters
        selectors = []
        if namespace:
            selectors.append(f'namespace="{namespace}"')
        if app:
            selectors.append(f'app="{app}"')

        selector_str = "{" + ",".join(selectors) + "}" if selectors else '{job=~".+"}'

        # Search for common error patterns
        query = f'{selector_str} |~ "(?i)(error|exception|fatal|panic|failed|crash)"'

        result = await loki_client.query(query, limit=limit, start=time_range)

        if result.get("status") != "success":
            return f"Query failed: {result.get('error', 'Unknown error')}"

        results = result.get("data", {}).get("result", [])

        if not results:
            return f"No errors found in the last {time_range}"

        output = [
            "=== Error Log Search Results ===",
            f"Time range: last {time_range}",
            f"Filters: namespace={namespace or 'all'}, app={app or 'all'}",
            "=" * 60,
            ""
        ]

        # Group by severity/type
        errors = {"error": [], "exception": [], "fatal": [], "panic": [], "failed": [], "crash": []}

        for stream_result in results:
            stream = stream_result.get("stream", {})
            for entry in stream_result.get("values", []):
                line = entry[1].lower() if isinstance(entry, list) else entry.get("line", "").lower()
                formatted = format_log_entry(entry, stream)

                for severity in errors.keys():
                    if severity in line:
                        errors[severity].append(formatted)
                        break

        # Output grouped errors
        for severity, lines in errors.items():
            if lines:
                output.append(f"\n{severity.upper()} ({len(lines)}):")
                output.append("-" * 40)
                for line in lines[:50]:  # Limit each category
                    output.append(line)
                if len(lines) > 50:
                    output.append(f"  ... and {len(lines) - 50} more")

        total = sum(len(v) for v in errors.values())
        output.insert(3, f"Total errors found: {total}")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in loki_search_errors: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def loki_tail(
    query: str = Field(description="LogQL query for the stream to tail"),
    lines: int = Field(default=50, description="Number of recent lines to show (max: 500)")
) -> str:
    """
    Get the most recent log lines (like 'tail -f').

    Shows the latest logs matching the query, ordered from newest to oldest.
    """
    try:
        lines = min(lines, 500)
        result = await loki_client.tail(query, limit=lines)

        if result.get("status") != "success":
            return f"Query failed: {result.get('error', 'Unknown error')}"

        results = result.get("data", {}).get("result", [])

        if not results:
            return f"No recent logs for query: {query}"

        output = [
            f"=== Tail: {query} ===",
            f"Showing {lines} most recent entries",
            "=" * 60,
            ""
        ]

        all_entries = []
        for stream_result in results:
            stream = stream_result.get("stream", {})
            for entry in stream_result.get("values", []):
                all_entries.append((entry, stream))

        # Sort by timestamp (newest first) - entry[0][0] is the timestamp
        all_entries.sort(key=lambda x: x[0][0] if isinstance(x[0], list) else 0, reverse=True)

        for entry, stream in all_entries[:lines]:
            output.append(format_log_entry(entry, stream))

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in loki_tail: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def loki_labels() -> str:
    """
    List all available label names in Loki.

    Labels are used to filter and query logs. Common labels include:
    - namespace: Kubernetes namespace
    - app: Application name
    - pod: Pod name
    - container: Container name
    - job: Prometheus job name
    """
    try:
        result = await loki_client.get_labels()

        if result.get("status") != "success":
            return f"Failed to get labels: {result.get('error', 'Unknown error')}"

        labels = result.get("data", [])

        output = [
            "=== Available Loki Labels ===",
            f"Total: {len(labels)}",
            "",
            "Labels:"
        ]

        for label in sorted(labels):
            output.append(f"  - {label}")

        output.append("")
        output.append("Example queries:")
        output.append('  {namespace="default"} - Logs from default namespace')
        output.append('  {app="nginx"} |= "error" - Error logs from nginx')

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in loki_labels: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def loki_label_values(
    label: str = Field(description="Label name to get values for (e.g., 'namespace', 'app', 'pod')")
) -> str:
    """
    Get all values for a specific label.

    Useful for discovering what applications, namespaces, or pods are sending logs.
    """
    try:
        result = await loki_client.get_label_values(label)

        if result.get("status") != "success":
            return f"Failed to get label values: {result.get('error', 'Unknown error')}"

        values = result.get("data", [])

        output = [
            f"=== Values for label '{label}' ===",
            f"Total: {len(values)}",
            ""
        ]

        for value in sorted(values):
            output.append(f"  - {value}")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in loki_label_values: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def loki_count_logs(
    query: str = Field(description="LogQL stream selector (e.g., '{app=\"nginx\"}')"),
    time_range: str = Field(default="1h", description="Time range to count over"),
    interval: str = Field(default="5m", description="Interval for counting (e.g., '1m', '5m', '15m')")
) -> str:
    """
    Count log entries over time.

    Returns the number of log lines per interval. Useful for identifying
    log volume spikes or quiet periods.
    """
    try:
        # Use count_over_time for aggregation
        metric_query = f'count_over_time({query}[{interval}])'

        result = await loki_client.query(metric_query, start=time_range, limit=1000)

        if result.get("status") != "success":
            return f"Query failed: {result.get('error', 'Unknown error')}"

        results = result.get("data", {}).get("result", [])

        if not results:
            return f"No data for query: {query}"

        output = [
            f"=== Log Count: {query} ===",
            f"Time range: last {time_range}",
            f"Interval: {interval}",
            "=" * 60,
            ""
        ]

        total_count = 0
        for stream_result in results:
            stream = stream_result.get("stream", {})
            values = stream_result.get("values", [])

            stream_labels = ", ".join(f'{k}="{v}"' for k, v in stream.items())
            output.append(f"Stream: {{{stream_labels}}}")

            for ts, count in values:
                ts_formatted = datetime.utcfromtimestamp(int(ts) // 1_000_000_000).strftime('%H:%M:%S')
                count_val = int(float(count))
                total_count += count_val
                bar = "#" * min(count_val // 10, 50)
                output.append(f"  {ts_formatted}: {count_val:>6} {bar}")
            output.append("")

        output.insert(4, f"Total entries: {total_count}")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in loki_count_logs: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def loki_log_rate(
    query: str = Field(description="LogQL stream selector"),
    time_range: str = Field(default="1h", description="Time range to analyze"),
    interval: str = Field(default="1m", description="Rate calculation interval")
) -> str:
    """
    Calculate log rate (lines per second) over time.

    Useful for detecting log volume anomalies and understanding traffic patterns.
    """
    try:
        metric_query = f'rate({query}[{interval}])'

        result = await loki_client.query(metric_query, start=time_range, limit=1000)

        if result.get("status") != "success":
            return f"Query failed: {result.get('error', 'Unknown error')}"

        results = result.get("data", {}).get("result", [])

        if not results:
            return f"No data for query: {query}"

        output = [
            f"=== Log Rate: {query} ===",
            f"Time range: last {time_range}",
            f"Interval: {interval}",
            "=" * 60,
            ""
        ]

        for stream_result in results:
            stream = stream_result.get("stream", {})
            values = stream_result.get("values", [])

            if not values:
                continue

            rates = [float(v[1]) for v in values]
            avg_rate = sum(rates) / len(rates)
            max_rate = max(rates)
            min_rate = min(rates)

            stream_labels = ", ".join(f'{k}="{v}"' for k, v in stream.items())
            output.append(f"Stream: {{{stream_labels}}}")
            output.append(f"  Avg rate: {avg_rate:.2f} lines/sec")
            output.append(f"  Max rate: {max_rate:.2f} lines/sec")
            output.append(f"  Min rate: {min_rate:.2f} lines/sec")
            output.append(f"  Data points: {len(values)}")
            output.append("")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in loki_log_rate: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def loki_context(
    query: str = Field(description="LogQL query that matches the log line of interest"),
    timestamp: str = Field(description="Timestamp of the log line (RFC3339 or Unix nanoseconds)"),
    before: int = Field(default=10, description="Number of lines before the match"),
    after: int = Field(default=10, description="Number of lines after the match")
) -> str:
    """
    Get log context around a specific log entry.

    Similar to 'grep -B -A', shows lines before and after a matching log entry.
    Useful for understanding what happened around an error.
    """
    try:
        # Parse the timestamp
        if timestamp.isdigit():
            ts_ns = int(timestamp)
        else:
            dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            ts_ns = int(dt.timestamp() * 1e9)

        # Get a window around the timestamp
        window_ns = 60 * 1e9  # 60 seconds window
        start_ns = str(ts_ns - int(window_ns))
        end_ns = str(ts_ns + int(window_ns))

        # Extract just the stream selector from the query
        selector_match = re.match(r'(\{[^}]+\})', query)
        if selector_match:
            selector = selector_match.group(1)
        else:
            selector = query

        result = await loki_client.query(
            selector,
            limit=before + after + 50,  # Get more than needed
            start=start_ns,
            end=end_ns,
            direction="forward"
        )

        if result.get("status") != "success":
            return f"Query failed: {result.get('error', 'Unknown error')}"

        results = result.get("data", {}).get("result", [])

        if not results:
            return f"No logs found around timestamp {timestamp}"

        # Collect all entries with timestamps
        all_entries = []
        for stream_result in results:
            stream = stream_result.get("stream", {})
            for entry in stream_result.get("values", []):
                entry_ts = int(entry[0]) if isinstance(entry, list) else 0
                all_entries.append((entry_ts, entry, stream))

        # Sort by timestamp
        all_entries.sort(key=lambda x: x[0])

        # Find the closest entry to our target timestamp
        closest_idx = 0
        min_diff = float('inf')
        for i, (entry_ts, _, _) in enumerate(all_entries):
            diff = abs(entry_ts - ts_ns)
            if diff < min_diff:
                min_diff = diff
                closest_idx = i

        # Get context window
        start_idx = max(0, closest_idx - before)
        end_idx = min(len(all_entries), closest_idx + after + 1)

        output = [
            f"=== Log Context ===",
            f"Query: {query}",
            f"Target timestamp: {timestamp}",
            f"Context: {before} lines before, {after} lines after",
            "=" * 60,
            ""
        ]

        for i in range(start_idx, end_idx):
            _, entry, stream = all_entries[i]
            formatted = format_log_entry(entry, stream)
            marker = ">>>" if i == closest_idx else "   "
            output.append(f"{marker} {formatted}")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in loki_context: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def loki_streams() -> str:
    """
    List all active log streams in Loki.

    Shows what applications and services are currently sending logs.
    Useful for discovering available log sources.
    """
    try:
        # Get series for the last hour
        result = await loki_client.get_series(['{job=~".+"}'], start="1h")

        if result.get("status") != "success":
            return f"Failed to get streams: {result.get('error', 'Unknown error')}"

        streams = result.get("data", [])

        if not streams:
            return "No active streams found"

        output = [
            "=== Active Log Streams ===",
            f"Total: {len(streams)}",
            "=" * 60,
            ""
        ]

        # Group by namespace/app
        by_namespace: Dict[str, List[Dict]] = {}
        for stream in streams:
            ns = stream.get("namespace", stream.get("job", "unknown"))
            if ns not in by_namespace:
                by_namespace[ns] = []
            by_namespace[ns].append(stream)

        for ns in sorted(by_namespace.keys()):
            ns_streams = by_namespace[ns]
            output.append(f"Namespace/Job: {ns} ({len(ns_streams)} streams)")

            # Group by app within namespace
            apps = set()
            for s in ns_streams:
                app = s.get("app", s.get("container", "unknown"))
                apps.add(app)

            for app in sorted(apps):
                output.append(f"  - {app}")
            output.append("")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in loki_streams: {e}")
        return f"Error: {str(e)}"


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

def main():
    """Run the MCP server"""
    logger.info(f"Starting Loki MCP Server (Loki URL: {LOKI_URL})")
    mcp.run()


if __name__ == "__main__":
    main()
