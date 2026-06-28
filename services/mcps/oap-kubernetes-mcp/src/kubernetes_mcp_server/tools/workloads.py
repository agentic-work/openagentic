"""Workload list tools — #881 chatmode-required enumeration verbs."""

from datetime import datetime
from typing import Any, Dict, Optional

from .._core import (
    mcp,
    logger,
    is_protected_namespace,
    get_k8s_client,
)

__all__ = [
    "k8s_list_replicasets",
    "k8s_list_daemonsets",
    "k8s_list_serviceaccounts",
    "k8s_list_ingresses",
    "k8s_list_events",
]

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
