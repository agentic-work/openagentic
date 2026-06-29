"""Azure MCP — governance tools.

Defender, Policy, Resource Graph, management groups, Advisor, Service Health.
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
    'azure_security_list_assessments',
    'azure_security_secure_score',
    'azure_security_list_alerts',
    'azure_policy_list_compliance_states',
    'azure_resource_graph_query',
    'azure_resource_graph_query_tenant_wide',
    'azure_list_public_facing_resources',
    'azure_list_management_groups',
    'azure_list_subscriptions_in_management_group',
    'azure_advisor_recommendations',
    'azure_service_health_events',
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
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_security_list_assessments(
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Microsoft Defender for Cloud security assessments for a subscription (typed SDK).
    Returns current security findings with severity, status, and remediation guidance.
    Use for security incident response (UC-028) and compliance audits.

    Args:
        subscription_id: Azure subscription ID (defaults to DEFAULT_SUBSCRIPTION_ID)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = SecurityCenter(credential, sub_id, asc_location="centralus")
        scope = f"/subscriptions/{sub_id}"
        results = []
        for a in client.assessments.list(scope=scope):
            props = getattr(a, "additional_properties", {}) or {}
            results.append({
                "name": a.name,
                "id": a.id,
                "display_name": getattr(a, "display_name", None) or props.get("properties", {}).get("displayName"),
                "status": getattr(getattr(a, "status", None), "code", None),
                "severity": getattr(getattr(a, "metadata", None), "severity", None),
                "description": getattr(getattr(a, "metadata", None), "description", None),
                "categories": getattr(getattr(a, "metadata", None), "categories", None),
            })
        return {"success": True, "count": len(results), "assessments": results, "executed_as": user_info}
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
async def azure_security_secure_score(
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get Microsoft Defender for Cloud secure score for a subscription (typed SDK).
    Returns the overall secure score percentage and individual control scores.
    Use for executive security posture reporting (UC-028).

    Args:
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = SecurityCenter(credential, sub_id, asc_location="centralus")
        scores = []
        for s in client.secure_scores.list():
            score_obj = getattr(s, "score", None)
            scores.append({
                "name": s.name,
                "id": s.id,
                "display_name": getattr(s, "display_name", None),
                "current": getattr(score_obj, "current", None) if score_obj else None,
                "max": getattr(score_obj, "max", None) if score_obj else None,
                "percentage": getattr(score_obj, "percentage", None) if score_obj else None,
                "weight": getattr(s, "weight", None),
            })
        return {"success": True, "count": len(scores), "secure_scores": scores, "executed_as": user_info}
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
async def azure_security_list_alerts(
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Microsoft Defender for Cloud security alerts for a subscription (typed SDK).
    Returns active and resolved security alerts with severity, status, and affected resources.
    Use for incident triage and security operations (UC-028).

    Args:
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = SecurityCenter(credential, sub_id, asc_location="centralus")
        alerts = []
        for a in client.alerts.list():
            alerts.append({
                "name": a.name,
                "id": a.id,
                "alert_display_name": getattr(a, "alert_display_name", None),
                "severity": getattr(a, "severity", None),
                "status": getattr(a, "status", None),
                "description": getattr(a, "description", None),
                "time_generated": str(getattr(a, "time_generated_utc", None)) if getattr(a, "time_generated_utc", None) else None,
                "compromised_entity": getattr(a, "compromised_entity", None),
                "intent": getattr(a, "intent", None),
            })
        return {"success": True, "count": len(alerts), "alerts": alerts, "executed_as": user_info}
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
async def azure_policy_list_compliance_states(
    subscription_id: Optional[str] = None,
    top: Optional[int] = 200,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure Policy compliance states for all resources in a subscription (typed SDK).
    Returns per-resource compliance results: policy assignment, policy definition,
    compliance state (Compliant / NonCompliant), and resource details.
    Use for governance audits, compliance reporting, and drift detection (UC-028).

    Args:
        subscription_id: Azure subscription ID
        top: Max number of records to return (default 200)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = PolicyInsightsClient(credential)
        results = []
        it = client.policy_states.list_query_results_for_subscription(
            policy_states_resource="latest",
            subscription_id=sub_id,
        )
        for i, s in enumerate(it):
            if i >= (top or 200):
                break
            results.append({
                "resource_id": getattr(s, "resource_id", None),
                "resource_type": getattr(s, "resource_type", None),
                "resource_group": getattr(s, "resource_group", None),
                "resource_location": getattr(s, "resource_location", None),
                "policy_assignment_id": getattr(s, "policy_assignment_id", None),
                "policy_assignment_name": getattr(s, "policy_assignment_name", None),
                "policy_definition_id": getattr(s, "policy_definition_id", None),
                "policy_definition_name": getattr(s, "policy_definition_name", None),
                "compliance_state": getattr(s, "compliance_state", None),
                "is_compliant": getattr(s, "is_compliant", None),
                "timestamp": str(getattr(s, "timestamp", None)) if getattr(s, "timestamp", None) else None,
            })
        compliant = sum(1 for r in results if r.get("compliance_state") == "Compliant")
        non_compliant = sum(1 for r in results if r.get("compliance_state") == "NonCompliant")
        return {
            "success": True,
            "count": len(results),
            "compliant_count": compliant,
            "non_compliant_count": non_compliant,
            "compliance_states": results,
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
async def azure_resource_graph_query(
    query: str,
    subscriptions: Optional[List[str]] = None,
    management_groups: Optional[List[str]] = None,
    max_results: int = 5000,
    max_pages: int = 10,
    skip_token: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Run a KQL query against Azure Resource Graph. THIS IS THE PREFERRED TOOL
    for any question about resources spanning multiple subscriptions, resource
    groups, or types — Resource Graph indexes ALL of Azure's ARM data and
    handles pagination natively.

    ENTERPRISE-SCALE AUTO-PAGINATION: the tool loops through skip_token pages
    internally and returns the UNION of results up to `max_results`. You don't
    need to manage pagination in your prompt chain — just issue the query and
    the tool handles fan-out. Default `max_results=5000` (5 pages of 1000),
    bump to 50000+ for tenant-wide audits.

    CROSS-SUBSCRIPTION: omit `subscriptions` to query ALL subscriptions the
    service principal has access to. Use `management_groups` to scope by MG
    hierarchy. Either way, a single query covers 100+ subs in one call.

    Use this for questions like:
      - "List all public-facing resources across ALL subscriptions"
      - "Find every VM tagged env=prod in the tenant"
      - "Which storage accounts have public network access enabled?"
      - "Count resources per type per subscription"
      - "Find all resources in resource groups matching ocio-omcp-*"

    Args:
        query: KQL query string. Examples:
            Resources | where type =~ 'microsoft.compute/virtualmachines' | project name, location, subscriptionId
            Resources | where properties.publicNetworkAccess == 'Enabled' | summarize count() by type, subscriptionId
            ResourceContainers | where type == 'microsoft.resources/subscriptions/resourcegroups' | where name startswith 'ocio-'
        subscriptions: List of subscription IDs to scope the query to. Omit for ALL accessible subs.
        management_groups: List of management group IDs to scope to. Omit to use subscription scope.
        max_results: Total rows to return across all pages (default 5000, uncapped by Resource Graph — bump for tenant audits).
        max_pages: Safety cap on pagination loop iterations (default 10 × 1000 rows per page = 10k).
        skip_token: Resume from a specific page token (rarely needed — the tool auto-paginates).

    Returns:
        {success, data: [...all rows...], count, total_records, pages_fetched,
         truncated (True if hit max_results/max_pages), next_skip_token, executed_as}

    KQL primer:
        - Tables: Resources, ResourceContainers, AdvisorResources, SecurityResources, etc
        - Common ops: where, project, summarize, count, distinct, join, extend
        - String matching: ==, =~ (case-insensitive), contains, startswith, endswith, matches regex
        - Arrays: array_length, mv-expand
        - Aggregation (do this server-side, not in LLM): summarize count() by subscriptionId
    """
    try:
        credential, user_info = require_user_token(meta)
        client = ResourceGraphClient(credential)

        PAGE_SIZE = 1000  # Resource Graph hard maximum per page
        all_rows: List[Any] = []
        current_skip = skip_token
        pages_fetched = 0
        total_records = None
        truncated = False
        effective_max = max(1, max_results)
        effective_max_pages = max(1, max_pages)

        # Auto-pagination loop — keep fetching until we hit max_results, max_pages,
        # or Resource Graph returns no more pages. The LLM never sees the pagination
        # machinery.
        while True:
            request_options = QueryRequestOptions(
                top=PAGE_SIZE,
                skip_token=current_skip,
                result_format="objectArray",
            )
            request = QueryRequest(
                query=query,
                subscriptions=subscriptions,
                management_groups=management_groups,
                options=request_options,
            )
            response = client.resources(request)
            page_data = response.data if hasattr(response, 'data') else []
            if total_records is None:
                total_records = getattr(response, 'total_records', None)

            if isinstance(page_data, list):
                # Respect the max_results cap even if the page puts us over
                remaining = effective_max - len(all_rows)
                if remaining <= 0:
                    truncated = True
                    break
                if len(page_data) > remaining:
                    all_rows.extend(page_data[:remaining])
                    truncated = True
                    break
                all_rows.extend(page_data)

            pages_fetched += 1
            current_skip = getattr(response, 'skip_token', None)

            if not current_skip:
                # Resource Graph says no more pages
                break
            if pages_fetched >= effective_max_pages:
                truncated = True
                break
            if len(all_rows) >= effective_max:
                truncated = True
                break

        return {
            "success": True,
            "query": query,
            "count": len(all_rows),
            "total_records": total_records,
            "pages_fetched": pages_fetched,
            "truncated": truncated,
            "next_skip_token": current_skip if truncated else None,
            "data": all_rows,
            "scoped_to": {
                "subscriptions": subscriptions or "all accessible",
                "management_groups": management_groups,
            },
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
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_resource_graph_query_tenant_wide(
    query: str,
    max_results: int = 50000,
    subscription_filter: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Run a KQL Resource Graph query across EVERY subscription the service principal
    can see — in ONE call. Use this for any question that should span the
    whole tenant: "find all X", "list biggest Y across all subs", "count Z
    by subscription", etc.

    Implementation: Azure Resource Graph already handles tenant-wide scope
    natively when the `subscriptions` filter is omitted — the service uses
    the service principal to enumerate every accessible subscription server-side.
    This tool just delegates to that path with auto-pagination up to
    `max_results` rows. NO client-side sub enumeration, NO batching, NO
    fan-out loops — all of that used to be here and caused 120s timeouts
    because it serialized through the sync Azure SDK.

    Args:
        query: KQL query string (same format as azure_resource_graph_query).
               Tip: `| summarize count() by subscriptionId` for per-sub counts.
        max_results: Total rows to return across all pages (default 50000).
        subscription_filter: Optional substring to filter subscription NAMES.
                             When set, the tool enumerates subs, filters by
                             display name, and then runs a scoped query.
                             Omit to query every accessible sub (faster).

    Returns:
        {success, query, total_rows, data: [...], pages_fetched, executed_as}
    """
    try:
        credential, user_info = require_user_token(meta)
        client = ResourceGraphClient(credential)

        # Optional: name-filtered sub enumeration
        scoped_sub_ids: Optional[List[str]] = None
        if subscription_filter:
            sub_client = SubscriptionClient(credential)
            scoped_sub_ids = [
                sub.subscription_id
                for sub in sub_client.subscriptions.list()
                if sub.subscription_id
                and subscription_filter.lower() in (sub.display_name or '').lower()
            ]
            if not scoped_sub_ids:
                return {
                    "success": True,
                    "query": query,
                    "total_rows": 0,
                    "data": [],
                    "pages_fetched": 0,
                    "note": f"No subscriptions matched filter '{subscription_filter}'",
                    "executed_as": user_info,
                }

        PAGE_SIZE = 1000
        all_rows: List[Any] = []
        current_skip = None
        pages_fetched = 0
        effective_max = max(1, max_results)

        while True:
            request_options = QueryRequestOptions(
                top=PAGE_SIZE,
                skip_token=current_skip,
                result_format="objectArray",
            )
            request = QueryRequest(
                query=query,
                subscriptions=scoped_sub_ids,  # None → tenant scope via service principal
                options=request_options,
            )
            response = client.resources(request)
            page_data = response.data if hasattr(response, 'data') else []
            if isinstance(page_data, list):
                remaining = effective_max - len(all_rows)
                if remaining <= 0:
                    break
                if len(page_data) > remaining:
                    all_rows.extend(page_data[:remaining])
                    break
                all_rows.extend(page_data)
            pages_fetched += 1
            current_skip = getattr(response, 'skip_token', None)
            if not current_skip or len(all_rows) >= effective_max:
                break

        return {
            "success": True,
            "query": query,
            "total_rows": len(all_rows),
            "pages_fetched": pages_fetched,
            "data": all_rows,
            "scope": "tenant-wide" if not scoped_sub_ids else f"{len(scoped_sub_ids)} subs matching '{subscription_filter}'",
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
        "goldenPrompts": ["list my public facing resources", "show me public facing resources", "what public facing resources do i have"],
        "testFixture": None,
    },
)
async def azure_list_public_facing_resources(
    subscription_id: Optional[str] = None,
    include_types: Optional[List[str]] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List all PUBLIC-FACING Azure resources in a subscription. Built on top of
    Resource Graph for accurate, indexed results across all resource types.

    Detects exposure via:
      - Public IP address attached
      - Public network access enabled (storage, kv, sql, cosmos, etc)
      - App Services with public hostnames
      - Front Door / App Gateway / Load Balancer with public frontends
      - AKS clusters with public API server

    Args:
        subscription_id: Single subscription to scope to (uses default if not specified)
        include_types: Optional whitelist of ARM types to filter (e.g. ['microsoft.compute/virtualmachines'])
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        # KQL union: any of the public-exposure indicators
        kql = """
        Resources
        | where (
            (type =~ 'microsoft.network/publicipaddresses' and isnotempty(properties.ipAddress))
            or (type =~ 'microsoft.web/sites' and properties.publicNetworkAccess !~ 'Disabled')
            or (type =~ 'microsoft.network/applicationgateways' and array_length(properties.frontendIPConfigurations) > 0)
            or (type =~ 'microsoft.network/frontdoors')
            or (type =~ 'microsoft.cdn/profiles')
            or (type =~ 'microsoft.network/loadbalancers' and properties.frontendIPConfigurations[0].properties.publicIPAddress != '')
            or (type =~ 'microsoft.containerservice/managedclusters' and properties.apiServerAccessProfile.enablePrivateCluster != true)
            or (type =~ 'microsoft.storage/storageaccounts' and properties.publicNetworkAccess !~ 'Disabled')
            or (type =~ 'microsoft.keyvault/vaults' and properties.publicNetworkAccess !~ 'Disabled')
            or (type =~ 'microsoft.sql/servers' and properties.publicNetworkAccess !~ 'Disabled')
            or (type =~ 'microsoft.documentdb/databaseaccounts' and properties.publicNetworkAccess !~ 'Disabled')
        )
        | project name, type, location, resourceGroup, subscriptionId, id, exposure_reason = case(
            type =~ 'microsoft.network/publicipaddresses', strcat('Public IP: ', tostring(properties.ipAddress)),
            type =~ 'microsoft.web/sites', strcat('App Service public access: ', tostring(properties.defaultHostName)),
            type =~ 'microsoft.network/applicationgateways', 'Application Gateway with public frontend',
            type =~ 'microsoft.network/frontdoors', 'Azure Front Door',
            type =~ 'microsoft.cdn/profiles', 'CDN Profile',
            type =~ 'microsoft.network/loadbalancers', 'Public Load Balancer',
            type =~ 'microsoft.containerservice/managedclusters', 'AKS public API server',
            type =~ 'microsoft.storage/storageaccounts', 'Storage public network access enabled',
            type =~ 'microsoft.keyvault/vaults', 'Key Vault public network access enabled',
            type =~ 'microsoft.sql/servers', 'SQL Server public network access enabled',
            type =~ 'microsoft.documentdb/databaseaccounts', 'Cosmos DB public access enabled',
            'Other'
        )
        """
        if include_types:
            type_filter = " or ".join([f"type =~ '{t}'" for t in include_types])
            kql += f"\n| where {type_filter}"
        kql += "\n| order by type asc, name asc"

        client = ResourceGraphClient(credential)
        request = QueryRequest(
            query=kql,
            subscriptions=[sub_id],
            options=QueryRequestOptions(top=1000, result_format="objectArray"),
        )
        response = client.resources(request)
        data = response.data if hasattr(response, 'data') else []

        # Group by type for the summary
        by_type: Dict[str, int] = {}
        for r in data:
            t = r.get('type', 'unknown')
            by_type[t] = by_type.get(t, 0) + 1

        return {
            "success": True,
            "subscription_id": sub_id,
            "total_count": len(data),
            "count_by_type": by_type,
            "resources": data,
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
        "goldenPrompts": ["list my management groups", "show me management groups", "what management groups do i have"],
        "testFixture": None,
    },
)
async def azure_list_management_groups(
    tenant_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List all management groups visible to the user in the tenant.

    Args:
        tenant_id: Optional tenant ID. If omitted, uses the user's home tenant.

    Returns hierarchy: management groups can contain other MGs and subscriptions.
    """
    try:
        credential, user_info = require_user_token(meta)
        client = ManagementGroupsAPI(credential)
        groups = list(client.management_groups.list())
        return {
            "success": True,
            "tenant_id": tenant_id or user_info.get("tid"),
            "count": len(groups),
            "management_groups": [
                {
                    "id": g.id,
                    "name": g.name,
                    "display_name": g.display_name,
                    "type": g.type,
                    "tenant_id": g.tenant_id if hasattr(g, 'tenant_id') else None,
                }
                for g in groups
            ],
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
        "goldenPrompts": ["list my subscriptions in management group", "show me subscriptions in management group", "what subscriptions in management group do i have"],
        "testFixture": None,
    },
)
async def azure_list_subscriptions_in_management_group(
    management_group_id: str,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List all subscriptions under a specific management group. Use this to answer
    questions like "list the subscriptions in management group Platform-Engineering-MG".

    The management_group_id can be either:
      - The short name (e.g. "Platform-Engineering-MG")
      - The full ARM ID (e.g. "/providers/Microsoft.Management/managementGroups/Platform-Engineering-MG")

    Args:
        management_group_id: The management group identifier (name or full ARM path).
    """
    try:
        credential, user_info = require_user_token(meta)
        client = ManagementGroupsAPI(credential)

        # Strip ARM prefix if user supplied the full path
        mg_name = management_group_id.split('/')[-1] if management_group_id.startswith('/') else management_group_id

        # Use Resource Graph to find all subscriptions in this MG (most reliable approach)
        rg_client = ResourceGraphClient(credential)
        kql = f"""
        ResourceContainers
        | where type == 'microsoft.resources/subscriptions'
        | extend mgs = properties.managementGroupAncestorsChain
        | mv-expand mgs
        | where tostring(mgs.name) == '{mg_name}'
        | project subscriptionId, name, displayName = properties.displayName, state = properties.state
        """
        request = QueryRequest(query=kql, options=QueryRequestOptions(top=1000, result_format="objectArray"))
        response = rg_client.resources(request)
        subs = response.data if hasattr(response, 'data') else []

        return {
            "success": True,
            "management_group_id": mg_name,
            "count": len(subs),
            "subscriptions": subs,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)


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
async def azure_advisor_recommendations(
    subscription_id: Optional[str] = None,
    category: Optional[str] = None,
    impact: Optional[str] = None,
    max_results: int = 200,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure Advisor recommendations for a subscription. Covers cost savings,
    security findings, performance, operational excellence, and reliability.

    Use this to answer questions like:
      - "List Azure Advisor security recommendations for subscription X"
      - "What cost savings can CBO leverage in subscription Y?"
      - "Show high-impact reliability recommendations across subscription Z"

    Args:
        subscription_id: Required scope.
        category: Filter by category. One of: 'Cost', 'Security', 'Performance',
            'OperationalExcellence', 'HighAvailability'. Omit for all.
        impact: Filter by impact level. One of: 'High', 'Medium', 'Low'. Omit for all.
        max_results: Cap on results (default 200).
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        client = AdvisorManagementClient(credential, sub_id)
        recs_iter = client.recommendations.list()

        result = []
        count = 0
        for rec in recs_iter:
            if count >= max_results:
                break
            props = rec.as_dict() if hasattr(rec, 'as_dict') else {}
            cat = (props.get('category') or '').lower()
            imp = (props.get('impact') or '').lower()
            if category and cat != category.lower():
                continue
            if impact and imp != impact.lower():
                continue
            result.append({
                "id": rec.id,
                "category": props.get('category'),
                "impact": props.get('impact'),
                "impacted_field": props.get('impacted_field'),
                "impacted_value": props.get('impacted_value'),
                "last_updated": props.get('last_updated'),
                "short_description": (props.get('short_description') or {}).get('problem'),
                "solution": (props.get('short_description') or {}).get('solution'),
                "metadata": props.get('metadata'),
                "extended_properties": props.get('extended_properties'),
            })
            count += 1

        # Group by category for the summary
        by_category: Dict[str, int] = {}
        by_impact: Dict[str, int] = {}
        for r in result:
            c = r.get('category') or 'Unknown'
            i = r.get('impact') or 'Unknown'
            by_category[c] = by_category.get(c, 0) + 1
            by_impact[i] = by_impact.get(i, 0) + 1

        return {
            "success": True,
            "subscription_id": sub_id,
            "count": len(result),
            "filters": {"category": category, "impact": impact},
            "summary": {"by_category": by_category, "by_impact": by_impact},
            "recommendations": result,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)


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
async def azure_service_health_events(
    regions: Optional[List[str]] = None,
    event_types: Optional[List[str]] = None,
    event_levels: Optional[List[str]] = None,
    days_back: int = 0,
    subscription_id: Optional[str] = None,
    max_results: int = 500,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Query Azure Service Health events (current incidents and historical issues)
    for one or more regions, filtered by type and severity.

    Use this to answer questions like:
      - "List current Azure Service Issues for the East US region"
      - "Provide the total number of warning-level service issues for East US, West US, Central US"
      - "List Azure Service Issues from the past 6 months in East US, East US2 with event level warning"

    Args:
        regions: List of Azure region names (e.g. ['eastus', 'eastus2', 'westus', 'centralus']).
            Omit for all regions.
        event_types: Filter by event type. Common: 'ServiceIssue', 'PlannedMaintenance',
            'HealthAdvisory', 'SecurityAdvisory'. Omit for all.
        event_levels: Filter by severity. Common: 'Critical', 'Warning', 'Informational'.
            Omit for all. Match is case-insensitive.
        days_back: How many days of history to include. 0 = active events only,
            180 = past 6 months, etc. Maximum 365.
        subscription_id: Required for the events list endpoint scope.
        max_results: Cap on returned events.

    Returns events with: id, name, type, level, status, region, start_time, end_time,
    title, summary, impact_summary, impact_details.
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        # Use the ARM REST API for service health events because the Python SDK
        # for Microsoft.ResourceHealth events is incomplete. ARM REST is well-supported.
        import requests
        token = credential.get_token("https://management.azure.com/.default").token

        # Time filter
        time_filter = ""
        if days_back > 0:
            from datetime import timezone
            cutoff = (datetime.now(timezone.utc) - timedelta(days=min(days_back, 365))).strftime("%Y-%m-%dT%H:%M:%SZ")
            time_filter = f"&$filter=properties/lastUpdateTime ge '{cutoff}'"

        url = f"https://management.azure.com/subscriptions/{sub_id}/providers/Microsoft.ResourceHealth/events?api-version=2022-10-01{time_filter}"
        all_events: List[Dict[str, Any]] = []
        next_url: Optional[str] = url
        normalized_regions = {r.lower().replace(' ', '') for r in (regions or [])}
        normalized_levels = {l.lower() for l in (event_levels or [])}
        normalized_types = {t.lower() for t in (event_types or [])}

        while next_url and len(all_events) < max_results:
            resp = await asyncio.to_thread(
                requests.get, next_url, headers={"Authorization": f"Bearer {token}"}, timeout=30
            )
            if resp.status_code != 200:
                return {
                    "success": False,
                    "error": f"Service Health API returned {resp.status_code}: {resp.text[:500]}",
                    "executed_as": user_info,
                }
            payload = resp.json()
            for event in payload.get("value", []):
                if len(all_events) >= max_results:
                    break
                props = event.get("properties", {})
                event_type = (props.get("eventType") or "").lower()
                event_level = (props.get("eventLevel") or "").lower()
                if normalized_types and event_type not in normalized_types:
                    continue
                if normalized_levels and event_level not in normalized_levels:
                    continue
                # Region filter — events have impact arrays per-service-per-region
                impacts = props.get("impact", []) or []
                event_regions = set()
                for impact in impacts:
                    for region_impact in impact.get("impactedRegions", []) or []:
                        rname = (region_impact.get("impactedRegion") or "").lower().replace(' ', '')
                        if rname:
                            event_regions.add(rname)
                if normalized_regions and not (event_regions & normalized_regions):
                    continue
                all_events.append({
                    "id": event.get("id"),
                    "name": event.get("name"),
                    "event_type": props.get("eventType"),
                    "event_level": props.get("eventLevel"),
                    "status": props.get("status"),
                    "title": props.get("title"),
                    "summary": props.get("summary"),
                    "impact_summary": props.get("impactSummary"),
                    "impact_details": props.get("impact"),
                    "regions": sorted(event_regions),
                    "start_time": props.get("impactStartTime"),
                    "last_update_time": props.get("lastUpdateTime"),
                    "is_hir": props.get("isHIR"),
                    "tracking_id": props.get("trackingId"),
                })
            next_url = payload.get("nextLink")

        # Build summary counts by region+level
        region_level_counts: Dict[str, Dict[str, int]] = {}
        for ev in all_events:
            lvl = ev.get("event_level") or "Unknown"
            for r in ev.get("regions", []) or ["unknown"]:
                if r not in region_level_counts:
                    region_level_counts[r] = {}
                region_level_counts[r][lvl] = region_level_counts[r].get(lvl, 0) + 1

        return {
            "success": True,
            "subscription_id": sub_id,
            "filters": {
                "regions": regions,
                "event_types": event_types,
                "event_levels": event_levels,
                "days_back": days_back,
            },
            "count": len(all_events),
            "summary": {"by_region_and_level": region_level_counts},
            "events": all_events,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return error_response(e, user_info if 'user_info' in dir() else None)
