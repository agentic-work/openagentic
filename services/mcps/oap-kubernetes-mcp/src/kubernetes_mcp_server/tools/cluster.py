"""Cluster health and events tools."""

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from .._core import (
    mcp,
    logger,
    PROTECTED_NAMESPACE,
    get_k8s_client,
)

__all__ = [
    "k8s_get_events",
    "k8s_cluster_health",
]

# ============================================================================
# CLUSTER HEALTH & EVENTS
# ============================================================================

@mcp.tool(description="Get recent events from a namespace or cluster-wide. Useful for debugging.")
async def k8s_get_events(
    namespace: Optional[str] = None,
    limit: int = 50
) -> Dict[str, Any]:
    """Get cluster or namespace events"""
    try:
        _, core_api, _ = get_k8s_client()

        if namespace:
            events = core_api.list_namespaced_event(namespace)
        else:
            events = core_api.list_event_for_all_namespaces()

        # Sort by last timestamp and limit
        event_list = []
        sorted_events = sorted(
            events.items,
            key=lambda e: e.last_timestamp or e.event_time or datetime.min.replace(tzinfo=None),
            reverse=True
        )[:limit]

        for event in sorted_events:
            event_info = {
                "namespace": event.metadata.namespace,
                "name": event.involved_object.name,
                "kind": event.involved_object.kind,
                "type": event.type,
                "reason": event.reason,
                "message": event.message,
                "count": event.count,
                "first_timestamp": event.first_timestamp.isoformat() if event.first_timestamp else None,
                "last_timestamp": event.last_timestamp.isoformat() if event.last_timestamp else None
            }
            event_list.append(event_info)

        logger.info(f"Listed {len(event_list)} events")

        return {
            "success": True,
            "namespace": namespace or "all",
            "events": event_list,
            "count": len(event_list)
        }
    except Exception as e:
        logger.error(f"Failed to get events: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get overall cluster health status including node status, component status, and resource usage.")
async def k8s_cluster_health() -> Dict[str, Any]:
    """Get cluster health overview"""
    try:
        _, core_api, _ = get_k8s_client()

        # Get nodes
        nodes = core_api.list_node()
        node_status = {
            "total": len(nodes.items),
            "ready": 0,
            "not_ready": 0
        }

        for node in nodes.items:
            for c in (node.status.conditions or []):
                if c.type == "Ready":
                    if c.status == "True":
                        node_status["ready"] += 1
                    else:
                        node_status["not_ready"] += 1
                    break

        # Get namespaces
        namespaces = core_api.list_namespace()

        # Count pods across all namespaces
        pods = core_api.list_pod_for_all_namespaces()
        pod_status = {
            "total": len(pods.items),
            "running": 0,
            "pending": 0,
            "failed": 0,
            "unknown": 0
        }

        for pod in pods.items:
            phase = pod.status.phase.lower() if pod.status.phase else "unknown"
            if phase == "running":
                pod_status["running"] += 1
            elif phase == "pending":
                pod_status["pending"] += 1
            elif phase == "failed":
                pod_status["failed"] += 1
            else:
                pod_status["unknown"] += 1

        # Get recent warning events
        events = core_api.list_event_for_all_namespaces()
        warning_events = [
            {
                "namespace": e.metadata.namespace,
                "name": e.involved_object.name,
                "reason": e.reason,
                "message": e.message[:100] if e.message else ""
            }
            for e in events.items
            if e.type == "Warning"
        ][:10]  # Last 10 warnings

        health = {
            "success": True,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "protected_namespace": PROTECTED_NAMESPACE,
            "nodes": node_status,
            "namespaces": len(namespaces.items),
            "pods": pod_status,
            "recent_warnings": warning_events,
            "healthy": node_status["not_ready"] == 0 and pod_status["failed"] == 0
        }

        logger.info(f"Cluster health check: healthy={health['healthy']}")

        return health
    except Exception as e:
        logger.error(f"Failed to get cluster health: {e}")
        return {"success": False, "error": str(e)}
