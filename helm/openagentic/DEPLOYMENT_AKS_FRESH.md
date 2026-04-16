# OpenAgentic AKS Deployment Guide - Fresh Cluster

Complete guide to deploy OpenAgentic to a fresh Azure AKS cluster with KeyVault and Azure Storage.

## Prerequisites

- Azure CLI installed and authenticated (`az login`)
- kubectl installed
- Helm 3 installed
- Docker images built and pushed to ACR (acropenagentic.azurecr.io)

## 1. Azure Infrastructure Setup

### 1.1 Create Resource Group

```bash
RESOURCE_GROUP="rg-openagentic"
LOCATION="eastus"
SUBSCRIPTION_ID="815a115d-bf32-495c-a89f-b5ce6b349b57"

az group create --name $RESOURCE_GROUP --location $LOCATION
```

### 1.2 Create AKS Cluster

```bash
AKS_CLUSTER="aks-openagentic"

az aks create \
  --resource-group $RESOURCE_GROUP \
  --name $AKS_CLUSTER \
  --node-count 3 \
  --node-vm-size Standard_D4s_v3 \
  --enable-managed-identity \
  --generate-ssh-keys \
  --enable-addons azure-keyvault-secrets-provider \
  --network-plugin azure \
  --enable-cluster-autoscaler \
  --min-count 3 \
  --max-count 6 \
  --nodepool-name systempool

# Get credentials
az aks get-credentials --resource-group $RESOURCE_GROUP --name $AKS_CLUSTER
```

### 1.3 Create Azure Container Registry (ACR)

```bash
ACR_NAME="acropenagentic"

az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Standard

# Attach ACR to AKS
az aks update \
  --resource-group $RESOURCE_GROUP \
  --name $AKS_CLUSTER \
  --attach-acr $ACR_NAME
```

### 1.4 Create Storage Account

```bash
STORAGE_ACCOUNT="stopenagentic"

az storage account create \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2 \
  --allow-blob-public-access false \
  --https-only true \
  --min-tls-version TLS1_2

# Create container for user workspaces
az storage container create \
  --name user-workspaces \
  --account-name $STORAGE_ACCOUNT \
  --auth-mode login
```

### 1.5 Create Azure Key Vault

```bash
KEYVAULT_NAME="kv-openagentic"

az keyvault create \
  --name $KEYVAULT_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --enable-rbac-authorization true
```

## 2. Configure Permissions

### 2.1 Get Identity IDs

```bash
# Get AKS system-assigned identity
AKS_IDENTITY=$(az aks show \
  --resource-group $RESOURCE_GROUP \
  --name $AKS_CLUSTER \
  --query "identity.principalId" -o tsv)

# Get KeyVault CSI Driver identity
KEYVAULT_CSI_IDENTITY=$(az aks show \
  --resource-group $RESOURCE_GROUP \
  --name $AKS_CLUSTER \
  --query "addonProfiles.azureKeyvaultSecretsProvider.identity.clientId" -o tsv)

KEYVAULT_CSI_OBJECT_ID=$(az aks show \
  --resource-group $RESOURCE_GROUP \
  --name $AKS_CLUSTER \
  --query "addonProfiles.azureKeyvaultSecretsProvider.identity.objectId" -o tsv)

echo "AKS Identity: $AKS_IDENTITY"
echo "KeyVault CSI Client ID: $KEYVAULT_CSI_IDENTITY"
echo "KeyVault CSI Object ID: $KEYVAULT_CSI_OBJECT_ID"
```

### 2.2 Grant KeyVault Access

```bash
# Grant KeyVault CSI identity "Key Vault Secrets User" role
az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee $KEYVAULT_CSI_OBJECT_ID \
  --scope /subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.KeyVault/vaults/$KEYVAULT_NAME

# Grant yourself "Key Vault Secrets Officer" role to create secrets
CURRENT_USER=$(az ad signed-in-user show --query id -o tsv)

az role assignment create \
  --role "Key Vault Secrets Officer" \
  --assignee $CURRENT_USER \
  --scope /subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.KeyVault/vaults/$KEYVAULT_NAME
```

### 2.3 Grant Storage Account Access

```bash
# Grant AKS identity "Storage Blob Data Contributor" role
az role assignment create \
  --role "Storage Blob Data Contributor" \
  --assignee $AKS_IDENTITY \
  --scope /subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Storage/storageAccounts/$STORAGE_ACCOUNT
```

### 2.4 Wait for RBAC Propagation

```bash
echo "Waiting 30 seconds for RBAC permissions to propagate..."
sleep 30
```

## 3. Create KeyVault Secrets

### 3.1 Generate and Store Secrets

```bash
# Generate secure random secrets
JWT_SECRET=$(openssl rand -base64 48)
API_SECRET=$(openssl rand -base64 32)
FRONTEND_SECRET=$(openssl rand -base64 32)
SIGNING_SECRET=$(openssl rand -base64 32)
POSTGRES_PASSWORD=$(openssl rand -base64 24)
MCP_API_KEY="sk-mcp-$(openssl rand -hex 16)"
MINIO_PASSWORD=$(openssl rand -base64 24)

# Get storage account key
STORAGE_KEY=$(az storage account keys list \
  --account-name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --query "[0].value" -o tsv)

# Create secrets in KeyVault
az keyvault secret set --vault-name $KEYVAULT_NAME --name "jwt-secret" --value "$JWT_SECRET"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "api-secret-key" --value "$API_SECRET"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "frontend-secret" --value "$FRONTEND_SECRET"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "signing-secret" --value "$SIGNING_SECRET"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "postgres-password" --value "$POSTGRES_PASSWORD"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "mcp-internal-api-key" --value "$MCP_API_KEY"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "minio-root-password" --value "$MINIO_PASSWORD"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "azure-storage-account-name" --value "$STORAGE_ACCOUNT"
az keyvault secret set --vault-name $KEYVAULT_NAME --name "azure-storage-account-key" --value "$STORAGE_KEY"

echo "✓ All secrets created in KeyVault"
```

## 4. Update Helm Values

### 4.1 Get Tenant ID

```bash
TENANT_ID=$(az account show --query tenantId -o tsv)
echo "Tenant ID: $TENANT_ID"
```

### 4.2 Edit values-aks.yaml

Update the following values in `helm/openagenticchat-v3/values-aks.yaml`:

```yaml
# Line 72-73: Add tenant and identity
azureKeyVault:
  enabled: true
  name: kv-openagentic
  tenantId: "<YOUR_TENANT_ID>"  # From step 4.1
  identityClientId: "<KEYVAULT_CSI_IDENTITY>"  # From step 2.1
```

## 5. Install Nginx Ingress Controller

```bash
# Add nginx ingress helm repo
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

# Install nginx ingress controller
helm install nginx-ingress ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/azure-load-balancer-health-probe-request-path"=/healthz
```

## 6. Install cert-manager (for TLS)

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.3/cert-manager.yaml

# Wait for cert-manager to be ready
kubectl wait --for=condition=ready pod -l app.kubernetes.io/instance=cert-manager -n cert-manager --timeout=300s

# Create Let's Encrypt ClusterIssuer
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: hello@openagentic.io
    privateKeySecretRef:
      name: letsencrypt-staging
    solvers:
    - http01:
        ingress:
          class: nginx
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: hello@openagentic.io
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
```

## 7. Deploy OpenAgentic

### 7.1 Update Helm Dependencies

```bash
cd helm/openagenticchat-v3
helm dependency update
```

### 7.2 Deploy with Helm

```bash
helm upgrade --install openagentic . \
  -f values-aks.yaml \
  --namespace openagentic \
  --create-namespace \
  --timeout 10m
```

### 7.3 Verify Deployment

```bash
# Check pods
kubectl get pods -n openagentic

# Check services
kubectl get svc -n openagentic

# Check ingress
kubectl get ingress -n openagentic
```

## 8. Configure DNS

### 8.1 Get Ingress External IP

```bash
INGRESS_IP=$(kubectl get ingress openagentic -n openagentic -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "Ingress IP: $INGRESS_IP"
```

### 8.2 Create DNS A Record

Create an A record in your DNS provider:
- **Name**: `test.openagentic.io` (or your domain)
- **Type**: A
- **Value**: `$INGRESS_IP`

## 9. Verification

### 9.1 Check All Pods Running

```bash
kubectl get pods -n openagentic -w
```

Wait until all pods show `Running` and `READY 1/1` (or their replica count).

### 9.2 Test the Endpoint

```bash
# Test HTTP (should redirect to HTTPS)
curl -I http://test.openagentic.io

# Test HTTPS (after cert is issued)
curl -I https://test.openagentic.io
```

## 10. Troubleshooting

### Check Pod Logs

```bash
# API logs
kubectl logs -f deployment/openagentic-api -n openagentic

# UI logs
kubectl logs -f deployment/openagentic-ui -n openagentic

```

### Check KeyVault Secret Mounting

```bash
# Describe a pod to see volume mounts
kubectl describe pod <pod-name> -n openagentic

# Check if secrets are mounted
kubectl exec -it deployment/openagentic-api -n openagentic -- ls -la /mnt/secrets-store
```

### Check Storage Access

```bash
# Check if openagentic can access Azure Storage
kubectl logs -f deployment/openagentic-code-runtime -n openagentic
```

## Architecture Summary

### Service Names (matching docker-compose)

- `openagentic-api` - Main API service
- `openagentic-ui` - Frontend UI
- `openagentic-mcp-proxy` - MCP server orchestrator
- `openagentic-code-runtime` - Code execution (OpenAgentic)
- `openagentic-ollama` - Local LLM inference
- `openagentic-postgresql-pgpool` - PostgreSQL HA (pgpool)
- `openagentic-redis-master` - Redis cache
- `openagentic-milvus-standalone` - Vector database
- `openagentic-minio` - Object storage (Milvus only)
- `openagentic-etcd` - Milvus metadata

### Storage Configuration

- **PostgreSQL HA**: Uses `managed-csi` storage class (Azure Disk)
- **Redis**: Uses `managed-csi` storage class
- **Milvus**: Uses `managed-csi` storage class
- **Ollama**: Uses `managed-csi` storage class for model storage
- **OpenAgentic**: Uses **Azure Blob Storage** (`stopenagentic/user-workspaces`)

### Security

- **KeyVault CSI Driver**: Mounts secrets from Azure KeyVault as volumes
- **Managed Identity**: AKS uses system-assigned identity for Azure resource access
- **RBAC**: Role-based access control for KeyVault and Storage Account
- **TLS**: cert-manager with Let's Encrypt for HTTPS

## Estimated Costs (East US)

- **AKS**: ~$250/month (3x D4s_v3 nodes)
- **Storage Account**: ~$20/month (100GB)
- **ACR**: ~$5/month (Standard)
- **KeyVault**: ~$1/month
- **Load Balancer**: ~$20/month
- **Total**: ~$300/month

## Next Steps

1. Switch to production Let's Encrypt issuer (change `letsencrypt-staging` to `letsencrypt-prod`)
2. Configure Azure AD authentication (already configured in values-aks.yaml)
3. Set up monitoring with Azure Monitor or Prometheus
4. Configure backup policies for PostgreSQL and Storage Account
5. Set up CI/CD pipeline for automated deployments
