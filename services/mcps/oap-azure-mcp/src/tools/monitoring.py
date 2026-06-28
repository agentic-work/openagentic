"""Azure MCP — monitoring tools.

Alerts, Log Analytics, App Insights, activity log, metrics.
"""

import os
import sys
import json
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, List

# Make the package root importable so `from _core import *` resolves both
# under `python -m src.server` (Docker) and `import server` (tests).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _core import *  # noqa: F401,F403

__all__ = [
    'azure_list_alerts',
    'azure_log_analytics_list_workspaces',
    'azure_log_analytics_query',
    'azure_app_insights_list_components',
    'azure_app_insights_query',
    'azure_activity_log',
    'azure_get_metrics',
]


@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my alerts", "show me alerts", "what alerts do i have"],
        "testFixture": None,
    },
)
async def azure_list_alerts(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List metric alert rules.

    Args:
        resource_group: Filter by resource group
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = MonitorManagementClient(credential, sub_id)

        if resource_group:
            alerts = list(client.metric_alerts.list_by_resource_group(resource_group))
        else:
            alerts = list(client.metric_alerts.list_by_subscription())

        return {
            "success": True,
            "count": len(alerts),
            "alerts": [
                {
                    "name": alert.name,
                    "location": alert.location,
                    "resource_group": alert.id.split('/')[4] if alert.id else None,
                    "severity": alert.severity,
                    "enabled": alert.enabled,
                    "description": alert.description,
                    "scopes": alert.scopes,
                    "tags": alert.tags or {}
                }
                for alert in alerts
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)


@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_log_analytics_list_workspaces(
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Log Analytics workspaces in a subscription or resource group (typed SDK).
    Returns workspace IDs, locations, retention, and SKU. You need a workspace_id
    (the customer_id GUID) to run azure_log_analytics_query against it.

    Args:
        subscription_id: Azure subscription ID
        resource_group: Optional resource group filter
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = LogAnalyticsManagementClient(credential, sub_id)
        it = client.workspaces.list_by_resource_group(resource_group) if resource_group else client.workspaces.list()
        workspaces = []
        for w in it:
            workspaces.append({
                "name": w.name,
                "id": w.id,
                "customer_id": getattr(w, "customer_id", None),
                "location": w.location,
                "retention_in_days": getattr(w, "retention_in_days", None),
                "sku": getattr(getattr(w, "sku", None), "name", None),
                "provisioning_state": getattr(w, "provisioning_state", None),
            })
        return {"success": True, "count": len(workspaces), "workspaces": workspaces, "executed_as": user_info}
    except Exception as e:
        return {"success": False, "error": str(e), "executed_as": user_info if 'user_info' in dir() else None}


@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_log_analytics_query(
    workspace_id: str,
    kql_query: str,
    timespan_hours: Optional[int] = 24,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Run a KQL query against a Log Analytics workspace (typed SDK via LogsQueryClient).
    Returns columns + rows for the first result table. Use for log investigation,
    security event hunting, operational troubleshooting (UC-027, UC-028).

    Args:
        workspace_id: The workspace customer_id GUID (NOT the full ARM resource ID).
                      Get it from azure_log_analytics_list_workspaces.
        kql_query: KQL query string, e.g. "AzureActivity | take 50"
        timespan_hours: Query timespan in hours (default 24)
    """
    try:
        credential, user_info = require_user_token(meta)
        client = LogsQueryClient(credential)
        response = client.query_workspace(
            workspace_id=workspace_id,
            query=kql_query,
            timespan=timedelta(hours=timespan_hours or 24),
        )
        if response.status == LogsQueryStatus.PARTIAL:
            tables = response.partial_data
            error = str(response.partial_error) if response.partial_error else None
        else:
            tables = response.tables
            error = None
        if not tables:
            return {"success": True, "columns": [], "rows": [], "row_count": 0, "error": error, "executed_as": user_info}
        t = tables[0]
        columns = [c for c in t.columns]
        rows = [list(r) for r in t.rows]
        return {
            "success": True,
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "error": error,
            "executed_as": user_info,
        }
    except Exception as e:
        return {"success": False, "error": str(e), "executed_as": user_info if 'user_info' in dir() else None}


@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_app_insights_list_components(
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Application Insights components in a subscription or resource group (typed SDK).
    Returns app_id (for query), instrumentation_key, location, and kind.

    Args:
        subscription_id: Azure subscription ID
        resource_group: Optional resource group filter
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = ApplicationInsightsManagementClient(credential, sub_id)
        it = client.components.list_by_resource_group(resource_group) if resource_group else client.components.list()
        components = []
        for c in it:
            components.append({
                "name": c.name,
                "id": c.id,
                "app_id": getattr(c, "app_id", None),
                "instrumentation_key": getattr(c, "instrumentation_key", None),
                "location": c.location,
                "kind": getattr(c, "kind", None),
                "application_type": getattr(c, "application_type", None),
                "retention_in_days": getattr(c, "retention_in_days", None),
            })
        return {"success": True, "count": len(components), "components": components, "executed_as": user_info}
    except Exception as e:
        return {"success": False, "error": str(e), "executed_as": user_info if 'user_info' in dir() else None}


@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_app_insights_query(
    app_id: str,
    kql_query: str,
    timespan_hours: Optional[int] = 24,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Run a KQL query against an Application Insights component (typed SDK).
    App Insights shares the Log Analytics query engine, so we use LogsQueryClient
    against the component's resource ID. Use for app-level telemetry queries:
    requests, dependencies, exceptions, traces, customEvents, pageViews.

    Args:
        app_id: Full ARM resource ID of the App Insights component
                (e.g. /subscriptions/{id}/resourceGroups/{rg}/providers/microsoft.insights/components/{name})
                Get it from azure_app_insights_list_components (the `id` field).
        kql_query: KQL query string, e.g. "requests | take 50"
        timespan_hours: Query timespan in hours (default 24)
    """
    try:
        credential, user_info = require_user_token(meta)
        client = LogsQueryClient(credential)
        response = client.query_resource(
            resource_id=app_id,
            query=kql_query,
            timespan=timedelta(hours=timespan_hours or 24),
        )
        if response.status == LogsQueryStatus.PARTIAL:
            tables = response.partial_data
            error = str(response.partial_error) if response.partial_error else None
        else:
            tables = response.tables
            error = None
        if not tables:
            return {"success": True, "columns": [], "rows": [], "row_count": 0, "error": error, "executed_as": user_info}
        t = tables[0]
        columns = [c for c in t.columns]
        rows = [list(r) for r in t.rows]
        return {
            "success": True,
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "error": error,
            "executed_as": user_info,
        }
    except Exception as e:
        return {"success": False, "error": str(e), "executed_as": user_info if 'user_info' in dir() else None}


@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 5000,
        "failureModes": ["auth_expired"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_activity_log(
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    hours: int = 24,
    filter_operations: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Query Azure Activity Log (audit log) for recent operations.

    Returns create, delete, update, and action events from the Azure
    control plane. Use this to see what changed in your tenant.

    Args:
        subscription_id: Subscription to query
        resource_group: Optional — filter to a specific resource group
        hours: How many hours back to look (default 24)
        filter_operations: Optional comma-separated operation filter
            (e.g., 'Microsoft.Resources/subscriptions/resourceGroups/write,Microsoft.Compute/virtualMachines/delete')
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        client = MonitorManagementClient(credential, sub_id)

        from datetime import datetime, timedelta, timezone
        end_time = datetime.now(timezone.utc)
        start_time = end_time - timedelta(hours=hours)

        # Build OData filter
        odata_filter = f"eventTimestamp ge '{start_time.isoformat()}' and eventTimestamp le '{end_time.isoformat()}'"
        if resource_group:
            odata_filter += f" and resourceGroupName eq '{resource_group}'"

        events = []
        for event in client.activity_logs.list(filter=odata_filter):
            op = event.operation_name.value if event.operation_name else ''
            if filter_operations:
                allowed = [o.strip().lower() for o in filter_operations.split(',')]
                if not any(a in op.lower() for a in allowed):
                    continue
            events.append({
                "timestamp": event.event_timestamp.isoformat() if event.event_timestamp else None,
                "operation": op,
                "status": event.status.value if event.status else None,
                "resource_id": event.resource_id,
                "resource_type": event.resource_type.value if event.resource_type else None,
                "resource_group": event.resource_group_name,
                "caller": event.caller,
                "level": event.level.value if event.level else None,
                "description": event.description,
            })
            if len(events) >= 500:
                break

        # Categorize
        creates = [e for e in events if e['operation'] and ('write' in e['operation'].lower() or 'create' in e['operation'].lower()) and e['status'] == 'Succeeded']
        deletes = [e for e in events if e['operation'] and 'delete' in e['operation'].lower() and e['status'] == 'Succeeded']
        failures = [e for e in events if e['status'] and e['status'] != 'Succeeded']

        return {
            "success": True,
            "subscription_id": sub_id,
            "time_range": f"Last {hours} hours",
            "total_events": len(events),
            "summary": {
                "creates_and_updates": len(creates),
                "deletes": len(deletes),
                "failures": len(failures),
            },
            "events": events[:100],  # Return first 100 for display
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)


@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["get metrics details", "show me one metrics"],
        "testFixture": None,
    },
)
async def azure_get_metrics(
    resource_id: str,
    metric_names: str = "Percentage CPU",
    timespan: str = "PT1H",
    interval: str = "PT5M",
    aggregation: str = "Average",
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get Azure Monitor metrics for any resource.

    Works with VMs, App Gateways, Front Door, Storage, AKS, etc.

    Args:
        resource_id: Full ARM resource ID (e.g., /subscriptions/.../resourceGroups/.../providers/...)
        metric_names: Comma-separated metric names.
            VMs: 'Percentage CPU', 'Available Memory Bytes', 'Network In Total'
            App GW: 'TotalRequests', 'HealthyHostCount', 'UnhealthyHostCount', 'Throughput'
            Front Door: 'RequestCount', 'TotalLatency', 'WebApplicationFirewallRequestCount'
            Storage: 'UsedCapacity', 'Transactions', 'Ingress', 'Egress'
        timespan: ISO 8601 duration — PT1H (1 hour), PT24H (24 hours), P7D (7 days)
        interval: Granularity — PT1M, PT5M, PT15M, PT1H
        aggregation: Average, Total, Maximum, Minimum, Count
        subscription_id: Subscription (extracted from resource_id if not provided)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        # Extract subscription from resource_id if possible
        if '/subscriptions/' in resource_id:
            parts = resource_id.split('/')
            idx = parts.index('subscriptions')
            if idx + 1 < len(parts):
                sub_id = parts[idx + 1]

        client = MonitorManagementClient(credential, sub_id)

        response = client.metrics.list(
            resource_uri=resource_id,
            metricnames=metric_names,
            timespan=timespan,
            interval=interval,
            aggregation=aggregation,
        )

        metrics = []
        for metric in response.value:
            timeseries_data = []
            for ts in (metric.timeseries or []):
                for dp in (ts.data or []):
                    val = getattr(dp, aggregation.lower(), None) or dp.average or dp.total or dp.maximum
                    if val is not None:
                        timeseries_data.append({
                            "timestamp": dp.time_stamp.isoformat() if dp.time_stamp else None,
                            "value": val,
                        })
            metrics.append({
                "name": metric.name.value if metric.name else '',
                "unit": metric.unit.value if metric.unit else '',
                "datapoints": timeseries_data[-20:],  # Last 20 data points
            })

        return {
            "success": True,
            "resource_id": resource_id,
            "timespan": timespan,
            "interval": interval,
            "aggregation": aggregation,
            "metrics": metrics,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)
