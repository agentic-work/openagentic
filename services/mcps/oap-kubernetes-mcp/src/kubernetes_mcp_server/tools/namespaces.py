"""Namespace tools (READ-ONLY for the protected namespace)."""

from typing import Any, Dict, Optional

from .._core import (
    mcp,
    logger,
    PROTECTED_NAMESPACE,
    is_protected_namespace,
    validate_namespace_write_access,
    get_k8s_client,
)

__all__ = [
    "k8s_list_namespaces",
    "k8s_get_namespace",
    "k8s_create_namespace",
    "k8s_delete_namespace",
]

# ============================================================================
# NAMESPACE TOOLS (READ-ONLY for protected namespace)
# ============================================================================

@mcp.tool(description="List all namespaces in the Kubernetes cluster. Returns namespace names, status, and labels.")
async def k8s_list_namespaces() -> Dict[str, Any]:
    """List all Kubernetes namespaces"""
    try:
        _, core_api, _ = get_k8s_client()

        namespaces = core_api.list_namespace()

        ns_list = []
        for ns in namespaces.items:
            ns_info = {
                "name": ns.metadata.name,
                "status": ns.status.phase,
                "created": ns.metadata.creation_timestamp.isoformat() if ns.metadata.creation_timestamp else None,
                "labels": ns.metadata.labels or {},
                "is_protected": is_protected_namespace(ns.metadata.name)
            }
            ns_list.append(ns_info)

        logger.info(f"Listed {len(ns_list)} namespaces")

        return {
            "success": True,
            "namespaces": ns_list,
            "protected_namespace": PROTECTED_NAMESPACE,
            "count": len(ns_list)
        }
    except Exception as e:
        logger.error(f"Failed to list namespaces: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get detailed information about a specific namespace including resource quotas and limits.")
async def k8s_get_namespace(namespace: str) -> Dict[str, Any]:
    """Get detailed namespace information"""
    try:
        _, core_api, _ = get_k8s_client()

        ns = core_api.read_namespace(namespace)

        # Get resource quotas if any
        quotas = core_api.list_namespaced_resource_quota(namespace)
        quota_info = []
        for q in quotas.items:
            quota_info.append({
                "name": q.metadata.name,
                "hard": dict(q.status.hard) if q.status.hard else {},
                "used": dict(q.status.used) if q.status.used else {}
            })

        result = {
            "success": True,
            "namespace": {
                "name": ns.metadata.name,
                "status": ns.status.phase,
                "created": ns.metadata.creation_timestamp.isoformat() if ns.metadata.creation_timestamp else None,
                "labels": ns.metadata.labels or {},
                "annotations": ns.metadata.annotations or {},
                "is_protected": is_protected_namespace(namespace)
            },
            "resource_quotas": quota_info
        }

        logger.info(f"Retrieved namespace info: {namespace}")
        return result
    except Exception as e:
        logger.error(f"Failed to get namespace {namespace}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Create a new namespace. BLOCKED for protected namespace.")
async def k8s_create_namespace(
    namespace: str,
    labels: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """Create a new namespace"""
    try:
        # Check if trying to create the protected namespace
        validate_namespace_write_access(namespace, "create")

        from kubernetes import client
        _, core_api, _ = get_k8s_client()

        body = client.V1Namespace(
            metadata=client.V1ObjectMeta(
                name=namespace,
                labels=labels or {}
            )
        )

        result = core_api.create_namespace(body)

        logger.info(f"Created namespace: {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "message": f"Namespace '{namespace}' created successfully"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except Exception as e:
        logger.error(f"Failed to create namespace {namespace}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Delete a namespace. BLOCKED for protected namespace. Use with caution - deletes all resources in the namespace.")
async def k8s_delete_namespace(namespace: str) -> Dict[str, Any]:
    """Delete a namespace"""
    try:
        # Prevent deletion of protected namespace
        validate_namespace_write_access(namespace, "delete")

        _, core_api, _ = get_k8s_client()

        core_api.delete_namespace(namespace)

        logger.info(f"Deleted namespace: {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "message": f"Namespace '{namespace}' deletion initiated"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except Exception as e:
        logger.error(f"Failed to delete namespace {namespace}: {e}")
        return {"success": False, "error": str(e)}
