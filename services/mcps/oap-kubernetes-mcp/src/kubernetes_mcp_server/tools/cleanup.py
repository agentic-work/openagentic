"""Pod cleanup tools."""

from typing import Any, Dict

from .._core import (
    mcp,
    logger,
    validate_namespace_write_access,
    get_k8s_client,
)

__all__ = [
    "k8s_cleanup_pods",
]

# ============================================================================
# POD CLEANUP TOOLS
# ============================================================================

@mcp.tool(description="Clean up failed, evicted, or stuck pods in a namespace. BLOCKED for protected namespace.")
async def k8s_cleanup_pods(
    namespace: str,
    cleanup_evicted: bool = True,
    cleanup_failed: bool = True,
    cleanup_completed: bool = False,
    dry_run: bool = False
) -> Dict[str, Any]:
    """Clean up problematic pods"""
    try:
        validate_namespace_write_access(namespace, "cleanup pods in")

        _, core_api, _ = get_k8s_client()

        pods = core_api.list_namespaced_pod(namespace)

        to_delete = []

        for pod in pods.items:
            reason = pod.status.reason
            phase = pod.status.phase

            # Evicted pods
            if cleanup_evicted and reason == "Evicted":
                to_delete.append({"name": pod.metadata.name, "reason": "Evicted"})
                continue

            # Failed pods
            if cleanup_failed and phase == "Failed":
                to_delete.append({"name": pod.metadata.name, "reason": "Failed"})
                continue

            # Completed pods (Succeeded phase)
            if cleanup_completed and phase == "Succeeded":
                to_delete.append({"name": pod.metadata.name, "reason": "Completed"})
                continue

        deleted = []
        errors = []

        if not dry_run:
            for pod_info in to_delete:
                try:
                    core_api.delete_namespaced_pod(pod_info["name"], namespace)
                    deleted.append(pod_info)
                except Exception as e:
                    errors.append({**pod_info, "error": str(e)})

        logger.info(f"Cleanup in {namespace}: found={len(to_delete)}, deleted={len(deleted)}, errors={len(errors)}")

        return {
            "success": True,
            "namespace": namespace,
            "dry_run": dry_run,
            "found": to_delete,
            "deleted": deleted if not dry_run else [],
            "errors": errors,
            "message": f"{'Would delete' if dry_run else 'Deleted'} {len(to_delete)} pods"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except Exception as e:
        logger.error(f"Failed to cleanup pods in {namespace}: {e}")
        return {"success": False, "error": str(e)}
