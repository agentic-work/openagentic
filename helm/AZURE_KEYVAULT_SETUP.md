# Azure Key Vault Integration for OpenAgenticChat

## Overview
This document describes the Azure Key Vault integration for secure secret management in the OpenAgenticChat Helm deployment.

## Prerequisites

### 1. Azure Resources
- Azure subscription with appropriate permissions
- Resource group (`rg-openagenticchat`)
- AKS cluster with system-assigned managed identity
- Azure Storage Account (for backend storage)

### 2. Azure Key Vault CSI Driver
The AKS cluster must have the Azure Key Vault CSI driver addon enabled:
```bash
az aks addon enable --addon azure-keyvault-secrets-provider \
  --resource-group rg-openagenticchat \
  --name openagenticchat-aks-dev
```

## Setup Instructions

### 1. Create Azure Key Vault
```bash
# Create Key Vault with unique name
KEYVAULT_NAME="kvopenagenticprod$(date +%s | tail -c 6)"
az keyvault create \
  --name "$KEYVAULT_NAME" \
  --resource-group rg-openagenticchat \
  --location eastus \
  --sku standard
```

### 2. Configure RBAC Access
```bash
# Get AKS cluster identity
IDENTITY_PRINCIPAL_ID=$(az aks show \
  --resource-group rg-openagenticchat \
  --name openagenticchat-aks-dev \
  --query "identity.principalId" -o tsv)

# Grant Key Vault access to AKS identity
az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee "$IDENTITY_PRINCIPAL_ID" \
  --scope "/subscriptions/<subscription-id>/resourceGroups/rg-openagenticchat/providers/Microsoft.KeyVault/vaults/$KEYVAULT_NAME"

# Grant yourself admin access to manage secrets
USER_OBJECT_ID=$(az ad signed-in-user show --query id -o tsv)
az role assignment create \
  --role "Key Vault Secrets Officer" \
  --assignee "$USER_OBJECT_ID" \
  --scope "/subscriptions/<subscription-id>/resourceGroups/rg-openagenticchat/providers/Microsoft.KeyVault/vaults/$KEYVAULT_NAME"
```

### 3. Store Secrets in Key Vault
```bash
# Store all required secrets
az keyvault secret set --vault-name $KEYVAULT_NAME --name "azure-storage-account-key" --value "<storage-key>"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "azure-storage-account-name" --value "<storage-name>"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "postgres-password" --value "<secure-password>"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "redis-password" --value "<secure-password>"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "jwt-secret" --value "<secure-jwt-key>"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "azure-client-secret" --value "<client-secret>"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "azure-openai-api-key" --value "<api-key>"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "mcp-internal-api-key" --value "<api-key>"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "minio-root-password" --value "<password>"
```

## Helm Chart Configuration

### 1. Update values.yaml
Add the following configuration to your `values-aks-dev.yaml`:

```yaml
# Azure Key Vault Configuration
azureKeyVault:
  enabled: true
  name: "kvopenagenticprod68294"  # Your Key Vault name
  tenantId: "ee3d15bb-e175-4ee7-995d-d992aa3199f6"  # Your Azure tenant ID
  identityClientId: "626bfecb-2bf0-4d62-a039-0fc699865b6b"  # AKS managed identity client ID

# Disable HashiCorp Vault (replaced by Azure Key Vault)
vault:
  enabled: false
```

### 2. Deploy with Helm
```bash
helm upgrade --install openagenticchat-v3 ./openagenticchat-v3 \
  -f values-aks-dev.yaml \
  --namespace openagenticchat \
  --create-namespace
```

## Architecture Components

### SecretProviderClass
- **Location**: `templates/keyvault/secret-provider-class.yaml`
- **Purpose**: Defines which secrets to fetch from Azure Key Vault
- **Features**:
  - Maps Key Vault secrets to Kubernetes secrets
  - Uses AKS managed identity for authentication
  - Automatically syncs secrets as Kubernetes secrets

### Modified Deployments
The following deployments have been updated to use Azure Key Vault secrets:
- **API Deployment** (`templates/core/api-deployment-keyvault.yaml`)
  - Mounts CSI driver volume
  - References secrets from synced Kubernetes secret
- **MCP Orchestrator** (to be updated)
- **PostgreSQL** (to be updated)
- **Redis** (to be updated)
- **MinIO** (to be updated)

## Security Benefits

1. **Centralized Secret Management**: All secrets stored in Azure Key Vault
2. **RBAC Control**: Fine-grained access control using Azure RBAC
3. **Audit Logging**: All secret access is logged in Azure
4. **Rotation Support**: Secrets can be rotated without pod restarts
5. **No Hardcoded Secrets**: Removes all sensitive data from Helm values

## Troubleshooting

### Check CSI Driver Status
```bash
kubectl get pods -n kube-system | grep secrets-store
```

### Verify SecretProviderClass
```bash
kubectl get secretproviderclass -n openagenticchat
```

### Check Secret Sync Status
```bash
kubectl get secrets -n openagenticchat | grep keyvault
```

### View CSI Driver Logs
```bash
kubectl logs -n kube-system -l app=secrets-store-csi-driver
```

## Migration from HashiCorp Vault

1. Export existing secrets from HashiCorp Vault
2. Import secrets to Azure Key Vault using the script above
3. Update Helm values to enable Azure Key Vault and disable HashiCorp Vault
4. Redeploy the application

## Current Key Vault Details
- **Name**: kvopenagenticprod68294
- **Resource Group**: rg-openagenticchat
- **Location**: East US
- **URI**: https://kvopenagenticprod68294.vault.azure.net/