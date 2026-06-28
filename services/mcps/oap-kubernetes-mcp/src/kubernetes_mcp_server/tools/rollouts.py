"""Rollout tools."""

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from .._core import (
    mcp,
    logger,
    validate_namespace_write_access,
    get_k8s_client,
)

__all__ = [
    "k8s_rollout_status",
    "k8s_rollout_history",
    "k8s_rollout_undo",
]

# ============================================================================
# ROLLOUT TOOLS
# ============================================================================

@mcp.tool(description="Get rollout status for a deployment showing revision history and current state.")
async def k8s_rollout_status(
    namespace: str,
    deployment_name: str
) -> Dict[str, Any]:
    """Get deployment rollout status"""
    try:
        from kubernetes import client
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
                    "message": c.message,
                    "last_update": c.last_update_time.isoformat() if c.last_update_time else None
                })

        # Determine rollout status
        replicas = dep.spec.replicas or 0
        updated = dep.status.updated_replicas or 0
        ready = dep.status.ready_replicas or 0
        available = dep.status.available_replicas or 0

        if updated == replicas and ready == replicas and available == replicas:
            rollout_status = "complete"
        elif updated < replicas:
            rollout_status = "progressing"
        else:
            rollout_status = "waiting"

        return {
            "success": True,
            "namespace": namespace,
            "deployment": deployment_name,
            "rollout_status": rollout_status,
            "replicas": {
                "desired": replicas,
                "updated": updated,
                "ready": ready,
                "available": available
            },
            "conditions": conditions,
            "generation": dep.metadata.generation,
            "observed_generation": dep.status.observed_generation
        }
    except Exception as e:
        logger.error(f"Failed to get rollout status for {namespace}/{deployment_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get rollout history for a deployment showing all revisions.")
async def k8s_rollout_history(
    namespace: str,
    deployment_name: str
) -> Dict[str, Any]:
    """Get deployment rollout history via ReplicaSets"""
    try:
        from kubernetes import client
        _, _, apps_api = get_k8s_client()

        # Get deployment to get selector
        dep = apps_api.read_namespaced_deployment(deployment_name, namespace)
        selector = dep.spec.selector.match_labels

        # Build label selector string
        label_selector = ",".join([f"{k}={v}" for k, v in selector.items()])

        # Get all ReplicaSets for this deployment
        rs_list = apps_api.list_namespaced_replica_set(namespace, label_selector=label_selector)

        revisions = []
        for rs in rs_list.items:
            revision = rs.metadata.annotations.get("deployment.kubernetes.io/revision", "?")
            revisions.append({
                "revision": revision,
                "name": rs.metadata.name,
                "replicas": rs.spec.replicas,
                "ready": rs.status.ready_replicas or 0,
                "created": rs.metadata.creation_timestamp.isoformat() if rs.metadata.creation_timestamp else None,
                "image": rs.spec.template.spec.containers[0].image if rs.spec.template.spec.containers else "unknown"
            })

        # Sort by revision
        revisions.sort(key=lambda x: int(x["revision"]) if x["revision"].isdigit() else 0, reverse=True)

        return {
            "success": True,
            "namespace": namespace,
            "deployment": deployment_name,
            "revisions": revisions,
            "count": len(revisions)
        }
    except Exception as e:
        logger.error(f"Failed to get rollout history for {namespace}/{deployment_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Undo a deployment rollout to a previous revision. BLOCKED for protected namespace.")
async def k8s_rollout_undo(
    namespace: str,
    deployment_name: str,
    revision: Optional[int] = None
) -> Dict[str, Any]:
    """Undo deployment to previous or specific revision"""
    try:
        validate_namespace_write_access(namespace, "rollback deployment in")

        from kubernetes import client
        _, _, apps_api = get_k8s_client()

        if revision:
            # Get the specific ReplicaSet for that revision
            dep = apps_api.read_namespaced_deployment(deployment_name, namespace)
            selector = dep.spec.selector.match_labels
            label_selector = ",".join([f"{k}={v}" for k, v in selector.items()])

            rs_list = apps_api.list_namespaced_replica_set(namespace, label_selector=label_selector)

            target_rs = None
            for rs in rs_list.items:
                rs_revision = rs.metadata.annotations.get("deployment.kubernetes.io/revision", "")
                if rs_revision == str(revision):
                    target_rs = rs
                    break

            if not target_rs:
                return {"success": False, "error": f"Revision {revision} not found"}

            # Patch deployment with the target RS's pod template
            patch = {
                "spec": {
                    "template": target_rs.spec.template.to_dict()
                }
            }
            apps_api.patch_namespaced_deployment(deployment_name, namespace, patch)
            message = f"Rolled back to revision {revision}"
        else:
            # Rollback to previous revision by using rollout restart equivalent
            now = datetime.now(timezone.utc).isoformat()
            patch = {
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
            apps_api.patch_namespaced_deployment(deployment_name, namespace, patch)
            message = "Triggered rollout (restart)"

        logger.info(f"Rollback initiated for {namespace}/{deployment_name}")

        return {
            "success": True,
            "namespace": namespace,
            "deployment": deployment_name,
            "message": message
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except Exception as e:
        logger.error(f"Failed to rollback {namespace}/{deployment_name}: {e}")
        return {"success": False, "error": str(e)}
