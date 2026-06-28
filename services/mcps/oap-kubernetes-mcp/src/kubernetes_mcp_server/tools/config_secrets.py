"""ConfigMap and Secret tools."""

from typing import Any, Dict

from .._core import (
    mcp,
    logger,
    is_protected_namespace,
    get_k8s_client,
)

__all__ = [
    "k8s_list_configmaps",
    "k8s_get_configmap",
    "k8s_list_secrets",
]

# ============================================================================
# CONFIGMAP AND SECRET TOOLS
# ============================================================================

@mcp.tool(description="List all ConfigMaps in a namespace.")
async def k8s_list_configmaps(namespace: str = "default") -> Dict[str, Any]:
    """List ConfigMaps in a namespace"""
    try:
        _, core_api, _ = get_k8s_client()

        configmaps = core_api.list_namespaced_config_map(namespace)

        cm_list = []
        for cm in configmaps.items:
            cm_info = {
                "name": cm.metadata.name,
                "namespace": cm.metadata.namespace,
                "data_keys": list((cm.data or {}).keys()),
                "created": cm.metadata.creation_timestamp.isoformat() if cm.metadata.creation_timestamp else None,
                "labels": cm.metadata.labels or {}
            }
            cm_list.append(cm_info)

        logger.info(f"Listed {len(cm_list)} configmaps in namespace {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "configmaps": cm_list,
            "count": len(cm_list)
        }
    except Exception as e:
        logger.error(f"Failed to list configmaps in {namespace}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get a ConfigMap with its data. Safe to view in any namespace.")
async def k8s_get_configmap(namespace: str, configmap_name: str) -> Dict[str, Any]:
    """Get ConfigMap data"""
    try:
        _, core_api, _ = get_k8s_client()

        cm = core_api.read_namespaced_config_map(configmap_name, namespace)

        result = {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "configmap": {
                "name": cm.metadata.name,
                "namespace": cm.metadata.namespace,
                "data": cm.data or {},
                "binary_data_keys": list((cm.binary_data or {}).keys()),
                "labels": cm.metadata.labels or {},
                "annotations": cm.metadata.annotations or {},
                "created": cm.metadata.creation_timestamp.isoformat() if cm.metadata.creation_timestamp else None
            }
        }

        logger.info(f"Retrieved configmap: {namespace}/{configmap_name}")
        return result
    except Exception as e:
        logger.error(f"Failed to get configmap {namespace}/{configmap_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="List all Secrets in a namespace (values are NOT returned for security).")
async def k8s_list_secrets(namespace: str = "default") -> Dict[str, Any]:
    """List Secrets in a namespace (without values)"""
    try:
        _, core_api, _ = get_k8s_client()

        secrets = core_api.list_namespaced_secret(namespace)

        secret_list = []
        for secret in secrets.items:
            secret_info = {
                "name": secret.metadata.name,
                "namespace": secret.metadata.namespace,
                "type": secret.type,
                "data_keys": list((secret.data or {}).keys()),
                "created": secret.metadata.creation_timestamp.isoformat() if secret.metadata.creation_timestamp else None,
                "labels": secret.metadata.labels or {}
            }
            secret_list.append(secret_info)

        logger.info(f"Listed {len(secret_list)} secrets in namespace {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "secrets": secret_list,
            "count": len(secret_list),
            "note": "Secret values are not returned for security. Use k8s_get_secret to view specific secret data."
        }
    except Exception as e:
        logger.error(f"Failed to list secrets in {namespace}: {e}")
        return {"success": False, "error": str(e)}
