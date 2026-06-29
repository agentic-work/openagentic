"""API discovery tools."""

from typing import Any, Dict, Optional

from .._core import (
    mcp,
    logger,
    get_k8s_client,
)

__all__ = [
    "k8s_list_api_resources",
    "k8s_explain_resource",
]

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
