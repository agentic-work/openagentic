"""Azure MCP — webapps tools.

App Service plans, web/function/container apps.
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
    'azure_create_app_service_plan',
    'azure_create_web_app',
    'azure_create_function_app',
    'azure_create_container_app',
    'azure_list_web_apps',
]


@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_app_service_plan(
    name: str,
    resource_group: str,
    location: str,
    sku: str = "B1",
    tier: str = "Basic",
    os_type: str = "Linux",
    capacity: int = 1,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure App Service Plan (server farm) — the compute container that
    hosts Web Apps, Function Apps, and other App Service workloads.

    Use this BEFORE creating a web app or function app: every App Service workload
    needs a plan to run on. Pick the cheapest SKU your workload needs:
      F1 (Free, no SLA), B1 (Basic ~$13/mo), S1 (Standard ~$70/mo),
      P1V3 (Premium V3, production-grade).

    For Linux Python/Node/Java/etc workloads, set os_type='Linux'. For Windows
    .NET workloads, set os_type='Windows'.

    Args:
        name: Plan name (must be unique within the resource group)
        resource_group: Resource group to create the plan in
        location: Azure region (e.g., 'eastus', 'westus2')
        sku: SKU code — F1, B1, B2, B3, S1, S2, S3, P1V3, P2V3, P3V3
        tier: Tier name — Free, Basic, Standard, PremiumV3
        os_type: 'Linux' or 'Windows'
        capacity: Number of instances (default 1)
        tags: Optional tags to apply
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = WebSiteManagementClient(credential, sub_id)
        plan_definition: Dict[str, Any] = {
            "location": location,
            "sku": {"name": sku, "tier": tier, "capacity": capacity},
            "kind": "linux" if os_type.lower() == "linux" else "app",
            "reserved": os_type.lower() == "linux",  # Linux requires reserved=true
            "tags": tags or {},
        }
        poller = client.app_service_plans.begin_create_or_update(
            resource_group_name=resource_group,
            name=name,
            app_service_plan=plan_definition,
        )
        plan = poller.result()
        return {
            "success": True,
            "app_service_plan": {
                "name": plan.name,
                "id": plan.id,
                "location": plan.location,
                "sku": {"name": plan.sku.name, "tier": plan.sku.tier} if plan.sku else None,
                "os_type": "Linux" if plan.reserved else "Windows",
                "tags": plan.tags,
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
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_web_app(
    name: str,
    resource_group: str,
    app_service_plan: str,
    location: str,
    runtime: str = "PYTHON|3.11",
    https_only: bool = True,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure App Service Web App on an existing App Service Plan.

    Use this AFTER creating an App Service Plan with azure_create_app_service_plan.
    The runtime field uses the App Service Linux runtime stack format:
      'PYTHON|3.11', 'PYTHON|3.12', 'NODE|20-lts', 'NODE|18-lts',
      'JAVA|17-java17', 'DOTNETCORE|8.0', 'PHP|8.2', 'RUBY|3.1'

    The app_service_plan argument can be either the plan name (when in the same
    resource group) or the full plan resource ID.

    Args:
        name: Web app name (becomes <name>.azurewebsites.net, must be globally unique)
        resource_group: Resource group containing the plan
        app_service_plan: Plan name or full resource ID
        location: Azure region (must match the plan's region)
        runtime: Linux runtime stack — 'PYTHON|3.11' format
        https_only: Force HTTPS-only access (default True, recommended)
        tags: Optional tags to apply
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = WebSiteManagementClient(credential, sub_id)
        # Resolve the plan ID — accept both name and full ID
        if app_service_plan.startswith("/subscriptions/"):
            plan_id = app_service_plan
        else:
            plan_id = (
                f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
                f"/providers/Microsoft.Web/serverfarms/{app_service_plan}"
            )

        site_definition: Dict[str, Any] = {
            "location": location,
            "server_farm_id": plan_id,
            "https_only": https_only,
            "site_config": {
                "linux_fx_version": runtime,
                "always_on": False,  # B1 plans don't support always_on
            },
            "tags": tags or {},
        }
        poller = client.web_apps.begin_create_or_update(
            resource_group_name=resource_group,
            name=name,
            site_envelope=site_definition,
        )
        site = poller.result()
        return {
            "success": True,
            "web_app": {
                "name": site.name,
                "id": site.id,
                "default_host_name": site.default_host_name,
                "state": site.state,
                "runtime": runtime,
                "tags": site.tags,
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
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_function_app(
    name: str,
    resource_group: str,
    location: str,
    storage_account: str,
    runtime: str = "python",
    runtime_version: str = "3.11",
    app_service_plan: Optional[str] = None,
    consumption_plan: bool = True,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Function App. Function Apps are serverless event-driven
    workloads — cheaper than always-on Web Apps for sporadic traffic.

    Use this as a fallback path when App Service quota is blocked, or for any
    workload that's event-driven (HTTP triggers, queues, timers, blobs).

    Two hosting modes:
    - consumption_plan=True (default): pay-per-execution, no always-on cost,
      no app_service_plan needed. Best for low-traffic / fallback path.
    - consumption_plan=False: dedicated plan via app_service_plan argument.

    Args:
        name: Function app name (globally unique)
        resource_group: Resource group
        location: Azure region
        storage_account: Storage account name (must already exist) — Functions
                         require a backing storage account for state and metadata
        runtime: 'python', 'node', 'dotnet', 'java', 'powershell'
        runtime_version: Version string ('3.11', '20', '8.0', etc)
        app_service_plan: Plan name (only when consumption_plan=False)
        consumption_plan: Use serverless consumption plan (default True)
        tags: Optional tags
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = WebSiteManagementClient(credential, sub_id)
        storage_client = StorageManagementClient(credential, sub_id)

        # Get storage account connection string for AzureWebJobsStorage
        keys = storage_client.storage_accounts.list_keys(resource_group, storage_account)
        storage_key = keys.keys[0].value
        storage_conn = (
            f"DefaultEndpointsProtocol=https;AccountName={storage_account};"
            f"AccountKey={storage_key};EndpointSuffix=core.windows.net"
        )

        kind = "functionapp,linux" if runtime != "dotnet" else "functionapp"
        site_definition: Dict[str, Any] = {
            "location": location,
            "kind": kind,
            "reserved": runtime != "dotnet",  # Linux for non-dotnet
            "site_config": {
                "linux_fx_version": f"{runtime.upper()}|{runtime_version}" if runtime != "dotnet" else None,
                "app_settings": [
                    {"name": "AzureWebJobsStorage", "value": storage_conn},
                    {"name": "FUNCTIONS_WORKER_RUNTIME", "value": runtime},
                    {"name": "FUNCTIONS_EXTENSION_VERSION", "value": "~4"},
                ],
            },
            "tags": tags or {},
        }
        if not consumption_plan and app_service_plan:
            site_definition["server_farm_id"] = (
                f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
                f"/providers/Microsoft.Web/serverfarms/{app_service_plan}"
            )
        # Consumption plan: omit server_farm_id, Azure auto-creates a Y1 plan

        poller = client.web_apps.begin_create_or_update(
            resource_group_name=resource_group,
            name=name,
            site_envelope=site_definition,
        )
        site = poller.result()
        return {
            "success": True,
            "function_app": {
                "name": site.name,
                "id": site.id,
                "default_host_name": site.default_host_name,
                "state": site.state,
                "runtime": f"{runtime} {runtime_version}",
                "tags": site.tags,
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
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_container_app(
    name: str,
    resource_group: str,
    location: str,
    image: str,
    environment_name: str,
    target_port: int = 80,
    cpu: float = 0.5,
    memory: str = "1.0Gi",
    min_replicas: int = 0,
    max_replicas: int = 10,
    env_vars: Optional[Dict[str, str]] = None,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Container App — serverless containers with auto-scaling and
    HTTP ingress. Cheaper than App Service for sporadic traffic, faster cold
    start than Functions for HTTP workloads.

    Use this as a fallback when App Service quota is blocked. Requires a
    Container Apps Environment (environment_name) to already exist in the same
    resource group — create one with `az containerapp env create` or via the
    portal first.

    Args:
        name: Container app name
        resource_group: Resource group
        location: Azure region
        image: Container image (e.g., 'docker.io/library/python:3.11-slim',
               'mcr.microsoft.com/azuredocs/aks-store-demo:latest')
        environment_name: Container Apps Environment name (must already exist)
        target_port: Port the container listens on (default 80)
        cpu: CPU cores (0.25, 0.5, 0.75, 1.0, 1.25, ...)
        memory: Memory (e.g. '0.5Gi', '1.0Gi', '2.0Gi')
        min_replicas: Minimum replicas (0 = scale to zero)
        max_replicas: Maximum replicas
        env_vars: Container environment variables
        tags: Optional tags
        subscription_id: Azure subscription ID
    """
    try:
        from azure.mgmt.appcontainers import ContainerAppsAPIClient
    except ImportError:
        return {
            "success": False,
            "error": "azure-mgmt-appcontainers SDK not installed in this MCP image. Add it to requirements.txt and rebuild.",
        }
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ContainerAppsAPIClient(credential, sub_id)

        # Resolve environment ID
        env_id = (
            f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
            f"/providers/Microsoft.App/managedEnvironments/{environment_name}"
        )

        env_var_list = []
        if env_vars:
            env_var_list = [{"name": k, "value": v} for k, v in env_vars.items()]

        container_app: Dict[str, Any] = {
            "location": location,
            "tags": tags or {},
            "properties": {
                "managed_environment_id": env_id,
                "configuration": {
                    "ingress": {
                        "external": True,
                        "target_port": target_port,
                    },
                },
                "template": {
                    "containers": [{
                        "name": name,
                        "image": image,
                        "resources": {"cpu": cpu, "memory": memory},
                        "env": env_var_list,
                    }],
                    "scale": {"min_replicas": min_replicas, "max_replicas": max_replicas},
                },
            },
        }
        poller = client.container_apps.begin_create_or_update(
            resource_group_name=resource_group,
            container_app_name=name,
            container_app_envelope=container_app,
        )
        result = poller.result()
        return {
            "success": True,
            "container_app": {
                "name": result.name,
                "id": result.id,
                "location": result.location,
                "fqdn": result.configuration.ingress.fqdn if result.configuration and result.configuration.ingress else None,
                "tags": result.tags,
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
        "goldenPrompts": ["list my web apps", "show me web apps", "what web apps do i have"],
        "testFixture": None,
    },
)
async def azure_list_web_apps(
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    runtime_filter: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure Web Apps and Function Apps in a subscription / resource group,
    INCLUDING their runtime stack and version (Python 3.11, Node 20, .NET 8, etc).

    Use this to answer questions like:
      - "List the web apps in resource group X that use Python and show the Python versions"
      - "Which function apps in subscription Y are on Node 18?"

    Args:
        subscription_id: Required scope.
        resource_group: Optional RG filter.
        runtime_filter: Optional filter on runtime name (case-insensitive substring,
            e.g. "python", "node", "dotnet"). Returns ONLY apps matching the filter.
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        client = WebSiteManagementClient(credential, sub_id)
        apps_iter = client.web_apps.list_by_resource_group(resource_group) if resource_group else client.web_apps.list()
        apps = list(apps_iter)

        result = []
        for app in apps:
            app_name = app.name
            rg = app.resource_group or resource_group or 'unknown'
            kind = app.kind or ''
            is_function = 'functionapp' in (kind or '').lower()

            # Get runtime config — needs a separate API call per app
            try:
                config = client.web_apps.get_configuration(rg, app_name)
                # Extract runtime from various possible fields
                linux_fx = (config.linux_fx_version or '').strip()  # e.g. "PYTHON|3.11"
                windows_fx = (config.windows_fx_version or '').strip()
                python_version = (config.python_version or '').strip()
                node_version = (config.node_version or '').strip()
                java_version = (config.java_version or '').strip()
                net_framework = (config.net_framework_version or '').strip()
                php_version = (config.php_version or '').strip()

                # Pick the most informative runtime string
                runtime = linux_fx or windows_fx or ''
                if not runtime:
                    parts = []
                    if python_version: parts.append(f"PYTHON|{python_version}")
                    if node_version: parts.append(f"NODE|{node_version}")
                    if java_version: parts.append(f"JAVA|{java_version}")
                    if net_framework: parts.append(f"DOTNET|{net_framework}")
                    if php_version: parts.append(f"PHP|{php_version}")
                    runtime = ", ".join(parts) if parts else 'unknown'

                runtime_lower = runtime.lower()
                if runtime_filter and runtime_filter.lower() not in runtime_lower:
                    continue

                result.append({
                    "name": app_name,
                    "resource_group": rg,
                    "kind": kind,
                    "is_function_app": is_function,
                    "location": app.location,
                    "state": app.state,
                    "default_hostname": app.default_host_name,
                    "runtime": runtime,
                    "linux_fx_version": linux_fx or None,
                    "windows_fx_version": windows_fx or None,
                    "python_version": python_version or None,
                    "node_version": node_version or None,
                    "java_version": java_version or None,
                })
            except Exception as cfg_err:
                # Still include the app, just with runtime=error
                result.append({
                    "name": app_name,
                    "resource_group": rg,
                    "kind": kind,
                    "is_function_app": is_function,
                    "location": app.location,
                    "state": app.state,
                    "default_hostname": app.default_host_name,
                    "runtime": "error",
                    "config_error": str(cfg_err)[:200],
                })

        return {
            "success": True,
            "subscription_id": sub_id,
            "resource_group": resource_group,
            "runtime_filter": runtime_filter,
            "count": len(result),
            "apps": result,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)
