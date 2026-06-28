"""Azure MCP — aks tools.

Azure Kubernetes Service (AKS) tools.
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
    'azure_list_aks_clusters',
    'azure_get_aks_cluster',
    'azure_get_aks_credentials',
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
        "goldenPrompts": ["list my aks clusters", "show me aks clusters", "what aks clusters do i have"],
        "testFixture": None,
    },
)
async def azure_list_aks_clusters(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List AKS (Azure Kubernetes Service) clusters.

    Args:
        resource_group: Filter by resource group (lists all if not specified)
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ContainerServiceClient(credential, sub_id)

        if resource_group:
            clusters = list(client.managed_clusters.list_by_resource_group(resource_group))
        else:
            clusters = list(client.managed_clusters.list())

        return {
            "success": True,
            "count": len(clusters),
            "clusters": [
                {
                    "name": c.name,
                    "location": c.location,
                    "resource_group": c.id.split('/')[4] if c.id else None,
                    "kubernetes_version": c.kubernetes_version,
                    "provisioning_state": c.provisioning_state,
                    "power_state": c.power_state.code if c.power_state else None,
                    "fqdn": c.fqdn,
                    "node_resource_group": c.node_resource_group,
                    "agent_pool_count": len(c.agent_pool_profiles) if c.agent_pool_profiles else 0,
                    "tags": c.tags or {}
                }
                for c in clusters
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
        "goldenPrompts": ["get aks cluster details", "show me one aks cluster"],
        "testFixture": None,
    },
)
async def azure_get_aks_cluster(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get detailed information about an AKS cluster.

    Args:
        name: Cluster name
        resource_group: Resource group containing the cluster
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ContainerServiceClient(credential, sub_id)
        cluster = client.managed_clusters.get(resource_group, name)

        return {
            "success": True,
            "cluster": {
                "name": cluster.name,
                "id": cluster.id,
                "location": cluster.location,
                "kubernetes_version": cluster.kubernetes_version,
                "provisioning_state": cluster.provisioning_state,
                "power_state": cluster.power_state.code if cluster.power_state else None,
                "fqdn": cluster.fqdn,
                "api_server_url": f"https://{cluster.fqdn}:443" if cluster.fqdn else None,
                "node_resource_group": cluster.node_resource_group,
                "network_profile": {
                    "network_plugin": cluster.network_profile.network_plugin if cluster.network_profile else None,
                    "service_cidr": cluster.network_profile.service_cidr if cluster.network_profile else None,
                    "dns_service_ip": cluster.network_profile.dns_service_ip if cluster.network_profile else None,
                } if cluster.network_profile else None,
                "agent_pools": [
                    {
                        "name": pool.name,
                        "count": pool.count,
                        "vm_size": pool.vm_size,
                        "os_type": pool.os_type,
                        "mode": pool.mode,
                        "kubernetes_version": pool.orchestrator_version
                    }
                    for pool in (cluster.agent_pool_profiles or [])
                ],
                "tags": cluster.tags or {}
            },
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
        "goldenPrompts": ["get aks credentials details", "show me one aks credentials"],
        "testFixture": None,
    },
)
async def azure_get_aks_credentials(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    admin: bool = False,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get kubeconfig credentials for an AKS cluster.

    Args:
        name: Cluster name
        resource_group: Resource group containing the cluster
        subscription_id: Azure subscription ID
        admin: Get admin credentials (requires elevated permissions)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ContainerServiceClient(credential, sub_id)

        if admin:
            creds = client.managed_clusters.list_cluster_admin_credentials(resource_group, name)
        else:
            creds = client.managed_clusters.list_cluster_user_credentials(resource_group, name)

        kubeconfigs = []
        for kc in (creds.kubeconfigs or []):
            kubeconfigs.append({
                "name": kc.name,
                "value": kc.value.decode('utf-8') if isinstance(kc.value, bytes) else kc.value
            })

        return {
            "success": True,
            "cluster_name": name,
            "credential_type": "admin" if admin else "user",
            "kubeconfigs": kubeconfigs,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)
