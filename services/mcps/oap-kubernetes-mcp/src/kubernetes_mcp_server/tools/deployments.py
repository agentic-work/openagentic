"""Deployment tools."""

from datetime import datetime, timezone
from typing import Any, Dict

from .._core import (
    mcp,
    logger,
    is_protected_namespace,
    validate_namespace_write_access,
    get_k8s_client,
)

__all__ = [
    "k8s_list_deployments",
    "k8s_get_deployment",
    "k8s_scale_deployment",
    "k8s_restart_deployment",
]

# ============================================================================
# DEPLOYMENT TOOLS
# ============================================================================

@mcp.tool(description="List all deployments in a namespace with replica counts and status.")
async def k8s_list_deployments(namespace: str = "default") -> Dict[str, Any]:
    """List deployments in a namespace"""
    try:
        _, _, apps_api = get_k8s_client()

        deployments = apps_api.list_namespaced_deployment(namespace)

        deploy_list = []
        for dep in deployments.items:
            deploy_info = {
                "name": dep.metadata.name,
                "namespace": dep.metadata.namespace,
                "replicas": dep.spec.replicas,
                "ready_replicas": dep.status.ready_replicas or 0,
                "available_replicas": dep.status.available_replicas or 0,
                "updated_replicas": dep.status.updated_replicas or 0,
                "created": dep.metadata.creation_timestamp.isoformat() if dep.metadata.creation_timestamp else None,
                "labels": dep.metadata.labels or {},
                "selector": dep.spec.selector.match_labels if dep.spec.selector else {}
            }
            deploy_list.append(deploy_info)

        logger.info(f"Listed {len(deploy_list)} deployments in namespace {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "deployments": deploy_list,
            "count": len(deploy_list)
        }
    except Exception as e:
        logger.error(f"Failed to list deployments in {namespace}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get detailed information about a specific deployment including strategy and conditions.")
async def k8s_get_deployment(namespace: str, deployment_name: str) -> Dict[str, Any]:
    """Get detailed deployment information"""
    try:
        _, _, apps_api = get_k8s_client()

        dep = apps_api.read_namespaced_deployment(deployment_name, namespace)

        # Get conditions
        conditions = []
        if dep.status.conditions:
            for c in dep.status.conditions:
                conditions.append({
                    "type": c.type,
                    "status": c.status,
                    "reason": c.reason,
                    "message": c.message
                })

        result = {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "deployment": {
                "name": dep.metadata.name,
                "namespace": dep.metadata.namespace,
                "replicas": dep.spec.replicas,
                "ready_replicas": dep.status.ready_replicas or 0,
                "available_replicas": dep.status.available_replicas or 0,
                "strategy": dep.spec.strategy.type if dep.spec.strategy else "Unknown",
                "created": dep.metadata.creation_timestamp.isoformat() if dep.metadata.creation_timestamp else None,
                "labels": dep.metadata.labels or {},
                "annotations": dep.metadata.annotations or {},
                "selector": dep.spec.selector.match_labels if dep.spec.selector else {},
                "conditions": conditions
            }
        }

        logger.info(f"Retrieved deployment info: {namespace}/{deployment_name}")
        return result
    except Exception as e:
        logger.error(f"Failed to get deployment {namespace}/{deployment_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Scale a deployment to a specified number of replicas. BLOCKED for deployments in protected namespace.")
async def k8s_scale_deployment(
    namespace: str,
    deployment_name: str,
    replicas: int
) -> Dict[str, Any]:
    """Scale a deployment"""
    try:
        # Prevent scaling in protected namespace
        validate_namespace_write_access(namespace, "scale deployment in")

        _, _, apps_api = get_k8s_client()

        # Patch the deployment
        body = {"spec": {"replicas": replicas}}
        apps_api.patch_namespaced_deployment_scale(
            deployment_name,
            namespace,
            body
        )

        logger.info(f"Scaled deployment {namespace}/{deployment_name} to {replicas} replicas")

        return {
            "success": True,
            "namespace": namespace,
            "deployment": deployment_name,
            "replicas": replicas,
            "message": f"Deployment '{deployment_name}' scaled to {replicas} replicas"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except Exception as e:
        logger.error(f"Failed to scale deployment {namespace}/{deployment_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Restart a deployment by triggering a rollout. BLOCKED for deployments in protected namespace.")
async def k8s_restart_deployment(namespace: str, deployment_name: str) -> Dict[str, Any]:
    """Restart a deployment by patching the pod template"""
    try:
        # Prevent restart in protected namespace
        validate_namespace_write_access(namespace, "restart deployment in")

        _, _, apps_api = get_k8s_client()

        # Patch with a new annotation to trigger rollout
        now = datetime.now(timezone.utc).isoformat()
        body = {
            "spec": {
                "template": {
                    "metadata": {
                        "annotations": {
                            "kubectl.kubernetes.io/restartedAt": now
                        }
                    }
                }
            }
        }

        apps_api.patch_namespaced_deployment(
            deployment_name,
            namespace,
            body
        )

        logger.info(f"Restarted deployment: {namespace}/{deployment_name}")

        return {
            "success": True,
            "namespace": namespace,
            "deployment": deployment_name,
            "message": f"Deployment '{deployment_name}' restart initiated"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except Exception as e:
        logger.error(f"Failed to restart deployment {namespace}/{deployment_name}: {e}")
        return {"success": False, "error": str(e)}
