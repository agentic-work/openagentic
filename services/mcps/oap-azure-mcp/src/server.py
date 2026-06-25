

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
# GUIDANCE TOOL - TEACHES LLM HOW TO USE THIS MCP
# =============================================================================

@mcp.tool()
async def azure_help(
    topic: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get guidance on how to use the Azure MCP effectively.

    Call this tool FIRST when you need to perform Azure operations.
    It provides examples, best practices, and common workflows.

    Args:
        topic: Optional topic to get help on. Options:
               - "overview" (default) - General guidance
               - "auth" - Authentication and permissions
               - "large_responses" - CRITICAL: Handling massive data correctly
               - "vms" - Virtual machine operations
               - "aks" - Kubernetes cluster operations
               - "appgw" - Application Gateway operations
               - "networking" - VNets, NSGs, Load Balancers
               - "storage" - Storage accounts and blobs
               - "keyvault" - Key Vault and secrets
               - "cost" - Cost management and analysis
               - "graph" - Azure AD / Entra ID operations
               - "troubleshooting" - Common issues and solutions
    """
    guides = {
        "overview": """
# Azure MCP Usage Guide

## How This MCP Works

This MCP runs as the configured Azure AD service principal. The service
principal's Azure RBAC permissions apply to ALL operations. If the SP can't
do it in the Azure Portal, you can't do it here.

## General Workflow

1. **Start with discovery** - List resources before operating on them
2. **Use specific tools** - Each resource type has dedicated tools
3. **Check the executed_as field** - Every response shows who ran the operation
4. **Handle large responses properly** - See `azure_help(topic="large_responses")`

## CRITICAL: Large Response Handling

Azure environments can have 1000s of VMs, 100Ks of blobs, 10Ks of users.
**NEVER dump raw JSON to users.** Always:
- Filter at source (resource_group, prefix, etc.)
- Use limit parameters (max_results, top)
- Summarize intelligently
- Use progressive disclosure

Read the full guide: `azure_help(topic="large_responses")`

## Common Patterns

### Find then Act
```
User: "Stop my VM named webserver"

1. azure_list_vms() → Find the VM and its resource group
2. azure_stop_vm(name="webserver", resource_group="my-rg")
```

### Subscription Context
Most tools accept `subscription_id`. If not provided, uses the default.
To see available subscriptions: `azure_list_subscriptions()`

### Resource Groups
Always identify the resource group before operating on resources.
Use `azure_list_resource_groups()` to find them.

## Tool Categories

| Category | Use For |
|----------|---------|
| Subscriptions | List accessible subscriptions |
| Resource Groups | Organize and manage resource groups |
| VMs | Start, stop, restart virtual machines |
| AKS | Kubernetes cluster management |
| App Gateway | L7 load balancing, WAF, SSL termination |
| Networking | VNets, NSGs, Load Balancers |
| Storage | Storage accounts, blob containers |
| Key Vault | Secrets management |
| Cost | Spending analysis and forecasts |
| Graph | Azure AD users, groups, apps |
""",

        "auth": """
# Authentication Guide

## How Authentication Works

1. The operator creates an Azure AD app registration (service principal) +
   client secret and grants it the required RBAC roles / Graph permissions.
2. AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET are provided to
   this MCP via the environment.
3. The MCP builds a ClientSecretCredential from those values.
4. The Azure SDK uses that credential, requesting the right scope per plane
   (ARM / Microsoft Graph / Key Vault / Storage) automatically.
5. The service principal's RBAC permissions apply to every operation.

## Permission Errors

If you get a 403 error:
- The service principal doesn't have the required Azure RBAC permission
  (or Microsoft Graph application permission for identity tools)
- Check: Azure Portal → Resource → Access Control (IAM)
- Common roles needed: Reader, Contributor, Owner

## Single Identity

This MCP uses ONE configured service principal for all operations. There is
no per-user token passthrough and no OBO exchange.
""",

        "large_responses": """
# CRITICAL: Handling Large Azure Responses

## The Problem

Azure environments can be MASSIVE:
- 1000s of VMs across subscriptions
- 100,000s of blobs in storage
- Years of cost data with daily granularity
- 10,000s of Azure AD users

**DO NOT** dump raw JSON responses to users. This will:
- Overwhelm the user with unreadable data
- Consume excessive tokens
- Provide poor user experience

## Best Practices

### 1. ALWAYS Filter at Source

Use parameters to narrow results BEFORE fetching:

```python
# BAD: Fetch everything
azure_list_vms()  # Could return 1000s of VMs

# GOOD: Filter by resource group
azure_list_vms(resource_group="production-rg")  # Only prod VMs
```

### 2. Use Limit Parameters

Most tools support limiting results:

```python
# Storage - use max_results
azure_list_blobs(
    storage_account="datalake",
    container_name="logs",
    prefix="2024/01/",    # Filter by prefix
    max_results=50        # Limit to 50 blobs
)

# Graph - use top
azure_list_users(top=25)
azure_list_groups(top=25)
```

### 3. Summarize for Users

When presenting results, summarize intelligently:

```
# BAD Response to User:
"Here are your 847 VMs: [massive JSON dump]"

# GOOD Response to User:
"You have 847 VMs across 12 resource groups:
- production-rg: 234 VMs (156 running, 78 stopped)
- staging-rg: 89 VMs (45 running, 44 stopped)
- dev-rg: 524 VMs (12 running, 512 stopped)

Would you like details on a specific resource group?"
```

### 4. Progressive Disclosure

Start narrow, expand on request:

```
User: "Show me our Azure storage"

Step 1: azure_list_storage_accounts()
→ "You have 8 storage accounts. The largest are:
   - datalakeprod (2.3 TB)
   - logstorage (890 GB)
   - backups (450 GB)"

Step 2 (if user asks): azure_list_containers(storage_account="datalakeprod")
→ "datalakeprod has 12 containers..."

Step 3 (if user asks): azure_list_blobs(..., prefix="...", max_results=20)
→ Show specific blobs
```

### 5. Cost Data Strategy

Cost queries can return HUGE datasets:

```python
# BAD: Raw daily data for a year
azure_cost_query(days=365, granularity="Daily")
# Returns 365+ rows of data

# GOOD: Summarized by service
azure_cost_by_service(days=30, top_n=10)
# Returns top 10 services with totals

# GOOD: Monthly granularity for trends
azure_cost_query(days=90, granularity="Monthly", group_by=["ServiceName"])
# Returns ~3 rows per service
```

### 6. For Programmatic Use

If the user needs raw data for processing:

1. Acknowledge the data will be large
2. Ask if they want it saved/exported
3. Consider chunking or pagination
4. Warn about token consumption

```
User: "Export all our VM data"

Response: "Your subscription has 847 VMs. The full export would be
approximately 50KB of JSON data. Would you like me to:

1. Export to a file (recommended for processing)
2. Show summary with option to drill down
3. Filter to specific resource groups first"
```

## Tools with Large Response Potential

| Tool | Risk | Mitigation |
|------|------|------------|
| azure_list_vms | High (1000s) | Filter by resource_group |
| azure_list_blobs | Very High (100Ks) | Use prefix + max_results |
| azure_cost_query | High | Use granularity=Monthly, limit days |
| azure_list_users | High (10Ks) | Use top parameter |
| azure_list_groups | Medium | Use top parameter |
| azure_get_app_gateway | Medium | Single resource, but detailed |
| azure_app_gateway_backend_health | Low-Medium | Per-server health |

## Data Layer Integration

For truly massive datasets that need further processing:

1. **Acknowledge the size** - Tell the user what you're dealing with
2. **Propose a strategy** - Filtering, sampling, or export
3. **Execute incrementally** - Don't fetch everything at once
4. **Summarize meaningfully** - Extract insights, not raw data

### Working Context Pattern (Fetch Once, Query Many)

When you receive a large response (like a 400+ resource App Gateway):

```
Step 1: FETCH - Get the full data
─────────────────────────────────
azure_get_app_gateway(...) → Large JSON response

Step 2: INDEX - Organize in your working memory
─────────────────────────────────────────────────
You now have this data in context. Index it mentally:
- listeners: {name → config}
- pools: {name → addresses}
- rules: {name → listener + pool}
- probes: {name → health config}

Step 3: QUERY - Answer questions from context
─────────────────────────────────────────────
User asks: "What handles api.company.com?"

DO NOT re-fetch. Query YOUR CONTEXT:
1. Search listeners for hostname match
2. Find rule referencing that listener
3. Get backend pool from rule
4. Format clean answer

Step 4: ANSWER - Present specific insights
──────────────────────────────────────────
"api.company.com routes through:
- Listener: api-listener (HTTPS/443)
- Backend: api-pool (3 servers)
- Health: /api/health every 30s"
```

### Multi-Turn Conversation Pattern

```
Turn 1: User asks about App Gateway
────────────────────────────────────
You: Fetch full config, store in context
You: "Your App Gateway has 127 listeners, 89 backend pools,
      156 routing rules. What would you like to know?"

Turn 2: User asks "Which listeners use SSL?"
────────────────────────────────────────────
You: Query YOUR EXISTING CONTEXT (don't re-fetch!)
You: Filter listeners where ssl_certificate != null
You: "43 listeners use SSL. Top domains:
      - *.company.com (wildcard cert, 12 listeners)
      - api.company.com (dedicated cert, 8 listeners)
      - portal.company.com (dedicated cert, 5 listeners)"

Turn 3: User asks "Show me the api.company.com flow"
───────────────────────────────────────────────────
You: Still using SAME CONTEXT from Turn 1
You: Trace: listener → rule → pool → settings → probe
You: Present ASCII flow diagram

Turn 4: User asks "What's the health status?"
─────────────────────────────────────────────
You: NOW you need new data - health is dynamic
You: azure_app_gateway_backend_health(...)
You: Correlate with pools from your existing context
```

### Key Rules

1. **Don't re-fetch static config** - App Gateway structure doesn't change mid-conversation
2. **Do re-fetch dynamic data** - Backend health, metrics change constantly
3. **Correlate across fetches** - Use pool names to link config to health
4. **Track what's in context** - Know what you've already fetched
5. **Answer FROM context** - Don't dump JSON, extract the answer

Remember: The goal is to HELP the user, not overwhelm them with data.
""",

        "vms": """
# Virtual Machine Operations

## List VMs
```python
# All VMs in subscription
azure_list_vms()

# VMs in specific resource group
azure_list_vms(resource_group="my-rg")
```

## Get VM Details
```python
# Includes power state (running/stopped)
azure_get_vm(name="webserver", resource_group="my-rg")
```

## Power Operations
```python
azure_start_vm(name="webserver", resource_group="my-rg")
azure_stop_vm(name="webserver", resource_group="my-rg")   # Deallocates (stops billing)
azure_restart_vm(name="webserver", resource_group="my-rg")
```

## Common Workflow: Find and Stop VM
```
User: "Stop my production web server"

1. azure_list_vms()
   → Find VM named "prod-web-01" in resource group "production-rg"

2. azure_get_vm(name="prod-web-01", resource_group="production-rg")
   → Confirm it's running and it's the right one

3. azure_stop_vm(name="prod-web-01", resource_group="production-rg")
   → VM deallocated, compute billing stops
```

## Tips
- stop_vm uses "deallocate" - this STOPS billing for compute
- Power operations are async - they return immediately
- Use get_vm to check power_state after operations
""",

        "aks": """
# AKS (Kubernetes) Operations

## List Clusters
```python
# All clusters
azure_list_aks_clusters()

# In specific resource group
azure_list_aks_clusters(resource_group="k8s-rg")
```

## Get Cluster Details
```python
azure_get_aks_cluster(name="prod-cluster", resource_group="k8s-rg")
# Returns: version, node pools, network config, FQDN
```

## Get Kubeconfig
```python
# User credentials (AAD integrated)
azure_get_aks_credentials(name="prod-cluster", resource_group="k8s-rg")

# Admin credentials (requires elevated permissions)
azure_get_aks_credentials(name="prod-cluster", resource_group="k8s-rg", admin=True)
```

## Common Workflow: Connect to Cluster
```
User: "I need to connect to my production Kubernetes cluster"

1. azure_list_aks_clusters()
   → Find "prod-aks" in "production-rg"

2. azure_get_aks_cluster(name="prod-aks", resource_group="production-rg")
   → Get FQDN: prod-aks-abc123.hcp.eastus.azmk8s.io

3. azure_get_aks_credentials(name="prod-aks", resource_group="production-rg")
   → Get kubeconfig to connect
```

## Tips
- Kubeconfig is returned as a YAML string
- For AAD-integrated clusters, user credentials use AAD auth
- Admin credentials bypass AAD (use sparingly)
""",

        "appgw": """
# Application Gateway Operations

## List App Gateways
```python
azure_list_app_gateways()
azure_list_app_gateways(resource_group="networking-rg")
```

## Get Full Configuration
```python
azure_get_app_gateway(name="api-gateway", resource_group="networking-rg")
```
Returns EVERYTHING:
- SKU (WAF_v2, Standard_v2, etc)
- Frontend IPs and ports
- Backend pools and addresses
- HTTP settings
- Listeners (HTTP/HTTPS, hostnames, SSL certs)
- Routing rules
- Health probes
- WAF configuration

## Check Backend Health
```python
azure_app_gateway_backend_health(name="api-gateway", resource_group="networking-rg")
```
Shows health of EACH backend server:
- Healthy / Unhealthy / Unknown
- Health probe logs (why it failed)

## Start/Stop
```python
azure_app_gateway_start(name="api-gateway", resource_group="networking-rg")
azure_app_gateway_stop(name="api-gateway", resource_group="networking-rg")
```
Stopping an App Gateway stops billing (good for dev/test).

## Common Workflow: Troubleshoot Unhealthy Backend
```
User: "My API gateway is showing unhealthy backends"

1. azure_list_app_gateways()
   → Find the gateway

2. azure_app_gateway_backend_health(name="api-gw", resource_group="prod-rg")
   → See which servers are unhealthy and WHY
   → "Connection refused on port 443"

3. azure_get_app_gateway(name="api-gw", resource_group="prod-rg")
   → Check probe configuration
   → Verify backend pool addresses are correct
```

## Tips
- Backend health check is a long-running operation (may take 30-60s)
- WAF_v2 SKU includes Web Application Firewall
- Health probe logs tell you exactly why backends are failing

## Handling Large App Gateway Configs (400+ Resources)

Enterprise App Gateways can have:
- 100+ backend pools
- 100+ HTTP settings
- 100+ listeners (multi-site hosting)
- 100+ routing rules
- 50+ health probes
- 50+ SSL certificates

### Strategy: Fetch Once, Query In-Context

**Step 1: Fetch the full config and acknowledge the size**
```python
result = azure_get_app_gateway(name="enterprise-gw", resource_group="prod-rg")

# Response contains 400+ resources
# DO NOT dump this to the user
```

**Step 2: Store in your working context**
When you receive a large App Gateway response, mentally index it:
- Backend pools: {pool_name → addresses}
- Listeners: {listener_name → hostname, port, ssl_cert}
- Rules: {rule_name → listener, backend_pool, http_settings}
- Probes: {probe_name → path, interval, threshold}

**Step 3: Answer user questions FROM your context**

```
User: "What backends handle api.company.com?"

Your process:
1. You already have the full config in context
2. Find listener where hostname = "api.company.com" → "api-https-listener"
3. Find rule referencing that listener → "api-routing-rule"
4. Get backend_pool from that rule → "api-backend-pool"
5. Get addresses from that pool → ["10.0.1.10", "10.0.1.11", "10.0.1.12"]

Response to user:
"api.company.com is handled by:
- Listener: api-https-listener (HTTPS/443, SSL cert: api-wildcard-cert)
- Routing Rule: api-routing-rule (Basic routing)
- Backend Pool: api-backend-pool
- Backend Servers: 10.0.1.10, 10.0.1.11, 10.0.1.12
- HTTP Settings: api-https-settings (port 443, 30s timeout)"
```

### Example: Complex Query Workflow

```
User: "I need to understand the full request flow for orders.company.com"

Step 1: Fetch full config (if not already in context)
azure_get_app_gateway(name="enterprise-gw", resource_group="prod-rg")

Step 2: Trace the flow using your context:

1. DNS → Frontend IP
   frontend_ip_configurations → find public IP

2. Frontend IP → Listener
   http_listeners → find where host_name = "orders.company.com"
   → "orders-https-listener" on port 443, SSL: "orders-cert"

3. Listener → Routing Rule
   request_routing_rules → find where http_listener = "orders-https-listener"
   → "orders-rule" (PathBasedRouting)

4. Rule → URL Path Map (if path-based)
   → "/api/*" → api-backend-pool
   → "/static/*" → cdn-backend-pool
   → default → web-backend-pool

5. Backend Pool → Servers
   backend_address_pools → get addresses
   → web-backend-pool: [10.0.2.10, 10.0.2.11]

6. HTTP Settings → How traffic is sent
   backend_http_settings → get settings
   → port 8080, HTTP, cookie affinity enabled, 60s timeout

7. Probe → Health check
   probes → find probe for this backend
   → /health, every 30s, threshold 3

Step 3: Present as a clear flow diagram to user:

"Request flow for orders.company.com:

┌─────────────────────────────────────────────────────────────┐
│ Client → orders.company.com                                 │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Frontend: 52.168.1.100 (public IP)                          │
│ Listener: orders-https-listener (HTTPS/443)                 │
│ SSL Cert: orders-cert (expires: 2025-06-15)                 │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Routing: orders-rule (Path-based)                           │
│   /api/*    → api-backend-pool                              │
│   /static/* → cdn-backend-pool                              │
│   /*        → web-backend-pool                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Backend Pool: web-backend-pool                              │
│ Servers: 10.0.2.10, 10.0.2.11                               │
│ HTTP Settings: web-settings (port 8080, 60s timeout)        │
│ Health Probe: web-probe (/health, 30s interval)             │
└─────────────────────────────────────────────────────────────┘
"
```

### Key Principles for Large Configs

1. **Fetch once, query many** - Don't re-fetch for each question
2. **Build mental index** - Organize by resource type
3. **Trace relationships** - Listeners → Rules → Pools → Settings
4. **Answer specifically** - Extract only what the user asked
5. **Visualize when helpful** - ASCII diagrams clarify complex flows
6. **Offer drill-down** - "Want details on the SSL certificates?"
""",

        "networking": """
# Networking Operations

## Virtual Networks
```python
azure_list_vnets()
azure_list_vnets(resource_group="networking-rg")
```
Returns: Name, address space, subnets

## Network Security Groups
```python
azure_list_nsgs()
azure_list_nsgs(resource_group="networking-rg")
```
Returns: Name, rule counts

## Load Balancers
```python
azure_list_load_balancers()
azure_list_load_balancers(resource_group="networking-rg")
```
Returns: SKU, frontend IPs, backend pools, rules

## Common Workflow: Network Discovery
```
User: "Show me the network topology for production"

1. azure_list_vnets(resource_group="production-rg")
   → VNets and their address spaces

2. azure_list_nsgs(resource_group="production-rg")
   → Security groups protecting the networks

3. azure_list_load_balancers(resource_group="production-rg")
   → L4 load balancers

4. azure_list_app_gateways(resource_group="production-rg")
   → L7 load balancers / WAF
```
""",

        "storage": """
# Storage Operations

## List Storage Accounts
```python
azure_list_storage_accounts()
azure_list_storage_accounts(resource_group="data-rg")
```

## List Containers (Storage data plane)
```python
azure_list_containers(
    storage_account="mystorageacct",
    resource_group="data-rg"
)
```

## List Blobs
```python
azure_list_blobs(
    storage_account="mystorageacct",
    container_name="documents",
    prefix="reports/",      # Optional filter
    max_results=50          # Limit results
)
```

## Common Workflow: Find Files
```
User: "Find all PDF reports in our data lake"

1. azure_list_storage_accounts()
   → Find "datalakeprod" storage account

2. azure_list_containers(storage_account="datalakeprod", resource_group="data-rg")
   → Find "reports" container

3. azure_list_blobs(
       storage_account="datalakeprod",
       container_name="reports",
       prefix="2024/"
   )
   → List all blobs in reports/2024/
```

## Tips
- Storage data-plane operations need the SP granted a Storage data role (e.g. Storage Blob Data Reader/Contributor)
- Use prefix filter to narrow down results
- max_results defaults to 100 to avoid huge responses
""",

        "keyvault": """
# Key Vault Operations

## List Key Vaults
```python
azure_list_keyvaults()
azure_list_keyvaults(resource_group="security-rg")
```

## List Secrets (names only)
```python
azure_list_secrets(vault_name="prod-secrets")
```

## Get Secret Value
```python
azure_get_secret(vault_name="prod-secrets", secret_name="db-password")
```

## Set Secret Value
```python
azure_set_secret(
    vault_name="prod-secrets",
    secret_name="api-key",
    secret_value="sk-abc123...",
    content_type="text/plain"
)
```

## Common Workflow: Retrieve Credentials
```
User: "I need the database connection string"

1. azure_list_keyvaults()
   → Find "prod-secrets" vault

2. azure_list_secrets(vault_name="prod-secrets")
   → Find "sql-connection-string" secret

3. azure_get_secret(vault_name="prod-secrets", secret_name="sql-connection-string")
   → Get the actual value
```

## Tips
- Key Vault data-plane operations need the SP granted a Key Vault access policy / data role
- User needs "Key Vault Secrets User" role to read secrets
- User needs "Key Vault Secrets Officer" role to write secrets
- Secret values are returned in plain text - handle carefully
""",

        "cost": """
# Cost Management Operations

## Query Costs (Flexible)
```python
azure_cost_query(
    days=30,                          # Last 30 days
    granularity="Daily",              # Daily, Monthly, or None
    group_by=["ResourceType", "ResourceGroup"]
)
```

## Cost by Service (Top Spenders)
```python
azure_cost_by_service(days=30, top_n=10)
```
Returns top 10 services by cost.

## Cost Forecast
```python
azure_cost_forecast(forecast_days=30)
```
Predicts spending for next 30 days.

## Common Workflow: Cost Analysis
```
User: "Why is our Azure bill so high this month?"

1. azure_cost_by_service(days=30, top_n=10)
   → "Virtual Machines: $5,234"
   → "Storage: $1,892"
   → "App Service: $956"

2. azure_cost_query(
       days=30,
       granularity="Daily",
       group_by=["ResourceGroup"]
   )
   → See which resource groups are costing the most

3. azure_cost_forecast(forecast_days=30)
   → "Forecasted: $8,500 for next 30 days"
```

## Subscription Resolution
- All three cost tools accept `subscription_id` as an OPTIONAL argument.
- When you omit it (or pass `null`), the tool auto-resolves the service
  principal's visible subscriptions and fans the query across each,
  aggregating into a single answer. Use this for "show me my total Azure
  cost" prompts — DON'T chain `azure_list_subscriptions` first.
- Pass an explicit UUID only when the user wants one specific subscription.

## Tips
- Cost data may have 24-48 hour delay
- group_by dimensions: ResourceType, ResourceGroup, ServiceName, etc.
- Costs are returned in USD
""",

        "graph": """
# Microsoft Graph (Azure AD / Entra ID) Operations

## List Users
```python
azure_list_users(top=100)
```

## Get User Details
```python
azure_get_user(user_id="john@company.com")
# or
azure_get_user(user_id="550e8400-e29b-41d4-a716-446655440000")
```

## List Groups
```python
azure_list_groups(top=100)
```

## List App Registrations
```python
azure_list_apps(top=100)
```

## Common Workflow: Find User Info
```
User: "Who is the manager of john@company.com?"

1. azure_get_user(user_id="john@company.com")
   → Returns user profile with department, job title, etc.
```

## Tips
- Graph operations need the SP granted Microsoft Graph application permissions
- User needs appropriate Graph permissions
- Can search by UPN (email) or object ID
""",

        "troubleshooting": """
# Troubleshooting Guide

## Common Errors

### "Azure service principal not configured"
**Cause**: AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET not all set
**Fix**: Create an Azure AD app registration + client secret and set the three
env vars for this MCP

### "403 Forbidden"
**Cause**: Service principal lacks the required Azure RBAC permission
**Fix**: Grant the appropriate role to the service principal in Azure Portal:
- Reader: View resources
- Contributor: Create/modify resources
- Owner: Full control including IAM

### "404 Not Found"
**Cause**: Resource doesn't exist or wrong name/resource group
**Fix**: Use list tools to find correct resource names

### "Token expired"
**Cause**: Azure AD token has expired
**Fix**: User should refresh the page / re-login to OpenAgentic

## Debugging Steps

1. **Check authentication**
   - Look at `executed_as` in responses
   - Verify it shows the correct user

2. **Verify resource exists**
   - Use list tools before operating on specific resources
   - Check resource group is correct

3. **Check permissions**
   - User needs RBAC role on the resource
   - Some operations need elevated roles (e.g., Key Vault secrets)

4. **Review error hints**
   - Error responses include `hint` field with suggestions

## Getting Help

If an operation fails:
1. Note the exact error message
2. Check the `error_type` field
3. Review the `hint` if provided
4. Verify user has correct RBAC role in Azure
"""
    }

    topic = (topic or "overview").lower()
    if topic not in guides:
        return {
            "success": True,
            "available_topics": list(guides.keys()),
            "hint": "Call azure_help(topic='<topic>') for specific guidance"
        }

    return {
        "success": True,
        "topic": topic,
        "guide": guides[topic]
    }

# =============================================================================
# SUBSCRIPTION & RESOURCE GROUP TOOLS
# =============================================================================

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my subscriptions", "show me subscriptions", "what subscriptions do i have"],
        "testFixture": None,
    },
)
async def azure_list_subscriptions(
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List the Azure AD tenant subscriptions visible to the caller.

    Resource: Azure subscriptions (sometimes called "subs" or "billing accounts").
    Read-only. Uses the configured service principal credential.
    RBAC-filtered: if the user has no role assignments on any subscription, the
    list is empty (an error of fact, not a permissions bug).

    Trigger phrases: "list my subscriptions", "show me my Azure subs",
    "what subscriptions do I have", "azure billing accounts", "what tenant am I in".

    Example: azure_list_subscriptions()  # caller's primary tenant, all visible subs

    Returns:
        { success, count, subscriptions: [
            { id, name, state: "Enabled"|"Disabled"|"Warned"|..., tenant_id }
          ], executed_as }

    Adjacent tools:
      - Drill into one sub: azure_list_resource_groups(subscription_id=...)
      - Cross-sub KQL: azure_resource_graph_query(subscriptions=[id, ...], kql=...)
      - Cost view: azure_cost_query(subscription_id=..., lookback_days=30)
    """
    try:
        credential, user_info = require_user_token(meta)

        client = SubscriptionClient(credential)
        subscriptions = list(client.subscriptions.list())

        # #572 — Azure SDK's Subscription.tenant_id is often None for the
        # primary listing path (only populated for true cross-tenant
        # Lighthouse delegations). Fall back to the validated JWT's `tid`
        # claim from user_info (require_user_token decoded it at line 163)
        # — that's the authenticated user's home tenant, which matches the
        # subs the service principal can see. Last-resort literal "unknown"
        # was harming UI rendering of subscription tables.
        user_tid = user_info.get("tid", "") if isinstance(user_info, dict) else ""
        return {
            "success": True,
            "count": len(subscriptions),
            "subscriptions": [
                {
                    "id": sub.subscription_id,
                    "name": sub.display_name,
                    "state": sub.state.value if hasattr(sub.state, 'value') else str(sub.state) if sub.state else "Unknown",
                    "tenant_id": (
                        getattr(sub, "tenant_id", None)
                        or sub.additional_properties.get("tenantId")
                        or user_tid
                        or "unknown"
                    ),
                }
                for sub in subscriptions
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my resource groups", "show me resource groups", "what resource groups do i have"],
        "testFixture": None,
    },
)
async def azure_list_resource_groups(
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List the resource groups in an Azure subscription visible to the caller.

    Resource: Azure resource groups ("RGs") — logical containers for
    deployments. Read-only. RBAC-filtered. Useful as the second step after
    azure_list_subscriptions, or to answer "what resource groups do I have
    in <sub>?" / "does <rg-name> already exist?".

    Trigger phrases: "list my resource groups", "show me my RGs",
    "list resource groups in <sub>", "what RGs do I have", "azure rg list".

    Example:
      azure_list_resource_groups(subscription_id="11111111-2222-3333-4444-555555555555")
      # subscription_id=None → falls back to AZURE_SUBSCRIPTION_ID server env

    Args:
        subscription_id: Subscription UUID. Get from azure_list_subscriptions.
                         When omitted, server-side default applies.

    Returns:
        { success, subscription_id, count, resource_groups: [
            { name, location, provisioning_state, tags }
          ], executed_as }

    Adjacent tools:
      - Create one: azure_create_resource_group(name, location)
      - Drill networking: azure_list_vnets(resource_group=<rg>)
      - Cross-RG KQL: azure_resource_graph_query(kql="Resources | where ...")
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        client = ResourceManagementClient(credential, sub_id)
        rgs = list(client.resource_groups.list())

        return {
            "success": True,
            "subscription_id": sub_id,
            "count": len(rgs),
            "resource_groups": [
                {
                    "name": rg.name,
                    "location": rg.location,
                    "provisioning_state": rg.properties.provisioning_state if rg.properties else None,
                    "tags": rg.tags or {}
                }
                for rg in rgs
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# =============================================================================
# #857 — Batch resource group inventory
# =============================================================================
# Replaces the model's typical 10-15 sequential tool calls (list_vms +
# list_disks + list_vnets + list_nics + list_nsgs + list_storage_accounts +
# list_key_vaults + list_aks + list_web_apps + list_app_gateways + ...) with
# a single tool that fan-outs across all categories in parallel via
# asyncio.gather + _in_thread. Each category returns {count, items} OR
# {error: "..."} so partial failures don't drop the whole payload.
#
# Latency budget: ~3-5s wall-clock for an RG with ~50 resources (vs ~30-60s
# for the model's sequential approach). Reduces max_turns pressure and the
# Ollama Harmony-prose-in-args symptom that surfaced in #806/#851.
# =============================================================================

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 4000,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [
            "what's in resource group {name}",
            "show me everything in rg {name}",
            "audit resource group {name}",
            "list all resources in {name}",
            "full inventory of {rg}",
            "give me an overview of resource group {name}",
        ],
        "testFixture": None,
    },
)
async def azure_get_resource_group_inventory(
    resource_group: str,
    subscription_id: Optional[str] = None,
    include: Optional[List[str]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Fetch ALL resource types in a resource group in ONE parallel call.

    Use this whenever you need to enumerate resources in an RG instead of
    chaining 10+ separate azure_list_* calls. Categories run in parallel via
    asyncio.gather; per-category failures degrade gracefully (each returns
    either {count, items} or {error}).

    Args:
        resource_group: Resource group name (required).
        subscription_id: Azure subscription ID (default: DEFAULT_SUBSCRIPTION_ID).
        include: Optional list of category names to fetch. If None, fetches all.

    Returns a dict with `categories` keyed by category name, each containing
    `{count, items}` on success or `{error, type}` on failure. `errors` is a
    flat list of any per-category failures for quick scanning.
    """
    # Fail-fast: validate `include` against the known category set BEFORE any
    # Azure SDK call (no point auto-resolving subscription_id just to reject
    # a typo). The fetcher dict below is the source of truth; this literal
    # mirror is OK because changes to either must be made together — the
    # behavior test `test_inventory_rejects_unknown_category` guards parity.
    _VALID_CATEGORIES = {
        "vms", "disks", "snapshots", "vmss",
        "network_interfaces", "virtual_networks", "network_security_groups",
        "public_ip_addresses", "load_balancers", "application_gateways",
        "storage_accounts", "key_vaults", "aks_clusters",
        "web_apps", "app_service_plans", "role_assignments",
        # 2026-05-15: added AIF / Front Door / Container Apps / App Insights so
        # the model can enumerate them via this one tool instead of needing
        # per-type fan-out (which won't exist in this MCP at all for several).
        "cognitive_services", "cdn_profiles",
        "container_apps", "app_insights",
    }
    if include is not None:
        unknown_early = [c for c in include if c not in _VALID_CATEGORIES]
        if unknown_early:
            return {
                "success": False,
                "error": f"Unknown categories: {unknown_early}. Valid: {sorted(_VALID_CATEGORIES)}",
            }

    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        auto_resolved_sub: Optional[str] = None

        # Auto-resolve subscription_id when caller didn't provide one and no
        # env default exists. Without this, Azure SDK throws InvalidSubscriptionId
        # and the model has no way to recover unless azure_list_subscriptions
        # happens to be in its top-K tool shortlist — which it often isn't.
        # We list the service principal's accessible subs and either:
        #   1 sub  → auto-pick it (transparent: result annotated)
        #   >1 sub → return structured error with `available_subscriptions`
        #            so the model can pick + retry without a follow-up tool
        #   0 sub  → clear error (NOT a leaked SDK InvalidSubscriptionId)
        if not sub_id:
            sub_client = SubscriptionClient(credential)
            try:
                available = await _in_thread(
                    lambda: list(sub_client.subscriptions.list())
                )
            except Exception as e:
                return {
                    "success": False,
                    "error": f"Could not list user subscriptions to auto-resolve: {e}",
                    "type": type(e).__name__,
                }
            if len(available) == 0:
                return {
                    "success": False,
                    "error": (
                        "No accessible Azure subscriptions for this user. "
                        "Cannot run inventory without a subscription_id."
                    ),
                }
            if len(available) > 1:
                return {
                    "success": False,
                    "error": (
                        "subscription_id is required: the user has multiple "
                        "accessible subscriptions. Re-call with one of the "
                        "IDs from `available_subscriptions`."
                    ),
                    "available_subscriptions": [
                        {
                            "id": s.subscription_id,
                            "name": getattr(s, "display_name", None),
                        }
                        for s in available
                    ],
                }
            sub_id = available[0].subscription_id
            auto_resolved_sub = sub_id

        compute = ComputeManagementClient(credential, sub_id)
        network = NetworkManagementClient(credential, sub_id)
        storage = StorageManagementClient(credential, sub_id)
        keyvault = KeyVaultManagementClient(credential, sub_id)
        aks = ContainerServiceClient(credential, sub_id)
        web = WebSiteManagementClient(credential, sub_id)
        authz = AuthorizationManagementClient(credential, sub_id)

        async def _vms():
            items = await _in_thread(lambda: list(compute.virtual_machines.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": v.name,
                        "location": v.location,
                        "vm_size": v.hardware_profile.vm_size if v.hardware_profile else None,
                        "os_type": v.storage_profile.os_disk.os_type.value
                        if v.storage_profile and v.storage_profile.os_disk and v.storage_profile.os_disk.os_type
                        else None,
                        "provisioning_state": v.provisioning_state,
                        "tags": v.tags or {},
                    }
                    for v in items
                ],
            }

        async def _disks():
            items = await _in_thread(lambda: list(compute.disks.list_by_resource_group(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": d.name,
                        "location": d.location,
                        "disk_size_gb": d.disk_size_gb,
                        "sku": d.sku.name if d.sku else None,
                        "disk_state": d.disk_state,
                        "tags": d.tags or {},
                    }
                    for d in items
                ],
            }

        async def _snapshots():
            items = await _in_thread(lambda: list(compute.snapshots.list_by_resource_group(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": s.name,
                        "location": s.location,
                        "disk_size_gb": s.disk_size_gb,
                        "time_created": s.time_created.isoformat() if s.time_created else None,
                        "tags": s.tags or {},
                    }
                    for s in items
                ],
            }

        async def _vmss():
            items = await _in_thread(
                lambda: list(compute.virtual_machine_scale_sets.list(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": s.name,
                        "location": s.location,
                        "sku": s.sku.name if s.sku else None,
                        "capacity": s.sku.capacity if s.sku else None,
                        "tags": s.tags or {},
                    }
                    for s in items
                ],
            }

        async def _network_interfaces():
            items = await _in_thread(lambda: list(network.network_interfaces.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": n.name,
                        "location": n.location,
                        "mac_address": n.mac_address,
                        "ip_configurations": [
                            {
                                "name": ip.name,
                                "private_ip": ip.private_ip_address,
                                "public_ip_id": ip.public_ip_address.id if ip.public_ip_address else None,
                            }
                            for ip in (n.ip_configurations or [])
                        ],
                    }
                    for n in items
                ],
            }

        async def _virtual_networks():
            items = await _in_thread(lambda: list(network.virtual_networks.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": v.name,
                        "location": v.location,
                        "address_space": list(v.address_space.address_prefixes) if v.address_space else [],
                        "subnets": [
                            {"name": s.name, "address_prefix": s.address_prefix}
                            for s in (v.subnets or [])
                        ],
                        "tags": v.tags or {},
                    }
                    for v in items
                ],
            }

        async def _nsgs():
            items = await _in_thread(lambda: list(network.network_security_groups.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": n.name,
                        "location": n.location,
                        "rule_count": len(n.security_rules or []),
                        "tags": n.tags or {},
                    }
                    for n in items
                ],
            }

        async def _public_ips():
            items = await _in_thread(lambda: list(network.public_ip_addresses.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": p.name,
                        "location": p.location,
                        "ip_address": p.ip_address,
                        "allocation_method": p.public_ip_allocation_method,
                        "tags": p.tags or {},
                    }
                    for p in items
                ],
            }

        async def _load_balancers():
            items = await _in_thread(lambda: list(network.load_balancers.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": lb.name,
                        "location": lb.location,
                        "sku": lb.sku.name if lb.sku else None,
                        "frontend_count": len(lb.frontend_ip_configurations or []),
                        "tags": lb.tags or {},
                    }
                    for lb in items
                ],
            }

        async def _app_gateways():
            items = await _in_thread(lambda: list(network.application_gateways.list(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": g.name,
                        "location": g.location,
                        "sku": g.sku.name if g.sku else None,
                        "tier": g.sku.tier if g.sku else None,
                        "operational_state": g.operational_state,
                        "tags": g.tags or {},
                    }
                    for g in items
                ],
            }

        async def _storage_accounts():
            items = await _in_thread(
                lambda: list(storage.storage_accounts.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": s.name,
                        "location": s.location,
                        "kind": s.kind,
                        "sku": s.sku.name if s.sku else None,
                        "allow_blob_public_access": s.allow_blob_public_access,
                        "minimum_tls_version": s.minimum_tls_version,
                        "tags": s.tags or {},
                    }
                    for s in items
                ],
            }

        async def _key_vaults():
            items = await _in_thread(lambda: list(keyvault.vaults.list_by_resource_group(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": k.name,
                        "location": k.location,
                        "vault_uri": k.properties.vault_uri if k.properties else None,
                        "enable_rbac_authorization": (
                            k.properties.enable_rbac_authorization if k.properties else None
                        ),
                        "public_network_access": (
                            k.properties.public_network_access if k.properties else None
                        ),
                        "tags": k.tags or {},
                    }
                    for k in items
                ],
            }

        async def _aks_clusters():
            items = await _in_thread(
                lambda: list(aks.managed_clusters.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": c.name,
                        "location": c.location,
                        "kubernetes_version": c.kubernetes_version,
                        "node_pool_count": len(c.agent_pool_profiles or []),
                        "provisioning_state": c.provisioning_state,
                        "tags": c.tags or {},
                    }
                    for c in items
                ],
            }

        async def _web_apps():
            items = await _in_thread(lambda: list(web.web_apps.list_by_resource_group(resource_group)))
            return {
                "count": len(items),
                "items": [
                    {
                        "name": w.name,
                        "location": w.location,
                        "kind": w.kind,
                        "state": w.state,
                        "default_host_name": w.default_host_name,
                        "https_only": w.https_only,
                        "tags": w.tags or {},
                    }
                    for w in items
                ],
            }

        async def _app_service_plans():
            items = await _in_thread(
                lambda: list(web.app_service_plans.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": p.name,
                        "location": p.location,
                        "kind": p.kind,
                        "sku": p.sku.name if p.sku else None,
                        "tier": p.sku.tier if p.sku else None,
                        "number_of_workers": p.number_of_workers,
                        "tags": p.tags or {},
                    }
                    for p in items
                ],
            }

        async def _role_assignments():
            scope = f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
            items = await _in_thread(
                lambda: list(authz.role_assignments.list_for_scope(scope))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": r.name,
                        "role_definition_id": r.role_definition_id,
                        "principal_id": r.principal_id,
                        "principal_type": r.principal_type,
                        "scope": r.scope,
                    }
                    for r in items
                ],
            }

        # 2026-05-15: AIF/Front Door/Container Apps/App Insights fetchers — see
        # `_VALID_CATEGORIES` comment for context. Each one builds its SDK
        # client lazily so a missing SDK only kills that one category, not the
        # whole inventory.
        async def _cognitive_services():
            if CognitiveServicesManagementClient is None:
                raise RuntimeError("azure-mgmt-cognitiveservices SDK not installed")
            client = CognitiveServicesManagementClient(credential, sub_id)
            items = await _in_thread(
                lambda: list(client.accounts.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": a.name,
                        "location": a.location,
                        # `kind` distinguishes AIServices (AIF), OpenAI, FormRecognizer, etc.
                        "kind": getattr(a, "kind", None),
                        "sku": getattr(a.sku, "name", None) if getattr(a, "sku", None) else None,
                        "endpoint": getattr(getattr(a, "properties", None), "endpoint", None),
                        "tags": a.tags or {},
                    }
                    for a in items
                ],
            }

        async def _cdn_profiles():
            # Covers Azure Front Door Standard/Premium (Microsoft.Cdn provider)
            # and classic CDN profiles. Classic Microsoft.Network/frontDoors needs
            # a separate SDK and is rare in new deployments — not in scope here.
            if CdnManagementClient is None:
                raise RuntimeError("azure-mgmt-cdn SDK not installed")
            client = CdnManagementClient(credential, sub_id)
            items = await _in_thread(
                lambda: list(client.profiles.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": p.name,
                        "location": p.location,
                        # sku.name marks Front Door (Standard_AzureFrontDoor /
                        # Premium_AzureFrontDoor) vs classic CDN (Standard_Microsoft etc).
                        "sku": getattr(p.sku, "name", None) if getattr(p, "sku", None) else None,
                        "kind": getattr(p, "kind", None),
                        "tags": p.tags or {},
                    }
                    for p in items
                ],
            }

        async def _container_apps():
            if ContainerAppsAPIClient is None:
                raise RuntimeError("azure-mgmt-appcontainers SDK not installed")
            client = ContainerAppsAPIClient(credential, sub_id)
            items = await _in_thread(
                lambda: list(client.container_apps.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": c.name,
                        "location": c.location,
                        "provisioning_state": getattr(c, "provisioning_state", None),
                        "tags": c.tags or {},
                    }
                    for c in items
                ],
            }

        async def _app_insights():
            client = ApplicationInsightsManagementClient(credential, sub_id)
            items = await _in_thread(
                lambda: list(client.components.list_by_resource_group(resource_group))
            )
            return {
                "count": len(items),
                "items": [
                    {
                        "name": c.name,
                        "location": c.location,
                        "kind": getattr(c, "kind", None),
                        "application_type": getattr(c, "application_type", None),
                        "tags": c.tags or {},
                    }
                    for c in items
                ],
            }

        # Category registry: name → fetcher coroutine factory.
        fetchers = {
            "vms": _vms,
            "disks": _disks,
            "snapshots": _snapshots,
            "vmss": _vmss,
            "network_interfaces": _network_interfaces,
            "virtual_networks": _virtual_networks,
            "network_security_groups": _nsgs,
            "public_ip_addresses": _public_ips,
            "load_balancers": _load_balancers,
            "application_gateways": _app_gateways,
            "storage_accounts": _storage_accounts,
            "key_vaults": _key_vaults,
            "aks_clusters": _aks_clusters,
            "web_apps": _web_apps,
            "app_service_plans": _app_service_plans,
            "role_assignments": _role_assignments,
            "cognitive_services": _cognitive_services,
            "cdn_profiles": _cdn_profiles,
            "container_apps": _container_apps,
            "app_insights": _app_insights,
        }

        selected = include or list(fetchers.keys())
        unknown = [c for c in selected if c not in fetchers]
        if unknown:
            return {
                "success": False,
                "error": f"Unknown categories: {unknown}. Valid: {sorted(fetchers.keys())}",
            }

        names = [c for c in selected if c in fetchers]
        results = await asyncio.gather(
            *[fetchers[c]() for c in names], return_exceptions=True
        )

        categories: Dict[str, Any] = {}
        errors: List[Dict[str, str]] = []
        total_count = 0
        for name, result in zip(names, results):
            if isinstance(result, BaseException):
                categories[name] = {"error": str(result), "type": type(result).__name__}
                errors.append({"category": name, "error": str(result), "type": type(result).__name__})
            else:
                categories[name] = result
                total_count += result.get("count", 0)

        result_payload: Dict[str, Any] = {
            "success": True,
            "resource_group": resource_group,
            "subscription_id": sub_id,
            "total_count": total_count,
            "categories": categories,
            "errors": errors,
            "executed_as": user_info,
        }
        if auto_resolved_sub:
            result_payload["auto_resolved_subscription_id"] = auto_resolved_sub
        return result_payload
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if "user_info" in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_resource_group(
    name: str,
    location: str,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create a new Azure resource group. This is idempotent — calling again with
    the same name + location just returns the existing one.

    Typically the FIRST step when provisioning any Azure scenario. Everything
    else (VNets, App Gateways, Front Doors, VMs, storage...) lives inside a
    resource group.

    Args:
        name: Resource group name. Naming rules: alphanumeric + hyphens + underscores,
              1-90 chars. Suggested pattern: `rg-<purpose>-<env>-<random>`.
              Example: "rg-fd-demo-eastus-7c3a".
        location: Azure region slug (lowercase, no spaces).
                  Examples: "eastus", "westus2", "westeurope", "centralus", "eastus2".
                  Some resources (e.g. Front Door profile) are global — use "global" for those.
        tags: Optional dict for billing/ownership (e.g. {"owner": "team-x", "env": "dev"}).
        subscription_id: Optional override. When omitted, uses the logged-in user's
                         default subscription from AZURE_SUBSCRIPTION_ID.

    Returns:
        { success: True, resource_group: { name, location, id, tags }, executed_as }

    Chain with: `azure_create_vnet` (put networking in this RG),
                `azure_create_storage_account`, `azure_create_key_vault`,
                `azure_create_vm`, `azure_create_app_gateway`, etc.
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ResourceManagementClient(credential, sub_id)

        rg = client.resource_groups.create_or_update(
            name,
            {"location": location, "tags": tags or {}}
        )

        return {
            "success": True,
            "resource_group": {
                "name": rg.name,
                "location": rg.location,
                "id": rg.id,
                "tags": rg.tags
            },
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": True,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-destructive",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "averageLatencyMs": 5000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_delete_resource_group(
    name: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Delete a resource group and all its resources.

    WARNING: This is destructive and cannot be undone!

    Args:
        name: Resource group name to delete
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ResourceManagementClient(credential, sub_id)

        # Start async delete operation
        poller = client.resource_groups.begin_delete(name)

        return {
            "success": True,
            "message": f"Resource group '{name}' deletion started",
            "operation_id": poller.operation_id if hasattr(poller, 'operation_id') else None,
            "note": "Deletion is async and may take several minutes to complete",
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# =============================================================================
# COMPUTE (VM) TOOLS
# =============================================================================

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my vms", "show me vms", "what vms do i have"],
        "testFixture": None,
    },
)
async def azure_list_vms(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List virtual machines.

    Args:
        resource_group: Filter by resource group (lists all if not specified)
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)

        if resource_group:
            vms = list(client.virtual_machines.list(resource_group))
        else:
            vms = list(client.virtual_machines.list_all())

        return {
            "success": True,
            "count": len(vms),
            "virtual_machines": [
                {
                    "name": vm.name,
                    "location": vm.location,
                    "resource_group": vm.id.split('/')[4] if vm.id else None,
                    "vm_size": vm.hardware_profile.vm_size if vm.hardware_profile else None,
                    "os_type": vm.storage_profile.os_disk.os_type.value if vm.storage_profile and vm.storage_profile.os_disk else None,
                    "provisioning_state": vm.provisioning_state,
                    "tags": vm.tags or {}
                }
                for vm in vms
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["get vm details", "show me one vm"],
        "testFixture": None,
    },
)
async def azure_get_vm(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    include_instance_view: bool = True,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get detailed information about a specific VM.

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        subscription_id: Azure subscription ID
        include_instance_view: Include power state and other runtime info
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)

        expand = "instanceView" if include_instance_view else None
        vm = client.virtual_machines.get(resource_group, name, expand=expand)

        result = {
            "name": vm.name,
            "id": vm.id,
            "location": vm.location,
            "vm_size": vm.hardware_profile.vm_size if vm.hardware_profile else None,
            "provisioning_state": vm.provisioning_state,
            "os_type": vm.storage_profile.os_disk.os_type.value if vm.storage_profile and vm.storage_profile.os_disk else None,
            "os_disk": vm.storage_profile.os_disk.name if vm.storage_profile and vm.storage_profile.os_disk else None,
            "tags": vm.tags or {}
        }

        if include_instance_view and vm.instance_view:
            statuses = vm.instance_view.statuses or []
            power_state = next((s.display_status for s in statuses if s.code and s.code.startswith("PowerState/")), "Unknown")
            result["power_state"] = power_state
            result["vm_agent_status"] = vm.instance_view.vm_agent.statuses[0].display_status if vm.instance_view.vm_agent and vm.instance_view.vm_agent.statuses else None

        return {
            "success": True,
            "vm": result,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 8000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_start_vm(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Start a virtual machine.

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)
        poller = client.virtual_machines.begin_start(resource_group, name)

        return {
            "success": True,
            "message": f"VM '{name}' start operation initiated",
            "vm_name": name,
            "resource_group": resource_group,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 8000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_stop_vm(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Stop (deallocate) a virtual machine.

    This deallocates the VM, stopping billing for compute (storage still billed).

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)
        poller = client.virtual_machines.begin_deallocate(resource_group, name)

        return {
            "success": True,
            "message": f"VM '{name}' stop (deallocate) operation initiated",
            "vm_name": name,
            "resource_group": resource_group,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 8000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_restart_vm(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Restart a virtual machine.

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)
        poller = client.virtual_machines.begin_restart(resource_group, name)

        return {
            "success": True,
            "message": f"VM '{name}' restart operation initiated",
            "vm_name": name,
            "resource_group": resource_group,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": True,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-destructive",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "averageLatencyMs": 5000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_delete_vm(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Delete (destroy) a virtual machine.

    DESTRUCTIVE: this permanently deletes the VM. The OS disk, NIC, and
    public IP may be left orphaned (use the portal or a follow-up call to
    clean those up). HITL approval is required from the chatmode cascade
    before this tool is invoked.

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)
        poller = client.virtual_machines.begin_delete(resource_group, name)

        return {
            "success": True,
            "message": f"VM '{name}' delete operation initiated",
            "vm_name": name,
            "resource_group": resource_group,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 8000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_deallocate_vm(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Deallocate a virtual machine (stops billing for compute).

    Equivalent to ``azure_stop_vm`` — kept under the explicit name so the
    Smart Router can match deallocate-specific prompts ("deallocate the
    web-01 VM to stop billing") without keyword-matching to "stop".

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)
        poller = client.virtual_machines.begin_deallocate(resource_group, name)

        return {
            "success": True,
            "message": f"VM '{name}' deallocate operation initiated (compute billing stopped)",
            "vm_name": name,
            "resource_group": resource_group,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 8000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_resize_vm(
    name: str,
    resource_group: str,
    vm_size: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Resize a virtual machine to a new SKU.

    DESTRUCTIVE: this restarts the VM with new hardware. In-flight workloads
    are interrupted. The new SKU must be available in the VM's region. HITL
    approval is required from the chatmode cascade before this tool is invoked.

    Args:
        name: VM name
        resource_group: Resource group containing the VM
        vm_size: Target SKU (e.g. ``Standard_B2s``, ``Standard_D4s_v5``)
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ComputeManagementClient(credential, sub_id)
        # Update path: change hardware_profile.vm_size on the VM resource.
        # The Azure SDK accepts a partial dict for begin_update.
        poller = client.virtual_machines.begin_update(
            resource_group,
            name,
            {"hardware_profile": {"vm_size": vm_size}},
        )

        return {
            "success": True,
            "message": f"VM '{name}' resize to {vm_size} initiated",
            "vm_name": name,
            "resource_group": resource_group,
            "vm_size": vm_size,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# =============================================================================
# AKS (KUBERNETES) TOOLS
# =============================================================================

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my aks clusters", "show me aks clusters", "what aks clusters do i have"],
        "testFixture": None,
    },
)
async def azure_list_aks_clusters(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List AKS (Azure Kubernetes Service) clusters.

    Args:
        resource_group: Filter by resource group (lists all if not specified)
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ContainerServiceClient(credential, sub_id)

        if resource_group:
            clusters = list(client.managed_clusters.list_by_resource_group(resource_group))
        else:
            clusters = list(client.managed_clusters.list())

        return {
            "success": True,
            "count": len(clusters),
            "clusters": [
                {
                    "name": c.name,
                    "location": c.location,
                    "resource_group": c.id.split('/')[4] if c.id else None,
                    "kubernetes_version": c.kubernetes_version,
                    "provisioning_state": c.provisioning_state,
                    "power_state": c.power_state.code if c.power_state else None,
                    "fqdn": c.fqdn,
                    "node_resource_group": c.node_resource_group,
                    "agent_pool_count": len(c.agent_pool_profiles) if c.agent_pool_profiles else 0,
                    "tags": c.tags or {}
                }
                for c in clusters
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["get aks cluster details", "show me one aks cluster"],
        "testFixture": None,
    },
)
async def azure_get_aks_cluster(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get detailed information about an AKS cluster.

    Args:
        name: Cluster name
        resource_group: Resource group containing the cluster
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ContainerServiceClient(credential, sub_id)
        cluster = client.managed_clusters.get(resource_group, name)

        return {
            "success": True,
            "cluster": {
                "name": cluster.name,
                "id": cluster.id,
                "location": cluster.location,
                "kubernetes_version": cluster.kubernetes_version,
                "provisioning_state": cluster.provisioning_state,
                "power_state": cluster.power_state.code if cluster.power_state else None,
                "fqdn": cluster.fqdn,
                "api_server_url": f"https://{cluster.fqdn}:443" if cluster.fqdn else None,
                "node_resource_group": cluster.node_resource_group,
                "network_profile": {
                    "network_plugin": cluster.network_profile.network_plugin if cluster.network_profile else None,
                    "service_cidr": cluster.network_profile.service_cidr if cluster.network_profile else None,
                    "dns_service_ip": cluster.network_profile.dns_service_ip if cluster.network_profile else None,
                } if cluster.network_profile else None,
                "agent_pools": [
                    {
                        "name": pool.name,
                        "count": pool.count,
                        "vm_size": pool.vm_size,
                        "os_type": pool.os_type,
                        "mode": pool.mode,
                        "kubernetes_version": pool.orchestrator_version
                    }
                    for pool in (cluster.agent_pool_profiles or [])
                ],
                "tags": cluster.tags or {}
            },
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["get aks credentials details", "show me one aks credentials"],
        "testFixture": None,
    },
)
async def azure_get_aks_credentials(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    admin: bool = False,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get kubeconfig credentials for an AKS cluster.

    Args:
        name: Cluster name
        resource_group: Resource group containing the cluster
        subscription_id: Azure subscription ID
        admin: Get admin credentials (requires elevated permissions)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ContainerServiceClient(credential, sub_id)

        if admin:
            creds = client.managed_clusters.list_cluster_admin_credentials(resource_group, name)
        else:
            creds = client.managed_clusters.list_cluster_user_credentials(resource_group, name)

        kubeconfigs = []
        for kc in (creds.kubeconfigs or []):
            kubeconfigs.append({
                "name": kc.name,
                "value": kc.value.decode('utf-8') if isinstance(kc.value, bytes) else kc.value
            })

        return {
            "success": True,
            "cluster_name": name,
            "credential_type": "admin" if admin else "user",
            "kubeconfigs": kubeconfigs,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# =============================================================================
# NETWORKING TOOLS
# =============================================================================

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my vnets", "show me vnets", "what vnets do i have"],
        "testFixture": None,
    },
)
async def azure_list_vnets(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Virtual Networks (VNets) visible to the user. Returns each VNet's
    address space, subnet names, and location.

    Use this to:
      - Verify a VNet you just created.
      - Find an existing VNet's subnets before dropping a VM or App Gateway in.
      - Audit VNet sprawl.

    Args:
        resource_group: Optional — scope to one RG. Omit to list all across sub.
        subscription_id: Optional override.

    Returns:
        { success, count, virtual_networks: [
            { name, location, resource_group, address_space: [...cidrs],
              subnets: [...names], provisioning_state, tags }
          ], executed_as
        }

    Chain with:
      - `azure_create_subnet` to add subnets to an existing VNet.
      - `azure_list_nsgs` to see NSGs available to attach.
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)

        if resource_group:
            vnets = list(client.virtual_networks.list(resource_group))
        else:
            vnets = list(client.virtual_networks.list_all())

        return {
            "success": True,
            "count": len(vnets),
            "virtual_networks": [
                {
                    "name": vnet.name,
                    "location": vnet.location,
                    "resource_group": vnet.id.split('/')[4] if vnet.id else None,
                    "address_space": vnet.address_space.address_prefixes if vnet.address_space else [],
                    "subnets": [s.name for s in (vnet.subnets or [])],
                    "provisioning_state": vnet.provisioning_state,
                    "tags": vnet.tags or {}
                }
                for vnet in vnets
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my nsgs", "show me nsgs", "what nsgs do i have"],
        "testFixture": None,
    },
)
async def azure_list_nsgs(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Network Security Groups (NSGs) — host firewalls for subnets / NICs —
    visible to the user. Includes per-NSG rule counts so you can quickly
    spot empty NSGs or over-permissive ones.

    Args:
        resource_group: Filter by resource group
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)

        if resource_group:
            nsgs = list(client.network_security_groups.list(resource_group))
        else:
            nsgs = list(client.network_security_groups.list_all())

        return {
            "success": True,
            "count": len(nsgs),
            "network_security_groups": [
                {
                    "name": nsg.name,
                    "location": nsg.location,
                    "resource_group": nsg.id.split('/')[4] if nsg.id else None,
                    "security_rules_count": len(nsg.security_rules) if nsg.security_rules else 0,
                    "default_rules_count": len(nsg.default_security_rules) if nsg.default_security_rules else 0,
                    "provisioning_state": nsg.provisioning_state,
                    "tags": nsg.tags or {}
                }
                for nsg in nsgs
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my app gateways", "show me app gateways", "what app gateways do i have"],
        "testFixture": None,
    },
)
async def azure_list_app_gateways(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List all Application Gateways visible to the logged-in user. RBAC-filtered:
    only returns gateways the user has at least Reader on.

    Use this to:
      - Verify a gateway you just created (`azure_create_app_gateway`) is live.
      - Survey what enterprise gateways exist before planning a Front Door.
      - Check operational_state (Running/Stopped) and provisioning_state (Succeeded/Failed).

    Args:
        resource_group: Optional — filter to one RG. Omit to list ALL across the sub.
        subscription_id: Optional override.

    Returns:
        { success, count, application_gateways: [
            { name, location, resource_group, sku (name/tier/capacity),
              operational_state, provisioning_state,
              backend_pools_count, http_listeners_count, rules_count, tags }
          ], executed_as
        }

    Pair with: `azure_get_app_gateway(name, resource_group)` for full detail
               (listeners, backend pools, rules, probes, WAF) on a single gateway.
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)

        if resource_group:
            gateways = list(client.application_gateways.list(resource_group))
        else:
            gateways = list(client.application_gateways.list_all())

        return {
            "success": True,
            "count": len(gateways),
            "application_gateways": [
                {
                    "name": gw.name,
                    "location": gw.location,
                    "resource_group": gw.id.split('/')[4] if gw.id else None,
                    "sku": {
                        "name": gw.sku.name if gw.sku else None,
                        "tier": gw.sku.tier if gw.sku else None,
                        "capacity": gw.sku.capacity if gw.sku else None
                    } if gw.sku else None,
                    "operational_state": gw.operational_state,
                    "provisioning_state": gw.provisioning_state,
                    "backend_pools_count": len(gw.backend_address_pools) if gw.backend_address_pools else 0,
                    "http_listeners_count": len(gw.http_listeners) if gw.http_listeners else 0,
                    "rules_count": len(gw.request_routing_rules) if gw.request_routing_rules else 0,
                    "tags": gw.tags or {}
                }
                for gw in gateways
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["get app gateway details", "show me one app gateway"],
        "testFixture": None,
    },
)
async def azure_get_app_gateway(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get detailed information about an Application Gateway.

    Args:
        name: Application Gateway name
        resource_group: Resource group containing the App Gateway
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)
        gw = client.application_gateways.get(resource_group, name)

        return {
            "success": True,
            "application_gateway": {
                "name": gw.name,
                "id": gw.id,
                "location": gw.location,
                "sku": {
                    "name": gw.sku.name if gw.sku else None,
                    "tier": gw.sku.tier if gw.sku else None,
                    "capacity": gw.sku.capacity if gw.sku else None
                } if gw.sku else None,
                "operational_state": gw.operational_state,
                "provisioning_state": gw.provisioning_state,
                "enable_http2": gw.enable_http2,
                "enable_fips": gw.enable_fips,
                "frontend_ip_configurations": [
                    {
                        "name": fip.name,
                        "private_ip": fip.private_ip_address,
                        "private_ip_allocation": fip.private_ip_allocation_method,
                        "public_ip_id": fip.public_ip_address.id if fip.public_ip_address else None
                    }
                    for fip in (gw.frontend_ip_configurations or [])
                ],
                "frontend_ports": [
                    {"name": fp.name, "port": fp.port}
                    for fp in (gw.frontend_ports or [])
                ],
                "backend_address_pools": [
                    {
                        "name": pool.name,
                        "addresses": [
                            addr.fqdn or addr.ip_address
                            for addr in (pool.backend_addresses or [])
                        ]
                    }
                    for pool in (gw.backend_address_pools or [])
                ],
                "backend_http_settings": [
                    {
                        "name": settings.name,
                        "port": settings.port,
                        "protocol": settings.protocol,
                        "cookie_based_affinity": settings.cookie_based_affinity,
                        "request_timeout": settings.request_timeout,
                        "probe_name": settings.probe.id.split('/')[-1] if settings.probe else None
                    }
                    for settings in (gw.backend_http_settings_collection or [])
                ],
                "http_listeners": [
                    {
                        "name": listener.name,
                        "protocol": listener.protocol,
                        "host_name": listener.host_name,
                        "host_names": listener.host_names,
                        "require_server_name_indication": listener.require_server_name_indication,
                        "frontend_port": listener.frontend_port.id.split('/')[-1] if listener.frontend_port else None,
                        "ssl_certificate": listener.ssl_certificate.id.split('/')[-1] if listener.ssl_certificate else None
                    }
                    for listener in (gw.http_listeners or [])
                ],
                "request_routing_rules": [
                    {
                        "name": rule.name,
                        "rule_type": rule.rule_type,
                        "priority": rule.priority,
                        "http_listener": rule.http_listener.id.split('/')[-1] if rule.http_listener else None,
                        "backend_address_pool": rule.backend_address_pool.id.split('/')[-1] if rule.backend_address_pool else None,
                        "backend_http_settings": rule.backend_http_settings.id.split('/')[-1] if rule.backend_http_settings else None,
                        "url_path_map": rule.url_path_map.id.split('/')[-1] if rule.url_path_map else None,
                        "redirect_configuration": rule.redirect_configuration.id.split('/')[-1] if rule.redirect_configuration else None
                    }
                    for rule in (gw.request_routing_rules or [])
                ],
                "probes": [
                    {
                        "name": probe.name,
                        "protocol": probe.protocol,
                        "host": probe.host,
                        "path": probe.path,
                        "interval": probe.interval,
                        "timeout": probe.timeout,
                        "unhealthy_threshold": probe.unhealthy_threshold,
                        "match_status_codes": probe.match.status_codes if probe.match else None
                    }
                    for probe in (gw.probes or [])
                ],
                "ssl_certificates": [
                    {"name": cert.name}
                    for cert in (gw.ssl_certificates or [])
                ],
                "waf_configuration": {
                    "enabled": gw.web_application_firewall_configuration.enabled,
                    "firewall_mode": gw.web_application_firewall_configuration.firewall_mode,
                    "rule_set_type": gw.web_application_firewall_configuration.rule_set_type,
                    "rule_set_version": gw.web_application_firewall_configuration.rule_set_version
                } if gw.web_application_firewall_configuration else None,
                "tags": gw.tags or {}
            },
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 5000,
        "failureModes": ["auth_expired"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_app_gateway_backend_health(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get backend health status for an Application Gateway.

    This shows the health of each backend server in each pool.

    Args:
        name: Application Gateway name
        resource_group: Resource group containing the App Gateway
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)

        # This is a long-running operation
        poller = client.application_gateways.begin_backend_health(resource_group, name)
        health = poller.result()

        backend_pools = []
        for pool in (health.backend_address_pools or []):
            pool_health = {
                "name": pool.backend_address_pool.id.split('/')[-1] if pool.backend_address_pool else "Unknown",
                "servers": []
            }
            for http_setting in (pool.backend_http_settings_collection or []):
                setting_name = http_setting.backend_http_settings.id.split('/')[-1] if http_setting.backend_http_settings else "Unknown"
                for server in (http_setting.servers or []):
                    pool_health["servers"].append({
                        "address": server.address,
                        "health": server.health.value if server.health else "Unknown",
                        "health_probe_log": server.health_probe_log,
                        "http_setting": setting_name
                    })
            backend_pools.append(pool_health)

        return {
            "success": True,
            "application_gateway": name,
            "backend_pools": backend_pools,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 8000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_app_gateway_start(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Start an Application Gateway.

    Args:
        name: Application Gateway name
        resource_group: Resource group containing the App Gateway
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)
        poller = client.application_gateways.begin_start(resource_group, name)

        return {
            "success": True,
            "message": f"Application Gateway '{name}' start operation initiated",
            "name": name,
            "resource_group": resource_group,
            "note": "This operation may take several minutes to complete",
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 8000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_app_gateway_stop(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Stop an Application Gateway.

    Stopping an App Gateway stops billing for compute but the resource remains.

    Args:
        name: Application Gateway name
        resource_group: Resource group containing the App Gateway
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)
        poller = client.application_gateways.begin_stop(resource_group, name)

        return {
            "success": True,
            "message": f"Application Gateway '{name}' stop operation initiated",
            "name": name,
            "resource_group": resource_group,
            "note": "This operation may take several minutes to complete",
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my load balancers", "show me load balancers", "what load balancers do i have"],
        "testFixture": None,
    },
)
async def azure_list_load_balancers(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Load Balancers.

    Args:
        resource_group: Filter by resource group
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = NetworkManagementClient(credential, sub_id)

        if resource_group:
            lbs = list(client.load_balancers.list(resource_group))
        else:
            lbs = list(client.load_balancers.list_all())

        return {
            "success": True,
            "count": len(lbs),
            "load_balancers": [
                {
                    "name": lb.name,
                    "location": lb.location,
                    "resource_group": lb.id.split('/')[4] if lb.id else None,
                    "sku": lb.sku.name if lb.sku else None,
                    "provisioning_state": lb.provisioning_state,
                    "frontend_ip_count": len(lb.frontend_ip_configurations) if lb.frontend_ip_configurations else 0,
                    "backend_pool_count": len(lb.backend_address_pools) if lb.backend_address_pools else 0,
                    "rules_count": len(lb.load_balancing_rules) if lb.load_balancing_rules else 0,
                    "tags": lb.tags or {}
                }
                for lb in lbs
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# =============================================================================
# STORAGE TOOLS
# =============================================================================

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my storage accounts", "show me storage accounts", "what storage accounts do i have"],
        "testFixture": None,
    },
)
async def azure_list_storage_accounts(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List storage accounts.

    Args:
        resource_group: Filter by resource group
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = StorageManagementClient(credential, sub_id)

        if resource_group:
            accounts = list(client.storage_accounts.list_by_resource_group(resource_group))
        else:
            accounts = list(client.storage_accounts.list())

        return {
            "success": True,
            "count": len(accounts),
            "storage_accounts": [
                {
                    "name": sa.name,
                    "location": sa.location,
                    "resource_group": sa.id.split('/')[4] if sa.id else None,
                    "kind": sa.kind.value if sa.kind else None,
                    "sku": sa.sku.name if sa.sku else None,
                    "access_tier": sa.access_tier.value if sa.access_tier else None,
                    "provisioning_state": sa.provisioning_state.value if sa.provisioning_state else None,
                    "primary_endpoints": {
                        "blob": sa.primary_endpoints.blob if sa.primary_endpoints else None,
                        "file": sa.primary_endpoints.file if sa.primary_endpoints else None,
                    } if sa.primary_endpoints else None,
                    "tags": sa.tags or {}
                }
                for sa in accounts
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my containers", "show me containers", "what containers do i have"],
        "testFixture": None,
    },
)
async def azure_list_containers(
    storage_account: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List blob containers in a storage account.

    Args:
        storage_account: Storage account name
        resource_group: Resource group containing the storage account
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta, "storageAccessToken")
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        # Use data plane with the service principal credential
        account_url = f"https://{storage_account}.blob.core.windows.net"
        blob_client = BlobServiceClient(account_url=account_url, credential=credential)

        containers = list(blob_client.list_containers())

        return {
            "success": True,
            "storage_account": storage_account,
            "count": len(containers),
            "containers": [
                {
                    "name": c.name,
                    "last_modified": c.last_modified.isoformat() if c.last_modified else None,
                    "public_access": c.public_access
                }
                for c in containers
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my blobs", "show me blobs", "what blobs do i have"],
        "testFixture": None,
    },
)
async def azure_list_blobs(
    storage_account: str,
    container_name: str,
    prefix: Optional[str] = None,
    max_results: int = 100,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List blobs in a container.

    Args:
        storage_account: Storage account name
        container_name: Container name
        prefix: Optional blob name prefix filter
        max_results: Maximum number of blobs to return
    """
    try:
        credential, user_info = require_user_token(meta, "storageAccessToken")

        account_url = f"https://{storage_account}.blob.core.windows.net"
        blob_client = BlobServiceClient(account_url=account_url, credential=credential)
        container_client = blob_client.get_container_client(container_name)

        blobs = []
        for blob in container_client.list_blobs(name_starts_with=prefix):
            blobs.append({
                "name": blob.name,
                "size": blob.size,
                "content_type": blob.content_settings.content_type if blob.content_settings else None,
                "last_modified": blob.last_modified.isoformat() if blob.last_modified else None
            })
            if len(blobs) >= max_results:
                break

        return {
            "success": True,
            "storage_account": storage_account,
            "container": container_name,
            "count": len(blobs),
            "blobs": blobs,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# =============================================================================
# KEY VAULT TOOLS
# =============================================================================

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my keyvaults", "show me keyvaults", "what keyvaults do i have"],
        "testFixture": None,
    },
)
async def azure_list_keyvaults(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Key Vaults.

    Args:
        resource_group: Filter by resource group
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = KeyVaultManagementClient(credential, sub_id)

        if resource_group:
            vaults = list(client.vaults.list_by_resource_group(resource_group))
        else:
            vaults = list(client.vaults.list_by_subscription())

        return {
            "success": True,
            "count": len(vaults),
            "key_vaults": [
                {
                    "name": v.name,
                    "location": v.location,
                    "resource_group": v.id.split('/')[4] if v.id else None,
                    "vault_uri": v.properties.vault_uri if v.properties else None,
                    "sku": v.properties.sku.name if v.properties and v.properties.sku else None,
                    "soft_delete_enabled": v.properties.enable_soft_delete if v.properties else None,
                    "tags": v.tags or {}
                }
                for v in vaults
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my secrets", "show me secrets", "what secrets do i have"],
        "testFixture": None,
    },
)
async def azure_list_secrets(
    vault_name: str,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List secrets in a Key Vault (names only, not values).

    Args:
        vault_name: Key Vault name (without .vault.azure.net)
    """
    try:
        credential, user_info = require_user_token(meta, "keyvaultAccessToken")

        vault_url = f"https://{vault_name}.vault.azure.net"
        client = SecretClient(vault_url=vault_url, credential=credential)

        secrets = list(client.list_properties_of_secrets())

        return {
            "success": True,
            "vault_name": vault_name,
            "count": len(secrets),
            "secrets": [
                {
                    "name": s.name,
                    "enabled": s.enabled,
                    "created_on": s.created_on.isoformat() if s.created_on else None,
                    "updated_on": s.updated_on.isoformat() if s.updated_on else None,
                    "content_type": s.content_type
                }
                for s in secrets
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["get secret details", "show me one secret"],
        "testFixture": None,
    },
)
async def azure_get_secret(
    vault_name: str,
    secret_name: str,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get a secret value from Key Vault.

    Args:
        vault_name: Key Vault name (without .vault.azure.net)
        secret_name: Name of the secret
    """
    try:
        credential, user_info = require_user_token(meta, "keyvaultAccessToken")

        vault_url = f"https://{vault_name}.vault.azure.net"
        client = SecretClient(vault_url=vault_url, credential=credential)

        secret = client.get_secret(secret_name)

        return {
            "success": True,
            "vault_name": vault_name,
            "secret": {
                "name": secret.name,
                "value": secret.value,
                "content_type": secret.properties.content_type,
                "enabled": secret.properties.enabled,
                "created_on": secret.properties.created_on.isoformat() if secret.properties.created_on else None,
                "updated_on": secret.properties.updated_on.isoformat() if secret.properties.updated_on else None
            },
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 8000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_set_secret(
    vault_name: str,
    secret_name: str,
    secret_value: str,
    content_type: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Set a secret value in Key Vault.

    Args:
        vault_name: Key Vault name (without .vault.azure.net)
        secret_name: Name of the secret
        secret_value: Value to set
        content_type: Optional content type (e.g., 'text/plain', 'application/json')
    """
    try:
        credential, user_info = require_user_token(meta, "keyvaultAccessToken")

        vault_url = f"https://{vault_name}.vault.azure.net"
        client = SecretClient(vault_url=vault_url, credential=credential)

        secret = client.set_secret(secret_name, secret_value, content_type=content_type)

        return {
            "success": True,
            "vault_name": vault_name,
            "message": f"Secret '{secret_name}' set successfully",
            "secret": {
                "name": secret.name,
                "version": secret.properties.version,
                "created_on": secret.properties.created_on.isoformat() if secret.properties.created_on else None
            },
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# =============================================================================
# COST MANAGEMENT TOOLS
# =============================================================================

def _resolve_cost_subscriptions(
    subscription_id: Optional[str],
    credential: Any,
) -> List[str]:
    """
    Resolve which Azure subscriptions a cost query should target.

    Q1-blocker-1 (2026-05-12): models invoke cost tools without
    `subscription_id`. Previously the tool fell back to `DEFAULT_SUBSCRIPTION_ID`
    (empty string in openagentic), built scope=`/subscriptions/`, and the
    Azure SDK collapsed `/subscriptions//providers/...` so Azure returned
    `InvalidSubscriptionId 'providers' is malformed`.

    Resolution order:
      1. Explicit `subscription_id` argument (single-sub mode).
      2. `DEFAULT_SUBSCRIPTION_ID` env var if non-empty (single-sub mode).
      3. SubscriptionClient.list() via the service principal (fan-out mode).

    Returns the list of subscription UUIDs to query. Raises ValueError if
    the user has no visible subscriptions — the caller turns that into a
    `{success: False}` response, never a malformed Azure URL.
    """
    if subscription_id:
        return [subscription_id]
    if DEFAULT_SUBSCRIPTION_ID:
        return [DEFAULT_SUBSCRIPTION_ID]

    sub_client = SubscriptionClient(credential)
    subs = [s.subscription_id for s in sub_client.subscriptions.list() if s.subscription_id]
    if not subs:
        raise ValueError(
            "No subscription_id provided and the caller has no visible Azure "
            "subscriptions (the service principal sees none). Pass `subscription_id` "
            "explicitly or call `azure_list_subscriptions` to see what's available."
        )
    return subs

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_cost_query(
    days: int = 30,
    granularity: str = "Daily",
    group_by: Optional[List[str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Query Azure costs with flexible parameters.

    Args:
        days: Number of days to query (default 30)
        granularity: Time granularity - 'Daily', 'Monthly', or 'None'
        group_by: List of dimensions to group by (e.g., ['ResourceType', 'ResourceGroup'])
        subscription_id: Optional Azure subscription ID. When omitted, the
            tool auto-resolves the service principal's visible subscriptions
            and fans the cost query across each, returning aggregated data.
            Pass an explicit UUID to scope to one subscription.
    """
    user_info: Optional[dict] = None
    try:
        credential, user_info = require_user_token(meta)
        sub_ids = _resolve_cost_subscriptions(subscription_id, credential)

        client = CostManagementClient(credential)

        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)

        # Build query definition
        query_def = {
            "type": "ActualCost",
            "timeframe": "Custom",
            "time_period": {
                "from": start_date.strftime("%Y-%m-%dT00:00:00Z"),
                "to": end_date.strftime("%Y-%m-%dT23:59:59Z")
            },
            "dataset": {
                "granularity": granularity,
                "aggregation": {
                    "totalCost": {"name": "Cost", "function": "Sum"},
                    "totalCostUSD": {"name": "CostUSD", "function": "Sum"}
                }
            }
        }

        if group_by:
            query_def["dataset"]["grouping"] = [
                {"type": "Dimension", "name": dim} for dim in group_by
            ]

        all_rows: List[Any] = []
        columns: List[str] = []
        per_sub: List[Dict[str, Any]] = []

        for sid in sub_ids:
            scope = f"/subscriptions/{sid}"
            result = client.query.usage(scope, query_def)
            sub_cols = [col.name for col in result.columns] if result.columns else []
            sub_rows = result.rows or []
            if not columns:
                columns = sub_cols
            all_rows.extend(sub_rows)
            per_sub.append({"subscription_id": sid, "row_count": len(sub_rows)})

        return {
            "success": True,
            "period": f"Last {days} days",
            "from_date": start_date.strftime("%Y-%m-%d"),
            "to_date": end_date.strftime("%Y-%m-%d"),
            "granularity": granularity,
            "columns": columns,
            "subscription_count": len(sub_ids),
            "subscriptions": per_sub,
            "row_count": len(all_rows),
            "data": all_rows[:100],  # Limit to first 100 rows
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_cost_by_service(
    days: int = 30,
    top_n: int = 10,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get cost breakdown by Azure service.

    Args:
        days: Number of days to analyze
        top_n: Number of top services to return
        subscription_id: Optional Azure subscription ID. When omitted, the
            tool auto-resolves the service principal's visible subscriptions,
            queries each, and returns top services aggregated across all
            of them. Pass an explicit UUID to scope to one subscription.
    """
    user_info: Optional[dict] = None
    try:
        credential, user_info = require_user_token(meta)
        sub_ids = _resolve_cost_subscriptions(subscription_id, credential)

        client = CostManagementClient(credential)

        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)

        query_def = {
            "type": "ActualCost",
            "timeframe": "Custom",
            "time_period": {
                "from": start_date.strftime("%Y-%m-%dT00:00:00Z"),
                "to": end_date.strftime("%Y-%m-%dT23:59:59Z")
            },
            "dataset": {
                "granularity": "None",
                "aggregation": {
                    "totalCost": {"name": "CostUSD", "function": "Sum"}
                },
                "grouping": [{"type": "Dimension", "name": "ServiceName"}],
                "sorting": [{"direction": "descending", "name": "CostUSD"}]
            }
        }

        # Aggregate cost per service across every subscription.
        agg: Dict[str, float] = {}
        for sid in sub_ids:
            scope = f"/subscriptions/{sid}"
            result = client.query.usage(scope, query_def)
            for row in (result.rows or []):
                cost = row[0] if len(row) > 0 else 0
                service = row[1] if len(row) > 1 else "Unknown"
                agg[service] = agg.get(service, 0.0) + float(cost)

        # Top-N by aggregated cost.
        ranked = sorted(agg.items(), key=lambda kv: kv[1], reverse=True)[:top_n]
        services = [{"service": s, "cost": round(c, 2)} for s, c in ranked]
        total_cost = sum(c for _, c in ranked)

        return {
            "success": True,
            "period": f"Last {days} days",
            "subscription_count": len(sub_ids),
            "subscriptions": [{"subscription_id": s} for s in sub_ids],
            "total_cost": round(total_cost, 2),
            "currency": "USD",
            "top_services": services,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_cost_forecast(
    forecast_days: int = 30,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get cost forecast based on historical spending.

    Args:
        forecast_days: Number of days to forecast
        subscription_id: Optional Azure subscription ID. When omitted, the
            tool auto-resolves the service principal's visible subscriptions
            and sums forecasted spend across each. Pass an explicit UUID to
            scope to one subscription.
    """
    user_info: Optional[dict] = None
    try:
        credential, user_info = require_user_token(meta)
        sub_ids = _resolve_cost_subscriptions(subscription_id, credential)

        client = CostManagementClient(credential)

        start_date = datetime.now(timezone.utc)
        end_date = start_date + timedelta(days=forecast_days)

        query_def = {
            "type": "Usage",
            "timeframe": "Custom",
            "time_period": {
                "from": start_date.strftime("%Y-%m-%dT00:00:00Z"),
                "to": end_date.strftime("%Y-%m-%dT23:59:59Z")
            },
            "dataset": {
                "granularity": "Daily",
                "aggregation": {
                    "totalCost": {"name": "Cost", "function": "Sum"}
                }
            }
        }

        forecasted_total = 0.0
        total_points = 0
        for sid in sub_ids:
            scope = f"/subscriptions/{sid}"
            result = client.forecast.usage(scope, query_def)
            rows = result.rows or []
            total_points += len(rows)
            forecasted_total += sum(row[0] for row in rows if len(row) > 0)

        return {
            "success": True,
            "forecast_period": f"Next {forecast_days} days",
            "from_date": start_date.strftime("%Y-%m-%d"),
            "to_date": end_date.strftime("%Y-%m-%d"),
            "subscription_count": len(sub_ids),
            "subscriptions": [{"subscription_id": s} for s in sub_ids],
            "forecasted_total": round(forecasted_total, 2),
            "currency": "USD",
            "daily_data_points": total_points,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info)

# =============================================================================
# MICROSOFT GRAPH (AZURE AD / ENTRA ID) TOOLS
# =============================================================================

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my users", "show me users", "what users do i have"],
        "testFixture": None,
    },
)
async def azure_list_users(
    filter_query: Optional[str] = None,
    top: int = 100,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure AD / Entra ID users.

    Args:
        filter_query: OData filter (e.g., "startswith(displayName,'John')")
        top: Maximum number of users to return
    """
    try:
        credential, user_info = require_user_token(meta, "graphAccessToken")

        graph_client = GraphServiceClient(credential)

        # Build request
        request = graph_client.users.get()

        # Note: Graph SDK pagination and filtering would be applied here
        # For now, return basic list
        users_response = await request

        users = []
        if users_response and users_response.value:
            for user in users_response.value[:top]:
                users.append({
                    "id": user.id,
                    "display_name": user.display_name,
                    "user_principal_name": user.user_principal_name,
                    "mail": user.mail,
                    "job_title": user.job_title,
                    "department": user.department,
                    "account_enabled": user.account_enabled
                })

        return {
            "success": True,
            "count": len(users),
            "users": users,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": str(e), "error_type": type(e).__name__}

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["get user details", "show me one user"],
        "testFixture": None,
    },
)
async def azure_get_user(
    user_id: str,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get details of a specific Azure AD user.

    Args:
        user_id: User ID or user principal name (email)
    """
    try:
        credential, user_info = require_user_token(meta, "graphAccessToken")

        graph_client = GraphServiceClient(credential)
        user = await graph_client.users.by_user_id(user_id).get()

        return {
            "success": True,
            "user": {
                "id": user.id,
                "display_name": user.display_name,
                "user_principal_name": user.user_principal_name,
                "mail": user.mail,
                "given_name": user.given_name,
                "surname": user.surname,
                "job_title": user.job_title,
                "department": user.department,
                "office_location": user.office_location,
                "mobile_phone": user.mobile_phone,
                "account_enabled": user.account_enabled,
                "created_date_time": user.created_date_time.isoformat() if user.created_date_time else None
            },
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": str(e), "error_type": type(e).__name__}

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my groups", "show me groups", "what groups do i have"],
        "testFixture": None,
    },
)
async def azure_list_groups(
    filter_query: Optional[str] = None,
    top: int = 100,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure AD / Entra ID groups.

    Args:
        filter_query: OData filter
        top: Maximum number of groups to return
    """
    try:
        credential, user_info = require_user_token(meta, "graphAccessToken")

        graph_client = GraphServiceClient(credential)
        groups_response = await graph_client.groups.get()

        groups = []
        if groups_response and groups_response.value:
            for group in groups_response.value[:top]:
                groups.append({
                    "id": group.id,
                    "display_name": group.display_name,
                    "description": group.description,
                    "mail": group.mail,
                    "mail_enabled": group.mail_enabled,
                    "security_enabled": group.security_enabled,
                    "group_types": group.group_types or []
                })

        return {
            "success": True,
            "count": len(groups),
            "groups": groups,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": str(e), "error_type": type(e).__name__}

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my apps", "show me apps", "what apps do i have"],
        "testFixture": None,
    },
)
async def azure_list_apps(
    top: int = 100,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure AD app registrations.

    Args:
        top: Maximum number of apps to return
    """
    try:
        credential, user_info = require_user_token(meta, "graphAccessToken")

        graph_client = GraphServiceClient(credential)
        apps_response = await graph_client.applications.get()

        apps = []
        if apps_response and apps_response.value:
            for app in apps_response.value[:top]:
                apps.append({
                    "id": app.id,
                    "app_id": app.app_id,
                    "display_name": app.display_name,
                    "sign_in_audience": app.sign_in_audience,
                    "created_date_time": app.created_date_time.isoformat() if app.created_date_time else None,
                    "identifier_uris": app.identifier_uris or []
                })

        return {
            "success": True,
            "count": len(apps),
            "applications": apps,
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": str(e), "error_type": type(e).__name__}

# =============================================================================
# MONITORING TOOLS
# =============================================================================

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my alerts", "show me alerts", "what alerts do i have"],
        "testFixture": None,
    },
)
async def azure_list_alerts(
    resource_group: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List metric alert rules.

    Args:
        resource_group: Filter by resource group
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = MonitorManagementClient(credential, sub_id)

        if resource_group:
            alerts = list(client.metric_alerts.list_by_resource_group(resource_group))
        else:
            alerts = list(client.metric_alerts.list_by_subscription())

        return {
            "success": True,
            "count": len(alerts),
            "alerts": [
                {
                    "name": alert.name,
                    "location": alert.location,
                    "resource_group": alert.id.split('/')[4] if alert.id else None,
                    "severity": alert.severity,
                    "enabled": alert.enabled,
                    "description": alert.description,
                    "scopes": alert.scopes,
                    "tags": alert.tags or {}
                }
                for alert in alerts
            ],
            "executed_as": user_info
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# =============================================================================
# TYPED CREATE TOOLS — each tool wraps a single SDK call with strongly-typed
# args so the model doesn't have to hand-craft ARM JSON. Docstrings are
# narrowly scoped so semantic search picks the right one per task.
# =============================================================================

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_app_service_plan(
    name: str,
    resource_group: str,
    location: str,
    sku: str = "B1",
    tier: str = "Basic",
    os_type: str = "Linux",
    capacity: int = 1,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure App Service Plan (server farm) — the compute container that
    hosts Web Apps, Function Apps, and other App Service workloads.

    Use this BEFORE creating a web app or function app: every App Service workload
    needs a plan to run on. Pick the cheapest SKU your workload needs:
      F1 (Free, no SLA), B1 (Basic ~$13/mo), S1 (Standard ~$70/mo),
      P1V3 (Premium V3, production-grade).

    For Linux Python/Node/Java/etc workloads, set os_type='Linux'. For Windows
    .NET workloads, set os_type='Windows'.

    Args:
        name: Plan name (must be unique within the resource group)
        resource_group: Resource group to create the plan in
        location: Azure region (e.g., 'eastus', 'westus2')
        sku: SKU code — F1, B1, B2, B3, S1, S2, S3, P1V3, P2V3, P3V3
        tier: Tier name — Free, Basic, Standard, PremiumV3
        os_type: 'Linux' or 'Windows'
        capacity: Number of instances (default 1)
        tags: Optional tags to apply
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = WebSiteManagementClient(credential, sub_id)
        plan_definition: Dict[str, Any] = {
            "location": location,
            "sku": {"name": sku, "tier": tier, "capacity": capacity},
            "kind": "linux" if os_type.lower() == "linux" else "app",
            "reserved": os_type.lower() == "linux",  # Linux requires reserved=true
            "tags": tags or {},
        }
        poller = client.app_service_plans.begin_create_or_update(
            resource_group_name=resource_group,
            name=name,
            app_service_plan=plan_definition,
        )
        plan = poller.result()
        return {
            "success": True,
            "app_service_plan": {
                "name": plan.name,
                "id": plan.id,
                "location": plan.location,
                "sku": {"name": plan.sku.name, "tier": plan.sku.tier} if plan.sku else None,
                "os_type": "Linux" if plan.reserved else "Windows",
                "tags": plan.tags,
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_web_app(
    name: str,
    resource_group: str,
    app_service_plan: str,
    location: str,
    runtime: str = "PYTHON|3.11",
    https_only: bool = True,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure App Service Web App on an existing App Service Plan.

    Use this AFTER creating an App Service Plan with azure_create_app_service_plan.
    The runtime field uses the App Service Linux runtime stack format:
      'PYTHON|3.11', 'PYTHON|3.12', 'NODE|20-lts', 'NODE|18-lts',
      'JAVA|17-java17', 'DOTNETCORE|8.0', 'PHP|8.2', 'RUBY|3.1'

    The app_service_plan argument can be either the plan name (when in the same
    resource group) or the full plan resource ID.

    Args:
        name: Web app name (becomes <name>.azurewebsites.net, must be globally unique)
        resource_group: Resource group containing the plan
        app_service_plan: Plan name or full resource ID
        location: Azure region (must match the plan's region)
        runtime: Linux runtime stack — 'PYTHON|3.11' format
        https_only: Force HTTPS-only access (default True, recommended)
        tags: Optional tags to apply
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = WebSiteManagementClient(credential, sub_id)
        # Resolve the plan ID — accept both name and full ID
        if app_service_plan.startswith("/subscriptions/"):
            plan_id = app_service_plan
        else:
            plan_id = (
                f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
                f"/providers/Microsoft.Web/serverfarms/{app_service_plan}"
            )

        site_definition: Dict[str, Any] = {
            "location": location,
            "server_farm_id": plan_id,
            "https_only": https_only,
            "site_config": {
                "linux_fx_version": runtime,
                "always_on": False,  # B1 plans don't support always_on
            },
            "tags": tags or {},
        }
        poller = client.web_apps.begin_create_or_update(
            resource_group_name=resource_group,
            name=name,
            site_envelope=site_definition,
        )
        site = poller.result()
        return {
            "success": True,
            "web_app": {
                "name": site.name,
                "id": site.id,
                "default_host_name": site.default_host_name,
                "state": site.state,
                "runtime": runtime,
                "tags": site.tags,
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_function_app(
    name: str,
    resource_group: str,
    location: str,
    storage_account: str,
    runtime: str = "python",
    runtime_version: str = "3.11",
    app_service_plan: Optional[str] = None,
    consumption_plan: bool = True,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Function App. Function Apps are serverless event-driven
    workloads — cheaper than always-on Web Apps for sporadic traffic.

    Use this as a fallback path when App Service quota is blocked, or for any
    workload that's event-driven (HTTP triggers, queues, timers, blobs).

    Two hosting modes:
    - consumption_plan=True (default): pay-per-execution, no always-on cost,
      no app_service_plan needed. Best for low-traffic / fallback path.
    - consumption_plan=False: dedicated plan via app_service_plan argument.

    Args:
        name: Function app name (globally unique)
        resource_group: Resource group
        location: Azure region
        storage_account: Storage account name (must already exist) — Functions
                         require a backing storage account for state and metadata
        runtime: 'python', 'node', 'dotnet', 'java', 'powershell'
        runtime_version: Version string ('3.11', '20', '8.0', etc)
        app_service_plan: Plan name (only when consumption_plan=False)
        consumption_plan: Use serverless consumption plan (default True)
        tags: Optional tags
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = WebSiteManagementClient(credential, sub_id)
        storage_client = StorageManagementClient(credential, sub_id)

        # Get storage account connection string for AzureWebJobsStorage
        keys = storage_client.storage_accounts.list_keys(resource_group, storage_account)
        storage_key = keys.keys[0].value
        storage_conn = (
            f"DefaultEndpointsProtocol=https;AccountName={storage_account};"
            f"AccountKey={storage_key};EndpointSuffix=core.windows.net"
        )

        kind = "functionapp,linux" if runtime != "dotnet" else "functionapp"
        site_definition: Dict[str, Any] = {
            "location": location,
            "kind": kind,
            "reserved": runtime != "dotnet",  # Linux for non-dotnet
            "site_config": {
                "linux_fx_version": f"{runtime.upper()}|{runtime_version}" if runtime != "dotnet" else None,
                "app_settings": [
                    {"name": "AzureWebJobsStorage", "value": storage_conn},
                    {"name": "FUNCTIONS_WORKER_RUNTIME", "value": runtime},
                    {"name": "FUNCTIONS_EXTENSION_VERSION", "value": "~4"},
                ],
            },
            "tags": tags or {},
        }
        if not consumption_plan and app_service_plan:
            site_definition["server_farm_id"] = (
                f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
                f"/providers/Microsoft.Web/serverfarms/{app_service_plan}"
            )
        # Consumption plan: omit server_farm_id, Azure auto-creates a Y1 plan

        poller = client.web_apps.begin_create_or_update(
            resource_group_name=resource_group,
            name=name,
            site_envelope=site_definition,
        )
        site = poller.result()
        return {
            "success": True,
            "function_app": {
                "name": site.name,
                "id": site.id,
                "default_host_name": site.default_host_name,
                "state": site.state,
                "runtime": f"{runtime} {runtime_version}",
                "tags": site.tags,
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_storage_account(
    name: str,
    resource_group: str,
    location: str,
    sku: str = "Standard_LRS",
    kind: str = "StorageV2",
    allow_blob_public_access: bool = False,
    enable_https_traffic_only: bool = True,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Storage Account.

    Storage account names must be globally unique, 3-24 characters, lowercase
    letters and numbers only. SKU controls redundancy:
      Standard_LRS (cheapest, single region 3 copies),
      Standard_ZRS (zone-redundant in one region),
      Standard_GRS (geo-redundant across regions, 2x cost),
      Premium_LRS (SSD-backed, fast).

    Set allow_blob_public_access=True if you intend to host publicly-readable
    blobs (e.g. a static site or public download). Default is False (private).

    Args:
        name: Storage account name (3-24 lowercase alphanumeric, globally unique)
        resource_group: Resource group
        location: Azure region
        sku: SKU code (Standard_LRS, Standard_ZRS, Standard_GRS, Premium_LRS)
        kind: 'StorageV2' (recommended), 'BlobStorage', 'FileStorage'
        allow_blob_public_access: Enable public read access on blob containers
        enable_https_traffic_only: Force HTTPS for all storage operations
        tags: Optional tags
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = StorageManagementClient(credential, sub_id)
        params: Dict[str, Any] = {
            "location": location,
            "sku": {"name": sku},
            "kind": kind,
            "allow_blob_public_access": allow_blob_public_access,
            "enable_https_traffic_only": enable_https_traffic_only,
            "minimum_tls_version": "TLS1_2",  # Security: enforce TLS 1.2 minimum
            "tags": tags or {},
        }
        poller = client.storage_accounts.begin_create(
            resource_group_name=resource_group,
            account_name=name,
            parameters=params,
        )
        account = poller.result()
        return {
            "success": True,
            "storage_account": {
                "name": account.name,
                "id": account.id,
                "location": account.location,
                "sku": account.sku.name if account.sku else None,
                "kind": account.kind,
                "allow_blob_public_access": account.allow_blob_public_access,
                "primary_endpoints": {
                    "blob": account.primary_endpoints.blob if account.primary_endpoints else None,
                    "file": account.primary_endpoints.file if account.primary_endpoints else None,
                } if account.primary_endpoints else None,
                "tags": account.tags,
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 8000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_storage_account_set_public_access(
    name: str,
    resource_group: str,
    allow_blob_public_access: bool,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Toggle public blob access on an existing Storage Account.

    This is the account-level switch — even with this enabled, individual blob
    containers default to private and need their own public-access setting.

    Args:
        name: Storage account name
        resource_group: Resource group
        allow_blob_public_access: True to enable, False to disable
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = StorageManagementClient(credential, sub_id)
        updated = client.storage_accounts.update(
            resource_group_name=resource_group,
            account_name=name,
            parameters={"allow_blob_public_access": allow_blob_public_access},
        )
        return {
            "success": True,
            "storage_account": {
                "name": updated.name,
                "id": updated.id,
                "allow_blob_public_access": updated.allow_blob_public_access,
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_container_app(
    name: str,
    resource_group: str,
    location: str,
    image: str,
    environment_name: str,
    target_port: int = 80,
    cpu: float = 0.5,
    memory: str = "1.0Gi",
    min_replicas: int = 0,
    max_replicas: int = 10,
    env_vars: Optional[Dict[str, str]] = None,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Container App — serverless containers with auto-scaling and
    HTTP ingress. Cheaper than App Service for sporadic traffic, faster cold
    start than Functions for HTTP workloads.

    Use this as a fallback when App Service quota is blocked. Requires a
    Container Apps Environment (environment_name) to already exist in the same
    resource group — create one with `az containerapp env create` or via the
    portal first.

    Args:
        name: Container app name
        resource_group: Resource group
        location: Azure region
        image: Container image (e.g., 'docker.io/library/python:3.11-slim',
               'mcr.microsoft.com/azuredocs/aks-store-demo:latest')
        environment_name: Container Apps Environment name (must already exist)
        target_port: Port the container listens on (default 80)
        cpu: CPU cores (0.25, 0.5, 0.75, 1.0, 1.25, ...)
        memory: Memory (e.g. '0.5Gi', '1.0Gi', '2.0Gi')
        min_replicas: Minimum replicas (0 = scale to zero)
        max_replicas: Maximum replicas
        env_vars: Container environment variables
        tags: Optional tags
        subscription_id: Azure subscription ID
    """
    try:
        from azure.mgmt.appcontainers import ContainerAppsAPIClient
    except ImportError:
        return {
            "success": False,
            "error": "azure-mgmt-appcontainers SDK not installed in this MCP image. Add it to requirements.txt and rebuild.",
        }
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = ContainerAppsAPIClient(credential, sub_id)

        # Resolve environment ID
        env_id = (
            f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
            f"/providers/Microsoft.App/managedEnvironments/{environment_name}"
        )

        env_var_list = []
        if env_vars:
            env_var_list = [{"name": k, "value": v} for k, v in env_vars.items()]

        container_app: Dict[str, Any] = {
            "location": location,
            "tags": tags or {},
            "properties": {
                "managed_environment_id": env_id,
                "configuration": {
                    "ingress": {
                        "external": True,
                        "target_port": target_port,
                    },
                },
                "template": {
                    "containers": [{
                        "name": name,
                        "image": image,
                        "resources": {"cpu": cpu, "memory": memory},
                        "env": env_var_list,
                    }],
                    "scale": {"min_replicas": min_replicas, "max_replicas": max_replicas},
                },
            },
        }
        poller = client.container_apps.begin_create_or_update(
            resource_group_name=resource_group,
            container_app_name=name,
            container_app_envelope=container_app,
        )
        result = poller.result()
        return {
            "success": True,
            "container_app": {
                "name": result.name,
                "id": result.id,
                "location": result.location,
                "fqdn": result.configuration.ingress.fqdn if result.configuration and result.configuration.ingress else None,
                "tags": result.tags,
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_key_vault(
    name: str,
    resource_group: str,
    location: str,
    tenant_id: Optional[str] = None,
    sku: str = "standard",
    enable_rbac_authorization: bool = True,
    soft_delete_retention_days: int = 7,
    purge_protection: bool = False,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Key Vault for storing secrets, keys, and certificates.

    Vault names must be globally unique, 3-24 characters, alphanumeric and
    hyphens (no underscores). RBAC authorization (default true) is the modern
    auth model — set to False only if you specifically need access policies.

    Args:
        name: Vault name (globally unique, 3-24 chars, alphanumeric+hyphens)
        resource_group: Resource group
        location: Azure region
        tenant_id: Azure AD tenant ID (defaults to AZURE_TENANT_ID env var)
        sku: 'standard' (cheap) or 'premium' (HSM-backed keys)
        enable_rbac_authorization: True for RBAC (modern), False for access policies
        soft_delete_retention_days: 7-90 days (default 7)
        purge_protection: True to prevent permanent deletion (default False)
        tags: Optional tags
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        tenant = tenant_id or os.environ.get("AZURE_TENANT_ID", "")
        if not tenant:
            return {"success": False, "error": "tenant_id not provided and AZURE_TENANT_ID env var not set"}

        client = KeyVaultManagementClient(credential, sub_id)
        params: Dict[str, Any] = {
            "location": location,
            "tags": tags or {},
            "properties": {
                "tenant_id": tenant,
                "sku": {"family": "A", "name": sku},
                "enable_rbac_authorization": enable_rbac_authorization,
                "enable_soft_delete": True,
                "soft_delete_retention_in_days": soft_delete_retention_days,
                "enable_purge_protection": purge_protection or None,  # API quirk: only set if True
                "access_policies": [] if enable_rbac_authorization else None,
            },
        }
        poller = client.vaults.begin_create_or_update(
            resource_group_name=resource_group,
            vault_name=name,
            parameters=params,
        )
        vault = poller.result()
        return {
            "success": True,
            "key_vault": {
                "name": vault.name,
                "id": vault.id,
                "location": vault.location,
                "vault_uri": vault.properties.vault_uri if vault.properties else None,
                "rbac_enabled": vault.properties.enable_rbac_authorization if vault.properties else None,
                "tags": vault.tags,
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_vm(
    name: str,
    resource_group: str,
    location: str,
    image: str = "Canonical:0001-com-ubuntu-server-jammy:22_04-lts-gen2:latest",
    size: str = "Standard_B1s",
    admin_username: str = "azureuser",
    ssh_public_key: Optional[str] = None,
    admin_password: Optional[str] = None,
    vnet_name: Optional[str] = None,
    subnet_name: Optional[str] = None,
    create_public_ip: bool = True,
    tags: Optional[Dict[str, str]] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create a basic Azure VM with a NIC, optional public IP, and a single OS
    disk. For Linux, pass an SSH public key (preferred). For Windows, pass an
    admin_password. The default image is Ubuntu 22.04 LTS Gen2.

    This is the minimal-viable VM create — for production VMs with managed
    identity, data disks, NSG rules, custom user data, etc, use a Bicep/ARM
    deployment instead.

    Args:
        name: VM name
        resource_group: Resource group (must already exist)
        location: Azure region
        image: URN — 'Publisher:Offer:Sku:Version' (default Ubuntu 22.04 LTS)
        size: VM SKU — Standard_B1s (cheapest), Standard_D2s_v5 (general), etc
        admin_username: Linux/Windows admin username
        ssh_public_key: SSH public key content (Linux only)
        admin_password: Admin password (Windows or Linux fallback)
        vnet_name: VNet to attach to (created if not specified — wires up a
                   default 10.0.0.0/16 vnet with subnet 10.0.0.0/24)
        subnet_name: Subnet within the vnet (default 'default')
        create_public_ip: Allocate a public IP (default True)
        tags: Optional tags
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        net_client = NetworkManagementClient(credential, sub_id)
        compute_client = ComputeManagementClient(credential, sub_id)

        # 1. VNet + subnet (create if not provided)
        actual_vnet = vnet_name or f"{name}-vnet"
        actual_subnet = subnet_name or "default"
        if not vnet_name:
            net_client.virtual_networks.begin_create_or_update(
                resource_group, actual_vnet,
                {
                    "location": location,
                    "address_space": {"address_prefixes": ["10.0.0.0/16"]},
                    "subnets": [{"name": actual_subnet, "address_prefix": "10.0.0.0/24"}],
                }
            ).result()

        subnet_id = (
            f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
            f"/providers/Microsoft.Network/virtualNetworks/{actual_vnet}/subnets/{actual_subnet}"
        )

        # 2. Public IP
        ip_config: Dict[str, Any] = {"subnet": {"id": subnet_id}}
        if create_public_ip:
            pip = net_client.public_ip_addresses.begin_create_or_update(
                resource_group, f"{name}-pip",
                {"location": location, "public_ip_allocation_method": "Dynamic"}
            ).result()
            ip_config["public_ip_address"] = {"id": pip.id}

        # 3. NIC
        nic = net_client.network_interfaces.begin_create_or_update(
            resource_group, f"{name}-nic",
            {
                "location": location,
                "ip_configurations": [{"name": "ipconfig1", **ip_config}],
            }
        ).result()

        # 4. VM
        urn_parts = image.split(":")
        if len(urn_parts) != 4:
            return {"success": False, "error": f"Image URN must have 4 parts (Publisher:Offer:Sku:Version), got: {image}"}
        publisher, offer, sku, version = urn_parts

        os_profile: Dict[str, Any] = {
            "computer_name": name,
            "admin_username": admin_username,
        }
        if ssh_public_key:
            os_profile["linux_configuration"] = {
                "disable_password_authentication": True,
                "ssh": {"public_keys": [{
                    "path": f"/home/{admin_username}/.ssh/authorized_keys",
                    "key_data": ssh_public_key,
                }]},
            }
        elif admin_password:
            os_profile["admin_password"] = admin_password
        else:
            return {"success": False, "error": "Either ssh_public_key or admin_password is required"}

        vm_params: Dict[str, Any] = {
            "location": location,
            "tags": tags or {},
            "hardware_profile": {"vm_size": size},
            "storage_profile": {
                "image_reference": {
                    "publisher": publisher,
                    "offer": offer,
                    "sku": sku,
                    "version": version,
                },
            },
            "os_profile": os_profile,
            "network_profile": {"network_interfaces": [{"id": nic.id, "primary": True}]},
        }
        poller = compute_client.virtual_machines.begin_create_or_update(
            resource_group_name=resource_group,
            vm_name=name,
            parameters=vm_params,
        )
        vm = poller.result()
        return {
            "success": True,
            "vm": {
                "name": vm.name,
                "id": vm.id,
                "location": vm.location,
                "size": vm.hardware_profile.vm_size if vm.hardware_profile else None,
                "tags": vm.tags,
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my role assignments", "show me role assignments", "what role assignments do i have"],
        "testFixture": None,
    },
)
async def azure_list_role_assignments(
    scope: Optional[str] = None,
    principal_id: Optional[str] = None,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure RBAC role assignments. Use for security audits, IAM reviews,
    and incident response (UC-028).

    Args:
        scope: Optional scope filter (e.g. '/subscriptions/<id>',
               '/subscriptions/<id>/resourceGroups/<name>'). Defaults to the
               full subscription.
        principal_id: Optional filter by user/group/SP object ID
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        client = AuthorizationManagementClient(credential, sub_id)
        actual_scope = scope or f"/subscriptions/{sub_id}"

        if principal_id:
            assignments = client.role_assignments.list_for_scope(
                scope=actual_scope,
                filter=f"principalId eq '{principal_id}'",
            )
        else:
            assignments = client.role_assignments.list_for_scope(scope=actual_scope)

        results = []
        for ra in assignments:
            results.append({
                "id": ra.id,
                "principal_id": ra.principal_id,
                "principal_type": ra.principal_type,
                "role_definition_id": ra.role_definition_id,
                "scope": ra.scope,
            })
        return {
            "success": True,
            "count": len(results),
            "scope": actual_scope,
            "role_assignments": results,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_security_list_assessments(
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Microsoft Defender for Cloud security assessments for a subscription (typed SDK).
    Returns current security findings with severity, status, and remediation guidance.
    Use for security incident response (UC-028) and compliance audits.

    Args:
        subscription_id: Azure subscription ID (defaults to DEFAULT_SUBSCRIPTION_ID)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = SecurityCenter(credential, sub_id, asc_location="centralus")
        scope = f"/subscriptions/{sub_id}"
        results = []
        for a in client.assessments.list(scope=scope):
            props = getattr(a, "additional_properties", {}) or {}
            results.append({
                "name": a.name,
                "id": a.id,
                "display_name": getattr(a, "display_name", None) or props.get("properties", {}).get("displayName"),
                "status": getattr(getattr(a, "status", None), "code", None),
                "severity": getattr(getattr(a, "metadata", None), "severity", None),
                "description": getattr(getattr(a, "metadata", None), "description", None),
                "categories": getattr(getattr(a, "metadata", None), "categories", None),
            })
        return {"success": True, "count": len(results), "assessments": results, "executed_as": user_info}
    except Exception as e:
        return {"success": False, "error": str(e), "executed_as": user_info if 'user_info' in dir() else None}

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 5000,
        "failureModes": ["auth_expired"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_security_secure_score(
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get Microsoft Defender for Cloud secure score for a subscription (typed SDK).
    Returns the overall secure score percentage and individual control scores.
    Use for executive security posture reporting (UC-028).

    Args:
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = SecurityCenter(credential, sub_id, asc_location="centralus")
        scores = []
        for s in client.secure_scores.list():
            score_obj = getattr(s, "score", None)
            scores.append({
                "name": s.name,
                "id": s.id,
                "display_name": getattr(s, "display_name", None),
                "current": getattr(score_obj, "current", None) if score_obj else None,
                "max": getattr(score_obj, "max", None) if score_obj else None,
                "percentage": getattr(score_obj, "percentage", None) if score_obj else None,
                "weight": getattr(s, "weight", None),
            })
        return {"success": True, "count": len(scores), "secure_scores": scores, "executed_as": user_info}
    except Exception as e:
        return {"success": False, "error": str(e), "executed_as": user_info if 'user_info' in dir() else None}

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_security_list_alerts(
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Microsoft Defender for Cloud security alerts for a subscription (typed SDK).
    Returns active and resolved security alerts with severity, status, and affected resources.
    Use for incident triage and security operations (UC-028).

    Args:
        subscription_id: Azure subscription ID
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = SecurityCenter(credential, sub_id, asc_location="centralus")
        alerts = []
        for a in client.alerts.list():
            alerts.append({
                "name": a.name,
                "id": a.id,
                "alert_display_name": getattr(a, "alert_display_name", None),
                "severity": getattr(a, "severity", None),
                "status": getattr(a, "status", None),
                "description": getattr(a, "description", None),
                "time_generated": str(getattr(a, "time_generated_utc", None)) if getattr(a, "time_generated_utc", None) else None,
                "compromised_entity": getattr(a, "compromised_entity", None),
                "intent": getattr(a, "intent", None),
            })
        return {"success": True, "count": len(alerts), "alerts": alerts, "executed_as": user_info}
    except Exception as e:
        return {"success": False, "error": str(e), "executed_as": user_info if 'user_info' in dir() else None}

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_log_analytics_list_workspaces(
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Log Analytics workspaces in a subscription or resource group (typed SDK).
    Returns workspace IDs, locations, retention, and SKU. You need a workspace_id
    (the customer_id GUID) to run azure_log_analytics_query against it.

    Args:
        subscription_id: Azure subscription ID
        resource_group: Optional resource group filter
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = LogAnalyticsManagementClient(credential, sub_id)
        it = client.workspaces.list_by_resource_group(resource_group) if resource_group else client.workspaces.list()
        workspaces = []
        for w in it:
            workspaces.append({
                "name": w.name,
                "id": w.id,
                "customer_id": getattr(w, "customer_id", None),
                "location": w.location,
                "retention_in_days": getattr(w, "retention_in_days", None),
                "sku": getattr(getattr(w, "sku", None), "name", None),
                "provisioning_state": getattr(w, "provisioning_state", None),
            })
        return {"success": True, "count": len(workspaces), "workspaces": workspaces, "executed_as": user_info}
    except Exception as e:
        return {"success": False, "error": str(e), "executed_as": user_info if 'user_info' in dir() else None}

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_log_analytics_query(
    workspace_id: str,
    kql_query: str,
    timespan_hours: Optional[int] = 24,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Run a KQL query against a Log Analytics workspace (typed SDK via LogsQueryClient).
    Returns columns + rows for the first result table. Use for log investigation,
    security event hunting, operational troubleshooting (UC-027, UC-028).

    Args:
        workspace_id: The workspace customer_id GUID (NOT the full ARM resource ID).
                      Get it from azure_log_analytics_list_workspaces.
        kql_query: KQL query string, e.g. "AzureActivity | take 50"
        timespan_hours: Query timespan in hours (default 24)
    """
    try:
        credential, user_info = require_user_token(meta)
        client = LogsQueryClient(credential)
        response = client.query_workspace(
            workspace_id=workspace_id,
            query=kql_query,
            timespan=timedelta(hours=timespan_hours or 24),
        )
        if response.status == LogsQueryStatus.PARTIAL:
            tables = response.partial_data
            error = str(response.partial_error) if response.partial_error else None
        else:
            tables = response.tables
            error = None
        if not tables:
            return {"success": True, "columns": [], "rows": [], "row_count": 0, "error": error, "executed_as": user_info}
        t = tables[0]
        columns = [c for c in t.columns]
        rows = [list(r) for r in t.rows]
        return {
            "success": True,
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "error": error,
            "executed_as": user_info,
        }
    except Exception as e:
        return {"success": False, "error": str(e), "executed_as": user_info if 'user_info' in dir() else None}

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_app_insights_list_components(
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Application Insights components in a subscription or resource group (typed SDK).
    Returns app_id (for query), instrumentation_key, location, and kind.

    Args:
        subscription_id: Azure subscription ID
        resource_group: Optional resource group filter
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = ApplicationInsightsManagementClient(credential, sub_id)
        it = client.components.list_by_resource_group(resource_group) if resource_group else client.components.list()
        components = []
        for c in it:
            components.append({
                "name": c.name,
                "id": c.id,
                "app_id": getattr(c, "app_id", None),
                "instrumentation_key": getattr(c, "instrumentation_key", None),
                "location": c.location,
                "kind": getattr(c, "kind", None),
                "application_type": getattr(c, "application_type", None),
                "retention_in_days": getattr(c, "retention_in_days", None),
            })
        return {"success": True, "count": len(components), "components": components, "executed_as": user_info}
    except Exception as e:
        return {"success": False, "error": str(e), "executed_as": user_info if 'user_info' in dir() else None}

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_app_insights_query(
    app_id: str,
    kql_query: str,
    timespan_hours: Optional[int] = 24,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Run a KQL query against an Application Insights component (typed SDK).
    App Insights shares the Log Analytics query engine, so we use LogsQueryClient
    against the component's resource ID. Use for app-level telemetry queries:
    requests, dependencies, exceptions, traces, customEvents, pageViews.

    Args:
        app_id: Full ARM resource ID of the App Insights component
                (e.g. /subscriptions/{id}/resourceGroups/{rg}/providers/microsoft.insights/components/{name})
                Get it from azure_app_insights_list_components (the `id` field).
        kql_query: KQL query string, e.g. "requests | take 50"
        timespan_hours: Query timespan in hours (default 24)
    """
    try:
        credential, user_info = require_user_token(meta)
        client = LogsQueryClient(credential)
        response = client.query_resource(
            resource_id=app_id,
            query=kql_query,
            timespan=timedelta(hours=timespan_hours or 24),
        )
        if response.status == LogsQueryStatus.PARTIAL:
            tables = response.partial_data
            error = str(response.partial_error) if response.partial_error else None
        else:
            tables = response.tables
            error = None
        if not tables:
            return {"success": True, "columns": [], "rows": [], "row_count": 0, "error": error, "executed_as": user_info}
        t = tables[0]
        columns = [c for c in t.columns]
        rows = [list(r) for r in t.rows]
        return {
            "success": True,
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "error": error,
            "executed_as": user_info,
        }
    except Exception as e:
        return {"success": False, "error": str(e), "executed_as": user_info if 'user_info' in dir() else None}

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_policy_list_compliance_states(
    subscription_id: Optional[str] = None,
    top: Optional[int] = 200,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure Policy compliance states for all resources in a subscription (typed SDK).
    Returns per-resource compliance results: policy assignment, policy definition,
    compliance state (Compliant / NonCompliant), and resource details.
    Use for governance audits, compliance reporting, and drift detection (UC-028).

    Args:
        subscription_id: Azure subscription ID
        top: Max number of records to return (default 200)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = PolicyInsightsClient(credential)
        results = []
        it = client.policy_states.list_query_results_for_subscription(
            policy_states_resource="latest",
            subscription_id=sub_id,
        )
        for i, s in enumerate(it):
            if i >= (top or 200):
                break
            results.append({
                "resource_id": getattr(s, "resource_id", None),
                "resource_type": getattr(s, "resource_type", None),
                "resource_group": getattr(s, "resource_group", None),
                "resource_location": getattr(s, "resource_location", None),
                "policy_assignment_id": getattr(s, "policy_assignment_id", None),
                "policy_assignment_name": getattr(s, "policy_assignment_name", None),
                "policy_definition_id": getattr(s, "policy_definition_id", None),
                "policy_definition_name": getattr(s, "policy_definition_name", None),
                "compliance_state": getattr(s, "compliance_state", None),
                "is_compliant": getattr(s, "is_compliant", None),
                "timestamp": str(getattr(s, "timestamp", None)) if getattr(s, "timestamp", None) else None,
            })
        compliant = sum(1 for r in results if r.get("compliance_state") == "Compliant")
        non_compliant = sum(1 for r in results if r.get("compliance_state") == "NonCompliant")
        return {
            "success": True,
            "count": len(results),
            "compliant_count": compliant,
            "non_compliant_count": non_compliant,
            "compliance_states": results,
            "executed_as": user_info,
        }
    except Exception as e:
        return {"success": False, "error": str(e), "executed_as": user_info if 'user_info' in dir() else None}

# =============================================================================
# End of typed-create block. To expose a new Azure resource type, add a new
# typed tool above following the same pattern: strongly-typed args, idempotent
# upsert where the SDK supports it, sensible defaults, and a rich docstring
# with parameter examples + "chain with" hints.
# =============================================================================

# =============================================================================
# AZURE AI FOUNDRY DEPLOYMENT MANAGEMENT
# =============================================================================

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_list_deployments(
    resource_group: str,
    account_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List all Azure AI Foundry / Azure OpenAI deployments on a resource.

    Args:
        resource_group: Azure resource group name
        account_name: Azure OpenAI / AI Foundry account name
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        deployments = list(client.deployments.list(resource_group, account_name))
        results = []
        for d in deployments:
            results.append({
                "name": d.name,
                "model": d.properties.model.name if d.properties and d.properties.model else "unknown",
                "model_version": d.properties.model.version if d.properties and d.properties.model else "",
                "scale_type": d.sku.name if d.sku else "unknown",
                "capacity": d.sku.capacity if d.sku else 0,
                "status": d.properties.provisioning_state if d.properties else "unknown",
            })

        return {
            "success": True,
            "deployments": results,
            "count": len(results),
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_create_deployment(
    resource_group: str,
    account_name: str,
    deployment_name: str,
    model_name: str,
    model_version: str = "",
    sku_name: str = "GlobalStandard",
    sku_capacity: int = 1,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create a new Azure AI Foundry / Azure OpenAI model deployment.

    Args:
        resource_group: Azure resource group name
        account_name: Azure OpenAI / AI Foundry account name
        deployment_name: Name for the new deployment
        model_name: Model to deploy (e.g. gpt-4o, o3-mini)
        model_version: Model version (latest if empty)
        sku_name: SKU type (GlobalStandard, Standard, ProvisionedManaged)
        sku_capacity: Capacity units (TPM in thousands for Standard)
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        from azure.mgmt.cognitiveservices.models import Deployment, DeploymentModel, Sku

        client = CognitiveServicesManagementClient(credential, sub_id)

        deployment = Deployment(
            sku=Sku(name=sku_name, capacity=sku_capacity),
            properties={"model": DeploymentModel(name=model_name, version=model_version or None, format="OpenAI")},
        )

        result = client.deployments.begin_create_or_update(
            resource_group, account_name, deployment_name, deployment
        ).result()

        return {
            "success": True,
            "status": "created",
            "name": result.name,
            "model": model_name,
            "provisioning_state": result.properties.provisioning_state if result.properties else "unknown",
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": True,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-destructive",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "averageLatencyMs": 5000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_delete_deployment(
    resource_group: str,
    account_name: str,
    deployment_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Delete an Azure AI Foundry / Azure OpenAI deployment.

    Args:
        resource_group: Azure resource group name
        account_name: Azure OpenAI / AI Foundry account name
        deployment_name: Deployment to delete
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        client.deployments.begin_delete(resource_group, account_name, deployment_name).result()

        return {
            "success": True,
            "status": "deleted",
            "deployment": deployment_name,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_get_deployment_status(
    resource_group: str,
    account_name: str,
    deployment_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get status and details of an Azure AI Foundry / Azure OpenAI deployment.

    Args:
        resource_group: Azure resource group name
        account_name: Azure OpenAI / AI Foundry account name
        deployment_name: Deployment name to check
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID

        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        d = client.deployments.get(resource_group, account_name, deployment_name)

        result = {
            "success": True,
            "name": d.name,
            "provisioning_state": d.properties.provisioning_state if d.properties else "unknown",
            "model": d.properties.model.name if d.properties and d.properties.model else "unknown",
            "model_version": d.properties.model.version if d.properties and d.properties.model else "",
            "scale_type": d.sku.name if d.sku else "unknown",
            "capacity": d.sku.capacity if d.sku else 0,
            "rate_limits": [],
            "executed_as": user_info,
        }

        if d.properties and hasattr(d.properties, 'rate_limits') and d.properties.rate_limits:
            for rl in d.properties.rate_limits:
                result["rate_limits"].append({
                    "key": rl.key,
                    "renewal_period": rl.renewal_period,
                    "count": rl.count,
                })

        return result
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# =============================================================================
# AIF — Project / Model / Deployment-scale management (#675)
# =============================================================================
#
# Tools added 2026-05-07 (#675) for full ML-platform control. The earlier
# deployment-quartet (aif_list_deployments / aif_create_deployment /
# aif_delete_deployment / aif_get_deployment_status) covers per-deployment
# CRUD. These add the remaining surface:
#
#   Projects (data-plane via azure-ai-projects):
#     - aif_list_projects       : list AIF projects on an account
#     - aif_get_project         : one project's details
#     - aif_create_project      : create a project
#     - aif_delete_project      : delete a project
#
#   Models (catalog via management-plane CognitiveServicesManagementClient):
#     - aif_list_models         : list models available to the account
#     - aif_get_model           : one model's metadata
#     - aif_list_model_versions : version list for one model
#     - aif_get_model_version   : one model-version's details
#
#   Deployment scaling/update (management-plane):
#     - aif_scale_deployment    : change SKU tier / capacity
#     - aif_update_deployment   : update model / version on a deployment
#
# All run as the calling user via require_user_token(meta) — no SP /
# managed identity / fallback creds, matching the rest of this server.

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_list_projects(
    resource_group: str,
    account_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List AI Foundry projects on an account.

    Use when the user asks "list my AIF projects", "show AI Foundry projects",
    "what projects do I have in <account>". Returns
    {success, count, projects:[{name, id, location, description}], executed_as}.
    Backed by the data-plane SDK (azure-ai-projects); falls back to a graceful
    diagnostic when the SDK isn't installed in this image.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image. "
                         "Add it to requirements.txt and rebuild the MCP to enable Project management.",
            }
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential)
        projects = await _in_thread(lambda: list(client.projects.list()))
        return {
            "success": True,
            "count": len(projects),
            "projects": [
                {
                    "name": getattr(p, "name", None),
                    "id": getattr(p, "id", None),
                    "location": getattr(p, "location", None),
                    "description": getattr(p, "description", None),
                }
                for p in projects
            ],
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_get_project(
    resource_group: str,
    account_name: str,
    project_id: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get one AI Foundry project's details by id (or name).

    Use when the user asks "show me project X details", "describe AIF project Y",
    "what's the status of project Z". Returns
    {success, project:{name, id, location, description, properties}, executed_as}.
    Data-plane SDK call (azure-ai-projects).

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        project_id: Project id or name
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image.",
            }
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential)
        p = await _in_thread(lambda: client.projects.get(project_id))
        return {
            "success": True,
            "project": {
                "name": getattr(p, "name", None),
                "id": getattr(p, "id", None),
                "location": getattr(p, "location", None),
                "description": getattr(p, "description", None),
                "properties": getattr(p, "properties", {}) if hasattr(p, "properties") else {},
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_create_project(
    resource_group: str,
    account_name: str,
    project_name: str,
    description: str = "",
    location: str = "",
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create an AI Foundry project on an account.

    Use when the user asks "create AIF project named X", "make a new AI Foundry
    project under <account>", "spin up project Y for our team". Returns
    {success, status:'created', project:{name, id}, executed_as}. Data-plane
    SDK call (azure-ai-projects.projects.create).

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        project_name: Display name for the new project
        description: Optional description
        location: Region (defaults to the account's region when empty)
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image.",
            }
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential)
        project = await _in_thread(
            lambda: client.projects.create(
                name=project_name,
                description=description or None,
                location=location or account.location,
            )
        )
        return {
            "success": True,
            "status": "created",
            "project": {
                "name": getattr(project, "name", project_name),
                "id": getattr(project, "id", None),
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": True,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-destructive",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "averageLatencyMs": 5000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_delete_project(
    resource_group: str,
    account_name: str,
    project_id: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Delete an AI Foundry project by id.

    Use when the user asks "delete AIF project X", "remove project Y from my
    account", "tear down the foo project". Returns
    {success, status:'deleted', project_id, executed_as}. Data-plane SDK
    call (azure-ai-projects.projects.delete).

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        project_id: Project id (from aif_list_projects)
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image.",
            }
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential)
        await _in_thread(lambda: client.projects.delete(project_id))
        return {
            "success": True,
            "status": "deleted",
            "project_id": project_id,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_list_models(
    resource_group: str,
    account_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List models available in an AIF / Azure OpenAI account catalog.

    Use when the user asks "what models are available in <account>", "list AIF
    models", "show me the OpenAI model catalog on this resource". Returns
    {success, count, models:[{name, format, source, capabilities}], executed_as}.
    Backed by management-plane
    `cognitiveservices.models.client.accounts.list_models(rg, account)`.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Cognitive Services account name
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)
        models = await _in_thread(lambda: list(client.accounts.list_models(resource_group, account_name)))
        results = []
        for m in models:
            mm = getattr(m, "model", None)
            results.append({
                "name": getattr(mm, "name", None) if mm else None,
                "version": getattr(mm, "version", None) if mm else None,
                "format": getattr(mm, "format", None) if mm else None,
                "source": getattr(mm, "source", None) if mm else None,
                "capabilities": getattr(m, "capabilities", {}) or {},
                "lifecycle_status": getattr(m, "lifecycle_status", None),
                "is_default_version": getattr(m, "is_default_version", None),
            })
        return {
            "success": True,
            "count": len(results),
            "models": results,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_get_model(
    resource_group: str,
    account_name: str,
    model_id: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get one model's catalog entry (default version) from an AIF account.

    Use when the user asks "describe model gpt-4o on <account>", "show me details
    of <model>", "what's the lifecycle status of <model>". Returns
    {success, model:{name, version, format, capabilities, lifecycle_status,
    is_default_version}, executed_as}. Resolves by filtering the management-plane
    `accounts.list_models` response (the management API returns the catalog
    list rather than a per-model GET).

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Cognitive Services account name
        model_id: Model name (e.g. 'gpt-4o', 'text-embedding-3-large')
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)
        models = await _in_thread(lambda: list(client.accounts.list_models(resource_group, account_name)))
        for m in models:
            mm = getattr(m, "model", None)
            if mm and getattr(mm, "name", None) == model_id and getattr(m, "is_default_version", False):
                return {
                    "success": True,
                    "model": {
                        "name": getattr(mm, "name", None),
                        "version": getattr(mm, "version", None),
                        "format": getattr(mm, "format", None),
                        "source": getattr(mm, "source", None),
                        "capabilities": getattr(m, "capabilities", {}) or {},
                        "lifecycle_status": getattr(m, "lifecycle_status", None),
                        "is_default_version": True,
                    },
                    "executed_as": user_info,
                }
        # Fall back to first match if no default-version row exists
        for m in models:
            mm = getattr(m, "model", None)
            if mm and getattr(mm, "name", None) == model_id:
                return {
                    "success": True,
                    "model": {
                        "name": getattr(mm, "name", None),
                        "version": getattr(mm, "version", None),
                        "format": getattr(mm, "format", None),
                        "source": getattr(mm, "source", None),
                        "capabilities": getattr(m, "capabilities", {}) or {},
                        "lifecycle_status": getattr(m, "lifecycle_status", None),
                        "is_default_version": getattr(m, "is_default_version", False),
                    },
                    "executed_as": user_info,
                }
        return {"success": False, "error": f"Model {model_id} not found in account {account_name}"}
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_list_model_versions(
    resource_group: str,
    account_name: str,
    model_id: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List all versions for one model in an AIF account catalog.

    Use when the user asks "what versions of gpt-4o are available", "list
    versions for model X", "show me model-Y version history on <account>".
    Returns {success, model_id, count, versions:[{version, format, source,
    capabilities, lifecycle_status, is_default_version}], executed_as}.
    Filters the management-plane `accounts.list_models` response by name.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Cognitive Services account name
        model_id: Model name to enumerate versions for
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)
        models = await _in_thread(lambda: list(client.accounts.list_models(resource_group, account_name)))
        versions = []
        for m in models:
            mm = getattr(m, "model", None)
            if not mm or getattr(mm, "name", None) != model_id:
                continue
            versions.append({
                "version": getattr(mm, "version", None),
                "format": getattr(mm, "format", None),
                "source": getattr(mm, "source", None),
                "capabilities": getattr(m, "capabilities", {}) or {},
                "lifecycle_status": getattr(m, "lifecycle_status", None),
                "is_default_version": getattr(m, "is_default_version", False),
            })
        return {
            "success": True,
            "model_id": model_id,
            "count": len(versions),
            "versions": versions,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_get_model_version(
    resource_group: str,
    account_name: str,
    model_id: str,
    version: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Get one specific (model, version) pair's catalog entry.

    Use when the user asks "describe gpt-4o version 2024-05-13", "show me
    version X of model Y on <account>", "is version Z still in lifecycle".
    Returns {success, model:{name, version, format, capabilities,
    lifecycle_status, is_default_version}, executed_as}. Filters
    `accounts.list_models` by (name, version).

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Cognitive Services account name
        model_id: Model name (e.g. 'gpt-4o')
        version: Model version (e.g. '2024-05-13')
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)
        models = await _in_thread(lambda: list(client.accounts.list_models(resource_group, account_name)))
        for m in models:
            mm = getattr(m, "model", None)
            if mm and getattr(mm, "name", None) == model_id and getattr(mm, "version", None) == version:
                return {
                    "success": True,
                    "model": {
                        "name": getattr(mm, "name", None),
                        "version": getattr(mm, "version", None),
                        "format": getattr(mm, "format", None),
                        "source": getattr(mm, "source", None),
                        "capabilities": getattr(m, "capabilities", {}) or {},
                        "lifecycle_status": getattr(m, "lifecycle_status", None),
                        "is_default_version": getattr(m, "is_default_version", False),
                    },
                    "executed_as": user_info,
                }
        return {"success": False, "error": f"Model {model_id} version {version} not found in account {account_name}"}
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_scale_deployment(
    resource_group: str,
    account_name: str,
    deployment_name: str,
    sku_name: str = "",
    capacity: int = 0,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Scale an AIF deployment — change SKU tier and/or TPM capacity in-place.

    Use when the user asks "scale deployment X to Y TPM", "bump capacity on
    deployment Z to N", "change SKU on deployment W to GlobalStandard". Existing
    model + version are preserved. Returns
    {success, status:'scaled', name, sku_name, capacity, provisioning_state,
    executed_as}. Calls
    `cognitiveservices.deployments.client.deployments.begin_create_or_update`
    with merged sku + existing model.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Azure OpenAI account name
        deployment_name: Deployment to scale
        sku_name: New SKU (GlobalStandard / Standard / ProvisionedManaged) — keep current if empty
        capacity: New capacity units (TPM in thousands) — keep current if 0
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        from azure.mgmt.cognitiveservices.models import Deployment, DeploymentModel, Sku
        client = CognitiveServicesManagementClient(credential, sub_id)

        existing = await _in_thread(lambda: client.deployments.get(resource_group, account_name, deployment_name))
        existing_model = existing.properties.model if existing.properties and existing.properties.model else None
        existing_sku = existing.sku
        if not existing_model:
            return {"success": False, "error": f"Deployment {deployment_name} has no model property; cannot scale"}

        new_sku_name = sku_name or (existing_sku.name if existing_sku else "Standard")
        new_capacity = capacity or (existing_sku.capacity if existing_sku else 1)
        new_deployment = Deployment(
            sku=Sku(name=new_sku_name, capacity=new_capacity),
            properties={"model": DeploymentModel(
                name=getattr(existing_model, "name", None),
                version=getattr(existing_model, "version", None),
                format=getattr(existing_model, "format", "OpenAI"),
            )},
        )
        result = await _in_thread(
            lambda: client.deployments.begin_create_or_update(
                resource_group, account_name, deployment_name, new_deployment
            ).result()
        )
        return {
            "success": True,
            "status": "scaled",
            "name": result.name,
            "sku_name": new_sku_name,
            "capacity": new_capacity,
            "provisioning_state": result.properties.provisioning_state if result.properties else "unknown",
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_update_deployment(
    resource_group: str,
    account_name: str,
    deployment_name: str,
    model_name: str = "",
    model_version: str = "",
    sku_name: str = "",
    capacity: int = 0,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Update an AIF deployment — swap model, version, SKU, and/or capacity.

    Use when the user asks "update deployment X to use gpt-4o-mini", "switch
    deployment Y to model Z version W", "upgrade my deployment to the latest
    model version". Empty fields keep the existing value. Returns
    {success, status:'updated', name, model, model_version, sku_name, capacity,
    provisioning_state, executed_as}. Calls
    `cognitiveservices.deployments.client.deployments.begin_create_or_update`.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Azure OpenAI account name
        deployment_name: Deployment to update
        model_name: New model (e.g. gpt-4o-mini) — keep current if empty
        model_version: New model version — keep current if empty
        sku_name: New SKU — keep current if empty
        capacity: New capacity (TPM thousands) — keep current if 0
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        from azure.mgmt.cognitiveservices.models import Deployment, DeploymentModel, Sku
        client = CognitiveServicesManagementClient(credential, sub_id)

        existing = await _in_thread(lambda: client.deployments.get(resource_group, account_name, deployment_name))
        existing_model = existing.properties.model if existing.properties and existing.properties.model else None
        existing_sku = existing.sku

        new_model_name = model_name or (getattr(existing_model, "name", None) if existing_model else None)
        new_model_version = model_version or (getattr(existing_model, "version", None) if existing_model else None)
        new_format = (getattr(existing_model, "format", "OpenAI") if existing_model else "OpenAI")
        new_sku_name = sku_name or (existing_sku.name if existing_sku else "Standard")
        new_capacity = capacity or (existing_sku.capacity if existing_sku else 1)
        if not new_model_name:
            return {"success": False, "error": f"Deployment {deployment_name} has no model_name; pass model_name explicitly"}

        new_deployment = Deployment(
            sku=Sku(name=new_sku_name, capacity=new_capacity),
            properties={"model": DeploymentModel(
                name=new_model_name,
                version=new_model_version or None,
                format=new_format,
            )},
        )
        result = await _in_thread(
            lambda: client.deployments.begin_create_or_update(
                resource_group, account_name, deployment_name, new_deployment
            ).result()
        )
        return {
            "success": True,
            "status": "updated",
            "name": result.name,
            "model": new_model_name,
            "model_version": new_model_version,
            "sku_name": new_sku_name,
            "capacity": new_capacity,
            "provisioning_state": result.properties.provisioning_state if result.properties else "unknown",
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# =============================================================================
# AIF — Project / Resource overview + Responsible AI Guardrails + Agents
# =============================================================================
#
# Tools added 2026-04-26 (#72) to round out AIF management. Existing
# deployment tools above (aif_list_deployments / aif_create_deployment /
# aif_delete_deployment / aif_get_deployment_status) cover model
# provisioning. These add:
#   - aif_project_status     : single-call overview of an AIF account
#   - aif_list_guardrails    : Responsible AI policies on the account
#   - aif_create_guardrail   : create / update an RAI policy
#   - aif_delete_guardrail   : delete an RAI policy
#   - aif_list_agents        : Agent service agents (preview)
#   - aif_create_agent       : create an Agent service agent
#   - aif_delete_agent       : delete an Agent service agent
#
# All run as the calling user via require_user_token(meta) — no SP /
# managed identity / fallback creds, matching the rest of this server.

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 5000,
        "failureModes": ["auth_expired"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_project_status(
    resource_group: str,
    account_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """One-shot overview of an Azure AI Foundry account: location, SKU,
    provisioning state, capabilities, deployment count, RAI policy count,
    and quota usage.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry / Cognitive Services account name
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        account = await _in_thread(lambda: client.accounts.get(resource_group, account_name))
        deployments = await _in_thread(lambda: list(client.deployments.list(resource_group, account_name)))
        # RAI policies live under the same account; some SDK versions expose
        # them as `rai_policies` and older ones do not. Tolerate either.
        rai_policies: List[Any] = []
        try:
            if hasattr(client, "rai_policies"):
                rai_policies = await _in_thread(lambda: list(client.rai_policies.list(resource_group, account_name)))
        except Exception as e:
            logger.debug(f"[aif_project_status] rai_policies.list skipped: {e}")

        usages: List[Dict[str, Any]] = []
        try:
            location = account.location
            for u in await _in_thread(lambda: list(client.usages.list(location))):
                usages.append({
                    "name": getattr(u.name, "value", None) if u.name else None,
                    "current_value": getattr(u, "current_value", None),
                    "limit": getattr(u, "limit", None),
                    "unit": getattr(u, "unit", None),
                })
        except Exception as e:
            logger.debug(f"[aif_project_status] usages.list skipped: {e}")

        return {
            "success": True,
            "account": {
                "name": account.name,
                "location": account.location,
                "kind": account.kind,
                "sku": account.sku.name if account.sku else None,
                "provisioning_state": getattr(account.properties, "provisioning_state", None) if account.properties else None,
                "endpoint": getattr(account.properties, "endpoint", None) if account.properties else None,
                "tags": account.tags or {},
            },
            "deployment_count": len(deployments),
            "deployments": [
                {
                    "name": d.name,
                    "model": d.properties.model.name if d.properties and d.properties.model else None,
                    "provisioning_state": d.properties.provisioning_state if d.properties else None,
                }
                for d in deployments
            ],
            "guardrail_count": len(rai_policies),
            "guardrails": [{"name": p.name} for p in rai_policies],
            "quota_usages": usages,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_list_guardrails(
    resource_group: str,
    account_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List Responsible-AI content-safety policies (guardrails) on an
    Azure AI Foundry / Cognitive Services account.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        if not hasattr(client, "rai_policies"):
            return {
                "success": False,
                "error": "RAI policy management not available in this azure-mgmt-cognitiveservices version. "
                         "Upgrade the SDK to expose client.rai_policies."
            }
        policies = await _in_thread(lambda: list(client.rai_policies.list(resource_group, account_name)))
        return {
            "success": True,
            "count": len(policies),
            "policies": [
                {
                    "name": p.name,
                    "type": getattr(p, "type", None),
                    "mode": getattr(p.properties, "mode", None) if getattr(p, "properties", None) else None,
                    "base_policy_name": getattr(p.properties, "base_policy_name", None) if getattr(p, "properties", None) else None,
                }
                for p in policies
            ],
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_create_guardrail(
    resource_group: str,
    account_name: str,
    policy_name: str,
    base_policy_name: str = "Microsoft.Default",
    mode: str = "Default",
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create or update a Responsible-AI content-safety policy on an
    Azure AI Foundry account.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        policy_name: New policy name
        base_policy_name: Inherits filters from this base (default: "Microsoft.Default")
        mode: 'Default' / 'Asynchronous_filter' / 'Deferred'
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        if not hasattr(client, "rai_policies"):
            return {
                "success": False,
                "error": "RAI policy management not available in this azure-mgmt-cognitiveservices version."
            }

        body = {
            "properties": {
                "basePolicyName": base_policy_name,
                "mode": mode,
            }
        }
        result = await _in_thread(
            lambda: client.rai_policies.create_or_update(resource_group, account_name, policy_name, body)
        )
        return {
            "success": True,
            "status": "created_or_updated",
            "name": result.name if hasattr(result, "name") else policy_name,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": True,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-destructive",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "averageLatencyMs": 5000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_delete_guardrail(
    resource_group: str,
    account_name: str,
    policy_name: str,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Delete a Responsible-AI content-safety policy from an AIF account.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        policy_name: Policy to delete
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}

        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        client = CognitiveServicesManagementClient(credential, sub_id)

        if not hasattr(client, "rai_policies"):
            return {
                "success": False,
                "error": "RAI policy management not available in this azure-mgmt-cognitiveservices version."
            }
        await _in_thread(lambda: client.rai_policies.delete(resource_group, account_name, policy_name))
        return {"success": True, "status": "deleted", "policy": policy_name, "executed_as": user_info}
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_list_agents(
    resource_group: str,
    account_name: str,
    project_name: str = "",
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """List AI Foundry Agent-service agents under a project (preview).

    A2S = Agent-to-System: a connected agent definition that wires a model
    deployment to a set of tools / functions / data sources. Implementation
    requires the data-plane SDK; this tool surfaces a graceful diagnostic
    when the runtime SDK isn't available so the admin UI can degrade.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        project_name: AIF project (data-plane scope) — required by the SDK
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        # The Agent service is a data-plane API; the management-plane
        # CognitiveServicesManagementClient does not expose it. The
        # Azure SDK ships a separate package
        # `azure.ai.projects` for this; we attempt an import and bail
        # gracefully if it isn't installed in this MCP image.
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image. "
                         "Add it to requirements.txt and rebuild the MCP to enable Agent management.",
            }
        # Resolve endpoint via management plane
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential, project_name=project_name or account_name)
        agents = await _in_thread(lambda: list(client.agents.list_agents()))
        return {
            "success": True,
            "count": len(agents),
            "agents": [
                {
                    "id": getattr(a, "id", None),
                    "name": getattr(a, "name", None),
                    "model": getattr(a, "model", None),
                    "instructions": getattr(a, "instructions", None),
                }
                for a in agents
            ],
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_create_agent(
    resource_group: str,
    account_name: str,
    agent_name: str,
    model: str,
    instructions: str,
    project_name: str = "",
    tools: Optional[List[Dict[str, Any]]] = None,
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create an AI Foundry Agent-service agent (A2S — Agent-to-System).

    Wires a deployed model to a set of tools / data sources via the
    AI Foundry data-plane SDK. Returns the new agent's id.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        agent_name: Display name for the agent
        model: Deployment name of the underlying model (must exist on the account)
        instructions: System prompt / instructions
        project_name: AIF project (defaults to account_name when empty)
        tools: Optional list of tool definitions (function/code-interpreter/file-search)
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image. "
                         "Add it to requirements.txt and rebuild the MCP to enable Agent management.",
            }
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential, project_name=project_name or account_name)
        agent = await _in_thread(
            lambda: client.agents.create_agent(
                model=model,
                name=agent_name,
                instructions=instructions,
                tools=tools or [],
            )
        )
        return {
            "success": True,
            "status": "created",
            "id": getattr(agent, "id", None),
            "name": getattr(agent, "name", agent_name),
            "model": model,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": True,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-destructive",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "free",
        "averageLatencyMs": 5000,
        "failureModes": ["not_found", "auth_expired", "rate_limited", "conflict"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def aif_delete_agent(
    resource_group: str,
    account_name: str,
    agent_id: str,
    project_name: str = "",
    subscription_id: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Delete an AI Foundry Agent-service agent by id.

    Args:
        resource_group: Azure resource group name
        account_name: Azure AI Foundry account name
        agent_id: Agent id (from aif_list_agents)
        project_name: AIF project (defaults to account_name when empty)
        subscription_id: Azure subscription ID (uses default if empty)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "No subscription_id provided and no default configured"}
        try:
            from azure.ai.projects import AIProjectClient  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "azure-ai-projects SDK not installed in this image.",
            }
        from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
        mgmt = CognitiveServicesManagementClient(credential, sub_id)
        account = await _in_thread(lambda: mgmt.accounts.get(resource_group, account_name))
        endpoint = getattr(account.properties, "endpoint", None) if account.properties else None
        if not endpoint:
            return {"success": False, "error": f"AIF account {account_name} has no endpoint configured"}
        client = AIProjectClient(endpoint=endpoint, credential=credential, project_name=project_name or account_name)
        await _in_thread(lambda: client.agents.delete_agent(agent_id))
        return {"success": True, "status": "deleted", "agent_id": agent_id, "executed_as": user_info}
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# =============================================================================
# STARTUP
# =============================================================================

# Add shared module to path for http_transport
import sys
import os
# In Docker container: /app/src/server.py, shared is at /app/shared/
# So from __file__ (/app/src/server.py), go to parent (/app/src), then parent (/app), then shared
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'shared'))
# Also add /app/shared directly in case we're running from /app
sys.path.insert(0, '/app/shared')

# =============================================================================
# v0.6.1 ENTERPRISE-SCALE TOOLS — issue #287
# =============================================================================
# These tools cover the failing client queries that need cross-subscription /
# cross-tenant / large-result-set capabilities. The pattern is:
#   1. Use Azure Resource Graph (KQL) for anything that needs to span subs
#      because it's MUCH faster and handles pagination natively
#   2. Use the dedicated mgmt clients for typed/structured operations
#   3. Always accept explicit subscription_id (and tenant_id where relevant)
#      so the LLM can target specific scopes the user names in their query
#   4. Always paginate large responses with max_results + continuation_token
#      so a single query can return 10k+ resources without OOMing the LLM
# =============================================================================

# ----------------------------------------------------------------------------
# Azure Resource Graph — single source for cross-subscription resource queries
# ----------------------------------------------------------------------------

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_resource_graph_query(
    query: str,
    subscriptions: Optional[List[str]] = None,
    management_groups: Optional[List[str]] = None,
    max_results: int = 5000,
    max_pages: int = 10,
    skip_token: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Run a KQL query against Azure Resource Graph. THIS IS THE PREFERRED TOOL
    for any question about resources spanning multiple subscriptions, resource
    groups, or types — Resource Graph indexes ALL of Azure's ARM data and
    handles pagination natively.

    ENTERPRISE-SCALE AUTO-PAGINATION: the tool loops through skip_token pages
    internally and returns the UNION of results up to `max_results`. You don't
    need to manage pagination in your prompt chain — just issue the query and
    the tool handles fan-out. Default `max_results=5000` (5 pages of 1000),
    bump to 50000+ for tenant-wide audits.

    CROSS-SUBSCRIPTION: omit `subscriptions` to query ALL subscriptions the
    service principal has access to. Use `management_groups` to scope by MG
    hierarchy. Either way, a single query covers 100+ subs in one call.

    Use this for questions like:
      - "List all public-facing resources across ALL subscriptions"
      - "Find every VM tagged env=prod in the tenant"
      - "Which storage accounts have public network access enabled?"
      - "Count resources per type per subscription"
      - "Find all resources in resource groups matching ocio-omcp-*"

    Args:
        query: KQL query string. Examples:
            Resources | where type =~ 'microsoft.compute/virtualmachines' | project name, location, subscriptionId
            Resources | where properties.publicNetworkAccess == 'Enabled' | summarize count() by type, subscriptionId
            ResourceContainers | where type == 'microsoft.resources/subscriptions/resourcegroups' | where name startswith 'ocio-'
        subscriptions: List of subscription IDs to scope the query to. Omit for ALL accessible subs.
        management_groups: List of management group IDs to scope to. Omit to use subscription scope.
        max_results: Total rows to return across all pages (default 5000, uncapped by Resource Graph — bump for tenant audits).
        max_pages: Safety cap on pagination loop iterations (default 10 × 1000 rows per page = 10k).
        skip_token: Resume from a specific page token (rarely needed — the tool auto-paginates).

    Returns:
        {success, data: [...all rows...], count, total_records, pages_fetched,
         truncated (True if hit max_results/max_pages), next_skip_token, executed_as}

    KQL primer:
        - Tables: Resources, ResourceContainers, AdvisorResources, SecurityResources, etc
        - Common ops: where, project, summarize, count, distinct, join, extend
        - String matching: ==, =~ (case-insensitive), contains, startswith, endswith, matches regex
        - Arrays: array_length, mv-expand
        - Aggregation (do this server-side, not in LLM): summarize count() by subscriptionId
    """
    try:
        credential, user_info = require_user_token(meta)
        client = ResourceGraphClient(credential)

        PAGE_SIZE = 1000  # Resource Graph hard maximum per page
        all_rows: List[Any] = []
        current_skip = skip_token
        pages_fetched = 0
        total_records = None
        truncated = False
        effective_max = max(1, max_results)
        effective_max_pages = max(1, max_pages)

        # Auto-pagination loop — keep fetching until we hit max_results, max_pages,
        # or Resource Graph returns no more pages. The LLM never sees the pagination
        # machinery.
        while True:
            request_options = QueryRequestOptions(
                top=PAGE_SIZE,
                skip_token=current_skip,
                result_format="objectArray",
            )
            request = QueryRequest(
                query=query,
                subscriptions=subscriptions,
                management_groups=management_groups,
                options=request_options,
            )
            response = client.resources(request)
            page_data = response.data if hasattr(response, 'data') else []
            if total_records is None:
                total_records = getattr(response, 'total_records', None)

            if isinstance(page_data, list):
                # Respect the max_results cap even if the page puts us over
                remaining = effective_max - len(all_rows)
                if remaining <= 0:
                    truncated = True
                    break
                if len(page_data) > remaining:
                    all_rows.extend(page_data[:remaining])
                    truncated = True
                    break
                all_rows.extend(page_data)

            pages_fetched += 1
            current_skip = getattr(response, 'skip_token', None)

            if not current_skip:
                # Resource Graph says no more pages
                break
            if pages_fetched >= effective_max_pages:
                truncated = True
                break
            if len(all_rows) >= effective_max:
                truncated = True
                break

        return {
            "success": True,
            "query": query,
            "count": len(all_rows),
            "total_records": total_records,
            "pages_fetched": pages_fetched,
            "truncated": truncated,
            "next_skip_token": current_skip if truncated else None,
            "data": all_rows,
            "scoped_to": {
                "subscriptions": subscriptions or "all accessible",
                "management_groups": management_groups,
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_resource_graph_query_tenant_wide(
    query: str,
    max_results: int = 50000,
    subscription_filter: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Run a KQL Resource Graph query across EVERY subscription the service principal
    can see — in ONE call. Use this for any question that should span the
    whole tenant: "find all X", "list biggest Y across all subs", "count Z
    by subscription", etc.

    Implementation: Azure Resource Graph already handles tenant-wide scope
    natively when the `subscriptions` filter is omitted — the service uses
    the service principal to enumerate every accessible subscription server-side.
    This tool just delegates to that path with auto-pagination up to
    `max_results` rows. NO client-side sub enumeration, NO batching, NO
    fan-out loops — all of that used to be here and caused 120s timeouts
    because it serialized through the sync Azure SDK.

    Args:
        query: KQL query string (same format as azure_resource_graph_query).
               Tip: `| summarize count() by subscriptionId` for per-sub counts.
        max_results: Total rows to return across all pages (default 50000).
        subscription_filter: Optional substring to filter subscription NAMES.
                             When set, the tool enumerates subs, filters by
                             display name, and then runs a scoped query.
                             Omit to query every accessible sub (faster).

    Returns:
        {success, query, total_rows, data: [...], pages_fetched, executed_as}
    """
    try:
        credential, user_info = require_user_token(meta)
        client = ResourceGraphClient(credential)

        # Optional: name-filtered sub enumeration
        scoped_sub_ids: Optional[List[str]] = None
        if subscription_filter:
            sub_client = SubscriptionClient(credential)
            scoped_sub_ids = [
                sub.subscription_id
                for sub in sub_client.subscriptions.list()
                if sub.subscription_id
                and subscription_filter.lower() in (sub.display_name or '').lower()
            ]
            if not scoped_sub_ids:
                return {
                    "success": True,
                    "query": query,
                    "total_rows": 0,
                    "data": [],
                    "pages_fetched": 0,
                    "note": f"No subscriptions matched filter '{subscription_filter}'",
                    "executed_as": user_info,
                }

        PAGE_SIZE = 1000
        all_rows: List[Any] = []
        current_skip = None
        pages_fetched = 0
        effective_max = max(1, max_results)

        while True:
            request_options = QueryRequestOptions(
                top=PAGE_SIZE,
                skip_token=current_skip,
                result_format="objectArray",
            )
            request = QueryRequest(
                query=query,
                subscriptions=scoped_sub_ids,  # None → tenant scope via service principal
                options=request_options,
            )
            response = client.resources(request)
            page_data = response.data if hasattr(response, 'data') else []
            if isinstance(page_data, list):
                remaining = effective_max - len(all_rows)
                if remaining <= 0:
                    break
                if len(page_data) > remaining:
                    all_rows.extend(page_data[:remaining])
                    break
                all_rows.extend(page_data)
            pages_fetched += 1
            current_skip = getattr(response, 'skip_token', None)
            if not current_skip or len(all_rows) >= effective_max:
                break

        return {
            "success": True,
            "query": query,
            "total_rows": len(all_rows),
            "pages_fetched": pages_fetched,
            "data": all_rows,
            "scope": "tenant-wide" if not scoped_sub_ids else f"{len(scoped_sub_ids)} subs matching '{subscription_filter}'",
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my public facing resources", "show me public facing resources", "what public facing resources do i have"],
        "testFixture": None,
    },
)
async def azure_list_public_facing_resources(
    subscription_id: Optional[str] = None,
    include_types: Optional[List[str]] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List all PUBLIC-FACING Azure resources in a subscription. Built on top of
    Resource Graph for accurate, indexed results across all resource types.

    Detects exposure via:
      - Public IP address attached
      - Public network access enabled (storage, kv, sql, cosmos, etc)
      - App Services with public hostnames
      - Front Door / App Gateway / Load Balancer with public frontends
      - AKS clusters with public API server

    Args:
        subscription_id: Single subscription to scope to (uses default if not specified)
        include_types: Optional whitelist of ARM types to filter (e.g. ['microsoft.compute/virtualmachines'])
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        # KQL union: any of the public-exposure indicators
        kql = """
        Resources
        | where (
            (type =~ 'microsoft.network/publicipaddresses' and isnotempty(properties.ipAddress))
            or (type =~ 'microsoft.web/sites' and properties.publicNetworkAccess !~ 'Disabled')
            or (type =~ 'microsoft.network/applicationgateways' and array_length(properties.frontendIPConfigurations) > 0)
            or (type =~ 'microsoft.network/frontdoors')
            or (type =~ 'microsoft.cdn/profiles')
            or (type =~ 'microsoft.network/loadbalancers' and properties.frontendIPConfigurations[0].properties.publicIPAddress != '')
            or (type =~ 'microsoft.containerservice/managedclusters' and properties.apiServerAccessProfile.enablePrivateCluster != true)
            or (type =~ 'microsoft.storage/storageaccounts' and properties.publicNetworkAccess !~ 'Disabled')
            or (type =~ 'microsoft.keyvault/vaults' and properties.publicNetworkAccess !~ 'Disabled')
            or (type =~ 'microsoft.sql/servers' and properties.publicNetworkAccess !~ 'Disabled')
            or (type =~ 'microsoft.documentdb/databaseaccounts' and properties.publicNetworkAccess !~ 'Disabled')
        )
        | project name, type, location, resourceGroup, subscriptionId, id, exposure_reason = case(
            type =~ 'microsoft.network/publicipaddresses', strcat('Public IP: ', tostring(properties.ipAddress)),
            type =~ 'microsoft.web/sites', strcat('App Service public access: ', tostring(properties.defaultHostName)),
            type =~ 'microsoft.network/applicationgateways', 'Application Gateway with public frontend',
            type =~ 'microsoft.network/frontdoors', 'Azure Front Door',
            type =~ 'microsoft.cdn/profiles', 'CDN Profile',
            type =~ 'microsoft.network/loadbalancers', 'Public Load Balancer',
            type =~ 'microsoft.containerservice/managedclusters', 'AKS public API server',
            type =~ 'microsoft.storage/storageaccounts', 'Storage public network access enabled',
            type =~ 'microsoft.keyvault/vaults', 'Key Vault public network access enabled',
            type =~ 'microsoft.sql/servers', 'SQL Server public network access enabled',
            type =~ 'microsoft.documentdb/databaseaccounts', 'Cosmos DB public access enabled',
            'Other'
        )
        """
        if include_types:
            type_filter = " or ".join([f"type =~ '{t}'" for t in include_types])
            kql += f"\n| where {type_filter}"
        kql += "\n| order by type asc, name asc"

        client = ResourceGraphClient(credential)
        request = QueryRequest(
            query=kql,
            subscriptions=[sub_id],
            options=QueryRequestOptions(top=1000, result_format="objectArray"),
        )
        response = client.resources(request)
        data = response.data if hasattr(response, 'data') else []

        # Group by type for the summary
        by_type: Dict[str, int] = {}
        for r in data:
            t = r.get('type', 'unknown')
            by_type[t] = by_type.get(t, 0) + 1

        return {
            "success": True,
            "subscription_id": sub_id,
            "total_count": len(data),
            "count_by_type": by_type,
            "resources": data,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# ----------------------------------------------------------------------------
# Management Groups — tenant hierarchy + cross-sub discovery
# ----------------------------------------------------------------------------

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my management groups", "show me management groups", "what management groups do i have"],
        "testFixture": None,
    },
)
async def azure_list_management_groups(
    tenant_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List all management groups visible to the user in the tenant.

    Args:
        tenant_id: Optional tenant ID. If omitted, uses the user's home tenant.

    Returns hierarchy: management groups can contain other MGs and subscriptions.
    """
    try:
        credential, user_info = require_user_token(meta)
        client = ManagementGroupsAPI(credential)
        groups = list(client.management_groups.list())
        return {
            "success": True,
            "tenant_id": tenant_id or user_info.get("tid"),
            "count": len(groups),
            "management_groups": [
                {
                    "id": g.id,
                    "name": g.name,
                    "display_name": g.display_name,
                    "type": g.type,
                    "tenant_id": g.tenant_id if hasattr(g, 'tenant_id') else None,
                }
                for g in groups
            ],
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my subscriptions in management group", "show me subscriptions in management group", "what subscriptions in management group do i have"],
        "testFixture": None,
    },
)
async def azure_list_subscriptions_in_management_group(
    management_group_id: str,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List all subscriptions under a specific management group. Use this to answer
    questions like "list the subscriptions in management group Platform-Engineering-MG".

    The management_group_id can be either:
      - The short name (e.g. "Platform-Engineering-MG")
      - The full ARM ID (e.g. "/providers/Microsoft.Management/managementGroups/Platform-Engineering-MG")

    Args:
        management_group_id: The management group identifier (name or full ARM path).
    """
    try:
        credential, user_info = require_user_token(meta)
        client = ManagementGroupsAPI(credential)

        # Strip ARM prefix if user supplied the full path
        mg_name = management_group_id.split('/')[-1] if management_group_id.startswith('/') else management_group_id

        # Use Resource Graph to find all subscriptions in this MG (most reliable approach)
        rg_client = ResourceGraphClient(credential)
        kql = f"""
        ResourceContainers
        | where type == 'microsoft.resources/subscriptions'
        | extend mgs = properties.managementGroupAncestorsChain
        | mv-expand mgs
        | where tostring(mgs.name) == '{mg_name}'
        | project subscriptionId, name, displayName = properties.displayName, state = properties.state
        """
        request = QueryRequest(query=kql, options=QueryRequestOptions(top=1000, result_format="objectArray"))
        response = rg_client.resources(request)
        subs = response.data if hasattr(response, 'data') else []

        return {
            "success": True,
            "management_group_id": mg_name,
            "count": len(subs),
            "subscriptions": subs,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# ----------------------------------------------------------------------------
# Web Apps & Function Apps — runtime config (Python version etc)
# ----------------------------------------------------------------------------

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my web apps", "show me web apps", "what web apps do i have"],
        "testFixture": None,
    },
)
async def azure_list_web_apps(
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    runtime_filter: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure Web Apps and Function Apps in a subscription / resource group,
    INCLUDING their runtime stack and version (Python 3.11, Node 20, .NET 8, etc).

    Use this to answer questions like:
      - "List the web apps in resource group X that use Python and show the Python versions"
      - "Which function apps in subscription Y are on Node 18?"

    Args:
        subscription_id: Required scope.
        resource_group: Optional RG filter.
        runtime_filter: Optional filter on runtime name (case-insensitive substring,
            e.g. "python", "node", "dotnet"). Returns ONLY apps matching the filter.
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        client = WebSiteManagementClient(credential, sub_id)
        apps_iter = client.web_apps.list_by_resource_group(resource_group) if resource_group else client.web_apps.list()
        apps = list(apps_iter)

        result = []
        for app in apps:
            app_name = app.name
            rg = app.resource_group or resource_group or 'unknown'
            kind = app.kind or ''
            is_function = 'functionapp' in (kind or '').lower()

            # Get runtime config — needs a separate API call per app
            try:
                config = client.web_apps.get_configuration(rg, app_name)
                # Extract runtime from various possible fields
                linux_fx = (config.linux_fx_version or '').strip()  # e.g. "PYTHON|3.11"
                windows_fx = (config.windows_fx_version or '').strip()
                python_version = (config.python_version or '').strip()
                node_version = (config.node_version or '').strip()
                java_version = (config.java_version or '').strip()
                net_framework = (config.net_framework_version or '').strip()
                php_version = (config.php_version or '').strip()

                # Pick the most informative runtime string
                runtime = linux_fx or windows_fx or ''
                if not runtime:
                    parts = []
                    if python_version: parts.append(f"PYTHON|{python_version}")
                    if node_version: parts.append(f"NODE|{node_version}")
                    if java_version: parts.append(f"JAVA|{java_version}")
                    if net_framework: parts.append(f"DOTNET|{net_framework}")
                    if php_version: parts.append(f"PHP|{php_version}")
                    runtime = ", ".join(parts) if parts else 'unknown'

                runtime_lower = runtime.lower()
                if runtime_filter and runtime_filter.lower() not in runtime_lower:
                    continue

                result.append({
                    "name": app_name,
                    "resource_group": rg,
                    "kind": kind,
                    "is_function_app": is_function,
                    "location": app.location,
                    "state": app.state,
                    "default_hostname": app.default_host_name,
                    "runtime": runtime,
                    "linux_fx_version": linux_fx or None,
                    "windows_fx_version": windows_fx or None,
                    "python_version": python_version or None,
                    "node_version": node_version or None,
                    "java_version": java_version or None,
                })
            except Exception as cfg_err:
                # Still include the app, just with runtime=error
                result.append({
                    "name": app_name,
                    "resource_group": rg,
                    "kind": kind,
                    "is_function_app": is_function,
                    "location": app.location,
                    "state": app.state,
                    "default_hostname": app.default_host_name,
                    "runtime": "error",
                    "config_error": str(cfg_err)[:200],
                })

        return {
            "success": True,
            "subscription_id": sub_id,
            "resource_group": resource_group,
            "runtime_filter": runtime_filter,
            "count": len(result),
            "apps": result,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# ----------------------------------------------------------------------------
# Azure Advisor — security/cost/performance recommendations
# ----------------------------------------------------------------------------

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 5000,
        "failureModes": ["auth_expired"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_advisor_recommendations(
    subscription_id: Optional[str] = None,
    category: Optional[str] = None,
    impact: Optional[str] = None,
    max_results: int = 200,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List Azure Advisor recommendations for a subscription. Covers cost savings,
    security findings, performance, operational excellence, and reliability.

    Use this to answer questions like:
      - "List Azure Advisor security recommendations for subscription X"
      - "What cost savings can CBO leverage in subscription Y?"
      - "Show high-impact reliability recommendations across subscription Z"

    Args:
        subscription_id: Required scope.
        category: Filter by category. One of: 'Cost', 'Security', 'Performance',
            'OperationalExcellence', 'HighAvailability'. Omit for all.
        impact: Filter by impact level. One of: 'High', 'Medium', 'Low'. Omit for all.
        max_results: Cap on results (default 200).
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        client = AdvisorManagementClient(credential, sub_id)
        recs_iter = client.recommendations.list()

        result = []
        count = 0
        for rec in recs_iter:
            if count >= max_results:
                break
            props = rec.as_dict() if hasattr(rec, 'as_dict') else {}
            cat = (props.get('category') or '').lower()
            imp = (props.get('impact') or '').lower()
            if category and cat != category.lower():
                continue
            if impact and imp != impact.lower():
                continue
            result.append({
                "id": rec.id,
                "category": props.get('category'),
                "impact": props.get('impact'),
                "impacted_field": props.get('impacted_field'),
                "impacted_value": props.get('impacted_value'),
                "last_updated": props.get('last_updated'),
                "short_description": (props.get('short_description') or {}).get('problem'),
                "solution": (props.get('short_description') or {}).get('solution'),
                "metadata": props.get('metadata'),
                "extended_properties": props.get('extended_properties'),
            })
            count += 1

        # Group by category for the summary
        by_category: Dict[str, int] = {}
        by_impact: Dict[str, int] = {}
        for r in result:
            c = r.get('category') or 'Unknown'
            i = r.get('impact') or 'Unknown'
            by_category[c] = by_category.get(c, 0) + 1
            by_impact[i] = by_impact.get(i, 0) + 1

        return {
            "success": True,
            "subscription_id": sub_id,
            "count": len(result),
            "filters": {"category": category, "impact": impact},
            "summary": {"by_category": by_category, "by_impact": by_impact},
            "recommendations": result,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# ----------------------------------------------------------------------------
# Service Health — current and historical Azure incidents
# ----------------------------------------------------------------------------

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 5000,
        "failureModes": ["auth_expired"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_service_health_events(
    regions: Optional[List[str]] = None,
    event_types: Optional[List[str]] = None,
    event_levels: Optional[List[str]] = None,
    days_back: int = 0,
    subscription_id: Optional[str] = None,
    max_results: int = 500,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Query Azure Service Health events (current incidents and historical issues)
    for one or more regions, filtered by type and severity.

    Use this to answer questions like:
      - "List current Azure Service Issues for the East US region"
      - "Provide the total number of warning-level service issues for East US, West US, Central US"
      - "List Azure Service Issues from the past 6 months in East US, East US2 with event level warning"

    Args:
        regions: List of Azure region names (e.g. ['eastus', 'eastus2', 'westus', 'centralus']).
            Omit for all regions.
        event_types: Filter by event type. Common: 'ServiceIssue', 'PlannedMaintenance',
            'HealthAdvisory', 'SecurityAdvisory'. Omit for all.
        event_levels: Filter by severity. Common: 'Critical', 'Warning', 'Informational'.
            Omit for all. Match is case-insensitive.
        days_back: How many days of history to include. 0 = active events only,
            180 = past 6 months, etc. Maximum 365.
        subscription_id: Required for the events list endpoint scope.
        max_results: Cap on returned events.

    Returns events with: id, name, type, level, status, region, start_time, end_time,
    title, summary, impact_summary, impact_details.
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        # Use the ARM REST API for service health events because the Python SDK
        # for Microsoft.ResourceHealth events is incomplete. ARM REST is well-supported.
        import requests
        token = credential.get_token("https://management.azure.com/.default").token

        # Time filter
        time_filter = ""
        if days_back > 0:
            from datetime import timezone
            cutoff = (datetime.now(timezone.utc) - timedelta(days=min(days_back, 365))).strftime("%Y-%m-%dT%H:%M:%SZ")
            time_filter = f"&$filter=properties/lastUpdateTime ge '{cutoff}'"

        url = f"https://management.azure.com/subscriptions/{sub_id}/providers/Microsoft.ResourceHealth/events?api-version=2022-10-01{time_filter}"
        all_events: List[Dict[str, Any]] = []
        next_url: Optional[str] = url
        normalized_regions = {r.lower().replace(' ', '') for r in (regions or [])}
        normalized_levels = {l.lower() for l in (event_levels or [])}
        normalized_types = {t.lower() for t in (event_types or [])}

        while next_url and len(all_events) < max_results:
            resp = await asyncio.to_thread(
                requests.get, next_url, headers={"Authorization": f"Bearer {token}"}, timeout=30
            )
            if resp.status_code != 200:
                return {
                    "success": False,
                    "error": f"Service Health API returned {resp.status_code}: {resp.text[:500]}",
                    "executed_as": user_info,
                }
            payload = resp.json()
            for event in payload.get("value", []):
                if len(all_events) >= max_results:
                    break
                props = event.get("properties", {})
                event_type = (props.get("eventType") or "").lower()
                event_level = (props.get("eventLevel") or "").lower()
                if normalized_types and event_type not in normalized_types:
                    continue
                if normalized_levels and event_level not in normalized_levels:
                    continue
                # Region filter — events have impact arrays per-service-per-region
                impacts = props.get("impact", []) or []
                event_regions = set()
                for impact in impacts:
                    for region_impact in impact.get("impactedRegions", []) or []:
                        rname = (region_impact.get("impactedRegion") or "").lower().replace(' ', '')
                        if rname:
                            event_regions.add(rname)
                if normalized_regions and not (event_regions & normalized_regions):
                    continue
                all_events.append({
                    "id": event.get("id"),
                    "name": event.get("name"),
                    "event_type": props.get("eventType"),
                    "event_level": props.get("eventLevel"),
                    "status": props.get("status"),
                    "title": props.get("title"),
                    "summary": props.get("summary"),
                    "impact_summary": props.get("impactSummary"),
                    "impact_details": props.get("impact"),
                    "regions": sorted(event_regions),
                    "start_time": props.get("impactStartTime"),
                    "last_update_time": props.get("lastUpdateTime"),
                    "is_hir": props.get("isHIR"),
                    "tracking_id": props.get("trackingId"),
                })
            next_url = payload.get("nextLink")

        # Build summary counts by region+level
        region_level_counts: Dict[str, Dict[str, int]] = {}
        for ev in all_events:
            lvl = ev.get("event_level") or "Unknown"
            for r in ev.get("regions", []) or ["unknown"]:
                if r not in region_level_counts:
                    region_level_counts[r] = {}
                region_level_counts[r][lvl] = region_level_counts[r].get(lvl, 0) + 1

        return {
            "success": True,
            "subscription_id": sub_id,
            "filters": {
                "regions": regions,
                "event_types": event_types,
                "event_levels": event_levels,
                "days_back": days_back,
            },
            "count": len(all_events),
            "summary": {"by_region_and_level": region_level_counts},
            "events": all_events,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# ----------------------------------------------------------------------------
# Azure Front Door — issue #287 explicit requirement
# ----------------------------------------------------------------------------

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["list my front doors", "show me front doors", "what front doors do i have"],
        "testFixture": None,
    },
)
async def azure_list_front_doors(
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    List ALL Azure Front Door profiles across the subscription — covers both
    the legacy "Classic" Front Door (Microsoft.Network/frontdoors) AND modern
    "Standard/Premium" Front Door (Microsoft.Cdn/profiles with AzureFrontDoor SKU).
    Uses Azure Resource Graph under the hood for unified discovery.

    Use this to:
      - Verify a Front Door you just created (`azure_create_front_door`).
      - Audit existing global edges before designing a new one.
      - Tell Classic from Standard/Premium — each `tier` field is set
        ("Classic" | "Standard" | "Premium").

    Args:
        subscription_id: Optional override.
        resource_group: Optional — scope to one RG instead of the whole sub.

    Returns:
        { success, count, front_doors: [
            { name, type, tier, location, resourceGroup, id, sku, properties }
          ], executed_as
        }

    Pair with: `azure_get_front_door(name, resource_group)` for one-profile
               detail (endpoint host, origin groups, origins, routes).
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        # Use Resource Graph for unified Classic + Standard/Premium discovery
        rg_filter = f"and resourceGroup =~ '{resource_group}'" if resource_group else ""
        kql = f"""
        Resources
        | where type =~ 'microsoft.network/frontdoors' or type =~ 'microsoft.cdn/profiles'
        | where subscriptionId == '{sub_id}' {rg_filter}
        | extend tier = case(
            type =~ 'microsoft.network/frontdoors', 'Classic',
            type =~ 'microsoft.cdn/profiles' and sku.name startswith 'Standard_AzureFrontDoor', 'Standard',
            type =~ 'microsoft.cdn/profiles' and sku.name startswith 'Premium_AzureFrontDoor', 'Premium',
            'CDN'
        )
        | project name, type, tier, location, resourceGroup, id, sku = sku.name, properties
        """
        client = ResourceGraphClient(credential)
        request = QueryRequest(query=kql, subscriptions=[sub_id], options=QueryRequestOptions(top=1000, result_format="objectArray"))
        response = client.resources(request)
        return {
            "success": True,
            "subscription_id": sub_id,
            "count": len(response.data) if hasattr(response, 'data') else 0,
            "front_doors": response.data,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["get front door details", "show me one front door"],
        "testFixture": None,
    },
)
async def azure_get_front_door(
    name: str,
    resource_group: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get detailed configuration for a specific Front Door profile, including
    routing rules, backend pools, frontend hosts, WAF policies, and health probes.

    Args:
        name: Front Door name
        resource_group: Resource group containing the Front Door
        subscription_id: Subscription scope
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        # Try Standard/Premium (microsoft.cdn) first, fall back to Classic (microsoft.network)
        import requests
        token = credential.get_token("https://management.azure.com/.default").token
        headers = {"Authorization": f"Bearer {token}"}

        # Standard/Premium AFD
        std_url = f"https://management.azure.com/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Cdn/profiles/{name}?api-version=2023-05-01"
        resp = await asyncio.to_thread(requests.get, std_url, headers=headers, timeout=20)
        if resp.status_code == 200:
            return {"success": True, "tier": "Standard/Premium", "front_door": resp.json(), "executed_as": user_info}

        # Classic AFD
        cls_url = f"https://management.azure.com/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/frontDoors/{name}?api-version=2021-06-01"
        resp = await asyncio.to_thread(requests.get, cls_url, headers=headers, timeout=20)
        if resp.status_code == 200:
            return {"success": True, "tier": "Classic", "front_door": resp.json(), "executed_as": user_info}

        return {"success": False, "error": f"Front Door '{name}' not found in resource group '{resource_group}'", "executed_as": user_info}
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

# ----------------------------------------------------------------------------
# Cost forecast — extended with resource_group scope
# ----------------------------------------------------------------------------

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_cost_forecast_for_resource_group(
    resource_group: str,
    forecast_days: int = 30,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Forecast cost for a specific resource group over the next N days.
    The original azure_cost_forecast tool only scopes to subscription level —
    this tool drops the scope down to a resource group.

    Use this for queries like "forecast monthly cost for resource group X in subscription Y".

    Args:
        resource_group: The resource group name
        forecast_days: Number of days to forecast (default 30)
        subscription_id: Subscription containing the RG
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        client = CostManagementClient(credential)
        from datetime import timezone
        start_date = datetime.now(timezone.utc)
        end_date = start_date + timedelta(days=forecast_days)

        query_def = {
            "type": "Usage",
            "timeframe": "Custom",
            "time_period": {
                "from": start_date.strftime("%Y-%m-%dT00:00:00Z"),
                "to": end_date.strftime("%Y-%m-%dT23:59:59Z")
            },
            "dataset": {
                "granularity": "Daily",
                "aggregation": {"totalCost": {"name": "Cost", "function": "Sum"}}
            }
        }

        scope = f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
        result = client.forecast.usage(scope, query_def)

        rows = result.rows or []
        forecasted_total = sum(row[0] for row in rows if len(row) > 0)
        return {
            "success": True,
            "subscription_id": sub_id,
            "resource_group": resource_group,
            "forecast_period": f"Next {forecast_days} days",
            "from_date": start_date.strftime("%Y-%m-%d"),
            "to_date": end_date.strftime("%Y-%m-%d"),
            "forecasted_total": round(forecasted_total, 2),
            "currency": "USD",
            "daily_data_points": len(rows),
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

try:
    from http_transport import run_with_http_support
    HTTP_TRANSPORT_AVAILABLE = True
except ImportError:
    HTTP_TRANSPORT_AVAILABLE = False

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_vnet(
    name: str,
    resource_group: str,
    location: str,
    address_space: str = "10.0.0.0/16",
    subnets: Optional[List[Dict[str, str]]] = None,
    subscription_id: Optional[str] = None,
    tags: Optional[Dict[str, str]] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Virtual Network (VNet) with one or more subnets in a single call.

    Use this when setting up the networking foundation for any multi-resource Azure
    scenario (VMs, AKS, App Gateway, container envs, private endpoints, etc.).
    The VNet's resource group must exist first — call `azure_create_resource_group` if needed.

    Args:
        name: VNet name. Alphanumeric + hyphens, 2-64 chars. Example: "vnet-demo-eastus".
        resource_group: Must already exist. Call `azure_create_resource_group` first.
        location: Azure region (must match the RG's region). Example: "eastus", "westus2".
        address_space: CIDR block for the whole VNet. Default "10.0.0.0/16" (65k IPs).
                       Use smaller blocks (e.g. "10.10.0.0/20") when peering many VNets.
        subnets: List of subnet dicts in format `[{"name": "...", "address_prefix": "x.x.x.x/y"}]`.
                 Defaults to a single "default" subnet at "10.0.0.0/24".
                 ENTERPRISE EXAMPLE (App Gateway + workloads + Azure Bastion):
                 [
                   {"name": "appgw-subnet",   "address_prefix": "10.0.1.0/24"},
                   {"name": "workload-subnet","address_prefix": "10.0.2.0/23"},
                   {"name": "AzureBastionSubnet", "address_prefix": "10.0.250.0/26"}
                 ]
                 NOTE: App Gateway v2 REQUIRES a dedicated /24 or larger subnet with no
                 other resources in it. Azure Bastion REQUIRES a subnet literally named
                 "AzureBastionSubnet" at /26 or larger.
        subscription_id: Optional override.
        tags: Optional tags.

    Returns:
        { success, vnet: { name, id, location, address_space, subnets: [{name, address_prefix}] },
          executed_as }

    Chain with: `azure_create_subnet` (add more subnets later),
                `azure_create_nsg` (secure subnets with inbound/outbound rules),
                `azure_create_app_gateway` (references a subnet by name),
                `azure_create_vm` (drops NIC into one of the subnets).
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = NetworkManagementClient(credential, sub_id)

        subnet_list = subnets or [{"name": "default", "address_prefix": "10.0.0.0/24"}]
        vnet_params = {
            "location": location,
            "tags": tags or {},
            "address_space": {"address_prefixes": [address_space]},
            "subnets": [{"name": s["name"], "address_prefix": s["address_prefix"]} for s in subnet_list],
        }
        vnet = await _in_thread(lambda: client.virtual_networks.begin_create_or_update(
            resource_group, name, vnet_params
        ).result())
        return {
            "success": True,
            "vnet": {
                "name": vnet.name, "id": vnet.id, "location": vnet.location,
                "address_space": [p for p in (vnet.address_space.address_prefixes if vnet.address_space else [])],
                "subnets": [{"name": s.name, "address_prefix": s.address_prefix} for s in (vnet.subnets or [])],
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_subnet(
    vnet_name: str,
    subnet_name: str,
    resource_group: str,
    address_prefix: str,
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Add a single subnet to an existing VNet. Use this when you need to extend
    a VNet with additional network segments after the initial VNet creation —
    for example, to add a dedicated App Gateway subnet, Bastion subnet,
    Private Endpoint subnet, or a new workload tier.

    For creating the VNet with subnets in one call, use `azure_create_vnet` with
    its `subnets` parameter instead — this tool is just for adding to existing VNets.

    Args:
        vnet_name: Existing VNet name.
        subnet_name: New subnet name. Common conventions:
                     - "appgw-subnet" / "gateway-subnet" — for App Gateway (/24 min, dedicated)
                     - "AzureBastionSubnet" — REQUIRED name for Bastion (/26 min)
                     - "workload-subnet" — for VMs / workloads
                     - "pe-subnet" — for Private Endpoints
        resource_group: VNet's resource group.
        address_prefix: CIDR range. MUST be within the VNet's address_space AND
                        non-overlapping with existing subnets.
                        Examples: "10.0.1.0/24" (256 IPs), "10.0.10.0/22" (1024 IPs).
        subscription_id: Optional override.

    Returns:
        { success, subnet: { name, id, address_prefix }, executed_as }

    Chain with: `azure_create_nsg` (then associate with subnet),
                `azure_create_app_gateway` (pass this subnet's name).
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = NetworkManagementClient(credential, sub_id)
        subnet = await _in_thread(lambda: client.subnets.begin_create_or_update(
            resource_group, vnet_name, subnet_name,
            {"address_prefix": address_prefix}
        ).result())
        return {
            "success": True,
            "subnet": {"name": subnet.name, "id": subnet.id, "address_prefix": subnet.address_prefix},
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_nsg(
    name: str,
    resource_group: str,
    location: str,
    rules: Optional[List[Dict[str, Any]]] = None,
    subscription_id: Optional[str] = None,
    tags: Optional[Dict[str, str]] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create a Network Security Group (NSG) with optional inbound / outbound
    security rules. NSGs are the equivalent of host-level firewalls and can
    be associated with subnets or NICs.

    Rules are evaluated in priority order (lowest priority wins), then the
    default rules apply. Always give each rule a unique priority in the
    100–4000 range.

    Args:
        name: NSG name. Example: "nsg-web-tier".
        resource_group: Must exist.
        location: Must match the resource group's region.
        rules: List of rule dicts. Each rule supports:
               - name: unique within the NSG (e.g., "Allow-HTTP-Internet")
               - priority: 100-4096, lower = evaluated first (default 1000)
               - direction: "Inbound" | "Outbound" (default "Inbound")
               - access: "Allow" | "Deny" (default "Allow")
               - protocol: "Tcp" | "Udp" | "Icmp" | "*" (default "Tcp")
               - source_address_prefix: "Internet" | "VirtualNetwork" | CIDR | "*"
               - destination_address_prefix: same options
               - source_port_range: "*" or number (default "*")
               - destination_port_range: "*" | "80" | "443" | "80,443" | "1000-2000"
               COMMON PATTERNS:
               • Public HTTPS: {name:"Allow-HTTPS", priority:100, protocol:"Tcp",
                 source_address_prefix:"Internet", destination_port_range:"443"}
               • App Gateway health probes: {name:"Allow-GWHealth", priority:110,
                 source_address_prefix:"GatewayManager", destination_port_range:"65200-65535"}
               • Block everything else: {name:"Deny-All-Inbound", priority:4096,
                 access:"Deny", source_address_prefix:"*", destination_address_prefix:"*",
                 destination_port_range:"*"}
        subscription_id: Optional override.
        tags: Optional tags.

    Returns:
        { success, nsg: { name, id, location, rules: [...] }, executed_as }

    Chain with: `azure_create_vnet` / `azure_create_subnet` (associate NSG
                with a subnet by configuring the subnet later), or attach to
                a NIC during VM creation.
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = NetworkManagementClient(credential, sub_id)

        security_rules = []
        for r in (rules or []):
            security_rules.append({
                "name": r["name"],
                "priority": r.get("priority", 1000),
                "direction": r.get("direction", "Inbound"),
                "access": r.get("access", "Allow"),
                "protocol": r.get("protocol", "Tcp"),
                "source_address_prefix": r.get("source_address_prefix", "*"),
                "destination_address_prefix": r.get("destination_address_prefix", "*"),
                "source_port_range": r.get("source_port_range", "*"),
                "destination_port_range": r.get("destination_port_range", "443"),
            })

        nsg_params = {
            "location": location,
            "tags": tags or {},
            "security_rules": security_rules,
        }
        nsg = await _in_thread(lambda: client.network_security_groups.begin_create_or_update(
            resource_group, name, nsg_params
        ).result())
        return {
            "success": True,
            "nsg": {
                "name": nsg.name, "id": nsg.id, "location": nsg.location,
                "rules": [{"name": r.name, "priority": r.priority, "direction": r.direction,
                           "access": r.access, "protocol": r.protocol}
                          for r in (nsg.security_rules or [])],
            },
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_app_gateway(
    name: str,
    resource_group: str,
    location: str,
    vnet_name: str,
    subnet_name: str,
    sku_name: str = "Standard_v2",
    sku_tier: str = "Standard_v2",
    capacity: int = 1,
    frontend_port: int = 80,
    backend_addresses: Optional[List[str]] = None,
    subscription_id: Optional[str] = None,
    tags: Optional[Dict[str, str]] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Application Gateway v2 with a public IP, a single HTTP
    listener, one backend pool (holds ALL your backend_addresses), one HTTP
    settings, and one routing rule. Supports 100+ backend endpoints in the
    single pool — perfect for fronting a large set of servers behind one L7.

    Provisioning takes 6-12 minutes (App Gateway v2 is slow). The call blocks
    until the gateway reaches a terminal provisioning state.

    PRE-REQUISITES (call these first if they don't exist):
      1. `azure_create_resource_group(name, location)`
      2. `azure_create_vnet(name=vnet_name, ..., subnets=[{"name": subnet_name,
           "address_prefix": "10.0.1.0/24"}])`  ← subnet must be DEDICATED to
           the App Gateway, /24 or larger, with NO OTHER resources in it.

    Args:
        name: App Gateway name. Alphanumeric + hyphens, 1-80 chars.
              Example: "agw-web-eastus".
        resource_group: Must already exist.
        location: Must match the VNet's region.
        vnet_name: Existing VNet name.
        subnet_name: Existing subnet in that VNet, DEDICATED for the gateway.
                     If shared with other resources, provisioning will fail.
        sku_name: "Standard_v2" for basic L7, or "WAF_v2" to enable Web
                  Application Firewall. Default "Standard_v2".
        sku_tier: Must match sku_name ("Standard_v2" or "WAF_v2").
        capacity: Fixed instance count, 1-10. Use 2+ for HA in prod.
                  Default 1 (dev/test). Auto-scaling requires different config
                  and is not supported by this tool — use capacity instead.
        frontend_port: Single listener port. Default 80 (HTTP). For HTTPS use 443
                       but then you also need a cert binding — not exposed here;
                       provision with port 80 first and add HTTPS via the portal
                       or a follow-up patch if needed.
        backend_addresses: List of backend IP addresses OR FQDNs. All go into one
                           backend pool. Enterprise scale examples:
                           • ["10.0.2.4", "10.0.2.5", ...100+ IPs for VM pool]
                           • ["app01.internal", "app02.internal", ...]
                           • ["my-apim.azure-api.net", "my-webapp.azurewebsites.net"]
                           Default: ["10.0.0.4"] (placeholder).
        subscription_id: Optional override.
        tags: Optional tags.

    Returns:
        {
          success, app_gateway: {
            name, id, location, sku (name, tier, capacity),
            provisioning_state,   ← "Succeeded" means ready
            frontend_ip,          ← public IP address (use this as Front Door origin!)
            backend_pool_count, rule_count
          },
          executed_as
        }

    Chain with:
      • `azure_create_front_door(origin_hostname=<frontend_ip or FQDN>)` to
        add a global edge in front of the gateway.
      • `azure_app_gateway_backend_health` to check that the pool members
        are reachable once the gateway is up.
      • `azure_get_app_gateway` to re-read full config.

    LIMITATIONS of this tool (by design — keep it simple):
      - Single backend pool, single listener, single routing rule.
      - For multi-path routing (e.g., /api/* → pool A, /static/* → pool B),
        path-based rules, URL rewrites, WAF policy attachment, SSL bindings:
        create the basic gateway here, then edit in the portal or via az cli
        (mention this limitation to the user).
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = NetworkManagementClient(credential, sub_id)

        subnet_id = (
            f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
            f"/providers/Microsoft.Network/virtualNetworks/{vnet_name}/subnets/{subnet_name}"
        )

        # Create a public IP for the App Gateway frontend
        # Public IP is fast — ~15s, safe to wait inline.
        pip_name = f"{name}-pip"
        pip = await _in_thread(lambda: client.public_ip_addresses.begin_create_or_update(
            resource_group, pip_name,
            {"location": location, "sku": {"name": "Standard"}, "public_ip_allocation_method": "Static"}
        ).result())
        # Capture the IP up front so we can return it even if we don't block on
        # App Gateway completion (see below).
        pip_ip_address = pip.ip_address

        backends = [{"ip_address": addr} for addr in (backend_addresses or ["10.0.0.4"])]

        agw_params = {
            "location": location,
            "tags": tags or {},
            "sku": {"name": sku_name, "tier": sku_tier, "capacity": capacity},
            "gateway_ip_configurations": [{
                "name": "appGatewayIpConfig",
                "subnet": {"id": subnet_id},
            }],
            "frontend_ip_configurations": [{
                "name": "appGatewayFrontendIP",
                "public_ip_address": {"id": pip.id},
            }],
            "frontend_ports": [{"name": "port_80", "port": frontend_port}],
            "backend_address_pools": [{"name": "defaultBackendPool", "backend_addresses": backends}],
            "backend_http_settings_collection": [{
                "name": "defaultHTTPSettings",
                "port": 80, "protocol": "Http",
                "cookie_based_affinity": "Disabled",
                "request_timeout": 30,
            }],
            "http_listeners": [{
                "name": "defaultListener",
                "frontend_ip_configuration": {
                    "id": f"/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/applicationGateways/{name}/frontendIPConfigurations/appGatewayFrontendIP"
                },
                "frontend_port": {
                    "id": f"/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/applicationGateways/{name}/frontendPorts/port_80"
                },
                "protocol": "Http",
            }],
            "request_routing_rules": [{
                "name": "defaultRule",
                "rule_type": "Basic",
                "priority": 100,
                "http_listener": {
                    "id": f"/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/applicationGateways/{name}/httpListeners/defaultListener"
                },
                "backend_address_pool": {
                    "id": f"/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/applicationGateways/{name}/backendAddressPools/defaultBackendPool"
                },
                "backend_http_settings": {
                    "id": f"/subscriptions/{sub_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/applicationGateways/{name}/backendHttpSettingsCollection/defaultHTTPSettings"
                },
            }],
        }
        # App Gateway v2 provisioning takes 6-12 minutes — longer than the typical
        # Azure AD access token lifetime remaining at dispatch time. If we block
        # on `.result()` the token can expire mid-LRO and we get ExpiredAuthenticationToken.
        # Instead: kick off the LRO, return immediately with the public IP and
        # "provisioning_state: Creating". The agent can call `azure_list_app_gateways`
        # or `azure_get_app_gateway` later to check completion.
        poller = await _in_thread(lambda: client.application_gateways.begin_create_or_update(
            resource_group, name, agw_params
        ))
        # At this point Azure has accepted the request (201 Accepted). The
        # gateway is being provisioned asynchronously. Don't block on
        # `.result()` — just return the initial status + known fields.
        initial_state = None
        try:
            if hasattr(poller, 'status'):
                initial_state = poller.status()
        except Exception:
            initial_state = None
        expected_agw_id = (
            f"/subscriptions/{sub_id}/resourceGroups/{resource_group}"
            f"/providers/Microsoft.Network/applicationGateways/{name}"
        )
        return {
            "success": True,
            "app_gateway": {
                "name": name,
                "id": expected_agw_id,
                "location": location,
                "sku": {"name": sku_name, "tier": sku_tier, "capacity": capacity},
                "provisioning_state": initial_state or "Creating",
                "frontend_ip": pip_ip_address,
                "backend_pool_count": 1,  # single default pool in this tool
                "rule_count": 1,          # single default rule
                "backend_address_count": len(backends),
            },
            "is_long_running": True,
            "async_poll_hint": f"Call azure_get_app_gateway(name='{name}', resource_group='{resource_group}') "
                               f"or azure_list_app_gateways(resource_group='{resource_group}') in 3-8 minutes "
                               f"to verify provisioning_state='Succeeded'.",
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-create",
        "hitlRisk": "high",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 30000,
        "failureModes": ["quota_exceeded", "auth_expired", "rate_limited", "conflict", "invalid_args"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_create_front_door(
    name: str,
    resource_group: str,
    sku: str = "Standard_AzureFrontDoor",
    origin_hostname: Optional[str] = None,
    subscription_id: Optional[str] = None,
    tags: Optional[Dict[str, str]] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create an Azure Front Door Standard/Premium profile. Front Door is a global
    L7 load balancer that sits at the Microsoft edge — clients get low-latency
    TLS termination + caching + WAF, then requests flow to your origins (which
    can be App Gateways, App Services, storage, or any public endpoint).

    This tool provisions: the PROFILE + a default ENDPOINT (host name is
    auto-generated, e.g. "my-fd-xxx.azurefd.net"). If you pass `origin_hostname`,
    it ALSO creates a default origin group + origin pointing to it with
    sensible health-probe and load-balancing defaults.

    Provisioning takes 1-3 minutes for the profile, another ~30s per child.

    PRE-REQUISITES:
      1. `azure_create_resource_group(name, location="global" or any region)`
         — Front Door profiles live at resource-group scope even though they're
         global; the RG location can be any region.

    Args:
        name: Front Door profile name. GLOBAL uniqueness NOT required (the
              endpoint host name has a random suffix). 2-64 chars, alphanumeric + hyphens.
              Example: "fd-enterprise-prod".
        resource_group: Must exist.
        sku: "Standard_AzureFrontDoor" (default) or "Premium_AzureFrontDoor".
             Premium adds: managed WAF, Private Link origins, bot protection.
             Use Premium for prod compliance scenarios; Standard for dev/test.
        origin_hostname: OPTIONAL. Public hostname or IP of the ORIGIN that
                         Front Door will forward requests to.
                         Common values:
                         • "<appgw-name>-pip.<region>.cloudapp.azure.com"  (App Gateway public IP FQDN)
                         • "<appservice>.azurewebsites.net"
                         • "<storage>.blob.core.windows.net"
                         • "<raw ip>"  (if your App Gateway uses a static IP)
                         If provided, origin_group "default-origin-group" and
                         origin "default-origin" are auto-wired with HTTP/80
                         + HTTPS/443 + health probe GET / on HTTPS every 60s.
                         If omitted, you'll need to add origins later via portal/CLI.
        subscription_id: Optional override.
        tags: Optional tags.

    Returns:
        {
          success,
          front_door: {
            name, id, sku, provisioning_state,
            endpoint,             ← e.g. "fd-xxx-a1b2c3.azurefd.net" — point DNS at this
            [origin_group],       ← only if origin_hostname was given
            [origin]              ← the hostname you passed
          },
          executed_as
        }

    Chain with:
      • `azure_list_front_doors` to verify the profile is visible.
      • `azure_get_front_door(profile_name=name)` to fetch full config incl. routes.
      • DNS: add a CNAME from your custom domain → the returned `endpoint`.
      • Custom-domain attachment + routing rules are currently portal-only from
        this tool — mention that to the user if needed.

    COMMON PATTERN (FD → App Gateway → VMs):
      1. `azure_create_app_gateway(...)` — returns `app_gateway.frontend_ip`.
      2. Front Door accepts that raw IP as `origin_hostname`, OR if you want a
         stable FQDN, provision the App Gateway with a DNS label set on its
         public IP (portal/CLI step today — not exposed via a typed tool).
      3. `azure_create_front_door(origin_hostname="<ip_or_fqdn_from_step_1>")`.
    """
    # Each sub-step wraps its own try/except so a child failure (e.g. endpoint
    # or origin-group hiccup) doesn't mask the fact that the PROFILE did land.
    # Gap 1 from docs/releases/0.6.5-evidence/temporal-plan-landing.md: FastMCP
    # surfaced INTERNAL_ERROR even when Azure CDN reported success, because the
    # Azure SDK occasionally raises non-AzureError exceptions from LRO polling.
    user_info: Optional[Dict[str, Any]] = None
    partial_errors: List[str] = []
    try:
        from azure.mgmt.cdn import CdnManagementClient
        from azure.mgmt.cdn.models import (
            Profile, Sku as CdnSku,
            AFDEndpoint,
            AFDOriginGroup, AFDOrigin,
            LoadBalancingSettingsParameters, HealthProbeParameters,
        )

        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        client = CdnManagementClient(credential, sub_id)

        # 1. PROFILE — if this fails, the whole tool fails.
        profile = await _in_thread(lambda: client.profiles.begin_create(
            resource_group, name,
            Profile(location="global", sku=CdnSku(name=sku), tags=tags or {})
        ).result())

        # 2. DEFAULT ENDPOINT — best-effort. If LRO flakes, fall back to a
        # verify-by-get after a short pause; Azure's control plane is eventually
        # consistent for child resources of a just-created profile.
        endpoint_name = f"{name}-endpoint"
        endpoint_host: Optional[str] = None
        try:
            endpoint = await _in_thread(lambda: client.afd_endpoints.begin_create(
                resource_group, name, endpoint_name,
                AFDEndpoint(location="global")
            ).result())
            endpoint_host = getattr(endpoint, "host_name", None)
        except Exception as e:
            partial_errors.append(f"endpoint_create: {type(e).__name__}: {e}")
            # Verify-by-get fallback: the create may have succeeded even though
            # the LRO poller raised. Give Azure 3s then probe.
            await asyncio.sleep(3)
            try:
                fetched = await _in_thread(lambda: client.afd_endpoints.get(
                    resource_group, name, endpoint_name
                ))
                endpoint_host = getattr(fetched, "host_name", None)
            except Exception:
                pass
        if not endpoint_host:
            endpoint_host = f"{endpoint_name}-<random>.z01.azurefd.net"

        result = {
            "success": True,
            "front_door": {
                "name": profile.name, "id": profile.id,
                "sku": profile.sku.name if profile.sku else None,
                "provisioning_state": profile.provisioning_state,
                "endpoint": endpoint_host,
            },
            "executed_as": user_info,
        }

        # 3. Optional origin group + origin — also best-effort.
        if origin_hostname:
            og_name = "default-origin-group"
            try:
                await _in_thread(lambda: client.afd_origin_groups.begin_create(
                    resource_group, name, og_name,
                    AFDOriginGroup(
                        load_balancing_settings=LoadBalancingSettingsParameters(
                            sample_size=4, successful_samples_required=3,
                            additional_latency_in_milliseconds=50,
                        ),
                        health_probe_settings=HealthProbeParameters(
                            probe_path="/", probe_protocol="Https",
                            probe_interval_in_seconds=60,
                        ),
                    )
                ).result())
                result["front_door"]["origin_group"] = og_name
            except Exception as e:
                partial_errors.append(f"origin_group_create: {type(e).__name__}: {e}")

            try:
                await _in_thread(lambda: client.afd_origins.begin_create(
                    resource_group, name, og_name, "default-origin",
                    AFDOrigin(host_name=origin_hostname, http_port=80, https_port=443)
                ).result())
                result["front_door"]["origin"] = origin_hostname
            except Exception as e:
                partial_errors.append(f"origin_create: {type(e).__name__}: {e}")

        if partial_errors:
            result["partial_errors"] = partial_errors
            result["note"] = "Profile landed. Non-fatal child-resource warnings — verify with azure_get_front_door."
        return result
    except ImportError:
        return {"success": False, "error": "azure-mgmt-cdn package not installed. pip install azure-mgmt-cdn"}
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info)
    except Exception as e:
        # Catch-all: broader than AzureError so we don't let random SDK
        # exceptions bubble up as FastMCP INTERNAL_ERROR. If the profile
        # might already exist, probe for it before declaring failure.
        try:
            from azure.mgmt.cdn import CdnManagementClient
            credential2, user_info2 = require_user_token(meta)
            probe_client = CdnManagementClient(credential2, subscription_id or DEFAULT_SUBSCRIPTION_ID)
            fetched_profile = await _in_thread(lambda: probe_client.profiles.get(resource_group, name))
            return {
                "success": True,
                "front_door": {
                    "name": fetched_profile.name,
                    "id": fetched_profile.id,
                    "sku": fetched_profile.sku.name if fetched_profile.sku else None,
                    "provisioning_state": fetched_profile.provisioning_state,
                    "endpoint": f"{name}-endpoint-<random>.z01.azurefd.net",
                },
                "executed_as": user_info2,
                "note": f"Creation raised {type(e).__name__} but profile exists — treating as success.",
                "partial_errors": [f"{type(e).__name__}: {e}"],
            }
        except Exception:
            return {"success": False, "error": f"{type(e).__name__}: {e}", "executed_as": user_info}

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-mutate",
        "hitlRisk": "medium",
        "requiresConsent": True,
        "cost": "metered",
        "averageLatencyMs": 5000,
        "failureModes": ["auth_expired"],
        "goldenPrompts": [],
        "testFixture": None,
    },
)
async def azure_activity_log(
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    hours: int = 24,
    filter_operations: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Query Azure Activity Log (audit log) for recent operations.

    Returns create, delete, update, and action events from the Azure
    control plane. Use this to see what changed in your tenant.

    Args:
        subscription_id: Subscription to query
        resource_group: Optional — filter to a specific resource group
        hours: How many hours back to look (default 24)
        filter_operations: Optional comma-separated operation filter
            (e.g., 'Microsoft.Resources/subscriptions/resourceGroups/write,Microsoft.Compute/virtualMachines/delete')
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        if not sub_id:
            return {"success": False, "error": "subscription_id required"}

        client = MonitorManagementClient(credential, sub_id)

        from datetime import datetime, timedelta, timezone
        end_time = datetime.now(timezone.utc)
        start_time = end_time - timedelta(hours=hours)

        # Build OData filter
        odata_filter = f"eventTimestamp ge '{start_time.isoformat()}' and eventTimestamp le '{end_time.isoformat()}'"
        if resource_group:
            odata_filter += f" and resourceGroupName eq '{resource_group}'"

        events = []
        for event in client.activity_logs.list(filter=odata_filter):
            op = event.operation_name.value if event.operation_name else ''
            if filter_operations:
                allowed = [o.strip().lower() for o in filter_operations.split(',')]
                if not any(a in op.lower() for a in allowed):
                    continue
            events.append({
                "timestamp": event.event_timestamp.isoformat() if event.event_timestamp else None,
                "operation": op,
                "status": event.status.value if event.status else None,
                "resource_id": event.resource_id,
                "resource_type": event.resource_type.value if event.resource_type else None,
                "resource_group": event.resource_group_name,
                "caller": event.caller,
                "level": event.level.value if event.level else None,
                "description": event.description,
            })
            if len(events) >= 500:
                break

        # Categorize
        creates = [e for e in events if e['operation'] and ('write' in e['operation'].lower() or 'create' in e['operation'].lower()) and e['status'] == 'Succeeded']
        deletes = [e for e in events if e['operation'] and 'delete' in e['operation'].lower() and e['status'] == 'Succeeded']
        failures = [e for e in events if e['status'] and e['status'] != 'Succeeded']

        return {
            "success": True,
            "subscription_id": sub_id,
            "time_range": f"Last {hours} hours",
            "total_events": len(events),
            "summary": {
                "creates_and_updates": len(creates),
                "deletes": len(deletes),
                "failures": len(failures),
            },
            "events": events[:100],  # Return first 100 for display
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

@mcp.tool(
    annotations={
        "destructiveHint": False,
        "readOnlyHint": True,
        "idempotentHint": True,
        "openWorldHint": True,
    },
    meta={
        "category": "cloud-list",
        "hitlRisk": "low",
        "requiresConsent": False,
        "cost": "free",
        "averageLatencyMs": 1500,
        "failureModes": ["not_found", "auth_expired", "rate_limited"],
        "goldenPrompts": ["get metrics details", "show me one metrics"],
        "testFixture": None,
    },
)
async def azure_get_metrics(
    resource_id: str,
    metric_names: str = "Percentage CPU",
    timespan: str = "PT1H",
    interval: str = "PT5M",
    aggregation: str = "Average",
    subscription_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get Azure Monitor metrics for any resource.

    Works with VMs, App Gateways, Front Door, Storage, AKS, etc.

    Args:
        resource_id: Full ARM resource ID (e.g., /subscriptions/.../resourceGroups/.../providers/...)
        metric_names: Comma-separated metric names.
            VMs: 'Percentage CPU', 'Available Memory Bytes', 'Network In Total'
            App GW: 'TotalRequests', 'HealthyHostCount', 'UnhealthyHostCount', 'Throughput'
            Front Door: 'RequestCount', 'TotalLatency', 'WebApplicationFirewallRequestCount'
            Storage: 'UsedCapacity', 'Transactions', 'Ingress', 'Egress'
        timespan: ISO 8601 duration — PT1H (1 hour), PT24H (24 hours), P7D (7 days)
        interval: Granularity — PT1M, PT5M, PT15M, PT1H
        aggregation: Average, Total, Maximum, Minimum, Count
        subscription_id: Subscription (extracted from resource_id if not provided)
    """
    try:
        credential, user_info = require_user_token(meta)
        sub_id = subscription_id or DEFAULT_SUBSCRIPTION_ID
        # Extract subscription from resource_id if possible
        if '/subscriptions/' in resource_id:
            parts = resource_id.split('/')
            idx = parts.index('subscriptions')
            if idx + 1 < len(parts):
                sub_id = parts[idx + 1]

        client = MonitorManagementClient(credential, sub_id)

        response = client.metrics.list(
            resource_uri=resource_id,
            metricnames=metric_names,
            timespan=timespan,
            interval=interval,
            aggregation=aggregation,
        )

        metrics = []
        for metric in response.value:
            timeseries_data = []
            for ts in (metric.timeseries or []):
                for dp in (ts.data or []):
                    val = getattr(dp, aggregation.lower(), None) or dp.average or dp.total or dp.maximum
                    if val is not None:
                        timeseries_data.append({
                            "timestamp": dp.time_stamp.isoformat() if dp.time_stamp else None,
                            "value": val,
                        })
            metrics.append({
                "name": metric.name.value if metric.name else '',
                "unit": metric.unit.value if metric.unit else '',
                "datapoints": timeseries_data[-20:],  # Last 20 data points
            })

        return {
            "success": True,
            "resource_id": resource_id,
            "timespan": timespan,
            "interval": interval,
            "aggregation": aggregation,
            "metrics": metrics,
            "executed_as": user_info,
        }
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except AzureError as e:
        return error_response(e, user_info if 'user_info' in dir() else None)

def main():
    """Main entry point for the OpenAgentic Azure MCP Server."""
    logger.info("=" * 70)
    logger.info("OpenAgentic Azure MCP Server - Full Azure SDK (az cli Parity)")
    logger.info("=" * 70)
    logger.info("")
    logger.info("AUTHENTICATION:")
    logger.info("  - Azure AD service principal (ClientSecretCredential)")
    logger.info("  - From AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET")
    logger.info("  - NO OBO / user-token passthrough")
    logger.info(f"  - Service principal configured: {'Yes' if (AZURE_TENANT_ID and AZURE_CLIENT_ID and AZURE_CLIENT_SECRET) else 'No (set the AZURE_* env vars)'}")
    logger.info("")
    logger.info(f"Default Subscription: {DEFAULT_SUBSCRIPTION_ID[:8] if DEFAULT_SUBSCRIPTION_ID else 'Not set'}...")
    logger.info("")
    logger.info("Available Tool Categories:")
    logger.info("  - Subscriptions & Resources")
    logger.info("  - Compute (VMs)")
    logger.info("  - AKS (Kubernetes)")
    logger.info("  - Networking (VNets, NSGs, App Gateway, Load Balancer)")
    logger.info("  - Storage")
    logger.info("  - Key Vault")
    logger.info("  - Cost Management")
    logger.info("  - Microsoft Graph (Users, Groups, Apps)")
    logger.info("  - Monitoring")
    logger.info("  - AI Foundry (Deployment Management)")
    logger.info("=" * 70)

    # Use HTTP transport if available and in HTTP mode, otherwise use stdio
    if HTTP_TRANSPORT_AVAILABLE:
        run_with_http_support(
            mcp_server=mcp,
            name="oap-azure-mcp",
            version="2.0.0",
            default_port=8081
        )
    else:
        mcp.run()

if __name__ == "__main__":
    main()
