"""Azure MCP — ai tools.

Azure AI Foundry (AIF) deployments, projects, models, guardrails, agents.
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
    'aif_list_deployments',
    'aif_create_deployment',
    'aif_delete_deployment',
    'aif_get_deployment_status',
    'aif_list_projects',
    'aif_get_project',
    'aif_create_project',
    'aif_delete_project',
    'aif_list_models',
    'aif_get_model',
    'aif_list_model_versions',
    'aif_get_model_version',
    'aif_scale_deployment',
    'aif_update_deployment',
    'aif_project_status',
    'aif_list_guardrails',
    'aif_create_guardrail',
    'aif_delete_guardrail',
    'aif_list_agents',
    'aif_create_agent',
    'aif_delete_agent',
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
async def aif_list_deployments(
    resource_group: str,
    account_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List all Azure AI Foundry / Azure OpenAI deployments on a resource.

    Args:
        resource_group: Azure resource group name
        account_name: Azure OpenAI / AI Foundry account name
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        deployments = list(client.deployments.list(resource_group, account_name))
        results = []
        for d in deployments:
            results.append({
                "name": d.name,
                "model": d.properties.model.name if d.properties and d.properties.model else "unknown",
                "model_version": d.properties.model.version if d.properties and d.properties.model else "",
                "scale_type": d.sku.name if d.sku else "unknown",
                "capacity": d.sku.capacity if d.sku else 0,
                "status": d.properties.provisioning_state if d.properties else "unknown",
            })

        return {
            "success": True,
            "deployments": results,
            "count": len(results),
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
async def aif_create_deployment(
    resource_group: str,
    account_name: str,
    deployment_name: str,
    model_name: str,
    model_version: str = "",
    sku_name: str = "GlobalStandard",
    sku_capacity: int = 1,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create a new Azure AI Foundry / Azure OpenAI model deployment.

    Args:
        resource_group: Azure resource group name
        account_name: Azure OpenAI / AI Foundry account name
        deployment_name: Name for the new deployment
        model_name: Model to deploy (e.g. gpt-4o, o3-mini)
        model_version: Model version (latest if empty)
        sku_name: SKU type (GlobalStandard, Standard, ProvisionedManaged)
        sku_capacity: Capacity units (TPM in thousands for Standard)
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        from azure.mgmt.cognitiveservices.models import Deployment, DeploymentModel, Sku

        client = CognitiveServicesManagementClient(credential, sub_id)

        deployment = Deployment(
            sku=Sku(name=sku_name, capacity=sku_capacity),
            properties={"model": DeploymentModel(name=model_name, version=model_version or None, format="OpenAI")},
        )

        result = client.deployments.begin_create_or_update(
            resource_group, account_name, deployment_name, deployment
        ).result()

        return {
            "success": True,
            "status": "created",
            "name": result.name,
            "model": model_name,
            "provisioning_state": result.properties.provisioning_state if result.properties else "unknown",
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)


@mcp.tool(
    annotations={
        "destructiveHint": True,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-destructive",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "averageLatencyMs": 5000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_delete_deployment(
    resource_group: str,
    account_name: str,
    deployment_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Delete an Azure AI Foundry / Azure OpenAI deployment.

    Args:
        resource_group: Azure resource group name
        account_name: Azure OpenAI / AI Foundry account name
        deployment_name: Deployment to delete
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        client.deployments.begin_delete(resource_group, account_name, deployment_name).result()

        return {
            "success": True,
            "status": "deleted",
            "deployment": deployment_name,
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
async def aif_get_deployment_status(
    resource_group: str,
    account_name: str,
    deployment_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get status and details of an Azure AI Foundry / Azure OpenAI deployment.

    Args:
        resource_group: Azure resource group name
        account_name: Azure OpenAI / AI Foundry account name
        deployment_name: Deployment name to check
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        d = client.deployments.get(resource_group, account_name, deployment_name)

        result = {
            "success": True,
            "name": d.name,
            "provisioning_state": d.properties.provisioning_state if d.properties else "unknown",
            "model": d.properties.model.name if d.properties and d.properties.model else "unknown",
            "model_version": d.properties.model.version if d.properties and d.properties.model else "",
            "scale_type": d.sku.name if d.sku else "unknown",
            "capacity": d.sku.capacity if d.sku else 0,
            "rate_limits": [],
            "executed_as": user_info,
        }

        if d.properties and hasattr(d.properties, 'rate_limits') and d.properties.rate_limits:
            for rl in d.properties.rate_limits:
                result["rate_limits"].append({
                    "key": rl.key,
                    "renewal_period": rl.renewal_period,
                    "count": rl.count,
                })

        return result
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
async def aif_list_projects(
    resource_group: str,
    account_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List AI Foundry projects on an account.

    Use when the user asks "list my AIF projects", "show AI Foundry projects",
    "what projects do I have in <account>". Returns
    {success, count, projects:[{name, id, location, description}], executed_as}.
    Backed by the data-plane SDK (azure-ai-projects); falls back to a graceful
    diagnostic when the SDK isn't installed in this image.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image. "
                         "Add it to requirements.txt and rebuild the MCP to enable Project management.",
            }
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential)
        projects = await _in_thread(lambda: list(client.projects.list()))
        return {
            "success": True,
            "count": len(projects),
            "projects": [
                {
                    "name": getattr(p, "name", None),
                    "id": getattr(p, "id", None),
                    "location": getattr(p, "location", None),
                    "description": getattr(p, "description", None),
                }
                for p in projects
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
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_get_project(
    resource_group: str,
    account_name: str,
    project_id: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get one AI Foundry project's details by id (or name).

    Use when the user asks "show me project X details", "describe AIF project Y",
    "what's the status of project Z". Returns
    {success, project:{name, id, location, description, properties}, executed_as}.
    Data-plane SDK call (azure-ai-projects).

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        project_id: Project id or name
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image.",
            }
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential)
        p = await _in_thread(lambda: client.projects.get(project_id))
        return {
            "success": True,
            "project": {
                "name": getattr(p, "name", None),
                "id": getattr(p, "id", None),
                "location": getattr(p, "location", None),
                "description": getattr(p, "description", None),
                "properties": getattr(p, "properties", {}) if hasattr(p, "properties") else {},
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
async def aif_create_project(
    resource_group: str,
    account_name: str,
    project_name: str,
    description: str = "",
    location: str = "",
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create an AI Foundry project on an account.

    Use when the user asks "create AIF project named X", "make a new AI Foundry
    project under <account>", "spin up project Y for our team". Returns
    {success, status:'created', project:{name, id}, executed_as}. Data-plane
    SDK call (azure-ai-projects.projects.create).

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        project_name: Display name for the new project
        description: Optional description
        location: Region (defaults to the account's region when empty)
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image.",
            }
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential)
        project = await _in_thread(
            lambda: client.projects.create(
                name=project_name,
                description=description or None,
                location=location or account.location,
            )
        )
        return {
            "success": True,
            "status": "created",
            "project": {
                "name": getattr(project, "name", project_name),
                "id": getattr(project, "id", None),
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)


@mcp.tool(
    annotations={
        "destructiveHint": True,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-destructive",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "averageLatencyMs": 5000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_delete_project(
    resource_group: str,
    account_name: str,
    project_id: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Delete an AI Foundry project by id.

    Use when the user asks "delete AIF project X", "remove project Y from my
    account", "tear down the foo project". Returns
    {success, status:'deleted', project_id, executed_as}. Data-plane SDK
    call (azure-ai-projects.projects.delete).

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        project_id: Project id (from aif_list_projects)
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image.",
            }
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential)
        await _in_thread(lambda: client.projects.delete(project_id))
        return {
            "success": True,
            "status": "deleted",
            "project_id": project_id,
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
async def aif_list_models(
    resource_group: str,
    account_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List models available in an AIF / Azure OpenAI account catalog.

    Use when the user asks "what models are available in <account>", "list AIF
    models", "show me the OpenAI model catalog on this resource". Returns
    {success, count, models:[{name, format, source, capabilities}], executed_as}.
    Backed by management-plane
    `cognitiveservices.models.client.accounts.list_models(rg, account)`.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Cognitive Services account name
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)
        models = await _in_thread(lambda: list(client.accounts.list_models(resource_group, account_name)))
        results = []
        for m in models:
            mm = getattr(m, "model", None)
            results.append({
                "name": getattr(mm, "name", None) if mm else None,
                "version": getattr(mm, "version", None) if mm else None,
                "format": getattr(mm, "format", None) if mm else None,
                "source": getattr(mm, "source", None) if mm else None,
                "capabilities": getattr(m, "capabilities", {}) or {},
                "lifecycle_status": getattr(m, "lifecycle_status", None),
                "is_default_version": getattr(m, "is_default_version", None),
            })
        return {
            "success": True,
            "count": len(results),
            "models": results,
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
async def aif_get_model(
    resource_group: str,
    account_name: str,
    model_id: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get one model's catalog entry (default version) from an AIF account.

    Use when the user asks "describe model gpt-4o on <account>", "show me details
    of <model>", "what's the lifecycle status of <model>". Returns
    {success, model:{name, version, format, capabilities, lifecycle_status,
    is_default_version}, executed_as}. Resolves by filtering the management-plane
    `accounts.list_models` response (the management API returns the catalog
    list rather than a per-model GET).

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Cognitive Services account name
        model_id: Model name (e.g. 'gpt-4o', 'text-embedding-3-large')
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)
        models = await _in_thread(lambda: list(client.accounts.list_models(resource_group, account_name)))
        for m in models:
            mm = getattr(m, "model", None)
            if mm and getattr(mm, "name", None) == model_id and getattr(m, "is_default_version", False):
                return {
                    "success": True,
                    "model": {
                        "name": getattr(mm, "name", None),
                        "version": getattr(mm, "version", None),
                        "format": getattr(mm, "format", None),
                        "source": getattr(mm, "source", None),
                        "capabilities": getattr(m, "capabilities", {}) or {},
                        "lifecycle_status": getattr(m, "lifecycle_status", None),
                        "is_default_version": True,
                    },
                    "executed_as": user_info,
                }
        # Fall back to first match if no default-version row exists
        for m in models:
            mm = getattr(m, "model", None)
            if mm and getattr(mm, "name", None) == model_id:
                return {
                    "success": True,
                    "model": {
                        "name": getattr(mm, "name", None),
                        "version": getattr(mm, "version", None),
                        "format": getattr(mm, "format", None),
                        "source": getattr(mm, "source", None),
                        "capabilities": getattr(m, "capabilities", {}) or {},
                        "lifecycle_status": getattr(m, "lifecycle_status", None),
                        "is_default_version": getattr(m, "is_default_version", False),
                    },
                    "executed_as": user_info,
                }
        return {"success": False, "error": f"Model {model_id} not found in account {account_name}"}
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
async def aif_list_model_versions(
    resource_group: str,
    account_name: str,
    model_id: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List all versions for one model in an AIF account catalog.

    Use when the user asks "what versions of gpt-4o are available", "list
    versions for model X", "show me model-Y version history on <account>".
    Returns {success, model_id, count, versions:[{version, format, source,
    capabilities, lifecycle_status, is_default_version}], executed_as}.
    Filters the management-plane `accounts.list_models` response by name.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Cognitive Services account name
        model_id: Model name to enumerate versions for
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)
        models = await _in_thread(lambda: list(client.accounts.list_models(resource_group, account_name)))
        versions = []
        for m in models:
            mm = getattr(m, "model", None)
            if not mm or getattr(mm, "name", None) != model_id:
                continue
            versions.append({
                "version": getattr(mm, "version", None),
                "format": getattr(mm, "format", None),
                "source": getattr(mm, "source", None),
                "capabilities": getattr(m, "capabilities", {}) or {},
                "lifecycle_status": getattr(m, "lifecycle_status", None),
                "is_default_version": getattr(m, "is_default_version", False),
            })
        return {
            "success": True,
            "model_id": model_id,
            "count": len(versions),
            "versions": versions,
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
async def aif_get_model_version(
    resource_group: str,
    account_name: str,
    model_id: str,
    version: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get one specific (model, version) pair's catalog entry.

    Use when the user asks "describe gpt-4o version 2024-05-13", "show me
    version X of model Y on <account>", "is version Z still in lifecycle".
    Returns {success, model:{name, version, format, capabilities,
    lifecycle_status, is_default_version}, executed_as}. Filters
    `accounts.list_models` by (name, version).

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Cognitive Services account name
        model_id: Model name (e.g. 'gpt-4o')
        version: Model version (e.g. '2024-05-13')
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)
        models = await _in_thread(lambda: list(client.accounts.list_models(resource_group, account_name)))
        for m in models:
            mm = getattr(m, "model", None)
            if mm and getattr(mm, "name", None) == model_id and getattr(mm, "version", None) == version:
                return {
                    "success": True,
                    "model": {
                        "name": getattr(mm, "name", None),
                        "version": getattr(mm, "version", None),
                        "format": getattr(mm, "format", None),
                        "source": getattr(mm, "source", None),
                        "capabilities": getattr(m, "capabilities", {}) or {},
                        "lifecycle_status": getattr(m, "lifecycle_status", None),
                        "is_default_version": getattr(m, "is_default_version", False),
                    },
                    "executed_as": user_info,
                }
        return {"success": False, "error": f"Model {model_id} version {version} not found in account {account_name}"}
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
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_scale_deployment(
    resource_group: str,
    account_name: str,
    deployment_name: str,
    sku_name: str = "",
    capacity: int = 0,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Scale an AIF deployment — change SKU tier and/or TPM capacity in-place.

    Use when the user asks "scale deployment X to Y TPM", "bump capacity on
    deployment Z to N", "change SKU on deployment W to GlobalStandard". Existing
    model + version are preserved. Returns
    {success, status:'scaled', name, sku_name, capacity, provisioning_state,
    executed_as}. Calls
    `cognitiveservices.deployments.client.deployments.begin_create_or_update`
    with merged sku + existing model.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Azure OpenAI account name
        deployment_name: Deployment to scale
        sku_name: New SKU (GlobalStandard / Standard / ProvisionedManaged) — keep current if empty
        capacity: New capacity units (TPM in thousands) — keep current if 0
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        from azure.mgmt.cognitiveservices.models import Deployment, DeploymentModel, Sku
        client = CognitiveServicesManagementClient(credential, sub_id)

        existing = await _in_thread(lambda: client.deployments.get(resource_group, account_name, deployment_name))
        existing_model = existing.properties.model if existing.properties and existing.properties.model else None
        existing_sku = existing.sku
        if not existing_model:
            return {"success": False, "error": f"Deployment {deployment_name} has no model property; cannot scale"}

        new_sku_name = sku_name or (existing_sku.name if existing_sku else "Standard")
        new_capacity = capacity or (existing_sku.capacity if existing_sku else 1)
        new_deployment = Deployment(
            sku=Sku(name=new_sku_name, capacity=new_capacity),
            properties={"model": DeploymentModel(
                name=getattr(existing_model, "name", None),
                version=getattr(existing_model, "version", None),
                format=getattr(existing_model, "format", "OpenAI"),
            )},
        )
        result = await _in_thread(
            lambda: client.deployments.begin_create_or_update(
                resource_group, account_name, deployment_name, new_deployment
            ).result()
        )
        return {
            "success": True,
            "status": "scaled",
            "name": result.name,
            "sku_name": new_sku_name,
            "capacity": new_capacity,
            "provisioning_state": result.properties.provisioning_state if result.properties else "unknown",
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
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_update_deployment(
    resource_group: str,
    account_name: str,
    deployment_name: str,
    model_name: str = "",
    model_version: str = "",
    sku_name: str = "",
    capacity: int = 0,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Update an AIF deployment — swap model, version, SKU, and/or capacity.

    Use when the user asks "update deployment X to use gpt-4o-mini", "switch
    deployment Y to model Z version W", "upgrade my deployment to the latest
    model version". Empty fields keep the existing value. Returns
    {success, status:'updated', name, model, model_version, sku_name, capacity,
    provisioning_state, executed_as}. Calls
    `cognitiveservices.deployments.client.deployments.begin_create_or_update`.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Azure OpenAI account name
        deployment_name: Deployment to update
        model_name: New model (e.g. gpt-4o-mini) — keep current if empty
        model_version: New model version — keep current if empty
        sku_name: New SKU — keep current if empty
        capacity: New capacity (TPM thousands) — keep current if 0
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        from azure.mgmt.cognitiveservices.models import Deployment, DeploymentModel, Sku
        client = CognitiveServicesManagementClient(credential, sub_id)

        existing = await _in_thread(lambda: client.deployments.get(resource_group, account_name, deployment_name))
        existing_model = existing.properties.model if existing.properties and existing.properties.model else None
        existing_sku = existing.sku

        new_model_name = model_name or (getattr(existing_model, "name", None) if existing_model else None)
        new_model_version = model_version or (getattr(existing_model, "version", None) if existing_model else None)
        new_format = (getattr(existing_model, "format", "OpenAI") if existing_model else "OpenAI")
        new_sku_name = sku_name or (existing_sku.name if existing_sku else "Standard")
        new_capacity = capacity or (existing_sku.capacity if existing_sku else 1)
        if not new_model_name:
            return {"success": False, "error": f"Deployment {deployment_name} has no model_name; pass model_name explicitly"}

        new_deployment = Deployment(
            sku=Sku(name=new_sku_name, capacity=new_capacity),
            properties={"model": DeploymentModel(
                name=new_model_name,
                version=new_model_version or None,
                format=new_format,
            )},
        )
        result = await _in_thread(
            lambda: client.deployments.begin_create_or_update(
                resource_group, account_name, deployment_name, new_deployment
            ).result()
        )
        return {
            "success": True,
            "status": "updated",
            "name": result.name,
            "model": new_model_name,
            "model_version": new_model_version,
            "sku_name": new_sku_name,
            "capacity": new_capacity,
            "provisioning_state": result.properties.provisioning_state if result.properties else "unknown",
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
async def aif_project_status(
    resource_group: str,
    account_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """One-shot overview of an Azure AI Foundry account: location, SKU,
    provisioning state, capabilities, deployment count, RAI policy count,
    and quota usage.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Cognitive Services account name
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        account = await _in_thread(lambda: client.accounts.get(resource_group, account_name))
        deployments = await _in_thread(lambda: list(client.deployments.list(resource_group, account_name)))
        # RAI policies live under the same account; some SDK versions expose
        # them as `rai_policies` and older ones do not. Tolerate either.
        rai_policies: List[Any] = []
        try:
            if hasattr(client, "rai_policies"):
                rai_policies = await _in_thread(lambda: list(client.rai_policies.list(resource_group, account_name)))
        except Exception as e:
            logger.debug(f"[aif_project_status] rai_policies.list skipped: {e}")

        usages: List[Dict[str, Any]] = []
        try:
            location = account.location
            for u in await _in_thread(lambda: list(client.usages.list(location))):
                usages.append({
                    "name": getattr(u.name, "value", None) if u.name else None,
                    "current_value": getattr(u, "current_value", None),
                    "limit": getattr(u, "limit", None),
                    "unit": getattr(u, "unit", None),
                })
        except Exception as e:
            logger.debug(f"[aif_project_status] usages.list skipped: {e}")

        return {
            "success": True,
            "account": {
                "name": account.name,
                "location": account.location,
                "kind": account.kind,
                "sku": account.sku.name if account.sku else None,
                "provisioning_state": getattr(account.properties, "provisioning_state", None) if account.properties else None,
                "endpoint": getattr(account.properties, "endpoint", None) if account.properties else None,
                "tags": account.tags or {},
            },
            "deployment_count": len(deployments),
            "deployments": [
                {
                    "name": d.name,
                    "model": d.properties.model.name if d.properties and d.properties.model else None,
                    "provisioning_state": d.properties.provisioning_state if d.properties else None,
                }
                for d in deployments
            ],
            "guardrail_count": len(rai_policies),
            "guardrails": [{"name": p.name} for p in rai_policies],
            "quota_usages": usages,
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
async def aif_list_guardrails(
    resource_group: str,
    account_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List Responsible-AI content-safety policies (guardrails) on an
    Azure AI Foundry / Cognitive Services account.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        if not hasattr(client, "rai_policies"):
            return {
                "success": False,
                "error": "RAI policy management not available in this azure-mgmt-cognitiveservices version. "
                         "Upgrade the SDK to expose client.rai_policies."
            }
        policies = await _in_thread(lambda: list(client.rai_policies.list(resource_group, account_name)))
        return {
            "success": True,
            "count": len(policies),
            "policies": [
                {
                    "name": p.name,
                    "type": getattr(p, "type", None),
                    "mode": getattr(p.properties, "mode", None) if getattr(p, "properties", None) else None,
                    "base_policy_name": getattr(p.properties, "base_policy_name", None) if getattr(p, "properties", None) else None,
                }
                for p in policies
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
async def aif_create_guardrail(
    resource_group: str,
    account_name: str,
    policy_name: str,
    base_policy_name: str = "Microsoft.Default",
    mode: str = "Default",
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create or update a Responsible-AI content-safety policy on an
    Azure AI Foundry account.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        policy_name: New policy name
        base_policy_name: Inherits filters from this base (default: "Microsoft.Default")
        mode: 'Default' / 'Asynchronous_filter' / 'Deferred'
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        if not hasattr(client, "rai_policies"):
            return {
                "success": False,
                "error": "RAI policy management not available in this azure-mgmt-cognitiveservices version."
            }

        body = {
            "properties": {
                "basePolicyName": base_policy_name,
                "mode": mode,
            }
        }
        result = await _in_thread(
            lambda: client.rai_policies.create_or_update(resource_group, account_name, policy_name, body)
        )
        return {
            "success": True,
            "status": "created_or_updated",
            "name": result.name if hasattr(result, "name") else policy_name,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)


@mcp.tool(
    annotations={
        "destructiveHint": True,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-destructive",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "averageLatencyMs": 5000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_delete_guardrail(
    resource_group: str,
    account_name: str,
    policy_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Delete a Responsible-AI content-safety policy from an AIF account.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        policy_name: Policy to delete
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        if not hasattr(client, "rai_policies"):
            return {
                "success": False,
                "error": "RAI policy management not available in this azure-mgmt-cognitiveservices version."
            }
        await _in_thread(lambda: client.rai_policies.delete(resource_group, account_name, policy_name))
        return {"success": True, "status": "deleted", "policy": policy_name, "executed_as": user_info}
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
async def aif_list_agents(
    resource_group: str,
    account_name: str,
    project_name: str = "",
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List AI Foundry Agent-service agents under a project (preview).

    A2S = Agent-to-System: a connected agent definition that wires a model
    deployment to a set of tools / functions / data sources. Implementation
    requires the data-plane SDK; this tool surfaces a graceful diagnostic
    when the runtime SDK isn't available so the admin UI can degrade.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        project_name: AIF project (data-plane scope) — required by the SDK
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        # The Agent service is a data-plane API; the management-plane
        # CognitiveServicesManagementClient does not expose it. The
        # Azure SDK ships a separate package
        # `azure.ai.projects` for this; we attempt an import and bail
        # gracefully if it isn't installed in this MCP image.
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image. "
                         "Add it to requirements.txt and rebuild the MCP to enable Agent management.",
            }
        # Resolve endpoint via management plane
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential, project_name=project_name or account_name)
        agents = await _in_thread(lambda: list(client.agents.list_agents()))
        return {
            "success": True,
            "count": len(agents),
            "agents": [
                {
                    "id": getattr(a, "id", None),
                    "name": getattr(a, "name", None),
                    "model": getattr(a, "model", None),
                    "instructions": getattr(a, "instructions", None),
                }
                for a in agents
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
async def aif_create_agent(
    resource_group: str,
    account_name: str,
    agent_name: str,
    model: str,
    instructions: str,
    project_name: str = "",
    tools: Optional[List[Dict[str, Any]]] = None,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create an AI Foundry Agent-service agent (A2S — Agent-to-System).

    Wires a deployed model to a set of tools / data sources via the
    AI Foundry data-plane SDK. Returns the new agent's id.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        agent_name: Display name for the agent
        model: Deployment name of the underlying model (must exist on the account)
        instructions: System prompt / instructions
        project_name: AIF project (defaults to account_name when empty)
        tools: Optional list of tool definitions (function/code-interpreter/file-search)
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image. "
                         "Add it to requirements.txt and rebuild the MCP to enable Agent management.",
            }
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential, project_name=project_name or account_name)
        agent = await _in_thread(
            lambda: client.agents.create_agent(
                model=model,
                name=agent_name,
                instructions=instructions,
                tools=tools or [],
            )
        )
        return {
            "success": True,
            "status": "created",
            "id": getattr(agent, "id", None),
            "name": getattr(agent, "name", agent_name),
            "model": model,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)


@mcp.tool(
    annotations={
        "destructiveHint": True,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-destructive",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "averageLatencyMs": 5000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_delete_agent(
    resource_group: str,
    account_name: str,
    agent_id: str,
    project_name: str = "",
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Delete an AI Foundry Agent-service agent by id.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        agent_id: Agent id (from aif_list_agents)
        project_name: AIF project (defaults to account_name when empty)
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image.",
            }
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential, project_name=project_name or account_name)
        await _in_thread(lambda: client.agents.delete_agent(agent_id))
        return {"success": True, "status": "deleted", "agent_id": agent_id, "executed_as": user_info}
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)
