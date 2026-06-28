"""Azure MCP — cost tools.

Cost Management query/forecast tools.
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
    'azure_cost_query',
    'azure_cost_by_service',
    'azure_cost_forecast',
    'azure_cost_forecast_for_resource_group',
]


def _resolve_cost_subscriptions(
    subscription_id: Optional[str],
    credential: Any,
) -> List[str]:
    """
    Resolve which Azure subscriptions a cost query should target.

    Q1-blocker-1 (2026-05-12): models invoke cost tools without
    `subscription_id`. Previously the tool fell back to `DEFAULT_SUBSCRIPTION_ID`
    (empty string in openagentic), built scope=`/subscriptions/`, and the
    Azure SDK collapsed `/subscriptions//providers/...` so Azure returned
    `InvalidSubscriptionId 'providers' is malformed`.

    Resolution order:
      1. Explicit `subscription_id` argument (single-sub mode).
      2. `DEFAULT_SUBSCRIPTION_ID` env var if non-empty (single-sub mode).
      3. SubscriptionClient.list() via the service principal (fan-out mode).

    Returns the list of subscription UUIDs to query. Raises ValueError if
    the user has no visible subscriptions — the caller turns that into a
    `{success: False}` response, never a malformed Azure URL.
    """
    if subscription_id:
        return [subscription_id]
    if DEFAULT_SUBSCRIPTION_ID:
        return [DEFAULT_SUBSCRIPTION_ID]

    sub_client = SubscriptionClient(credential)
    subs = [s.subscription_id for s in sub_client.subscriptions.list() if s.subscription_id]
    if not subs:
        raise ValueError(
            "No subscription_id provided and the caller has no visible Azure "
            "subscriptions (the service principal sees none). Pass `subscription_id` "
            "explicitly or call `azure_list_subscriptions` to see what's available."
        )
    return subs


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
async def azure_cost_query(
    days: int = 30,
    granularity: str = "Daily",
    group_by: Optional[List[str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Query Azure costs with flexible parameters.

    Args:
        days: Number of days to query (default 30)
        granularity: Time granularity - 'Daily', 'Monthly', or 'None'
        group_by: List of dimensions to group by (e.g., ['ResourceType', 'ResourceGroup'])
        subscription_id: Optional Azure subscription ID. When omitted, the
            tool auto-resolves the service principal's visible subscriptions
            and fans the cost query across each, returning aggregated data.
            Pass an explicit UUID to scope to one subscription.
    """
    user_info: Optional[dict] = None
    try:
        credential, user_info = require_user_token(meta)
        sub_ids = _resolve_cost_subscriptions(subscription_id, credential)

        client = CostManagementClient(credential)

        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)

        # Build query definition
        query_def = {
            "type": "ActualCost",
            "timeframe": "Custom",
            "time_period": {
                "from": start_date.strftime("%Y-%m-%dT00:00:00Z"),
                "to": end_date.strftime("%Y-%m-%dT23:59:59Z")
            },
            "dataset": {
                "granularity": granularity,
                "aggregation": {
                    "totalCost": {"name": "Cost", "function": "Sum"},
                    "totalCostUSD": {"name": "CostUSD", "function": "Sum"}
                }
            }
        }

        if group_by:
            query_def["dataset"]["grouping"] = [
                {"type": "Dimension", "name": dim} for dim in group_by
            ]

        all_rows: List[Any] = []
        columns: List[str] = []
        per_sub: List[Dict[str, Any]] = []

        for sid in sub_ids:
            scope = f"/subscriptions/{sid}"
            result = client.query.usage(scope, query_def)
            sub_cols = [col.name for col in result.columns] if result.columns else []
            sub_rows = result.rows or []
            if not columns:
                columns = sub_cols
            all_rows.extend(sub_rows)
            per_sub.append({"subscription_id": sid, "row_count": len(sub_rows)})

        return {
            "success": True,
            "period": f"Last {days} days",
            "from_date": start_date.strftime("%Y-%m-%d"),
            "to_date": end_date.strftime("%Y-%m-%d"),
            "granularity": granularity,
            "columns": columns,
            "subscription_count": len(sub_ids),
            "subscriptions": per_sub,
            "row_count": len(all_rows),
            "data": all_rows[:100],  # Limit to first 100 rows
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info)


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
async def azure_cost_by_service(
    days: int = 30,
    top_n: int = 10,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get cost breakdown by Azure service.

    Args:
        days: Number of days to analyze
        top_n: Number of top services to return
        subscription_id: Optional Azure subscription ID. When omitted, the
            tool auto-resolves the service principal's visible subscriptions,
            queries each, and returns top services aggregated across all
            of them. Pass an explicit UUID to scope to one subscription.
    """
    user_info: Optional[dict] = None
    try:
        credential, user_info = require_user_token(meta)
        sub_ids = _resolve_cost_subscriptions(subscription_id, credential)

        client = CostManagementClient(credential)

        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)

        query_def = {
            "type": "ActualCost",
            "timeframe": "Custom",
            "time_period": {
                "from": start_date.strftime("%Y-%m-%dT00:00:00Z"),
                "to": end_date.strftime("%Y-%m-%dT23:59:59Z")
            },
            "dataset": {
                "granularity": "None",
                "aggregation": {
                    "totalCost": {"name": "CostUSD", "function": "Sum"}
                },
                "grouping": [{"type": "Dimension", "name": "ServiceName"}],
                "sorting": [{"direction": "descending", "name": "CostUSD"}]
            }
        }

        # Aggregate cost per service across every subscription.
        agg: Dict[str, float] = {}
        for sid in sub_ids:
            scope = f"/subscriptions/{sid}"
            result = client.query.usage(scope, query_def)
            for row in (result.rows or []):
                cost = row[0] if len(row) > 0 else 0
                service = row[1] if len(row) > 1 else "Unknown"
                agg[service] = agg.get(service, 0.0) + float(cost)

        # Top-N by aggregated cost.
        ranked = sorted(agg.items(), key=lambda kv: kv[1], reverse=True)[:top_n]
        services = [{"service": s, "cost": round(c, 2)} for s, c in ranked]
        total_cost = sum(c for _, c in ranked)

        return {
            "success": True,
            "period": f"Last {days} days",
            "subscription_count": len(sub_ids),
            "subscriptions": [{"subscription_id": s} for s in sub_ids],
            "total_cost": round(total_cost, 2),
            "currency": "USD",
            "top_services": services,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info)


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
async def azure_cost_forecast(
    forecast_days: int = 30,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get cost forecast based on historical spending.

    Args:
        forecast_days: Number of days to forecast
        subscription_id: Optional Azure subscription ID. When omitted, the
            tool auto-resolves the service principal's visible subscriptions
            and sums forecasted spend across each. Pass an explicit UUID to
            scope to one subscription.
    """
    user_info: Optional[dict] = None
    try:
        credential, user_info = require_user_token(meta)
        sub_ids = _resolve_cost_subscriptions(subscription_id, credential)

        client = CostManagementClient(credential)

        start_date = datetime.now(timezone.utc)
        end_date = start_date + timedelta(days=forecast_days)

        query_def = {
            "type": "Usage",
            "timeframe": "Custom",
            "time_period": {
                "from": start_date.strftime("%Y-%m-%dT00:00:00Z"),
                "to": end_date.strftime("%Y-%m-%dT23:59:59Z")
            },
            "dataset": {
                "granularity": "Daily",
                "aggregation": {
                    "totalCost": {"name": "Cost", "function": "Sum"}
                }
            }
        }

        forecasted_total = 0.0
        total_points = 0
        for sid in sub_ids:
            scope = f"/subscriptions/{sid}"
            result = client.forecast.usage(scope, query_def)
            rows = result.rows or []
            total_points += len(rows)
            forecasted_total += sum(row[0] for row in rows if len(row) > 0)

        return {
            "success": True,
            "forecast_period": f"Next {forecast_days} days",
            "from_date": start_date.strftime("%Y-%m-%d"),
            "to_date": end_date.strftime("%Y-%m-%d"),
            "subscription_count": len(sub_ids),
            "subscriptions": [{"subscription_id": s} for s in sub_ids],
            "forecasted_total": round(forecasted_total, 2),
            "currency": "USD",
            "daily_data_points": total_points,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info)


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
async def azure_cost_forecast_for_resource_group(
    resource_group: str,
    forecast_days: int = 30,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Forecast cost for a specific resource group over the next N days.
    The original azure_cost_forecast tool only scopes to subscription level —
    this tool drops the scope down to a resource group.

    Use this for queries like "forecast monthly cost for resource group X in subscription Y".

    Args:
        resource_group: The resource group name
        forecast_days: Number of days to forecast (default 30)
        subscription_id: Subscription containing the RG
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        client = CostManagementClient(credential)
        from datetime import timezone
        start_date = datetime.now(timezone.utc)
        end_date = start_date + timedelta(days=forecast_days)

        query_def = {
            "type": "Usage",
            "timeframe": "Custom",
            "time_period": {
                "from": start_date.strftime("%Y-%m-%dT00:00:00Z"),
                "to": end_date.strftime("%Y-%m-%dT23:59:59Z")
            },
            "dataset": {
                "granularity": "Daily",
                "aggregation": {"totalCost": {"name": "Cost", "function": "Sum"}}
            }
        }

        scope = f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
        result = client.forecast.usage(scope, query_def)

        rows = result.rows or []
        forecasted_total = sum(row[0] for row in rows if len(row) > 0)
        return {
            "success": True,
            "subscription_id": sub_id,
            "resource_group": resource_group,
            "forecast_period": f"Next {forecast_days} days",
            "from_date": start_date.strftime("%Y-%m-%d"),
            "to_date": end_date.strftime("%Y-%m-%d"),
            "forecasted_total": round(forecasted_total, 2),
            "currency": "USD",
            "daily_data_points": len(rows),
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)
