"""Pod tools."""

from typing import Any, Dict, Optional

from .._core import (
    mcp,
    logger,
    is_protected_namespace,
    validate_namespace_write_access,
    get_k8s_client,
)

__all__ = [
    "k8s_list_pods",
    "k8s_get_pod",
    "k8s_get_pod_logs",
    "k8s_delete_pod",
]

# ============================================================================
# POD TOOLS
# ============================================================================

@mcp.tool(description="List all pods in a namespace with their status, ready state, and restart count.")
async def k8s_list_pods(
    namespace: str = "default",
    label_selector: Optional[str] = None
) -> Dict[str, Any]:
    """List pods in a namespace"""
    try:
        _, core_api, _ = get_k8s_client()

        if label_selector:
            pods = core_api.list_namespaced_pod(namespace, label_selector=label_selector)
        else:
            pods = core_api.list_namespaced_pod(namespace)

        pod_list = []
        for pod in pods.items:
            # Calculate ready containers
            ready_count = 0
            total_count = len(pod.spec.containers)
            restart_count = 0

            if pod.status.container_statuses:
                for cs in pod.status.container_statuses:
                    if cs.ready:
                        ready_count += 1
                    restart_count += cs.restart_count

            pod_info = {
                "name": pod.metadata.name,
                "namespace": pod.metadata.namespace,
                "status": pod.status.phase,
                "ready": f"{ready_count}/{total_count}",
                "restarts": restart_count,
                "node": pod.spec.node_name,
                "ip": pod.status.pod_ip,
                "created": pod.metadata.creation_timestamp.isoformat() if pod.metadata.creation_timestamp else None,
                "labels": pod.metadata.labels or {}
            }
            pod_list.append(pod_info)

        logger.info(f"Listed {len(pod_list)} pods in namespace {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "pods": pod_list,
            "count": len(pod_list)
        }
    except Exception as e:
        logger.error(f"Failed to list pods in {namespace}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get detailed information about a specific pod including containers, volumes, and events.")
async def k8s_get_pod(namespace: str, pod_name: str) -> Dict[str, Any]:
    """Get detailed pod information"""
    try:
        _, core_api, _ = get_k8s_client()

        pod = core_api.read_namespaced_pod(pod_name, namespace)

        # Get container info
        containers = []
        for c in pod.spec.containers:
            container_info = {
                "name": c.name,
                "image": c.image,
                "ports": [{"port": p.container_port, "protocol": p.protocol} for p in (c.ports or [])],
                "resources": {
                    "requests": dict(c.resources.requests) if c.resources and c.resources.requests else {},
                    "limits": dict(c.resources.limits) if c.resources and c.resources.limits else {}
                }
            }
            containers.append(container_info)

        # Get container statuses
        statuses = []
        if pod.status.container_statuses:
            for cs in pod.status.container_statuses:
                status = {
                    "name": cs.name,
                    "ready": cs.ready,
                    "restarts": cs.restart_count,
                    "state": None
                }
                if cs.state.running:
                    status["state"] = "running"
                elif cs.state.waiting:
                    status["state"] = f"waiting: {cs.state.waiting.reason}"
                elif cs.state.terminated:
                    status["state"] = f"terminated: {cs.state.terminated.reason}"
                statuses.append(status)

        result = {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "pod": {
                "name": pod.metadata.name,
                "namespace": pod.metadata.namespace,
                "status": pod.status.phase,
                "node": pod.spec.node_name,
                "ip": pod.status.pod_ip,
                "host_ip": pod.status.host_ip,
                "created": pod.metadata.creation_timestamp.isoformat() if pod.metadata.creation_timestamp else None,
                "labels": pod.metadata.labels or {},
                "annotations": pod.metadata.annotations or {},
                "containers": containers,
                "container_statuses": statuses
            }
        }

        logger.info(f"Retrieved pod info: {namespace}/{pod_name}")
        return result
    except Exception as e:
        logger.error(f"Failed to get pod {namespace}/{pod_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get logs from a pod container. Returns the last N lines of logs.")
async def k8s_get_pod_logs(
    namespace: str,
    pod_name: str,
    container: Optional[str] = None,
    tail_lines: int = 100,
    previous: bool = False
) -> Dict[str, Any]:
    """Get pod logs"""
    try:
        _, core_api, _ = get_k8s_client()

        logs = core_api.read_namespaced_pod_log(
            pod_name,
            namespace,
            container=container,
            tail_lines=tail_lines,
            previous=previous
        )

        logger.info(f"Retrieved logs for pod: {namespace}/{pod_name}")

        return {
            "success": True,
            "namespace": namespace,
            "pod": pod_name,
            "container": container,
            "logs": logs,
            "tail_lines": tail_lines
        }
    except Exception as e:
        logger.error(f"Failed to get logs for {namespace}/{pod_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Delete a pod. BLOCKED for pods in protected namespace. The pod will be recreated by its controller.")
async def k8s_delete_pod(namespace: str, pod_name: str) -> Dict[str, Any]:
    """Delete a pod (useful for forcing restart)"""
    try:
        # Prevent deletion in protected namespace
        validate_namespace_write_access(namespace, "delete pod from")

        _, core_api, _ = get_k8s_client()

        core_api.delete_namespaced_pod(pod_name, namespace)

        logger.info(f"Deleted pod: {namespace}/{pod_name}")

        return {
            "success": True,
            "namespace": namespace,
            "pod": pod_name,
            "message": f"Pod '{pod_name}' deleted successfully"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except Exception as e:
        logger.error(f"Failed to delete pod {namespace}/{pod_name}: {e}")
        return {"success": False, "error": str(e)}
