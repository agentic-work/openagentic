# OpenAgentic Azure MCP Server

A production-ready Azure MCP server providing full Azure ARM REST API access using a **service principal (app registration)**.

## Authentication Model

**This MCP authenticates with a service principal (Azure AD app registration).**

```
┌─────────────────────────────────────────────────────────────────────┐
│  AUTHENTICATION — SERVICE PRINCIPAL (app registration)             │
│  All operations run as ONE configured service principal via         │
│  azure.identity.ClientSecretCredential.                             │
└─────────────────────────────────────────────────────────────────────┘
```

The server builds a single `ClientSecretCredential` from the
`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` environment
variables and uses it to acquire tokens for every Azure API call. There is:

- ✅ One process-wide service principal credential (`ClientSecretCredential`)
- ✅ `AZURE_CLIENT_SECRET` (plus `AZURE_TENANT_ID` / `AZURE_CLIENT_ID`) required
- ❌ **NO** per-user/OBO token exchange — every operation runs as the service principal
- ⚠️ All operations run with the **service principal's RBAC permissions**, not the calling user's

### Token Flow

```
Service principal env vars → ClientSecretCredential → token → Azure ARM API
   (AZURE_TENANT_ID /              (one per process)    (audience:
    AZURE_CLIENT_ID /                                    management.azure.com)
    AZURE_CLIENT_SECRET)
```

### Required RBAC

Grant the service principal the Azure RBAC roles it needs (e.g. **Reader** for
read-only queries, or scoped contributor roles for write operations) on the
target subscriptions / resource groups. The credential acquires tokens for the
ARM, Graph, Key Vault, and Storage audiences as required by each tool.

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
# Returns: {"success": true, "data": {"value": [...]}, "executed_as": {"upn": "sp:<client-id>"}}
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

All tools return responses with an `executed_as` field showing the service principal the operation ran as:

```json
{
  "success": true,
  "status_code": 200,
  "data": { ... },
  "executed_as": {
    "upn": "sp:<client-id>",
    "oid": "<client-id>",
    "tid": "<tenant-id>",
    "aud": "https://management.azure.com"
  }
}
```

## Error Handling

### Service Principal Not Configured
If the `AZURE_*` env vars are not all set:
```json
{
  "success": false,
  "error": "Service principal not configured. Set AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET.",
  "hint": "Create an Azure AD app registration with a client secret and grant it the required RBAC roles."
}
```

### Authorization Failed
If the service principal lacks permissions:
```json
{
  "success": false,
  "status_code": 403,
  "error": { "code": "AuthorizationFailed", "message": "..." },
  "executed_as": { "upn": "sp:<client-id>" }
}
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_TENANT_ID` | Yes | Azure AD tenant ID for the service principal |
| `AZURE_CLIENT_ID` | Yes | App registration (client) ID of the service principal |
| `AZURE_CLIENT_SECRET` | Yes | Client secret for the service principal |
| `AZURE_SUBSCRIPTION_ID` | No | Default subscription ID |

**Note:** Authentication uses an Azure AD app registration (service principal)
via `ClientSecretCredential`. All three `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` /
`AZURE_CLIENT_SECRET` values are required.

## Security

### Operating Model

- ⚠️ All operations run as the **configured service principal**, not as the
  calling user — its Azure RBAC roles define exactly what the MCP can do.
- ✅ Scope blast radius by granting the app registration the minimum RBAC roles
  (e.g. **Reader**) on only the subscriptions / resource groups it needs.
- ✅ Rotate `AZURE_CLIENT_SECRET` regularly and store it as a secret, never in code.

### Audit Trail

Every operation logs:
- The service principal identity (`sp:<client-id>`)
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
- `azure-identity` - `ClientSecretCredential` for service-principal token acquisition

**Note:** ARM/Graph/data-plane calls are made directly over REST via httpx; only
token acquisition uses `azure-identity`.

## License

[Apache-2.0](../../../LICENSE) © Agenticwork™ LLC
