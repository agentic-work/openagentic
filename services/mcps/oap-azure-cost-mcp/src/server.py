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
OpenAgentic Azure Cost MCP Server - Azure Cost Management Operations

Provides tools for Azure Cost Management:
1. azure_cost_query - Query cost data with custom time ranges and grouping
2. azure_cost_breakdown - Get cost breakdown by resource type, location, or tags
3. azure_cost_forecast - Get cost forecasts based on historical data

Uses OBO (On-Behalf-Of) authentication so operations run as the user.
"""

import os
import json
import logging
import httpx
from typing import Any, Dict, Optional, List
from datetime import datetime, timedelta

from mcp.server.fastmcp import FastMCP
from azure.identity import OnBehalfOfCredential, ClientSecretCredential

# =============================================================================
# CONFIGURATION
# =============================================================================

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-azure-cost-mcp')
except ImportError:
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("oap-azure-cost-mcp")

TENANT_ID = os.environ.get("AZURE_TENANT_ID", "")
CLIENT_ID = os.environ.get("AZURE_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("AZURE_CLIENT_SECRET", "")
DEFAULT_SUBSCRIPTION_ID = os.environ.get("AZURE_SUBSCRIPTION_ID", "")

# OBO context for per-request user authentication
_obo_context = {}

# =============================================================================
# FASTMCP SERVER
# =============================================================================

mcp = FastMCP("OpenAgentic Azure Cost MCP")

# =============================================================================
# OBO AUTHENTICATION
# =============================================================================

def set_obo_context(user_assertion: str, client_id: str = None, scope: str = None):
    """Set OBO context for the current request."""
    _obo_context["user_assertion"] = user_assertion
    if client_id:
        _obo_context["client_id"] = client_id
    if scope:
        _obo_context["scope"] = scope
    logger.info(f"OBO context set with assertion length: {len(user_assertion)}")

def clear_obo_context():
    """Clear OBO context after request."""
    _obo_context.clear()

def get_obo_credential():
    """Get OnBehalfOfCredential if OBO context is set, otherwise use service principal."""
    if "user_assertion" in _obo_context:
        logger.info("Creating OBO credential for user")
        return OnBehalfOfCredential(
            tenant_id=TENANT_ID,
            client_id=_obo_context.get("client_id", CLIENT_ID),
            client_secret=CLIENT_SECRET,
            user_assertion=_obo_context["user_assertion"]
        )
    else:
        logger.info("No OBO context, using service principal credential")
        return ClientSecretCredential(
            tenant_id=TENANT_ID,
            client_id=CLIENT_ID,
            client_secret=CLIENT_SECRET
        )

def get_access_token(resource: str = "https://management.azure.com/.default") -> str:
    """Get access token for Azure Cost Management API."""
    credential = get_obo_credential()
    token = credential.get_token(resource)
    return token.token

# =============================================================================
# COST MANAGEMENT TOOLS
# =============================================================================

@mcp.tool()
async def azure_cost_query(
    granularity: str = "Daily",
    time_period: str = "Last30Days",
    group_by: Optional[List[str]] = None,
    subscription_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
) -> Dict[str, Any]:
    """
    Query Azure cost data with flexible time ranges and grouping.

    Args:
        granularity: Time granularity - "Daily", "Monthly", or "None" (total)
        time_period: Preset time period - "Last7Days", "Last30Days", "LastMonth", "Custom"
        group_by: List of dimensions to group by. Options:
            - "ResourceType" - Group by resource type (VMs, Storage, etc.)
            - "ResourceGroup" - Group by resource group
            - "ServiceName" - Group by Azure service name
            - "ResourceLocation" - Group by Azure region
            - "SubscriptionName" - Group by subscription
            - "TagKey:tagname" - Group by a specific tag
        subscription_id: Optional subscription ID. Uses default if not specified.
        start_date: Start date for custom time period (YYYY-MM-DD)
        end_date: End date for custom time period (YYYY-MM-DD)

    Returns:
        Cost data with breakdown by the specified dimensions

    Examples:
        # Get daily costs for last 30 days grouped by resource type
        azure_cost_query(granularity="Daily", time_period="Last30Days", group_by=["ResourceType"])

        # Get monthly costs by resource group
        azure_cost_query(granularity="Monthly", time_period="Last30Days", group_by=["ResourceGroup"])

        # Get total costs by service for a custom date range
        azure_cost_query(
            granularity="None",
            time_period="Custom",
            start_date="2024-01-01",
            end_date="2024-01-31",
            group_by=["ServiceName"]
        )
    """
    try:
        # Get access token with OBO if available
        token = get_access_token()
        sub_id = subscription_id if subscription_id else DEFAULT_SUBSCRIPTION_ID

        # Build time frame
        if time_period == "Custom" and start_date and end_date:
            time_frame = {
                "type": "Custom",
                "timePeriod": {
                    "from": f"{start_date}T00:00:00Z",
                    "to": f"{end_date}T23:59:59Z"
                }
            }
        else:
            # Calculate dates for preset periods
            today = datetime.utcnow()
            if time_period == "Last7Days":
                from_date = today - timedelta(days=7)
            elif time_period == "LastMonth":
                from_date = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
                to_date = today.replace(day=1) - timedelta(days=1)
            else:  # Default Last30Days
                from_date = today - timedelta(days=30)

            if time_period != "LastMonth":
                time_frame = {
                    "type": "Custom",
                    "timePeriod": {
                        "from": from_date.strftime("%Y-%m-%dT00:00:00Z"),
                        "to": today.strftime("%Y-%m-%dT23:59:59Z")
                    }
                }
            else:
                time_frame = {
                    "type": "Custom",
                    "timePeriod": {
                        "from": from_date.strftime("%Y-%m-%dT00:00:00Z"),
                        "to": to_date.strftime("%Y-%m-%dT23:59:59Z")
                    }
                }

        # Build grouping
        grouping = []
        if group_by:
            for dim in group_by:
                if dim.startswith("TagKey:"):
                    tag_name = dim.split(":")[1]
                    grouping.append({"type": "TagKey", "name": tag_name})
                else:
                    grouping.append({"type": "Dimension", "name": dim})

        # Build query body
        body = {
            "type": "ActualCost",
            "timeframe": "Custom",
            "timePeriod": time_frame.get("timePeriod"),
            "dataSet": {
                "granularity": granularity,
                "aggregation": {
                    "totalCost": {
                        "name": "Cost",
                        "function": "Sum"
                    },
                    "totalCostUSD": {
                        "name": "CostUSD",
                        "function": "Sum"
                    }
                },
                "grouping": grouping if grouping else None
            }
        }

        # Remove None values from grouping
        if not body["dataSet"]["grouping"]:
            del body["dataSet"]["grouping"]

        url = f"https://management.azure.com/subscriptions/{sub_id}/providers/Microsoft.CostManagement/query?api-version=2023-11-01"

        logger.info(f"Cost Management Query: {url}")

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(url, headers=headers, json=body)

        if response.status_code >= 200 and response.status_code < 300:
            data = response.json()
            # Process the response into a more usable format
            return {"success": True, "status_code": response.status_code, "data": data}
        else:
            try:
                error_data = response.json()
            except:
                error_data = response.text
            return {"success": False, "status_code": response.status_code, "error": error_data}

    except Exception as e:
        logger.error(f"Cost query failed: {e}")
        return {"success": False, "error": str(e)}


@mcp.tool()
async def azure_cost_breakdown(
    breakdown_by: str = "ResourceType",
    days: int = 30,
    top_n: int = 10,
    subscription_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get a simplified cost breakdown for Azure resources.

    Args:
        breakdown_by: Dimension to break down costs. Options:
            - "ResourceType" - By resource type (VMs, Storage, etc.)
            - "ResourceGroup" - By resource group
            - "ServiceName" - By Azure service
            - "ResourceLocation" - By region
        days: Number of days to analyze (default 30)
        top_n: Number of top items to return (default 10)
        subscription_id: Optional subscription ID

    Returns:
        Simplified cost breakdown with totals and top items

    Examples:
        # Get top 10 resource types by cost
        azure_cost_breakdown(breakdown_by="ResourceType", days=30, top_n=10)

        # Get cost by resource group
        azure_cost_breakdown(breakdown_by="ResourceGroup", days=7)
    """
    try:
        token = get_access_token()
        sub_id = subscription_id if subscription_id else DEFAULT_SUBSCRIPTION_ID

        today = datetime.utcnow()
        from_date = today - timedelta(days=days)

        body = {
            "type": "ActualCost",
            "timeframe": "Custom",
            "timePeriod": {
                "from": from_date.strftime("%Y-%m-%dT00:00:00Z"),
                "to": today.strftime("%Y-%m-%dT23:59:59Z")
            },
            "dataSet": {
                "granularity": "None",
                "aggregation": {
                    "totalCost": {
                        "name": "Cost",
                        "function": "Sum"
                    },
                    "totalCostUSD": {
                        "name": "CostUSD",
                        "function": "Sum"
                    }
                },
                "grouping": [
                    {"type": "Dimension", "name": breakdown_by}
                ],
                "sorting": [
                    {"direction": "descending", "name": "Cost"}
                ]
            }
        }

        url = f"https://management.azure.com/subscriptions/{sub_id}/providers/Microsoft.CostManagement/query?api-version=2023-11-01"

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(url, headers=headers, json=body)

        if response.status_code >= 200 and response.status_code < 300:
            data = response.json()

            # Process into simplified format
            result = {
                "period": f"Last {days} days",
                "from_date": from_date.strftime("%Y-%m-%d"),
                "to_date": today.strftime("%Y-%m-%d"),
                "breakdown_by": breakdown_by,
                "items": [],
                "total_cost": 0,
                "currency": "USD"
            }

            # Extract columns and rows
            columns = data.get("properties", {}).get("columns", [])
            rows = data.get("properties", {}).get("rows", [])

            # Find column indices
            cost_idx = None
            cost_usd_idx = None
            dim_idx = None
            for i, col in enumerate(columns):
                if col.get("name") == "Cost":
                    cost_idx = i
                elif col.get("name") == "CostUSD":
                    cost_usd_idx = i
                elif col.get("name") == breakdown_by:
                    dim_idx = i

            # Process rows
            for row in rows[:top_n]:
                cost = row[cost_usd_idx] if cost_usd_idx is not None else (row[cost_idx] if cost_idx is not None else 0)
                dim_value = row[dim_idx] if dim_idx is not None else "Unknown"
                result["items"].append({
                    "name": dim_value,
                    "cost": round(cost, 2)
                })
                result["total_cost"] += cost

            result["total_cost"] = round(result["total_cost"], 2)

            return {"success": True, "data": result}
        else:
            try:
                error_data = response.json()
            except:
                error_data = response.text
            return {"success": False, "status_code": response.status_code, "error": error_data}

    except Exception as e:
        logger.error(f"Cost breakdown failed: {e}")
        return {"success": False, "error": str(e)}


@mcp.tool()
async def azure_cost_forecast(
    forecast_days: int = 30,
    subscription_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get cost forecast based on historical spending patterns.

    Args:
        forecast_days: Number of days to forecast (default 30)
        subscription_id: Optional subscription ID

    Returns:
        Forecasted costs based on historical data

    Examples:
        # Get 30-day cost forecast
        azure_cost_forecast(forecast_days=30)
    """
    try:
        token = get_access_token()
        sub_id = subscription_id if subscription_id else DEFAULT_SUBSCRIPTION_ID

        today = datetime.utcnow()
        from_date = today
        to_date = today + timedelta(days=forecast_days)

        body = {
            "type": "ActualCost",
            "timeframe": "Custom",
            "timePeriod": {
                "from": from_date.strftime("%Y-%m-%dT00:00:00Z"),
                "to": to_date.strftime("%Y-%m-%dT23:59:59Z")
            },
            "dataSet": {
                "granularity": "Daily",
                "aggregation": {
                    "totalCost": {
                        "name": "Cost",
                        "function": "Sum"
                    }
                }
            },
            "includeFreshPartialCost": True
        }

        url = f"https://management.azure.com/subscriptions/{sub_id}/providers/Microsoft.CostManagement/forecast?api-version=2023-11-01"

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(url, headers=headers, json=body)

        if response.status_code >= 200 and response.status_code < 300:
            data = response.json()

            # Process forecast data
            result = {
                "forecast_period": f"Next {forecast_days} days",
                "from_date": from_date.strftime("%Y-%m-%d"),
                "to_date": to_date.strftime("%Y-%m-%d"),
                "forecasted_total": 0,
                "daily_forecast": [],
                "currency": "USD"
            }

            columns = data.get("properties", {}).get("columns", [])
            rows = data.get("properties", {}).get("rows", [])

            # Find column indices
            cost_idx = None
            date_idx = None
            for i, col in enumerate(columns):
                if col.get("name") == "Cost":
                    cost_idx = i
                elif col.get("name") == "UsageDate":
                    date_idx = i

            # Process rows
            for row in rows:
                cost = row[cost_idx] if cost_idx is not None else 0
                date = row[date_idx] if date_idx is not None else ""
                result["daily_forecast"].append({
                    "date": str(date)[:10] if date else "",
                    "forecasted_cost": round(cost, 2)
                })
                result["forecasted_total"] += cost

            result["forecasted_total"] = round(result["forecasted_total"], 2)

            return {"success": True, "data": result}
        else:
            try:
                error_data = response.json()
            except:
                error_data = response.text
            return {"success": False, "status_code": response.status_code, "error": error_data}

    except Exception as e:
        logger.error(f"Cost forecast failed: {e}")
        return {"success": False, "error": str(e)}


@mcp.tool()
async def azure_cost_set_obo_token(user_assertion: str, client_id: Optional[str] = None, scope: Optional[str] = None) -> Dict[str, Any]:
    """
    Set the OBO (On-Behalf-Of) token for subsequent cost operations.
    Called by MCP proxy to set user's token before executing cost queries.

    Args:
        user_assertion: The user's access token to exchange
        client_id: Optional client ID override
        scope: Optional scope override

    Returns:
        Confirmation that OBO context is set
    """
    set_obo_context(user_assertion, client_id, scope)
    return {"success": True, "message": "OBO context set - subsequent cost operations will run as user", "obo_active": True}


# =============================================================================
# STARTUP
# =============================================================================

if __name__ == "__main__":
    import sys

    if not TENANT_ID or not CLIENT_ID or not CLIENT_SECRET:
        logger.error("Missing required Azure credentials. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET")
        sys.exit(1)

    logger.info("Starting OpenAgentic Azure Cost MCP Server")
    logger.info(f"Tenant: {TENANT_ID[:8]}...")
    logger.info(f"Client: {CLIENT_ID[:8]}...")
    logger.info(f"Default Subscription: {DEFAULT_SUBSCRIPTION_ID[:8] if DEFAULT_SUBSCRIPTION_ID else 'Not set'}...")

    mcp.run()
