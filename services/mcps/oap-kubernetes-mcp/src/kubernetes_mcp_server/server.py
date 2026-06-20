

"""
Kubernetes MCP Server - FastMCP Implementation for K8s Administration

IMPORTANT: This MCP server is ONLY available to ADMIN users.
Non-admin users should NOT have access to any tools in this server.
The MCP proxy validates admin status before routing requests here.

CRITICAL SECURITY:
- The namespace where OpenAgentic is deployed is READ-ONLY
- No modifications, deletions, or changes can be made to that protected namespace
- The protected namespace is determined by the OPENAGENTIC_NAMESPACE env var
"""

import os
import sys
import json
import logging
import asyncio
from typing import Any, Dict, List, Optional
from datetime import datetime

import dotenv
from mcp.server.fastmcp import FastMCP

# Load environment variables
dotenv.load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))

# Configure structured logging via shared observability module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-kubernetes-mcp')
except ImportError:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        stream=sys.stderr
    )
    logger = logging.getLogger("kubernetes-mcp")

# Initialize FastMCP server
mcp = FastMCP("Kubernetes MCP Server - ADMIN USERS ONLY")

# Protected namespace - OpenAgentic deployment namespace
PROTECTED_NAMESPACE = os.getenv("OPENAGENTIC_NAMESPACE", "openagentic")

# Kubernetes client (lazy loaded)
_k8s_api = None
_k8s_apps_api = None
_k8s_core_api = None

# ============================================================================
# NAMESPACE PROTECTION
# ============================================================================

def is_protected_namespace(namespace: str) -> bool:
    """Check if a namespace is the protected OpenAgentic namespace"""
    return namespace.lower() == PROTECTED_NAMESPACE.lower()

def validate_namespace_write_access(namespace: str, operation: str = "modify"):
    """
    Validate that the namespace is not the protected OpenAgentic namespace.
    Raises an error if write access is attempted on the protected namespace.
    """
    if is_protected_namespace(namespace):
        logger.error(
            f"SECURITY: Blocked {operation} operation on protected namespace '{namespace}'"
        )
        raise PermissionError(
            f"Access denied: Cannot {operation} resources in the protected namespace '{PROTECTED_NAMESPACE}'. "
            f"The OpenAgentic deployment namespace is read-only for safety. "
            f"You can only read/view resources in this namespace."
        )

# ============================================================================
# KUBERNETES CLIENT INITIALIZATION
# ============================================================================

def get_k8s_client():
    """Get the Kubernetes API client.

    2026-05-23 fix: explicit Bearer header attach. Live-debugged via
    urllib3 request interception inside a running MCP pod:

      Captured request from kubernetes-python client:
        GET /api/v1/namespaces/default/pods?limit=1
        Headers: Accept, User-Agent, Content-Type
        (Authorization MISSING — request 401'd at kube-apiserver)

    Root cause: kubernetes-python's `Configuration.api_key` mechanism for
    in-cluster bearer auth does NOT attach an Authorization header in this
    runtime (k8s-python 35/36 + python 3.14 + FastMCP + in-cluster SA).
    The `Configuration.api_key = {'authorization': 'bearer <tok>'}` was
    present, but the ApiClient.call_api auth_settings lookup didn't
    translate it into an HTTP header. Result: every list_namespaced_pod
    call sent with NO auth → 401 Unauthorized.

    Fix: read the projected SA token from disk explicitly and call
    `api_client.set_default_header('Authorization', f'Bearer {tok}')`.
    This bypasses Configuration.api_key entirely and guarantees the
    Authorization header lands on every request. Verified: same pod,
    same token, with set_default_header → 200 OK, 26 pods returned.
    """
    global _k8s_api, _k8s_apps_api, _k8s_core_api

    try:
        from kubernetes import client, config

        # Try in-cluster config first, then fall back to kubeconfig.
        in_cluster = False
        try:
            config.load_incluster_config()
            in_cluster = True
        except config.ConfigException:
            config.load_kube_config()

        api_client = client.ApiClient()

        # CRITICAL: kubernetes-python's auto-attach of in-cluster bearer
        # auth is broken here. The async/FastMCP runtime path was found
        # to silently strip `set_default_header('Authorization')` because
        # `RESTClientObject.request` calls `update_params_for_auth` which
        # rewrites headers based on `Configuration.api_key`. Direct sync
        # test returned 200 (set_default_header survived); async FastMCP
        # path returned 401 (rewrite overwrote it). Fix below patches
        # BOTH (a) Configuration.api_key + api_key_prefix (canonical
        # path kubernetes-python's auth_settings hook reads) AND
        # (b) default_headers as belt-and-suspenders.
        if in_cluster:
            try:
                with open(
                    "/var/run/secrets/kubernetes.io/serviceaccount/token", "r"
                ) as fh:
                    token = fh.read().strip()
                if token:
                    cfg = api_client.configuration
                    # (a) Canonical kubernetes-python in-cluster auth path.
                    # `Configuration.auth_settings()` looks up the dict
                    # KEY 'BearerToken' (NOT 'authorization' / 'Authorization')
                    # to build `{key: 'authorization', value: <prefixed_token>}`
                    # for `update_params_for_auth`. Using the wrong dict
                    # key silently no-ops and lets the overwrite wipe our
                    # default_header. See client.Configuration.auth_settings.
                    cfg.api_key = {"BearerToken": token}
                    cfg.api_key_prefix = {"BearerToken": "Bearer"}
                    # (b) Belt+suspenders — explicit default header. With
                    # the canonical path now correct, auth_settings will
                    # set lowercase 'authorization' from BearerToken, and
                    # our 'Authorization' default_header coexists. urllib3
                    # treats them case-insensitively on the wire.
                    api_client.set_default_header(
                        "Authorization", f"Bearer {token}"
                    )
                    # One-line proof on each init so we can diff
                    # async-path vs sync-path in pod logs.
                    has_default = (
                        "Authorization" in api_client.default_headers
                    )
                    has_cfg_bearertoken = bool(cfg.api_key.get("BearerToken"))
                    auth_settings_value = cfg.auth_settings().get(
                        "BearerToken", {}
                    ).get("value", "")
                    auth_settings_ok = auth_settings_value.startswith(
                        "Bearer "
                    )
                    logger.info(
                        f"[k8s-auth] init: in_cluster=True "
                        f"default_header_set={has_default} "
                        f"cfg_BearerToken_set={has_cfg_bearertoken} "
                        f"auth_settings_yields_bearer={auth_settings_ok} "
                        f"token_len={len(token)}"
                    )
            except Exception as token_err:
                logger.warning(
                    f"Could not read SA token for explicit-header fix: {token_err}"
                )

        _k8s_api = api_client
        _k8s_core_api = client.CoreV1Api(api_client=api_client)
        _k8s_apps_api = client.AppsV1Api(api_client=api_client)
    except Exception as e:
        logger.error(f"Failed to initialize Kubernetes client: {e}")
        raise RuntimeError(f"Kubernetes client initialization failed: {e}")

    return _k8s_api, _k8s_core_api, _k8s_apps_api

# ============================================================================
# NAMESPACE TOOLS (READ-ONLY for protected namespace)
# ============================================================================

@mcp.tool(description="List all namespaces in the Kubernetes cluster. Returns namespace names, status, and labels.")
async def k8s_list_namespaces() -> Dict[str, Any]:
    """List all Kubernetes namespaces"""
    try:
        _, core_api, _ = get_k8s_client()

        namespaces = core_api.list_namespace()

        ns_list = []
        for ns in namespaces.items:
            ns_info = {
                "name": ns.metadata.name,
                "status": ns.status.phase,
                "created": ns.metadata.creation_timestamp.isoformat() if ns.metadata.creation_timestamp else None,
                "labels": ns.metadata.labels or {},
                "is_protected": is_protected_namespace(ns.metadata.name)
            }
            ns_list.append(ns_info)

        logger.info(f"Listed {len(ns_list)} namespaces")

        return {
            "success": True,
            "namespaces": ns_list,
            "protected_namespace": PROTECTED_NAMESPACE,
            "count": len(ns_list)
        }
    except Exception as e:
        logger.error(f"Failed to list namespaces: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get detailed information about a specific namespace including resource quotas and limits.")
async def k8s_get_namespace(namespace: str) -> Dict[str, Any]:
    """Get detailed namespace information"""
    try:
        _, core_api, _ = get_k8s_client()

        ns = core_api.read_namespace(namespace)

        # Get resource quotas if any
        quotas = core_api.list_namespaced_resource_quota(namespace)
        quota_info = []
        for q in quotas.items:
            quota_info.append({
                "name": q.metadata.name,
                "hard": dict(q.status.hard) if q.status.hard else {},
                "used": dict(q.status.used) if q.status.used else {}
            })

        result = {
            "success": True,
            "namespace": {
                "name": ns.metadata.name,
                "status": ns.status.phase,
                "created": ns.metadata.creation_timestamp.isoformat() if ns.metadata.creation_timestamp else None,
                "labels": ns.metadata.labels or {},
                "annotations": ns.metadata.annotations or {},
                "is_protected": is_protected_namespace(namespace)
            },
            "resource_quotas": quota_info
        }

        logger.info(f"Retrieved namespace info: {namespace}")
        return result
    except Exception as e:
        logger.error(f"Failed to get namespace {namespace}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Create a new namespace. BLOCKED for protected namespace.")
async def k8s_create_namespace(
    namespace: str,
    labels: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """Create a new namespace"""
    try:
        # Check if trying to create the protected namespace
        validate_namespace_write_access(namespace, "create")

        from kubernetes import client
        _, core_api, _ = get_k8s_client()

        body = client.V1Namespace(
            metadata=client.V1ObjectMeta(
                name=namespace,
                labels=labels or {}
            )
        )

        result = core_api.create_namespace(body)

        logger.info(f"Created namespace: {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "message": f"Namespace '{namespace}' created successfully"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except Exception as e:
        logger.error(f"Failed to create namespace {namespace}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Delete a namespace. BLOCKED for protected namespace. Use with caution - deletes all resources in the namespace.")
async def k8s_delete_namespace(namespace: str) -> Dict[str, Any]:
    """Delete a namespace"""
    try:
        # Prevent deletion of protected namespace
        validate_namespace_write_access(namespace, "delete")

        _, core_api, _ = get_k8s_client()

        core_api.delete_namespace(namespace)

        logger.info(f"Deleted namespace: {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "message": f"Namespace '{namespace}' deletion initiated"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except Exception as e:
        logger.error(f"Failed to delete namespace {namespace}: {e}")
        return {"success": False, "error": str(e)}

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

# ============================================================================
# DEPLOYMENT TOOLS
# ============================================================================

@mcp.tool(description="List all deployments in a namespace with replica counts and status.")
async def k8s_list_deployments(namespace: str = "default") -> Dict[str, Any]:
    """List deployments in a namespace"""
    try:
        _, _, apps_api = get_k8s_client()

        deployments = apps_api.list_namespaced_deployment(namespace)

        deploy_list = []
        for dep in deployments.items:
            deploy_info = {
                "name": dep.metadata.name,
                "namespace": dep.metadata.namespace,
                "replicas": dep.spec.replicas,
                "ready_replicas": dep.status.ready_replicas or 0,
                "available_replicas": dep.status.available_replicas or 0,
                "updated_replicas": dep.status.updated_replicas or 0,
                "created": dep.metadata.creation_timestamp.isoformat() if dep.metadata.creation_timestamp else None,
                "labels": dep.metadata.labels or {},
                "selector": dep.spec.selector.match_labels if dep.spec.selector else {}
            }
            deploy_list.append(deploy_info)

        logger.info(f"Listed {len(deploy_list)} deployments in namespace {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "deployments": deploy_list,
            "count": len(deploy_list)
        }
    except Exception as e:
        logger.error(f"Failed to list deployments in {namespace}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get detailed information about a specific deployment including strategy and conditions.")
async def k8s_get_deployment(namespace: str, deployment_name: str) -> Dict[str, Any]:
    """Get detailed deployment information"""
    try:
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
                    "message": c.message
                })

        result = {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "deployment": {
                "name": dep.metadata.name,
                "namespace": dep.metadata.namespace,
                "replicas": dep.spec.replicas,
                "ready_replicas": dep.status.ready_replicas or 0,
                "available_replicas": dep.status.available_replicas or 0,
                "strategy": dep.spec.strategy.type if dep.spec.strategy else "Unknown",
                "created": dep.metadata.creation_timestamp.isoformat() if dep.metadata.creation_timestamp else None,
                "labels": dep.metadata.labels or {},
                "annotations": dep.metadata.annotations or {},
                "selector": dep.spec.selector.match_labels if dep.spec.selector else {},
                "conditions": conditions
            }
        }

        logger.info(f"Retrieved deployment info: {namespace}/{deployment_name}")
        return result
    except Exception as e:
        logger.error(f"Failed to get deployment {namespace}/{deployment_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Scale a deployment to a specified number of replicas. BLOCKED for deployments in protected namespace.")
async def k8s_scale_deployment(
    namespace: str,
    deployment_name: str,
    replicas: int
) -> Dict[str, Any]:
    """Scale a deployment"""
    try:
        # Prevent scaling in protected namespace
        validate_namespace_write_access(namespace, "scale deployment in")

        _, _, apps_api = get_k8s_client()

        # Patch the deployment
        body = {"spec": {"replicas": replicas}}
        apps_api.patch_namespaced_deployment_scale(
            deployment_name,
            namespace,
            body
        )

        logger.info(f"Scaled deployment {namespace}/{deployment_name} to {replicas} replicas")

        return {
            "success": True,
            "namespace": namespace,
            "deployment": deployment_name,
            "replicas": replicas,
            "message": f"Deployment '{deployment_name}' scaled to {replicas} replicas"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except Exception as e:
        logger.error(f"Failed to scale deployment {namespace}/{deployment_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Restart a deployment by triggering a rollout. BLOCKED for deployments in protected namespace.")
async def k8s_restart_deployment(namespace: str, deployment_name: str) -> Dict[str, Any]:
    """Restart a deployment by patching the pod template"""
    try:
        # Prevent restart in protected namespace
        validate_namespace_write_access(namespace, "restart deployment in")

        _, _, apps_api = get_k8s_client()

        # Patch with a new annotation to trigger rollout
        now = datetime.utcnow().isoformat()
        body = {
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

        apps_api.patch_namespaced_deployment(
            deployment_name,
            namespace,
            body
        )

        logger.info(f"Restarted deployment: {namespace}/{deployment_name}")

        return {
            "success": True,
            "namespace": namespace,
            "deployment": deployment_name,
            "message": f"Deployment '{deployment_name}' restart initiated"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except Exception as e:
        logger.error(f"Failed to restart deployment {namespace}/{deployment_name}: {e}")
        return {"success": False, "error": str(e)}

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

# ============================================================================
# WORKLOAD LIST TOOLS — #881 chatmode-required enumeration verbs
# ============================================================================
# These tools fill the gap surfaced by Q-loop drives where the model tried
# to enumerate cluster state via standard kubectl list verbs that the MCP
# server didn't register. Read-only by design (no create/delete/scale).
# Shape parity with k8s_list_pods @ server.py:251-302 — required by the
# chatmode prompt's tool_result handler.

@mcp.tool(description="List all ReplicaSets in a namespace with replica counts and selector labels. Use to inspect deployment revision history at the ReplicaSet level.")
async def k8s_list_replicasets(
    namespace: str = "default",
    label_selector: Optional[str] = None
) -> Dict[str, Any]:
    """List ReplicaSets in a namespace"""
    try:
        _, _, apps_api = get_k8s_client()

        if label_selector:
            rs_items = apps_api.list_namespaced_replica_set(namespace, label_selector=label_selector)
        else:
            rs_items = apps_api.list_namespaced_replica_set(namespace)

        rs_list = []
        for rs in rs_items.items:
            owner_kind = None
            owner_name = None
            if rs.metadata.owner_references:
                owner = rs.metadata.owner_references[0]
                owner_kind = owner.kind
                owner_name = owner.name

            rs_info = {
                "name": rs.metadata.name,
                "namespace": rs.metadata.namespace,
                "replicas": rs.spec.replicas,
                "ready_replicas": rs.status.ready_replicas or 0,
                "available_replicas": rs.status.available_replicas or 0,
                "revision": (rs.metadata.annotations or {}).get("deployment.kubernetes.io/revision"),
                "owner_kind": owner_kind,
                "owner_name": owner_name,
                "selector": rs.spec.selector.match_labels if rs.spec.selector else {},
                "created": rs.metadata.creation_timestamp.isoformat() if rs.metadata.creation_timestamp else None,
                "labels": rs.metadata.labels or {}
            }
            rs_list.append(rs_info)

        logger.info(f"Listed {len(rs_list)} replicasets in namespace {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "replicasets": rs_list,
            "count": len(rs_list)
        }
    except Exception as e:
        logger.error(f"Failed to list replicasets in {namespace}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="List all DaemonSets in a namespace with desired/current/ready counts. Use to inspect node-level agents (CNI, log shippers, monitoring).")
async def k8s_list_daemonsets(
    namespace: str = "default",
    label_selector: Optional[str] = None
) -> Dict[str, Any]:
    """List DaemonSets in a namespace"""
    try:
        _, _, apps_api = get_k8s_client()

        if label_selector:
            ds_items = apps_api.list_namespaced_daemon_set(namespace, label_selector=label_selector)
        else:
            ds_items = apps_api.list_namespaced_daemon_set(namespace)

        ds_list = []
        for ds in ds_items.items:
            ds_info = {
                "name": ds.metadata.name,
                "namespace": ds.metadata.namespace,
                "desired": ds.status.desired_number_scheduled or 0,
                "current": ds.status.current_number_scheduled or 0,
                "ready": ds.status.number_ready or 0,
                "available": ds.status.number_available or 0,
                "updated": ds.status.updated_number_scheduled or 0,
                "node_selector": ds.spec.template.spec.node_selector if ds.spec.template and ds.spec.template.spec else {},
                "selector": ds.spec.selector.match_labels if ds.spec.selector else {},
                "created": ds.metadata.creation_timestamp.isoformat() if ds.metadata.creation_timestamp else None,
                "labels": ds.metadata.labels or {}
            }
            ds_list.append(ds_info)

        logger.info(f"Listed {len(ds_list)} daemonsets in namespace {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "daemonsets": ds_list,
            "count": len(ds_list)
        }
    except Exception as e:
        logger.error(f"Failed to list daemonsets in {namespace}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="List all ServiceAccounts in a namespace with their secret references. Use to audit pod identity and RBAC bindings.")
async def k8s_list_serviceaccounts(
    namespace: str = "default",
    label_selector: Optional[str] = None
) -> Dict[str, Any]:
    """List ServiceAccounts in a namespace"""
    try:
        _, core_api, _ = get_k8s_client()

        if label_selector:
            sa_items = core_api.list_namespaced_service_account(namespace, label_selector=label_selector)
        else:
            sa_items = core_api.list_namespaced_service_account(namespace)

        sa_list = []
        for sa in sa_items.items:
            sa_info = {
                "name": sa.metadata.name,
                "namespace": sa.metadata.namespace,
                "secrets": [s.name for s in (sa.secrets or []) if s.name],
                "image_pull_secrets": [s.name for s in (sa.image_pull_secrets or []) if s.name],
                "automount_service_account_token": sa.automount_service_account_token,
                "created": sa.metadata.creation_timestamp.isoformat() if sa.metadata.creation_timestamp else None,
                "labels": sa.metadata.labels or {}
            }
            sa_list.append(sa_info)

        logger.info(f"Listed {len(sa_list)} serviceaccounts in namespace {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "serviceaccounts": sa_list,
            "count": len(sa_list)
        }
    except Exception as e:
        logger.error(f"Failed to list serviceaccounts in {namespace}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="List all Ingresses in a namespace with their hosts, paths, and backend services. Use to audit external traffic routing.")
async def k8s_list_ingresses(
    namespace: str = "default",
    label_selector: Optional[str] = None
) -> Dict[str, Any]:
    """List Ingresses in a namespace (networking.k8s.io/v1)"""
    try:
        from kubernetes import client
        get_k8s_client()  # ensure config is loaded
        networking_api = client.NetworkingV1Api()

        if label_selector:
            ing_items = networking_api.list_namespaced_ingress(namespace, label_selector=label_selector)
        else:
            ing_items = networking_api.list_namespaced_ingress(namespace)

        ing_list = []
        for ing in ing_items.items:
            # Collect host/path/backend rules
            rules = []
            for rule in (ing.spec.rules or []):
                paths = []
                if rule.http and rule.http.paths:
                    for p in rule.http.paths:
                        backend_svc = None
                        backend_port = None
                        if p.backend and p.backend.service:
                            backend_svc = p.backend.service.name
                            if p.backend.service.port:
                                backend_port = p.backend.service.port.number or p.backend.service.port.name
                        paths.append({
                            "path": p.path,
                            "path_type": p.path_type,
                            "backend_service": backend_svc,
                            "backend_port": backend_port
                        })
                rules.append({
                    "host": rule.host,
                    "paths": paths
                })

            # Load-balancer addresses (if controller has populated status)
            addresses = []
            if ing.status and ing.status.load_balancer and ing.status.load_balancer.ingress:
                for lb in ing.status.load_balancer.ingress:
                    addresses.append({"hostname": lb.hostname, "ip": lb.ip})

            ing_info = {
                "name": ing.metadata.name,
                "namespace": ing.metadata.namespace,
                "ingress_class_name": ing.spec.ingress_class_name,
                "rules": rules,
                "tls_hosts": [h for tls in (ing.spec.tls or []) for h in (tls.hosts or [])],
                "load_balancer": addresses,
                "created": ing.metadata.creation_timestamp.isoformat() if ing.metadata.creation_timestamp else None,
                "labels": ing.metadata.labels or {}
            }
            ing_list.append(ing_info)

        logger.info(f"Listed {len(ing_list)} ingresses in namespace {namespace}")

        return {
            "success": True,
            "namespace": namespace,
            "is_protected": is_protected_namespace(namespace),
            "ingresses": ing_list,
            "count": len(ing_list)
        }
    except Exception as e:
        logger.error(f"Failed to list ingresses in {namespace}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="List events from a namespace or cluster-wide (cluster-wide when namespace omitted). Identical semantics to k8s_get_events but uses the standard 'list' verb the model expects.")
async def k8s_list_events(
    namespace: Optional[str] = None,
    limit: int = 50,
    label_selector: Optional[str] = None
) -> Dict[str, Any]:
    """List events from a namespace or cluster-wide (alias-shape of k8s_get_events)"""
    try:
        _, core_api, _ = get_k8s_client()

        if namespace:
            if label_selector:
                events = core_api.list_namespaced_event(namespace, label_selector=label_selector)
            else:
                events = core_api.list_namespaced_event(namespace)
        else:
            if label_selector:
                events = core_api.list_event_for_all_namespaces(label_selector=label_selector)
            else:
                events = core_api.list_event_for_all_namespaces()

        # Sort by last timestamp (most recent first) and apply limit.
        sorted_events = sorted(
            events.items,
            key=lambda e: e.last_timestamp or e.event_time or datetime.min.replace(tzinfo=None),
            reverse=True
        )[:limit]

        event_list = []
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

        logger.info(f"Listed {len(event_list)} events (namespace={namespace or 'all'})")

        return {
            "success": True,
            "namespace": namespace or "all",
            "is_protected": is_protected_namespace(namespace) if namespace else False,
            "events": event_list,
            "count": len(event_list)
        }
    except Exception as e:
        logger.error(f"Failed to list events: {e}")
        return {"success": False, "error": str(e)}

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
            "timestamp": datetime.utcnow().isoformat(),
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
            now = datetime.utcnow().isoformat()
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

# ============================================================================
# API DISCOVERY TOOLS
# ============================================================================

@mcp.tool(description="List all available API resources in the cluster.")
async def k8s_list_api_resources() -> Dict[str, Any]:
    """List available Kubernetes API resources"""
    try:
        from kubernetes import client
        api_client, _, _ = get_k8s_client()

        # Add common resources we know about
        common_resources = [
            {"name": "pods", "kind": "Pod", "api_version": "v1", "namespaced": True},
            {"name": "services", "kind": "Service", "api_version": "v1", "namespaced": True},
            {"name": "deployments", "kind": "Deployment", "api_version": "apps/v1", "namespaced": True},
            {"name": "configmaps", "kind": "ConfigMap", "api_version": "v1", "namespaced": True},
            {"name": "secrets", "kind": "Secret", "api_version": "v1", "namespaced": True},
            {"name": "namespaces", "kind": "Namespace", "api_version": "v1", "namespaced": False},
            {"name": "nodes", "kind": "Node", "api_version": "v1", "namespaced": False},
            {"name": "persistentvolumes", "kind": "PersistentVolume", "api_version": "v1", "namespaced": False},
            {"name": "persistentvolumeclaims", "kind": "PersistentVolumeClaim", "api_version": "v1", "namespaced": True},
            {"name": "statefulsets", "kind": "StatefulSet", "api_version": "apps/v1", "namespaced": True},
            {"name": "daemonsets", "kind": "DaemonSet", "api_version": "apps/v1", "namespaced": True},
            {"name": "replicasets", "kind": "ReplicaSet", "api_version": "apps/v1", "namespaced": True},
            {"name": "ingresses", "kind": "Ingress", "api_version": "networking.k8s.io/v1", "namespaced": True},
            {"name": "jobs", "kind": "Job", "api_version": "batch/v1", "namespaced": True},
            {"name": "cronjobs", "kind": "CronJob", "api_version": "batch/v1", "namespaced": True},
            {"name": "serviceaccounts", "kind": "ServiceAccount", "api_version": "v1", "namespaced": True},
            {"name": "roles", "kind": "Role", "api_version": "rbac.authorization.k8s.io/v1", "namespaced": True},
            {"name": "rolebindings", "kind": "RoleBinding", "api_version": "rbac.authorization.k8s.io/v1", "namespaced": True},
            {"name": "clusterroles", "kind": "ClusterRole", "api_version": "rbac.authorization.k8s.io/v1", "namespaced": False},
            {"name": "clusterrolebindings", "kind": "ClusterRoleBinding", "api_version": "rbac.authorization.k8s.io/v1", "namespaced": False},
        ]

        return {
            "success": True,
            "resources": common_resources,
            "count": len(common_resources)
        }
    except Exception as e:
        logger.error(f"Failed to list API resources: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Explain a Kubernetes resource kind with its fields and documentation.")
async def k8s_explain_resource(
    kind: str,
    api_version: Optional[str] = None
) -> Dict[str, Any]:
    """Get documentation for a Kubernetes resource kind"""
    try:
        # Resource explanations (subset of common resources)
        explanations = {
            "pod": {
                "kind": "Pod",
                "api_version": "v1",
                "description": "A Pod is the smallest deployable unit that can be created and managed in Kubernetes. A Pod encapsulates one or more containers, storage resources, a unique network IP, and options that govern how the container(s) should run.",
                "key_fields": {
                    "spec.containers": "List of containers belonging to the pod",
                    "spec.volumes": "List of volumes that can be mounted by containers",
                    "spec.restartPolicy": "Restart policy: Always, OnFailure, Never",
                    "spec.nodeSelector": "Node selection constraints",
                    "spec.serviceAccountName": "ServiceAccount to run the pod as",
                    "status.phase": "Current phase: Pending, Running, Succeeded, Failed, Unknown"
                }
            },
            "deployment": {
                "kind": "Deployment",
                "api_version": "apps/v1",
                "description": "A Deployment provides declarative updates for Pods and ReplicaSets. You describe a desired state and the Deployment Controller changes the actual state to the desired state at a controlled rate.",
                "key_fields": {
                    "spec.replicas": "Number of desired pods",
                    "spec.selector": "Label selector for pods",
                    "spec.template": "Pod template specification",
                    "spec.strategy": "Deployment strategy (RollingUpdate or Recreate)",
                    "spec.minReadySeconds": "Minimum seconds for pod to be ready",
                    "status.availableReplicas": "Total available pods"
                }
            },
            "service": {
                "kind": "Service",
                "api_version": "v1",
                "description": "A Service is an abstraction which defines a logical set of Pods and a policy by which to access them. Services enable loose coupling between dependent Pods.",
                "key_fields": {
                    "spec.type": "Service type: ClusterIP, NodePort, LoadBalancer, ExternalName",
                    "spec.selector": "Label selector for pods",
                    "spec.ports": "List of ports exposed by the service",
                    "spec.clusterIP": "IP address of the service",
                    "spec.externalIPs": "External IPs for the service"
                }
            },
            "configmap": {
                "kind": "ConfigMap",
                "api_version": "v1",
                "description": "ConfigMap holds configuration data for pods to consume. ConfigMaps allow you to decouple configuration from image content.",
                "key_fields": {
                    "data": "Key-value pairs of configuration data",
                    "binaryData": "Binary configuration data",
                    "immutable": "If true, prevents updates"
                }
            },
            "secret": {
                "kind": "Secret",
                "api_version": "v1",
                "description": "Secret holds secret data of a certain type. Secrets are similar to ConfigMaps but are intended to hold confidential data.",
                "key_fields": {
                    "type": "Secret type (Opaque, kubernetes.io/tls, etc.)",
                    "data": "Base64-encoded secret data",
                    "stringData": "Non-base64 secret data (write-only)"
                }
            },
            "namespace": {
                "kind": "Namespace",
                "api_version": "v1",
                "description": "Namespace provides a scope for Names. Names of resources need to be unique within a namespace, but not across namespaces.",
                "key_fields": {
                    "metadata.name": "Namespace name",
                    "status.phase": "Namespace phase (Active or Terminating)"
                }
            },
            "ingress": {
                "kind": "Ingress",
                "api_version": "networking.k8s.io/v1",
                "description": "Ingress exposes HTTP and HTTPS routes from outside the cluster to services within the cluster. Traffic routing is controlled by rules defined on the Ingress resource.",
                "key_fields": {
                    "spec.ingressClassName": "Name of IngressClass to use",
                    "spec.tls": "TLS configuration",
                    "spec.rules": "Routing rules (host, path, backend)"
                }
            },
            "statefulset": {
                "kind": "StatefulSet",
                "api_version": "apps/v1",
                "description": "StatefulSet manages the deployment and scaling of a set of Pods with guarantees about ordering and uniqueness. Unlike Deployments, StatefulSets maintain a sticky identity for each pod.",
                "key_fields": {
                    "spec.serviceName": "Governing Service name",
                    "spec.replicas": "Number of replicas",
                    "spec.volumeClaimTemplates": "PVC templates for pods",
                    "spec.podManagementPolicy": "OrderedReady or Parallel"
                }
            }
        }

        kind_lower = kind.lower()

        if kind_lower in explanations:
            exp = explanations[kind_lower]
            return {
                "success": True,
                "kind": exp["kind"],
                "api_version": api_version or exp["api_version"],
                "description": exp["description"],
                "key_fields": exp["key_fields"]
            }
        else:
            return {
                "success": True,
                "kind": kind,
                "api_version": api_version or "unknown",
                "description": f"No detailed explanation available for {kind}. Use k8s_list_api_resources to see available resources.",
                "key_fields": {}
            }
    except Exception as e:
        logger.error(f"Failed to explain resource {kind}: {e}")
        return {"success": False, "error": str(e)}

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

# ============================================================================
# HELM TOOLS
# ============================================================================

@mcp.tool(description="List Helm releases in a namespace or all namespaces.")
async def helm_list(
    namespace: Optional[str] = None,
    all_namespaces: bool = False
) -> Dict[str, Any]:
    """List Helm releases"""
    try:
        import subprocess

        cmd = ["helm", "list", "--output", "json"]

        if all_namespaces:
            cmd.append("--all-namespaces")
        elif namespace:
            cmd.extend(["-n", namespace])

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        releases = json.loads(result.stdout) if result.stdout else []

        return {
            "success": True,
            "namespace": namespace or ("all" if all_namespaces else "default"),
            "releases": releases,
            "count": len(releases)
        }
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to list Helm releases: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get status of a Helm release.")
async def helm_status(
    release_name: str,
    namespace: str = "default"
) -> Dict[str, Any]:
    """Get Helm release status"""
    try:
        import subprocess

        cmd = ["helm", "status", release_name, "-n", namespace, "--output", "json"]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        status = json.loads(result.stdout) if result.stdout else {}

        return {
            "success": True,
            "release": release_name,
            "namespace": namespace,
            "status": status
        }
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to get Helm status for {release_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get Helm release history showing all revisions.")
async def helm_history(
    release_name: str,
    namespace: str = "default"
) -> Dict[str, Any]:
    """Get Helm release history"""
    try:
        import subprocess

        cmd = ["helm", "history", release_name, "-n", namespace, "--output", "json"]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        history = json.loads(result.stdout) if result.stdout else []

        return {
            "success": True,
            "release": release_name,
            "namespace": namespace,
            "history": history,
            "count": len(history)
        }
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to get Helm history for {release_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Install a Helm chart. BLOCKED for protected namespace.")
async def helm_install(
    release_name: str,
    chart: str,
    namespace: str = "default",
    values: Optional[Dict[str, Any]] = None,
    create_namespace: bool = False,
    wait: bool = True,
    timeout: str = "5m"
) -> Dict[str, Any]:
    """Install a Helm chart"""
    try:
        validate_namespace_write_access(namespace, "install Helm chart in")

        import subprocess
        import tempfile
        import yaml as pyyaml

        cmd = ["helm", "install", release_name, chart, "-n", namespace, "--output", "json"]

        if create_namespace:
            cmd.append("--create-namespace")

        if wait:
            cmd.extend(["--wait", "--timeout", timeout])

        # Write values to temp file if provided
        values_file = None
        if values:
            values_file = tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False)
            pyyaml.dump(values, values_file)
            values_file.close()
            cmd.extend(["-f", values_file.name])

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        # Clean up temp file
        if values_file:
            import os
            os.unlink(values_file.name)

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        logger.info(f"Installed Helm chart {chart} as {release_name} in {namespace}")

        return {
            "success": True,
            "release": release_name,
            "chart": chart,
            "namespace": namespace,
            "message": f"Release '{release_name}' installed successfully"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to install Helm chart {chart}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Upgrade a Helm release. BLOCKED for protected namespace.")
async def helm_upgrade(
    release_name: str,
    chart: str,
    namespace: str = "default",
    values: Optional[Dict[str, Any]] = None,
    reuse_values: bool = True,
    wait: bool = True,
    timeout: str = "5m"
) -> Dict[str, Any]:
    """Upgrade a Helm release"""
    try:
        validate_namespace_write_access(namespace, "upgrade Helm release in")

        import subprocess
        import tempfile
        import yaml as pyyaml

        cmd = ["helm", "upgrade", release_name, chart, "-n", namespace, "--output", "json"]

        if reuse_values:
            cmd.append("--reuse-values")

        if wait:
            cmd.extend(["--wait", "--timeout", timeout])

        values_file = None
        if values:
            values_file = tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False)
            pyyaml.dump(values, values_file)
            values_file.close()
            cmd.extend(["-f", values_file.name])

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        if values_file:
            import os
            os.unlink(values_file.name)

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        logger.info(f"Upgraded Helm release {release_name} in {namespace}")

        return {
            "success": True,
            "release": release_name,
            "chart": chart,
            "namespace": namespace,
            "message": f"Release '{release_name}' upgraded successfully"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to upgrade Helm release {release_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Uninstall a Helm release. BLOCKED for protected namespace.")
async def helm_uninstall(
    release_name: str,
    namespace: str = "default",
    keep_history: bool = False
) -> Dict[str, Any]:
    """Uninstall a Helm release"""
    try:
        validate_namespace_write_access(namespace, "uninstall Helm release from")

        import subprocess

        cmd = ["helm", "uninstall", release_name, "-n", namespace]

        if keep_history:
            cmd.append("--keep-history")

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        logger.info(f"Uninstalled Helm release {release_name} from {namespace}")

        return {
            "success": True,
            "release": release_name,
            "namespace": namespace,
            "message": f"Release '{release_name}' uninstalled successfully"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to uninstall Helm release {release_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Rollback a Helm release to a previous revision. BLOCKED for protected namespace.")
async def helm_rollback(
    release_name: str,
    revision: int,
    namespace: str = "default",
    wait: bool = True,
    timeout: str = "5m"
) -> Dict[str, Any]:
    """Rollback a Helm release"""
    try:
        validate_namespace_write_access(namespace, "rollback Helm release in")

        import subprocess

        cmd = ["helm", "rollback", release_name, str(revision), "-n", namespace]

        if wait:
            cmd.extend(["--wait", "--timeout", timeout])

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        logger.info(f"Rolled back Helm release {release_name} to revision {revision}")

        return {
            "success": True,
            "release": release_name,
            "revision": revision,
            "namespace": namespace,
            "message": f"Release '{release_name}' rolled back to revision {revision}"
        }
    except PermissionError as e:
        return {"success": False, "error": str(e), "blocked": True}
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to rollback Helm release {release_name}: {e}")
        return {"success": False, "error": str(e)}

@mcp.tool(description="Get values for a Helm release.")
async def helm_get_values(
    release_name: str,
    namespace: str = "default",
    all_values: bool = False
) -> Dict[str, Any]:
    """Get Helm release values"""
    try:
        import subprocess

        cmd = ["helm", "get", "values", release_name, "-n", namespace, "--output", "json"]

        if all_values:
            cmd.append("--all")

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        if result.returncode != 0:
            return {"success": False, "error": result.stderr}

        values = json.loads(result.stdout) if result.stdout else {}

        return {
            "success": True,
            "release": release_name,
            "namespace": namespace,
            "values": values
        }
    except FileNotFoundError:
        return {"success": False, "error": "Helm is not installed or not in PATH"}
    except Exception as e:
        logger.error(f"Failed to get Helm values for {release_name}: {e}")
        return {"success": False, "error": str(e)}

# ============================================================================
# FASTMCP SERVER INITIALIZATION
# ============================================================================

def main():
    """Main entry point for the Kubernetes MCP server"""
    logger.info("=" * 80)
    logger.info("Starting Kubernetes MCP Server (FastMCP)")
    logger.info("ADMIN USERS ONLY - Non-admin users will be rejected")
    logger.info(f"PROTECTED NAMESPACE: {PROTECTED_NAMESPACE} (read-only)")
    logger.info("=" * 80)

    # Test Kubernetes connection
    try:
        get_k8s_client()
        logger.info("Kubernetes client initialized successfully")
    except Exception as e:
        logger.warning(f"Kubernetes client initialization deferred: {e}")

    # Use shared HTTP transport when deployed as a pod-per-MCP service;
    # fall back to stdio when http_transport isn't on sys.path (local dev).
    try:
        from http_transport import run_with_http_support
        logger.info("Kubernetes MCP Server ready - waiting for requests")
        run_with_http_support(
            mcp_server=mcp,
            name="oap-kubernetes-mcp",
            version="1.0.0",
            default_port=int(os.environ.get("MCP_SERVER_PORT", "8086")),
        )
    except ImportError:
        logger.info("Kubernetes MCP Server ready - waiting for requests (stdio)")
        mcp.run()

if __name__ == "__main__":
    main()
