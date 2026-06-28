

"""
OpenAgentic Azure MCP Server - Full Azure SDK for az cli Parity

This MCP provides FULL PARITY with Azure CLI using the official Azure SDK.
All operations run as the configured Azure SERVICE PRINCIPAL (app registration).

Authentication (OSS self-hosted pattern):
  azure.identity.ClientSecretCredential(tenant_id, client_id, client_secret)
  built from AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET env vars.

  The operator creates an Azure AD app registration + client secret, grants it
  the required Azure RBAC roles (and Microsoft Graph application permissions for
  the identity tools), and supplies the three values via the environment. Every
  operation runs with that single service-principal identity — the SP's RBAC
  permissions apply to all operations.

There is NO On-Behalf-Of (OBO) / user-token passthrough and no per-user
credential brokering: this MCP does not depend on a user being logged in via
an external IdP.
"""

import os
import json
import logging
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, List, Callable, TypeVar

_T = TypeVar("_T")

async def _in_thread(fn: Callable[[], _T]) -> _T:
    """Run a blocking SDK call off the asyncio event loop so it can't freeze
    the MCP HTTP server (and prevent /health from responding, which triggers
    k8s liveness-probe restarts during long-running Azure provisioning)."""
    return await asyncio.to_thread(fn)

from azure.core.credentials import AccessToken, TokenCredential
from azure.core.exceptions import AzureError, HttpResponseError, ClientAuthenticationError

# Management Plane Clients
from azure.mgmt.resource import ResourceManagementClient
from azure.mgmt.subscription import SubscriptionClient
from azure.mgmt.compute import ComputeManagementClient
from azure.mgmt.network import NetworkManagementClient
from azure.mgmt.storage import StorageManagementClient
from azure.mgmt.containerservice import ContainerServiceClient
from azure.mgmt.keyvault import KeyVaultManagementClient
from azure.mgmt.costmanagement import CostManagementClient
from azure.mgmt.monitor import MonitorManagementClient
from azure.mgmt.authorization import AuthorizationManagementClient

# Enterprise-scale clients added in v0.6.1 for issue #287
from azure.mgmt.resourcegraph import ResourceGraphClient
from azure.mgmt.resourcegraph.models import QueryRequest, QueryRequestOptions
from azure.mgmt.advisor import AdvisorManagementClient
from azure.mgmt.web import WebSiteManagementClient
from azure.mgmt.managementgroups import ManagementGroupsAPI
from azure.mgmt.security import SecurityCenter
from azure.mgmt.policyinsights import PolicyInsightsClient
from azure.mgmt.loganalytics import LogAnalyticsManagementClient
from azure.mgmt.applicationinsights import ApplicationInsightsManagementClient
from azure.monitor.query import LogsQueryClient, LogsQueryStatus

# 2026-05-15: imports for the batch-inventory tool's AIF/Front Door/Container Apps
# coverage. Lazy try/import below tolerates missing SDK in lean image builds.
try:
    from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
except ImportError:
    CognitiveServicesManagementClient = None  # type: ignore[assignment]
try:
    from azure.mgmt.cdn import CdnManagementClient
except ImportError:
    CdnManagementClient = None  # type: ignore[assignment]
try:
    from azure.mgmt.appcontainers import ContainerAppsAPIClient
except ImportError:
    ContainerAppsAPIClient = None  # type: ignore[assignment]
# Resource Health SDK is beta-only — we use ARM REST directly via requests
# in azure_service_health_events to avoid the unstable beta dependency.

# Data Plane Clients
from azure.keyvault.secrets import SecretClient
from azure.storage.blob import BlobServiceClient

# Microsoft Graph
from msgraph import GraphServiceClient
from azure.identity import ClientSecretCredential

from mcp.server.fastmcp import FastMCP

# =============================================================================
# CONFIGURATION
# =============================================================================

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-azure-mcp')
except ImportError:
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("oap-azure-mcp")

DEFAULT_SUBSCRIPTION_ID = os.environ.get("AZURE_SUBSCRIPTION_ID", "")

# Service principal (Azure AD app registration) configuration.
AZURE_TENANT_ID = os.environ.get("AZURE_TENANT_ID", "")
AZURE_CLIENT_ID = os.environ.get("AZURE_CLIENT_ID", "")
AZURE_CLIENT_SECRET = os.environ.get("AZURE_CLIENT_SECRET", "")

# =============================================================================
# SERVICE PRINCIPAL AUTHENTICATION
# =============================================================================
# This MCP authenticates with a single Azure AD service principal (app
# registration), built from the AZURE_TENANT_ID / AZURE_CLIENT_ID /
# AZURE_CLIENT_SECRET environment variables via ClientSecretCredential.
#
# There is NO user-token passthrough and NO OBO exchange — every operation
# runs with the service principal's RBAC (and Microsoft Graph application)
# permissions. The SP's identity is what shows up in the executed_as badge.
# =============================================================================

# Cached singleton ClientSecretCredential (one per process).
_sp_credential: Optional["ClientSecretCredential"] = None


def _build_service_principal_info() -> dict:
    """Build the executed_as badge for the configured service principal."""
    return {
        "upn": f"sp:{AZURE_CLIENT_ID}" if AZURE_CLIENT_ID else "service-principal",
        "name": "Azure Service Principal",
        "oid": AZURE_CLIENT_ID,
        "tid": AZURE_TENANT_ID,
        "aud": "",
        "auth": "service_principal",
    }


def get_service_principal_credential() -> "ClientSecretCredential":
    """
    Build (once) and return the ClientSecretCredential for the configured
    Azure AD service principal.

    Raises:
        ValueError: If AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET
            are not all configured.
    """
    global _sp_credential

    missing = [
        name for name, val in (
            ("AZURE_TENANT_ID", AZURE_TENANT_ID),
            ("AZURE_CLIENT_ID", AZURE_CLIENT_ID),
            ("AZURE_CLIENT_SECRET", AZURE_CLIENT_SECRET),
        ) if not val
    ]
    if missing:
        raise ValueError(
            "Azure service principal not configured. Missing environment "
            f"variable(s): {', '.join(missing)}. Create an Azure AD app "
            "registration + client secret, grant it the needed RBAC roles "
            "(and Microsoft Graph application permissions for identity tools), "
            "then set AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET."
        )

    if _sp_credential is None:
        _sp_credential = ClientSecretCredential(
            tenant_id=AZURE_TENANT_ID,
            client_id=AZURE_CLIENT_ID,
            client_secret=AZURE_CLIENT_SECRET,
        )
        logger.info(f"ClientSecretCredential initialized for service principal: {AZURE_CLIENT_ID}")

    return _sp_credential


def require_user_token(meta: Optional[Dict[str, Any]], token_key: str = "userAccessToken") -> tuple:
    """
    Return the service-principal credential + its identity badge.

    NOTE: the name and signature are retained for compatibility with the ~100
    tool call sites (and the test suite). The `meta` / `token_key` arguments
    are accepted but IGNORED — this MCP authenticates with the configured
    Azure AD service principal, not a per-user token. ClientSecretCredential
    requests the correct scope per Azure SDK client (ARM / Graph / Key Vault /
    Storage data planes) automatically, so a single credential serves every
    token_key that callers used to pass.

    Args:
        meta: Ignored (kept for call-site compatibility).
        token_key: Ignored (kept for call-site compatibility).

    Returns:
        Tuple of (ClientSecretCredential, service_principal_info dict)

    Raises:
        ValueError: If the service principal env vars are not configured.
    """
    credential = get_service_principal_credential()
    return credential, _build_service_principal_info()

def error_response(error: Exception, user_info: Optional[dict] = None) -> Dict[str, Any]:
    """Format error response with optional user context."""
    response = {
        "success": False,
        "error": str(error),
        "error_type": type(error).__name__
    }

    if isinstance(error, ClientAuthenticationError):
        response["hint"] = "Authentication failed. Your token may have expired - try re-logging into OpenAgentic."
    elif isinstance(error, HttpResponseError):
        response["status_code"] = error.status_code
        if error.status_code == 403:
            response["hint"] = "Access denied. You don't have permission for this operation in Azure."
        elif error.status_code == 404:
            response["hint"] = "Resource not found. Check the resource name/ID."

    if user_info:
        response["executed_as"] = user_info

    return response

# =============================================================================
# SERVER INSTRUCTIONS
# =============================================================================

AZURE_SERVER_INSTRUCTIONS = """
## OpenAgentic Azure MCP - Full Azure SDK (az cli Parity)

**IMPORTANT: Call `azure_help()` first to learn how to use this MCP effectively!**

This MCP runs as the configured Azure AD service principal.
The service principal's Azure RBAC permissions apply to all operations.

### Getting Started
```
azure_help()                    # Overview and general guidance
azure_help(topic="appgw")       # Application Gateway guide
azure_help(topic="troubleshooting")  # Common issues and fixes
```

### Available Tool Categories

**Help & Guidance**
- `azure_help` - Get usage guides, examples, and troubleshooting tips

**Subscriptions & Resources**
- `azure_list_subscriptions` - List accessible subscriptions
- `azure_list_resource_groups` - List resource groups
- `azure_create_resource_group` - Create a resource group
- `azure_delete_resource_group` - Delete a resource group

**Compute (VMs)**
- `azure_list_vms` - List virtual machines
- `azure_get_vm` - Get VM details
- `azure_start_vm` - Start a VM
- `azure_stop_vm` - Stop (deallocate) a VM
- `azure_restart_vm` - Restart a VM

**AKS (Kubernetes)**
- `azure_list_aks_clusters` - List AKS clusters
- `azure_get_aks_cluster` - Get AKS cluster details
- `azure_get_aks_credentials` - Get kubeconfig credentials

**Networking**
- `azure_list_vnets` - List virtual networks
- `azure_list_nsgs` - List network security groups
- `azure_list_load_balancers` - List Load Balancers

**Application Gateway**
- `azure_list_app_gateways` - List Application Gateways
- `azure_get_app_gateway` - Get full App Gateway config (listeners, pools, rules, probes, WAF)
- `azure_app_gateway_backend_health` - Get backend server health status
- `azure_app_gateway_start` - Start an App Gateway
- `azure_app_gateway_stop` - Stop an App Gateway

**Storage**
- `azure_list_storage_accounts` - List storage accounts
- `azure_list_containers` - List blob containers
- `azure_list_blobs` - List blobs in a container

**Key Vault**
- `azure_list_keyvaults` - List Key Vaults
- `azure_list_secrets` - List secrets in a vault
- `azure_get_secret` - Get a secret value
- `azure_set_secret` - Set a secret value

**Cost Management**
- `azure_cost_query` - Query costs with flexible parameters
- `azure_cost_by_service` - Cost breakdown by service
- `azure_cost_forecast` - Get cost forecasts

**Identity (Microsoft Graph)**
- `azure_list_users` - List Azure AD users
- `azure_get_user` - Get user details
- `azure_list_groups` - List Azure AD groups
- `azure_list_apps` - List app registrations

**Monitoring**
- `azure_list_alerts` - List metric alerts
- `azure_get_metrics` - Get resource metrics

**Typed Create Tools (use these — they handle all the ARM complexity for you)**
- `azure_create_resource_group` - Create resource group
- `azure_create_vnet` - Create virtual network with address space
- `azure_create_subnet` - Create subnet in a VNet (delegate dedicated subnet for App Gateway)
- `azure_create_nsg` - Create Network Security Group with optional inbound/outbound rules
- `azure_create_app_gateway` - Create Application Gateway v2 (Standard_v2 or WAF_v2).
  Accepts `backend_addresses` list (IPs/FQDNs) for the default backend pool — can hold
  100+ entries for enterprise scenarios. Creates public IP + listener + routing rule.
- `azure_create_front_door` - Create Front Door Standard/Premium profile with default
  endpoint; optionally auto-wires one origin group + origin to a backend hostname
  (supply `origin_hostname="myappgw-pip.eastus.cloudapp.azure.com"` to wire it to an
  App Gateway public IP, etc.).
- `azure_create_app_service_plan` - Create App Service Plan (compute container for web apps)
- `azure_create_web_app` - Create Linux/Windows App Service web app on a plan
- `azure_create_function_app` - Create serverless Function App (consumption or dedicated)
- `azure_create_container_app` - Create serverless Container App
- `azure_create_storage_account` - Create Storage Account
- `azure_storage_account_set_public_access` - Toggle public blob access
- `azure_create_key_vault` - Create Key Vault for secrets/keys/certs
- `azure_create_vm` - Create basic Linux/Windows VM with NIC + optional public IP

**Chaining example — Front Door → App Gateway (enterprise fronting)**
1. `azure_create_resource_group(name="rg-fd-demo", location="eastus")`
2. `azure_create_vnet(name="vnet-fd", resource_group="rg-fd-demo",
      location="eastus", address_prefix="10.0.0.0/16")`
3. `azure_create_subnet(vnet_name="vnet-fd", name="appgw-subnet",
      address_prefix="10.0.1.0/24")`  — App Gateway needs its own /24
4. `azure_create_app_gateway(name="agw-demo", resource_group="rg-fd-demo",
      location="eastus", vnet_name="vnet-fd", subnet_name="appgw-subnet",
      backend_addresses=[...100 IPs/FQDNs...], capacity=2)`
5. `azure_create_front_door(name="fd-demo", resource_group="rg-fd-demo",
      origin_hostname="<appgw-pip-fqdn-from-step-4>")`
6. `azure_list_front_doors` + `azure_list_app_gateways` to verify.

**Audit / Security / Compliance Reads**
- `azure_list_role_assignments` - List RBAC role assignments
- `azure_security_list_assessments` - Defender for Cloud findings (typed SDK)
- `azure_security_secure_score` - Defender secure score by control
- `azure_security_list_alerts` - Defender active/resolved security alerts
- `azure_policy_list_compliance_states` - Policy compliance per resource

**Observability / Logs / Metrics**
- `azure_log_analytics_list_workspaces` - List LAW workspaces
- `azure_log_analytics_query` - Run KQL against a LAW workspace
- `azure_app_insights_list_components` - List App Insights components
- `azure_app_insights_query` - Run KQL against App Insights telemetry

USAGE PATTERN: The tools listed above are the COMPLETE set. If a typed tool
exists for your need, call it. If one does not, say so clearly — do NOT
invent tool names. Every Azure MCP tool begins with `azure_` or `aif_`.

If a requested scenario has no typed tool, respond honestly: "I don't have
a tool for <thing>. I can do <related thing> with <typed tool>. Do you
want me to proceed with that?" — then stop and wait for the user.

### Authentication

All operations run as the configured Azure AD service principal.
If an operation fails with 403, the service principal lacks the required
Azure RBAC role (or Microsoft Graph application permission).
"""

# =============================================================================
# FASTMCP SERVER
# =============================================================================

mcp = FastMCP("OpenAgentic Azure MCP", instructions=AZURE_SERVER_INSTRUCTIONS)

# =============================================================================
# HTTP TRANSPORT (shared) — startup path + import guard
# =============================================================================
import sys
import os
# In Docker container: /app/src/server.py, shared is at /app/shared/
# So from __file__ (/app/src/server.py), go to parent (/app/src), then parent (/app), then shared
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'shared'))
# Also add /app/shared directly in case we're running from /app
sys.path.insert(0, '/app/shared')

try:
    from http_transport import run_with_http_support
    HTTP_TRANSPORT_AVAILABLE = True
except ImportError:
    run_with_http_support = None
    HTTP_TRANSPORT_AVAILABLE = False

# =============================================================================
# PUBLIC API — names re-exported to server + every tools module via `import *`
# =============================================================================
__all__ = [
    'AccessToken',
    'TokenCredential',
    'AzureError',
    'HttpResponseError',
    'ClientAuthenticationError',
    'ResourceManagementClient',
    'SubscriptionClient',
    'ComputeManagementClient',
    'NetworkManagementClient',
    'StorageManagementClient',
    'ContainerServiceClient',
    'KeyVaultManagementClient',
    'CostManagementClient',
    'MonitorManagementClient',
    'AuthorizationManagementClient',
    'ResourceGraphClient',
    'QueryRequest',
    'QueryRequestOptions',
    'AdvisorManagementClient',
    'WebSiteManagementClient',
    'ManagementGroupsAPI',
    'SecurityCenter',
    'PolicyInsightsClient',
    'LogAnalyticsManagementClient',
    'ApplicationInsightsManagementClient',
    'LogsQueryClient',
    'LogsQueryStatus',
    'CognitiveServicesManagementClient',
    'CdnManagementClient',
    'ContainerAppsAPIClient',
    'SecretClient',
    'BlobServiceClient',
    'GraphServiceClient',
    'ClientSecretCredential',
    'FastMCP',
    'mcp',
    'logger',
    'DEFAULT_SUBSCRIPTION_ID',
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    '_in_thread',
    '_build_service_principal_info',
    'get_service_principal_credential',
    'require_user_token',
    'error_response',
    'AZURE_SERVER_INSTRUCTIONS',
    'run_with_http_support',
    'HTTP_TRANSPORT_AVAILABLE',
]
