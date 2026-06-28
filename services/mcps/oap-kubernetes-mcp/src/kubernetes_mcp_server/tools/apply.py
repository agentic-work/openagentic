"""Apply / patch tools."""

from typing import Any, Dict, Optional

from .._core import (
    mcp,
    logger,
    validate_namespace_write_access,
    get_k8s_client,
)

__all__ = [
    "k8s_apply_yaml",
    "k8s_patch_resource",
]

# ============================================================================
# APPLY/PATCH TOOLS
# ============================================================================

@mcp.tool(description="Apply a YAML manifest to the cluster. BLOCKED for resources in protected namespace.")
async def k8s_apply_yaml(
    yaml_content: str,
    namespace: Optional[str] = None
) -> Dict[str, Any]:
    """Apply a YAML manifest to create or update resources"""
    try:
        import yaml as pyyaml
        from kubernetes import client, utils

        api_client, _, _ = get_k8s_client()

        # Parse YAML (may contain multiple documents)
        docs = list(pyyaml.safe_load_all(yaml_content))
        results = []

        for doc in docs:
            if doc is None:
                continue

            # Get namespace from doc or parameter
            doc_namespace = doc.get("metadata", {}).get("namespace") or namespace or "default"

            # Check protected namespace
            validate_namespace_write_access(doc_namespace, "apply resources to")

            # Apply using kubernetes utils
            try:
                result = utils.create_from_dict(api_client, doc, namespace=doc_namespace)
                kind = doc.get("kind", "Unknown")
                name = doc.get("metadata", {}).get("name", "unknown")
                results.append({
                    "kind": kind,
                    "name": name,
                    "namespace": doc_namespace,
                    "status": "created"
                })
            except utils.FailToCreateError as e:
                # Try patch/update if create fails
                kind = doc.get("kind", "Unknown")
                name = doc.get("metadata", {}).get("name", "unknown")
                results.append({
                    "kind": kind,
                    "name": name,
                    "namespace": doc_namespace,
                    "status": "error",
                    "error": str(e)
                })

        logger.info(f"Applied {len(results)} resources from YAML")

        return {
            "success": True,
            "results": results,
            "count": len(results)
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except Exception as e:
        logger.error(f"Failed to apply YAML: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Patch a Kubernetes resource using strategic merge patch. BLOCKED for protected namespace.")
async def k8s_patch_resource(
    kind: str,
    name: str,
    namespace: str,
    patch: Dict[str, Any]
) -> Dict[str, Any]:
    """Patch a resource with strategic merge patch"""
    try:
        validate_namespace_write_access(namespace, f"patch {kind} in")

        from kubernetes import client
        api_client, core_api, apps_api = get_k8s_client()

        # Route to appropriate API based on kind
        kind_lower = kind.lower()

        if kind_lower == "deployment":
            result = apps_api.patch_namespaced_deployment(name, namespace, patch)
        elif kind_lower == "service":
            result = core_api.patch_namespaced_service(name, namespace, patch)
        elif kind_lower == "configmap":
            result = core_api.patch_namespaced_config_map(name, namespace, patch)
        elif kind_lower == "secret":
            result = core_api.patch_namespaced_secret(name, namespace, patch)
        elif kind_lower == "pod":
            result = core_api.patch_namespaced_pod(name, namespace, patch)
        elif kind_lower == "statefulset":
            apps_api = client.AppsV1Api()
            result = apps_api.patch_namespaced_stateful_set(name, namespace, patch)
        elif kind_lower == "daemonset":
            apps_api = client.AppsV1Api()
            result = apps_api.patch_namespaced_daemon_set(name, namespace, patch)
        else:
            return {"success": False, "error": f"Unsupported kind: {kind}. Supported: deployment, service, configmap, secret, pod, statefulset, daemonset"}

        logger.info(f"Patched {kind}/{name} in {namespace}")

        return {
            "success": True,
            "kind": kind,
            "name": name,
            "namespace": namespace,
            "message": f"Resource {kind}/{name} patched successfully"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except Exception as e:
        logger.error(f"Failed to patch {kind}/{name} in {namespace}: {e}")
        return {"success": False, "error": str(e)}
