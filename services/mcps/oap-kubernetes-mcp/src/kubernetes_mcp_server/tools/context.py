"""Context tools."""

from typing import Any, Dict

from .._core import (
    mcp,
    logger,
)

__all__ = [
    "k8s_list_contexts",
    "k8s_get_current_context",
]

# ============================================================================
# CONTEXT TOOLS
# ============================================================================

@mcp.tool(description="List all available Kubernetes contexts from kubeconfig.")
async def k8s_list_contexts() -> Dict[str, Any]:
    """List all available kubectl contexts"""
    try:
        from kubernetes import config

        contexts, active_context = config.list_kube_config_contexts()

        context_list = []
        for ctx in contexts:
            context_list.append({
                "name": ctx["name"],
                "cluster": ctx["context"].get("cluster", ""),
                "user": ctx["context"].get("user", ""),
                "namespace": ctx["context"].get("namespace", "default"),
                "is_active": ctx["name"] == active_context["name"] if active_context else False
            })

        return {
            "success": True,
            "contexts": context_list,
            "active_context": active_context["name"] if active_context else None,
            "count": len(context_list)
        }
    except Exception as e:
        logger.error(f"Failed to list contexts: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get current active Kubernetes context.")
async def k8s_get_current_context() -> Dict[str, Any]:
    """Get current kubectl context"""
    try:
        from kubernetes import config

        contexts, active_context = config.list_kube_config_contexts()

        if not active_context:
            return {"success": False, "error": "No active context found"}

        return {
            "success": True,
            "context": {
                "name": active_context["name"],
                "cluster": active_context["context"].get("cluster", ""),
                "user": active_context["context"].get("user", ""),
                "namespace": active_context["context"].get("namespace", "default")
            }
        }
    except Exception as e:
        logger.error(f"Failed to get current context: {e}")
        return {"success": False, "error": str(e)}
