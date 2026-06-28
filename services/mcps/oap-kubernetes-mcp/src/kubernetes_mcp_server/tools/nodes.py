"""Node tools."""

from typing import Any, Dict

from .._core import (
    mcp,
    logger,
    get_k8s_client,
)

__all__ = [
    "k8s_list_nodes",
]

# ============================================================================
# NODE TOOLS
# ============================================================================

@mcp.tool(description="List all nodes in the cluster with their status, capacity, and allocatable resources.")
async def k8s_list_nodes() -> Dict[str, Any]:
    """List cluster nodes"""
    try:
        _, core_api, _ = get_k8s_client()

        nodes = core_api.list_node()

        node_list = []
        for node in nodes.items:
            # Get conditions
            conditions = {}
            for c in (node.status.conditions or []):
                conditions[c.type] = c.status

            node_info = {
                "name": node.metadata.name,
                "status": "Ready" if conditions.get("Ready") == "True" else "NotReady",
                "roles": [k.replace("node-role.kubernetes.io/", "") for k in (node.metadata.labels or {}).keys() if k.startswith("node-role.kubernetes.io/")],
                "version": node.status.node_info.kubelet_version if node.status.node_info else "Unknown",
                "os": f"{node.status.node_info.os_image if node.status.node_info else 'Unknown'}",
                "architecture": node.status.node_info.architecture if node.status.node_info else "Unknown",
                "capacity": {
                    "cpu": node.status.capacity.get("cpu", "0") if node.status.capacity else "0",
                    "memory": node.status.capacity.get("memory", "0") if node.status.capacity else "0",
                    "pods": node.status.capacity.get("pods", "0") if node.status.capacity else "0"
                },
                "allocatable": {
                    "cpu": node.status.allocatable.get("cpu", "0") if node.status.allocatable else "0",
                    "memory": node.status.allocatable.get("memory", "0") if node.status.allocatable else "0",
                    "pods": node.status.allocatable.get("pods", "0") if node.status.allocatable else "0"
                },
                "conditions": conditions,
                "created": node.metadata.creation_timestamp.isoformat() if node.metadata.creation_timestamp else None
            }
            node_list.append(node_info)

        logger.info(f"Listed {len(node_list)} nodes")

        return {
            "success": True,
            "nodes": node_list,
            "count": len(node_list)
        }
    except Exception as e:
        logger.error(f"Failed to list nodes: {e}")
        return {"success": False, "error": str(e)}
