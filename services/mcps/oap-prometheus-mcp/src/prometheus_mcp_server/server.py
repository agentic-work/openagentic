# Proprietary and confidential. Unauthorized copying prohibited.

"""
Prometheus MCP Server - FastMCP Implementation

Provides tools to query Prometheus metrics, alerts, targets, and rules.
This enables LLMs to observe and analyze system metrics.

IMPORTANT: This MCP server is available to ADMIN users only.
"""

import os
import sys
import json
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta

import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

# Configure structured logging via shared observability module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-prometheus-mcp')
except ImportError:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        stream=sys.stderr
    )
    logger = logging.getLogger("prometheus-mcp")

# Initialize FastMCP server
mcp = FastMCP("Prometheus MCP Server - Query Metrics and Alerts")

# Prometheus configuration
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")


# ============================================================================
# PROMETHEUS CLIENT
# ============================================================================

class PrometheusClient:
    """Client for interacting with Prometheus API"""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=30.0)

    async def query(self, promql: str, time: Optional[str] = None) -> Dict[str, Any]:
        """Execute instant query"""
        params = {"query": promql}
        if time:
            params["time"] = time

        response = await self.client.get(
            f"{self.base_url}/api/v1/query",
            params=params
        )
        response.raise_for_status()
        return response.json()

    async def query_range(
        self,
        promql: str,
        start: str,
        end: str,
        step: str = "60s"
    ) -> Dict[str, Any]:
        """Execute range query"""
        response = await self.client.get(
            f"{self.base_url}/api/v1/query_range",
            params={
                "query": promql,
                "start": start,
                "end": end,
                "step": step
            }
        )
        response.raise_for_status()
        return response.json()

    async def get_alerts(self) -> Dict[str, Any]:
        """Get active alerts"""
        response = await self.client.get(f"{self.base_url}/api/v1/alerts")
        response.raise_for_status()
        return response.json()

    async def get_targets(self) -> Dict[str, Any]:
        """Get scrape targets"""
        response = await self.client.get(f"{self.base_url}/api/v1/targets")
        response.raise_for_status()
        return response.json()

    async def get_rules(self) -> Dict[str, Any]:
        """Get alerting and recording rules"""
        response = await self.client.get(f"{self.base_url}/api/v1/rules")
        response.raise_for_status()
        return response.json()

    async def get_labels(self, label_name: Optional[str] = None) -> Dict[str, Any]:
        """Get label names or values"""
        if label_name:
            response = await self.client.get(
                f"{self.base_url}/api/v1/label/{label_name}/values"
            )
        else:
            response = await self.client.get(f"{self.base_url}/api/v1/labels")
        response.raise_for_status()
        return response.json()

    async def get_metadata(self, metric: Optional[str] = None) -> Dict[str, Any]:
        """Get metric metadata"""
        params = {}
        if metric:
            params["metric"] = metric

        response = await self.client.get(
            f"{self.base_url}/api/v1/metadata",
            params=params
        )
        response.raise_for_status()
        return response.json()

    async def get_series(
        self,
        match: List[str],
        start: Optional[str] = None,
        end: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get time series matching selectors"""
        params = {"match[]": match}
        if start:
            params["start"] = start
        if end:
            params["end"] = end

        response = await self.client.get(
            f"{self.base_url}/api/v1/series",
            params=params
        )
        response.raise_for_status()
        return response.json()


# Global client instance
prometheus_client = PrometheusClient(PROMETHEUS_URL)


# ============================================================================
# TOOL DEFINITIONS
# ============================================================================

@mcp.tool()
async def prometheus_query(
    query: str = Field(description="PromQL query to execute (e.g., 'http_requests_total', 'rate(http_requests_total[5m])')"),
    time: Optional[str] = Field(default=None, description="Evaluation timestamp (RFC3339 or Unix timestamp). Defaults to current time.")
) -> str:
    """
    Execute an instant PromQL query against Prometheus to check infrastructure metrics.

    Use this tool to query CPU usage, memory consumption, disk I/O, network traffic,
    pod resource utilization, container metrics, request latency, error rates, throughput,
    and any other Prometheus metric. Returns current point-in-time metric values.

    Common use cases:
    - CPU usage per pod/container/node
    - Memory consumption and OOM risk
    - Disk usage and I/O rates
    - Network bandwidth and packet rates
    - HTTP request rates, error rates, latency percentiles
    - Container restarts, pod status, node health
    - Custom application metrics

    Example queries:
    - container_cpu_usage_seconds_total
    - container_memory_usage_bytes
    - rate(http_requests_total[5m])
    - sum(rate(http_requests_total[5m])) by (status_code)
    """
    try:
        result = await prometheus_client.query(query, time)

        if result.get("status") != "success":
            return f"Query failed: {result.get('error', 'Unknown error')}"

        data = result.get("data", {})
        result_type = data.get("resultType", "unknown")
        results = data.get("result", [])

        output = [f"Query: {query}", f"Result Type: {result_type}", f"Results: {len(results)}", ""]

        for r in results[:50]:  # Limit to 50 results
            metric = r.get("metric", {})
            value = r.get("value", [])
            if value and len(value) == 2:
                metric_str = json.dumps(metric) if metric else "{}"
                output.append(f"  {metric_str}: {value[1]}")

        return "\n".join(output)

    except httpx.HTTPError as e:
        return f"HTTP error querying Prometheus: {str(e)}"
    except Exception as e:
        logger.error(f"Error in prometheus_query: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def prometheus_query_range(
    query: str = Field(description="PromQL query to execute"),
    start: str = Field(description="Start timestamp (RFC3339 or Unix timestamp, e.g., '2024-01-01T00:00:00Z' or '1704067200')"),
    end: str = Field(description="End timestamp (RFC3339 or Unix timestamp)"),
    step: str = Field(default="60s", description="Query resolution step (e.g., '15s', '1m', '5m')")
) -> str:
    """
    Execute a range PromQL query against Prometheus for time-series analysis.

    Returns metric values over a time range with the specified step interval.
    Use for analyzing CPU usage trends, memory consumption over time, latency patterns,
    throughput history, error rate spikes, resource utilization trends, and capacity planning.

    Example:
    - Query: rate(container_cpu_usage_seconds_total[5m])
    - Start: 2024-01-01T00:00:00Z
    - End: 2024-01-01T01:00:00Z
    - Step: 1m
    """
    try:
        result = await prometheus_client.query_range(query, start, end, step)

        if result.get("status") != "success":
            return f"Query failed: {result.get('error', 'Unknown error')}"

        data = result.get("data", {})
        results = data.get("result", [])

        output = [
            f"Query: {query}",
            f"Range: {start} to {end}",
            f"Step: {step}",
            f"Series: {len(results)}",
            ""
        ]

        for r in results[:10]:  # Limit to 10 series
            metric = r.get("metric", {})
            values = r.get("values", [])
            metric_str = json.dumps(metric) if metric else "{}"
            output.append(f"Series: {metric_str}")
            output.append(f"  Data points: {len(values)}")
            if values:
                output.append(f"  First: {values[0][1]} at {datetime.fromtimestamp(values[0][0])}")
                output.append(f"  Last: {values[-1][1]} at {datetime.fromtimestamp(values[-1][0])}")
            output.append("")

        return "\n".join(output)

    except httpx.HTTPError as e:
        return f"HTTP error querying Prometheus: {str(e)}"
    except Exception as e:
        logger.error(f"Error in prometheus_query_range: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def prometheus_alerts() -> str:
    """
    Get all active alerts from Prometheus for incident detection.

    Returns firing and pending alerts with severity, labels, and annotations.
    Use to check for CPU/memory/disk alerts, pod crash alerts, high error rate alerts,
    node down alerts, certificate expiry warnings, and any infrastructure issues.
    """
    try:
        result = await prometheus_client.get_alerts()

        if result.get("status") != "success":
            return f"Failed to get alerts: {result.get('error', 'Unknown error')}"

        alerts = result.get("data", {}).get("alerts", [])

        if not alerts:
            return "No active alerts"

        output = [f"Active Alerts: {len(alerts)}", ""]

        firing = [a for a in alerts if a.get("state") == "firing"]
        pending = [a for a in alerts if a.get("state") == "pending"]

        if firing:
            output.append(f"FIRING ({len(firing)}):")
            for alert in firing:
                output.append(f"  - {alert.get('labels', {}).get('alertname', 'Unknown')}")
                output.append(f"    Severity: {alert.get('labels', {}).get('severity', 'unknown')}")
                output.append(f"    Summary: {alert.get('annotations', {}).get('summary', 'N/A')}")
                output.append("")

        if pending:
            output.append(f"PENDING ({len(pending)}):")
            for alert in pending:
                output.append(f"  - {alert.get('labels', {}).get('alertname', 'Unknown')}")
                output.append("")

        return "\n".join(output)

    except httpx.HTTPError as e:
        return f"HTTP error getting alerts: {str(e)}"
    except Exception as e:
        logger.error(f"Error in prometheus_alerts: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def prometheus_targets() -> str:
    """
    Get all Prometheus scrape targets and their health status.

    Returns which services, pods, and endpoints Prometheus is monitoring,
    whether they are up or down, and any scrape errors. Use to check
    if monitoring is working for specific services or infrastructure components.
    """
    try:
        result = await prometheus_client.get_targets()

        if result.get("status") != "success":
            return f"Failed to get targets: {result.get('error', 'Unknown error')}"

        active = result.get("data", {}).get("activeTargets", [])
        dropped = result.get("data", {}).get("droppedTargets", [])

        output = [
            f"Active Targets: {len(active)}",
            f"Dropped Targets: {len(dropped)}",
            ""
        ]

        # Group by job
        by_job: Dict[str, List] = {}
        for target in active:
            job = target.get("labels", {}).get("job", "unknown")
            if job not in by_job:
                by_job[job] = []
            by_job[job].append(target)

        for job, targets in by_job.items():
            up_count = sum(1 for t in targets if t.get("health") == "up")
            output.append(f"Job: {job} ({up_count}/{len(targets)} up)")

            for target in targets:
                health = target.get("health", "unknown")
                instance = target.get("labels", {}).get("instance", "unknown")
                last_scrape = target.get("lastScrape", "N/A")
                error = target.get("lastError", "")

                status_icon = "✓" if health == "up" else "✗"
                output.append(f"  {status_icon} {instance} - {health}")
                if error:
                    output.append(f"      Error: {error}")
            output.append("")

        return "\n".join(output)

    except httpx.HTTPError as e:
        return f"HTTP error getting targets: {str(e)}"
    except Exception as e:
        logger.error(f"Error in prometheus_targets: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def prometheus_metrics_list(
    filter: Optional[str] = Field(default=None, description="Optional filter pattern to match metric names (e.g., 'http_' or 'memory')")
) -> str:
    """
    List all available Prometheus metric names for discovery.

    Discover what CPU, memory, disk, network, container, pod, node, and application
    metrics are being collected. Filter by pattern to find specific metrics.
    Use this before prometheus_query when you need to find the right metric name.
    """
    try:
        result = await prometheus_client.get_labels("__name__")

        if result.get("status") != "success":
            return f"Failed to get metrics: {result.get('error', 'Unknown error')}"

        metrics = result.get("data", [])

        if filter:
            metrics = [m for m in metrics if filter.lower() in m.lower()]

        output = [f"Available Metrics: {len(metrics)}", ""]

        # Group by prefix
        prefixes: Dict[str, List[str]] = {}
        for metric in metrics:
            prefix = metric.split("_")[0] if "_" in metric else metric
            if prefix not in prefixes:
                prefixes[prefix] = []
            prefixes[prefix].append(metric)

        for prefix in sorted(prefixes.keys()):
            prefix_metrics = prefixes[prefix]
            output.append(f"{prefix}_* ({len(prefix_metrics)} metrics)")
            for m in prefix_metrics[:5]:  # Show first 5 of each prefix
                output.append(f"  - {m}")
            if len(prefix_metrics) > 5:
                output.append(f"  ... and {len(prefix_metrics) - 5} more")
            output.append("")

        return "\n".join(output)

    except httpx.HTTPError as e:
        return f"HTTP error getting metrics list: {str(e)}"
    except Exception as e:
        logger.error(f"Error in prometheus_metrics_list: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def prometheus_metric_info(
    metric: str = Field(description="Name of the metric to get info about")
) -> str:
    """
    Get metadata and current values for a specific metric.

    Returns the metric type, help text, and current values.
    """
    try:
        # Get metadata
        metadata = await prometheus_client.get_metadata(metric)
        meta_data = metadata.get("data", {}).get(metric, [{}])[0]

        # Get current values
        values = await prometheus_client.query(metric)
        value_data = values.get("data", {}).get("result", [])

        output = [
            f"Metric: {metric}",
            f"Type: {meta_data.get('type', 'unknown')}",
            f"Help: {meta_data.get('help', 'No description')}",
            f"Unit: {meta_data.get('unit', 'N/A')}",
            "",
            f"Current Values ({len(value_data)} series):",
        ]

        for v in value_data[:20]:  # Limit to 20 series
            labels = v.get("metric", {})
            value = v.get("value", [None, None])[1]
            label_str = ", ".join(f'{k}="{v}"' for k, v in labels.items() if k != "__name__")
            output.append(f"  {{{label_str}}}: {value}")

        if len(value_data) > 20:
            output.append(f"  ... and {len(value_data) - 20} more series")

        return "\n".join(output)

    except httpx.HTTPError as e:
        return f"HTTP error getting metric info: {str(e)}"
    except Exception as e:
        logger.error(f"Error in prometheus_metric_info: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def prometheus_rules() -> str:
    """
    Get all alerting and recording rules from Prometheus.

    Shows configured alert rules and their states.
    """
    try:
        result = await prometheus_client.get_rules()

        if result.get("status") != "success":
            return f"Failed to get rules: {result.get('error', 'Unknown error')}"

        groups = result.get("data", {}).get("groups", [])

        if not groups:
            return "No rules configured"

        output = [f"Rule Groups: {len(groups)}", ""]

        for group in groups:
            name = group.get("name", "unnamed")
            rules = group.get("rules", [])

            output.append(f"Group: {name}")
            output.append(f"  File: {group.get('file', 'N/A')}")
            output.append(f"  Rules: {len(rules)}")

            alert_rules = [r for r in rules if r.get("type") == "alerting"]
            record_rules = [r for r in rules if r.get("type") == "recording"]

            if alert_rules:
                output.append(f"  Alerting Rules ({len(alert_rules)}):")
                for rule in alert_rules:
                    state = rule.get("state", "unknown")
                    name = rule.get("name", "unnamed")
                    output.append(f"    - {name} [{state}]")

            if record_rules:
                output.append(f"  Recording Rules ({len(record_rules)}):")
                for rule in record_rules[:5]:
                    name = rule.get("name", "unnamed")
                    output.append(f"    - {name}")
                if len(record_rules) > 5:
                    output.append(f"    ... and {len(record_rules) - 5} more")

            output.append("")

        return "\n".join(output)

    except httpx.HTTPError as e:
        return f"HTTP error getting rules: {str(e)}"
    except Exception as e:
        logger.error(f"Error in prometheus_rules: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def prometheus_health_summary() -> str:
    """
    Get a quick health summary of the monitored services.

    Aggregates key metrics to provide an overview of system health:
    - Target status (up/down)
    - Active alerts
    - Key performance metrics
    """
    try:
        output = ["=== Prometheus Health Summary ===", ""]

        # Get targets
        targets_result = await prometheus_client.get_targets()
        active_targets = targets_result.get("data", {}).get("activeTargets", [])
        up_targets = sum(1 for t in active_targets if t.get("health") == "up")
        down_targets = len(active_targets) - up_targets

        output.append(f"Targets: {up_targets} up, {down_targets} down")

        if down_targets > 0:
            output.append("  Down targets:")
            for t in active_targets:
                if t.get("health") != "up":
                    output.append(f"    - {t.get('labels', {}).get('job', 'unknown')}: {t.get('labels', {}).get('instance', 'unknown')}")
        output.append("")

        # Get alerts
        alerts_result = await prometheus_client.get_alerts()
        alerts = alerts_result.get("data", {}).get("alerts", [])
        firing = sum(1 for a in alerts if a.get("state") == "firing")
        pending = sum(1 for a in alerts if a.get("state") == "pending")

        output.append(f"Alerts: {firing} firing, {pending} pending")
        if firing > 0:
            output.append("  Firing alerts:")
            for a in alerts:
                if a.get("state") == "firing":
                    output.append(f"    - {a.get('labels', {}).get('alertname', 'Unknown')}")
        output.append("")

        # Get key metrics
        key_queries = [
            ("HTTP Request Rate (5m)", "sum(rate(http_requests_total[5m]))"),
            ("Error Rate (5m)", "sum(rate(http_requests_total{status_code=~\"5..\"}[5m]))"),
            ("Active Sessions", "sum(active_users_current) or vector(0)"),
        ]

        output.append("Key Metrics:")
        for name, query in key_queries:
            try:
                result = await prometheus_client.query(query)
                value = result.get("data", {}).get("result", [{}])[0].get("value", [None, "N/A"])[1]
                output.append(f"  {name}: {value}")
            except Exception:
                output.append(f"  {name}: unavailable")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in prometheus_health_summary: {e}")
        return f"Error generating health summary: {str(e)}"


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

def main():
    """Run the MCP server"""
    logger.info(f"Starting Prometheus MCP Server (Prometheus URL: {PROMETHEUS_URL})")
    mcp.run()


if __name__ == "__main__":
    main()
