# OpenAgentic AKS Deployment Prerequisites

## Current Deployment Status

Deployment to `omcp-dev-aks-agentic` cluster requires these prerequisites to be resolved.

## Azure Resource Prerequisites

### 1. Azure Container Registry (ACR) - COMPLETE
- **Registry**: `omcpdevaksagenticregistry.azurecr.io`
- **Status**: All images pushed and accessible
- **Required Images**:
  - `openagentic-api:latest`
  - `openagentic-ui:latest`
  - `openagentic-mcp-proxy:latest`
  - `openagentic-code-manager:latest`
  - `openagentic-uat-dashboard:latest`
  - `ollama/ollama:latest`
  - `minio/minio:RELEASE.2024-05-01T01-11-10Z`
  - `milvusdb/milvus:v2.6.5`
  - `milvusdb/etcd:3.5.14-r1`
  - `apachepulsar/pulsar:3.0.7`
  - `bitnami/postgresql:16`
  - `bitnami/redis:7.2`
  - `zilliz/attu:v2.5.12`
  - `busybox:latest`

### 2. Azure AI Foundry - COMPLETE
- **Resource**: `ocio-omcp-dev-moderate-east2hub-dev-aif`
- **Endpoint**: `https://ocio-omcp-dev-moderate-east2hub-dev-aif.cognitiveservices.azure.com/`
- **Deployments Required**:
  - `gpt-5.2-chat-dev` - Chat completion model
  - `text-embedding-3-large-dev` - Embedding model (3072 dimensions)
  - `gpt-image-1-dev` - Image generation (DALL-E)
- **Status**: Available via private endpoint

### 3. Azure Blob Storage - BLOCKED
- **Account**: `ocioomcpdevmodmcp01`
- **Container**: `milvus`
- **Issue**: `publicNetworkAccess: Disabled`
- **Resolution Options**:
  1. Enable public network access for AKS subnet
  2. Configure storage account to allow shared key access via private endpoint
  3. Use Azure AD managed identity authentication
- **Current Workaround**: Using internal MinIO deployment

### 4. Firewall Rules - PENDING

#### Required Outbound Access:
| Destination | Port | Purpose | Status |
|-------------|------|---------|--------|
| `ollama.ai` | 443 | Ollama model downloads | BLOCKED |
| `registry.ollama.ai` | 443 | Ollama registry | BLOCKED |
| `huggingface.co` | 443 | Model downloads | BLOCKED |
| `*.blob.core.windows.net` | 443 | Azure Blob (via PE) | Partial |

#### Firewall Request Required:
Submit firewall request to whitelist:
- `ollama.ai`
- `registry.ollama.ai`
- `*.ollama.com`

### 5. Private DNS Zones - COMPLETE
- `privatelink.blob.core.windows.net` - Resolves to `172.18.172.38`
- `privatelink.aiservices.azure.com` - AI Foundry endpoint

## Kubernetes Prerequisites

### 1. Secrets
- `acr-secret` - ACR pull credentials (created during deployment)
- TLS certificates for `agentic-dev.cdc.gov`

### 2. Storage Classes
- `managed-csi-premium` - Premium SSD for databases
- `managed-csi` - Standard SSD for general storage

### 3. Node Pools
| Pool | Purpose | Node Selector |
|------|---------|---------------|
| `gpu` | Ollama, Milvus query/data nodes | `agentpool=gpu` |
| `litellm` | API, Redis, PostgreSQL | `kubernetes.io/arch=amd64` |
| `workloads` | UI, general workloads | `kubernetes.io/arch=amd64` |

## Current Workarounds

### Milvus Object Storage
**Problem**: Azure Blob Storage inaccessible due to private endpoint + publicNetworkAccess disabled
**Workaround**: Deploy MinIO within cluster
**Impact**: Data not persisted to Azure Blob, requires backup strategy
**To Enable Azure Blob**:
1. Configure storage account to accept connections from AKS VNet
2. Update `values-aks-dev.yaml`:
   ```yaml
   milvus:
     minio:
       enabled: false
     externalS3:
       enabled: true
       host: "core.windows.net"
       # ... rest of Azure config
   ```

### Ollama Models
**Problem**: Firewall blocks ollama.ai
**Workaround**: Ollama deployed but disabled (`OLLAMA_ENABLED=false`)
**Impact**: Using Azure AI Foundry for all LLM/embedding operations
**To Enable**:
1. Get firewall approval for ollama.ai
2. Update `values-aks-dev.yaml`:
   ```yaml
   env:
     OLLAMA_ENABLED: "true"
   ```
3. Pull models: `kubectl exec -it <ollama-pod> -- ollama pull llama3.2:3b`

## Deployment Commands

```bash
# 1. Login to ACR
az acr login --name omcpdevaksagenticregistry

# 2. Push any new images (if needed)
./scripts/build-fixed.sh --buildpush --registry omcpdevaksagenticregistry.azurecr.io

# 3. Update Helm dependencies
cd helm/openagentic
helm dependency update

# 4. Package and push chart
helm package . -d /tmp/
helm push /tmp/openagentic-1.0.0.tgz oci://omcpdevaksagenticregistry.azurecr.io/helm

# 5. Deploy via AKS command invoke
az aks command invoke \
  --resource-group ocio-omcp-dev-moderate-rg \
  --name omcp-dev-aks-agentic \
  --command "helm registry login omcpdevaksagenticregistry.azurecr.io --username <user> --password '<pass>' && \
             helm upgrade --install openagentic oci://omcpdevaksagenticregistry.azurecr.io/helm/openagentic \
             --version 1.0.0 -f values-aks-dev.yaml --timeout 15m" \
  --file values-aks-dev.yaml
```

## Post-Deployment Verification

```bash
# Check all pods running
az aks command invoke -g ocio-omcp-dev-moderate-rg -n omcp-dev-aks-agentic \
  --command "kubectl get pods -o wide"

# Check Milvus health
az aks command invoke -g ocio-omcp-dev-moderate-rg -n omcp-dev-aks-agentic \
  --command "kubectl exec -it <milvus-proxy-pod> -- curl -s localhost:9091/healthz"

# Check API health
az aks command invoke -g ocio-omcp-dev-moderate-rg -n omcp-dev-aks-agentic \
  --command "kubectl exec -it <api-pod> -- curl -s localhost:8000/health"
```

## Known Issues

1. **Streaming Node CrashLoop** - ✅ FIXED by using internal MinIO instead of Azure Blob
2. **API Collection Not Found** - Expected on fresh deployment, collections created on first use
3. **Ollama Pending** - Expected until firewall opens ollama.ai, pod deployed but not functional
4. **RAG waiting for Ollama** - ✅ FIXED by setting `OLLAMA_EMBEDDING_MODEL: ""` in values-aks-dev.yaml
5. **Temperature Error with gpt-5.2-chat** - ✅ FIXED by setting `AIF_TEMPERATURE: "1"` (reasoning models only support temperature=1)
6. **Redis NOAUTH Error** - ✅ FIXED by updating Redis URL template to include password when auth enabled

## Deployment Status (2025-12-22)

All core services are healthy:
- ✅ API (2 pods)
- ✅ UI (2 pods)
- ✅ Milvus cluster (proxy, mixcoord, datanode, querynode, streamingnode)
- ✅ PostgreSQL (primary + 2 read replicas)
- ✅ Redis (2 nodes with sentinel)
- ✅ MCP Proxy (10 pods)
- ✅ Ollama (deployed, awaiting firewall)
- ✅ Pulsar (zookeeper, bookies, brokers, proxy)
- ✅ MinIO (internal object storage)

## Configuration Notes

### Embedding Provider Selection
The API determines embedding provider based on these env vars (in order):
1. `EMBEDDING_PROVIDER` - Explicit provider: `azure`, `ollama`, `aws`, `vertex`
2. Auto-detection from env vars (can override #1 if certain vars present!)

**BUG**: `RAGInitService.ts` checks `OLLAMA_EMBEDDING_MODEL` even when `EMBEDDING_PROVIDER=azure`.
**Workaround**: Set `OLLAMA_EMBEDDING_MODEL: ""` when using non-Ollama embedding provider.

## Contact

For firewall requests: Network Security Team
For Azure resource changes: Cloud Platform Team
For deployment issues: OpenAgentic Team (hello@openagentic.io)
