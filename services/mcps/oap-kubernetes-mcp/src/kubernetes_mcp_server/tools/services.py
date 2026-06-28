"""Service tools."""

from typing import Any, Dict

from .._core import (
    mcp,
    logger,
    is_protected_namespace,
    get_k8s_client,
)

__all__ = [
    "k8s_list_services",
    "k8s_get_service",
]

# ============================================================================
# SERVICE TOOLS
# ============================================================================

@mcp.tool(description="List all services in a namespace with their types, cluster IPs, and ports.")
async def k8s_list_services(namespace: str = "default") -> Dict[str, Any]:
    """List services in a namespace"""
    try:
        _, core_api, _ = get_k8s_client()

        services = core_api.list_namespaced_service(namespace)

        svc_list = []
        for svc in services.items:
            ports = []
            for p in (svc.spec.ports or []):
                ports.append({
                    "name": p.name,
                    "port": p.port,
                    "target_port": str(p.target_port),
                    "protocol": p.protocol,
                    "node_port": p.node_port
                })

            svc_info = {
                "name": svc.metadata.name,
                "namespace": svc.metadata.namespace,
                "type": svc.spec.type,
                "cluster_ip": svc.spec.cluster_ip,
                "external_ips": svc.spec.external_i_ps or [],
                "ports": ports,
                "selector": svc.spec.selector or {},
                "created": svc.metadata.creation_timestamp.isoformat() if svc.metadata.creation_timestamp else None
            }
            svc_list.append(svc_info)

        logger.info(f"Listed {len(svc_list)} services in namespace {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "services": svc_list,
            "count": len(svc_list)
        }
    except Exception as e:
        logger.error(f"Failed to list services in {namespace}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get detailed information about a specific service including endpoints.")
async def k8s_get_service(namespace: str, service_name: str) -> Dict[str, Any]:
    """Get detailed service information"""
    try:
        _, core_api, _ = get_k8s_client()

        svc = core_api.read_namespaced_service(service_name, namespace)

        # Get endpoints
        try:
            endpoints = core_api.read_namespaced_endpoints(service_name, namespace)
            endpoint_list = []
            for subset in (endpoints.subsets or []):
                for addr in (subset.addresses or []):
                    for port in (subset.ports or []):
                        endpoint_list.append({
                            "ip": addr.ip,
                            "port": port.port,
                            "name": port.name
                        })
        except:
            endpoint_list = []

        ports = []
        for p in (svc.spec.ports or []):
            ports.append({
                "name": p.name,
                "port": p.port,
                "target_port": str(p.target_port),
                "protocol": p.protocol,
                "node_port": p.node_port
            })

        result = {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "service": {
                "name": svc.metadata.name,
                "namespace": svc.metadata.namespace,
                "type": svc.spec.type,
                "cluster_ip": svc.spec.cluster_ip,
                "external_ips": svc.spec.external_i_ps or [],
                "ports": ports,
                "selector": svc.spec.selector or {},
                "labels": svc.metadata.labels or {},
                "annotations": svc.metadata.annotations or {},
                "created": svc.metadata.creation_timestamp.isoformat() if svc.metadata.creation_timestamp else None,
                "endpoints": endpoint_list
            }
        }

        logger.info(f"Retrieved service info: {namespace}/{service_name}")
        return result
    except Exception as e:
        logger.error(f"Failed to get service {namespace}/{service_name}: {e}")
        return {"success": False, "error": str(e)}
