# OpenAgentic Azure MCP Server

A production-ready Azure MCP server providing full Azure ARM REST API access using **direct user tokens only**.

## Authentication Model

**CRITICAL: This MCP uses DIRECT USER TOKENS - NO SERVICE PRINCIPALS.**

```
┌─────────────────────────────────────────────────────────────────────┐
│  AUTHENTICATION - NO SERVICE PRINCIPALS                             │
│  All operations use DIRECT USER TOKENS only - exactly like az login │
└─────────────────────────────────────────────────────────────────────┘
```

The user's Azure AD access token is passed from the frontend SSO through the MCP proxy and used directly for all Azure API calls. There is:

- ❌ **NO** Azure SDK authentication imports
- ❌ **NO** `AZURE_CLIENT_SECRET` environment variable
- ❌ **NO** service principal fallback
- ❌ **NO** OBO token exchange (user token is used directly)
- ✅ **ONLY** authentication source: `meta.userAccessToken` from user's SSO session

### Token Flow

```
User → Azure AD SSO → Frontend → API → MCP Proxy → Azure MCP → Azure ARM API
                 ↓                                      ↓
           Access Token ─────────────────────────→ Direct Use
           (audience: management.azure.com)
```

### Required Frontend Scopes

The frontend SSO must request tokens for all Azure APIs the user needs:

| API | Token Key | Audience |
|-----|-----------|----------|
| ARM (Management) | `userAccessToken` | `https://management.azure.com/.default` |
| Graph (Entra ID) | `graphAccessToken` | `https://graph.microsoft.com/.default` |
| Key Vault | `keyvaultAccessToken` | `https://vault.azure.net/.default` |
| Storage | `storageAccessToken` | `https://storage.azure.com/.default` |

## Tools

### ARM API Tools

| Tool | Description |
|------|-------------|
| `azure_arm_execute` | Universal ARM REST API - ANY Azure resource operation |
| `azure_arm_help` | Get example commands for common operations |
| `subscription_list` | List accessible subscriptions |
| `resource_group_list` | List resource groups |
| `vm_list` | List virtual machines |

### Cost Management Tools

| Tool | Description |
|------|-------------|
| `azure_cost_query` | Flexible cost queries with grouping |
| `azure_cost_breakdown` | Cost breakdown by dimension (ResourceType, Region, etc.) |
| `azure_cost_forecast` | Cost forecasting |

### Graph API Tools (Entra ID)

| Tool | Description |
|------|-------------|
| `azure_graph_execute` | Microsoft Graph API for users, groups, apps, service principals |

### Data Plane Tools

| Tool | Description |
|------|-------------|
| `azure_keyvault_secret` | Key Vault secrets (get, set, list, delete) |
| `azure_storage_blob` | Blob storage operations |

## Usage Examples

### List Subscriptions
```python
subscription_list()
# Returns: {"success": true, "data": {"value": [...]}, "executed_as": {"upn": "user@domain.com"}}
```

### List Resource Groups
```python
resource_group_list()
```

### Execute ARM REST API
```python
# List VMs in a resource group
azure_arm_execute(
    method="GET",
    path="/resourceGroups/my-rg/providers/Microsoft.Compute/virtualMachines",
    api_version="2024-03-01"
)

# Create a storage account
azure_arm_execute(
    method="PUT",
    path="/resourceGroups/my-rg/providers/Microsoft.Storage/storageAccounts/mystorageacct",
    api_version="2023-01-01",
    body={
        "location": "eastus",
        "sku": {"name": "Standard_LRS"},
        "kind": "StorageV2"
    }
)
```

### Cost Query
```python
azure_cost_breakdown(
    breakdown_by="ResourceType",
    days=30,
    top_n=10
)
```

### Graph API (Entra ID)
```python
# List users
azure_graph_execute(method="GET", path="/users")

# List app registrations
azure_graph_execute(method="GET", path="/applications")
```

### Key Vault Secrets
```python
# List secrets
azure_keyvault_secret(vault_name="myvault", operation="list", secret_name="")

# Get a secret
azure_keyvault_secret(vault_name="myvault", operation="get", secret_name="my-secret")
```

## Response Format

All tools return responses with an `executed_as` field showing the authenticated user:

```json
{
  "success": true,
  "status_code": 200,
  "data": { ... },
  "executed_as": {
    "upn": "user@domain.com",
    "name": "User Name",
    "oid": "user-object-id",
    "tid": "tenant-id",
    "aud": "https://management.azure.com"
  }
}
```

## Error Handling

### No User Token
If no user token is provided:
```json
{
  "success": false,
  "error": "No user token provided. User must be logged in with Azure AD.",
  "hint": "Ensure the user logged in via Azure AD SSO, not local auth."
}
```

### Authorization Failed
If the user lacks permissions:
```json
{
  "success": false,
  "status_code": 403,
  "error": { "code": "AuthorizationFailed", "message": "..." },
  "executed_as": { "upn": "user@domain.com" }
}
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_SUBSCRIPTION_ID` | No | Default subscription ID |
| `AZURE_TENANT_ID` | No | Azure AD tenant ID (for logging) |

**Note:** No client credentials are used. Authentication is entirely via user tokens.

## Security

### What This Prevents

- ✅ Service principal escalation - **impossible** (no SP code exists)
- ✅ Shared credential abuse - each user uses their own token
- ✅ Permission escalation - user's Azure RBAC applies

### Audit Trail

Every operation logs:
- User's UPN (email)
- Token audience
- Operation performed
- Success/failure status

## Architecture

```
services/mcps/oap-azure-mcp/
├── src/
│   └── server.py    # Main MCP server (single file, ~1400 lines)
├── requirements.txt # Python dependencies
└── README.md        # This file
```

## Dependencies

- `mcp>=1.0.0` - MCP framework
- `httpx>=0.25.0` - HTTP client for Azure REST APIs

**Note:** No Azure SDK (`azure-identity`, `azure-mgmt-*`) - all calls are direct REST API via httpx.

## License

Copyright (c) 2025 OpenAgentic. All rights reserved.
