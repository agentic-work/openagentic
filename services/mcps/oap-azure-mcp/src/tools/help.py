"""Azure MCP — help tools.

Help & guidance catalog.
"""

import os
import sys
import json
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, List

# Make the package root importable so `from _core import *` resolves both
# under `python -m src.server` (Docker) and `import server` (tests).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _core import *  # noqa: F401,F403

__all__ = [
    'azure_help',
]


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
