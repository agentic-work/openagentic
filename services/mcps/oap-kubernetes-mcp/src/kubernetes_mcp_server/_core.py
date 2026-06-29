"""
Kubernetes MCP Server - shared core (FastMCP instance + K8s client)

This module is the SINGLE OWNER of the FastMCP ``mcp`` instance, the lazy
Kubernetes API clients, namespace-protection helpers, configuration, and the
structured logger. Tool modules under ``kubernetes_mcp_server.tools`` import
from here and register their ``@mcp.tool`` handlers as an import side-effect.

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
import logging

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
