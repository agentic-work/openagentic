"""Node management tools (cordon / uncordon / drain)."""

from typing import Any, Dict

from .._core import (
    mcp,
    logger,
    get_k8s_client,
)

__all__ = [
    "k8s_cordon_node",
    "k8s_uncordon_node",
    "k8s_drain_node",
]

# ============================================================================
# NODE MANAGEMENT TOOLS
# ============================================================================

@mcp.tool(description="Cordon a node to prevent new pods from being scheduled on it.")
async def k8s_cordon_node(node_name: str) -> Dict[str, Any]:
    """Mark node as unschedulable"""
    try:
        _, core_api, _ = get_k8s_client()

        body = {"spec": {"unschedulable": True}}
        core_api.patch_node(node_name, body)

        logger.info(f"Cordoned node: {node_name}")

        return {
            "success": True,
            "node": node_name,
            "message": f"Node '{node_name}' cordoned (marked unschedulable)"
        }
    except Exception as e:
        logger.error(f"Failed to cordon node {node_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Uncordon a node to allow pods to be scheduled on it again.")
async def k8s_uncordon_node(node_name: str) -> Dict[str, Any]:
    """Mark node as schedulable"""
    try:
        _, core_api, _ = get_k8s_client()

        body = {"spec": {"unschedulable": False}}
        core_api.patch_node(node_name, body)

        logger.info(f"Uncordoned node: {node_name}")

        return {
            "success": True,
            "node": node_name,
            "message": f"Node '{node_name}' uncordoned (marked schedulable)"
        }
    except Exception as e:
        logger.error(f"Failed to uncordon node {node_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Drain a node by evicting all pods and cordoning it. Use for node maintenance.")
async def k8s_drain_node(
    node_name: str,
    ignore_daemonsets: bool = True,
    delete_local_data: bool = False,
    force: bool = False,
    grace_period: int = 30
) -> Dict[str, Any]:
    """Drain a node by evicting pods"""
    try:
        from kubernetes import client
        _, core_api, _ = get_k8s_client()

        # First cordon the node
        body = {"spec": {"unschedulable": True}}
        core_api.patch_node(node_name, body)

        # Get pods on this node
        pods = core_api.list_pod_for_all_namespaces(field_selector=f"spec.nodeName={node_name}")

        evicted = []
        skipped = []
        errors = []

        for pod in pods.items:
            pod_name = pod.metadata.name
            namespace = pod.metadata.namespace

            # Skip mirror pods (static pods)
            if pod.metadata.annotations and "kubernetes.io/config.mirror" in pod.metadata.annotations:
                skipped.append({"name": pod_name, "namespace": namespace, "reason": "mirror pod"})
                continue

            # Skip DaemonSet pods unless force
            is_daemonset = False
            if pod.metadata.owner_references:
                for ref in pod.metadata.owner_references:
                    if ref.kind == "DaemonSet":
                        is_daemonset = True
                        break

            if is_daemonset and ignore_daemonsets:
                skipped.append({"name": pod_name, "namespace": namespace, "reason": "daemonset pod"})
                continue

            # Check for local storage
            if not delete_local_data and pod.spec.volumes:
                has_local = any(v.empty_dir for v in pod.spec.volumes if v.empty_dir)
                if has_local and not force:
                    skipped.append({"name": pod_name, "namespace": namespace, "reason": "has local storage"})
                    continue

            # Evict the pod
            try:
                eviction = client.V1Eviction(
                    metadata=client.V1ObjectMeta(name=pod_name, namespace=namespace),
                    delete_options=client.V1DeleteOptions(grace_period_seconds=grace_period)
                )
                core_api.create_namespaced_pod_eviction(pod_name, namespace, eviction)
                evicted.append({"name": pod_name, "namespace": namespace})
            except Exception as e:
                errors.append({"name": pod_name, "namespace": namespace, "error": str(e)})

        logger.info(f"Drained node {node_name}: evicted={len(evicted)}, skipped={len(skipped)}, errors={len(errors)}")

        return {
            "success": len(errors) == 0,
            "node": node_name,
            "evicted": evicted,
            "skipped": skipped,
            "errors": errors,
            "message": f"Node drain {'completed' if len(errors) == 0 else 'completed with errors'}"
        }
    except Exception as e:
        logger.error(f"Failed to drain node {node_name}: {e}")
        return {"success": False, "error": str(e)}
