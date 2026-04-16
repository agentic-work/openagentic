# OpenAgentic AKS Deployment Guide

Complete guide for deploying OpenAgentic to Azure Kubernetes Service (AKS) with GPU support.

## Architecture

### Cluster Configuration
- **Resource Group**: rg-openagentic (eastus)
- **AKS Cluster**: aks-openagentic
- **Kubernetes Version**: 1.29

### Node Pools

#### System Pool (systempool)
- **Count**: 5 nodes (auto-scaling 3-10)
- **VM Size**: Standard_D8s_v3 (8 vCPU, 32 GB RAM)
- **Purpose**: API, UI, databases, services
- **Labels**: `agentpool=system`

#### GPU Pool (gpupool)
- **Count**: 1 node (auto-scaling 1-2)
- **VM Size**: Standard_NC4as_T4_v3 (4 vCPU, 28 GB RAM, 1x T4 GPU)
- **Purpose**: Ollama (local models), Milvus vector DB with GPU
- **Labels**: `agentpool=gpu`, `accelerator=nvidia-tesla-t4`
- **Taints**: `sku=gpu:NoSchedule`

### Azure Services

#### Azure Container Registry (ACR)
- **Name**: acropenagentic.azurecr.io
- **SKU**: Standard
- **Access**: Attached to AKS cluster via managed identity

#### Azure Storage Account
- **Name**: stopenagentic
- **Purpose**: User workspaces, file storage
- **Type**: StorageV2, Standard_LRS

#### Azure Key Vault
- **Name**: kv-openagentic
- **Purpose**: Secrets management
- **Access**: AKS managed identity with RBAC

#### Networking
- **Ingress Controller**: nginx-ingress with Azure LoadBalancer
- **TLS**: cert-manager with Let's Encrypt
- **Domain**: test.openagentic.io

## Deployment Steps

### 1. Create AKS Infrastructure

```bash
# Run the automated deployment script
./scripts/deploy-aks.sh
```

This script will:
- Create resource group
- Create ACR
- Create AKS cluster with system node pool
- Add GPU node pool with T4 GPU
- Install NVIDIA device plugin
- Configure Storage Account
- Configure Key Vault
- Install nginx-ingress controller
- Install cert-manager
- Configure Let's Encrypt staging issuer

**Duration**: ~10-15 minutes

### 2. Configure DNS

After the script completes, it will display the LoadBalancer IP. Add a DNS A record:

```
test.openagentic.io -> <INGRESS_IP>
```

### 3. Build and Push Images to ACR

```bash
# Build all images and push to ACR
./scripts/build-all.sh --acr --acr-name acropenagentic

# Or build specific services
./scripts/build-all.sh --acr --acr-name acropenagentic openagentic-api openagentic-ui
```

**Duration**: ~10-20 minutes (depending on number of services)

### 4. Deploy with Helm

```bash
# Deploy the full stack
./scripts/deploy-helm-aks.sh
```

This will:
- Create namespace `openagentic`
- Configure Key Vault secrets
- Update Helm dependencies
- Deploy with AKS values + GPU values
- Wait for pods to be ready

**Duration**: ~5-10 minutes

### 5. Verify Deployment

```bash
# Check pods
kubectl get pods -n openagentic

# Check services
kubectl get svc -n openagentic

# Check ingress
kubectl get ingress -n openagentic

# View logs
kubectl logs -f deployment/openagentic-api -n openagentic
```

## Model Configuration

The deployment uses the same models as docker-compose:

### Default Chat Model
- **Provider**: Azure OpenAI (with Entra ID auth)
- **Model**: o3-mini
- **Purpose**: Primary chat, reasoning tasks

### Vision Model
- **Provider**: Ollama (GPU-accelerated)
- **Model**: gemma3:12b
- **Purpose**: Image understanding, multimodal tasks

### Embedding Model
- **Provider**: Ollama (GPU-accelerated)
- **Model**: embeddinggemma
- **Purpose**: Semantic search, RAG

### Image Generation
- **Provider**: Azure OpenAI
- **Model**: DALL-E-3
- **Purpose**: Text-to-image generation

### Auto-Routing
- Vision requests automatically route to gemma3 (GPU)
- Image generation requests route to DALL-E-3
- Standard chat uses o3-mini

## Resource Requests

### API Service
- **Replicas**: 3
- **CPU**: 1000m request, 4000m limit
- **Memory**: 2Gi request, 8Gi limit
- **Node**: systempool

### UI Service
- **Replicas**: 2
- **CPU**: 250m request, 1000m limit
- **Memory**: 256Mi request, 1Gi limit
- **Node**: systempool

### Ollama Service
- **Replicas**: 1
- **GPU**: 1x NVIDIA T4
- **CPU**: 4000m request, 8000m limit
- **Memory**: 16Gi request, 32Gi limit
- **Storage**: 100Gi PVC (for models)
- **Node**: gpupool (with GPU taint toleration)

### Milvus Vector DB
- **Replicas**: 1 (standalone mode)
- **GPU**: 1x NVIDIA T4
- **CPU**: 2000m request, 4000m limit
- **Memory**: 8Gi request, 16Gi limit
- **Storage**: 100Gi PVC (for vectors)
- **Node**: gpupool (with GPU taint toleration)

### PostgreSQL
- **CPU**: 1000m request, 4000m limit
- **Memory**: 2Gi request, 8Gi limit
- **Storage**: 50Gi PVC
- **Node**: systempool

### Redis
- **CPU**: 500m request, 2000m limit
- **Memory**: 1Gi request, 4Gi limit
- **Storage**: 10Gi PVC
- **Node**: systempool

## Security

### Secrets Management
All secrets stored in Azure Key Vault:
- JWT_SECRET
- API_SECRET_KEY
- FRONTEND_SECRET
- SIGNING_SECRET
- Azure authentication credentials

### Access Control
- AKS managed identity for Key Vault access
- RBAC enabled on Key Vault
- ACR attached via managed identity (no passwords)

### TLS/SSL
- cert-manager with Let's Encrypt
- Automatic certificate renewal
- Staging issuer for testing (switch to production when ready)

## Monitoring

### Built-in
- AKS monitoring addon enabled
- Logs in Azure Monitor / Log Analytics

### Optional
Set `monitoring.enabled: true` in values-aks.yaml for:
- Prometheus
- Grafana
- Full metrics stack

## Troubleshooting

### Check GPU availability
```bash
kubectl get nodes -o=custom-columns='NAME:.metadata.name,GPU:.status.allocatable.nvidia\.com/gpu'
```

### View NVIDIA device plugin status
```bash
kubectl get pods -n kube-system | grep nvidia
kubectl logs -n kube-system -l name=nvidia-device-plugin-ds
```

### Check Ollama GPU usage
```bash
kubectl exec -it deployment/ollama -n openagentic -- nvidia-smi
```

### Check ingress status
```bash
kubectl get ingress -n openagentic
kubectl describe ingress openagentic-ingress -n openagentic
```

### View cert-manager certificates
```bash
kubectl get certificate -n openagentic
kubectl describe certificate openagentic-tls -n openagentic
```

## Scaling

### Manual Scaling
```bash
# Scale API replicas
kubectl scale deployment openagentic-api -n openagentic --replicas=5

# Scale UI replicas
kubectl scale deployment openagentic-ui -n openagentic --replicas=3
```

### Node Pool Auto-Scaling
Already enabled:
- System pool: 3-10 nodes
- GPU pool: 1-2 nodes

## Upgrading

### Update Images
```bash
# Build new images
./scripts/build-all.sh --acr --acr-name acropenagentic --tag v1.1.0

# Update Helm deployment
helm upgrade openagentic ./helm/openagenticchat-v3 \
  --namespace openagentic \
  -f helm/openagenticchat-v3/values-aks.yaml \
  -f helm/openagenticchat-v3/values-gpu.yaml \
  --set image.tag=v1.1.0
```

### Update Configuration
```bash
# Edit values
vim helm/openagenticchat-v3/values-aks.yaml

# Apply changes
./scripts/deploy-helm-aks.sh
```

## Cost Optimization

### GPU Node Pool
- Starts with 1 node
- Auto-scales to 2 max
- Can manually scale to 0 when not needed:
  ```bash
  az aks nodepool scale \
    --resource-group rg-openagentic \
    --cluster-name aks-openagentic \
    --name gpupool \
    --node-count 0
  ```

### System Node Pool
- Auto-scales 3-10 based on load
- Set min lower if testing:
  ```bash
  az aks nodepool update \
    --resource-group rg-openagentic \
    --cluster-name aks-openagentic \
    --name systempool \
    --min-count 2
  ```

## Access URLs

After deployment:
- **UI**: https://test.openagentic.io
- **API**: https://test.openagentic.io/api
- **MCP Proxy**: https://test.openagentic.io/mcp

## Next Steps

1. Switch to production Let's Encrypt issuer when DNS is confirmed
2. Enable monitoring if needed
3. Configure backup policies for PostgreSQL and storage
4. Set up Azure Front Door or CDN (optional)
5. Configure additional Azure AD app registrations for production
