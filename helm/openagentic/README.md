# OpenAgentic Helm Chart

Helm chart for deploying the OpenAgentic AI platform on Kubernetes.

## Prerequisites

- Kubernetes 1.28+
- Helm 3.12+
- kubectl configured for your cluster
- Storage class (e.g., `nfs`, `local-path`)
- Container registry access (GCR, ECR, or local registry)
- NVIDIA GPU drivers (for Milvus GPU mode)
- **Gateway API CRDs** (for Envoy Gateway ingress)
- **Envoy Gateway** (replaces deprecated nginx-ingress)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              OpenAgentic Platform                                    │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                         ┌─────────────────────────────┐                             │
│                         │     Envoy Gateway           │                             │
│                         │  (Gateway API + HTTPRoute)  │                             │
│                         └──────────────┬──────────────┘                             │
│  ┌─────────────┐  ┌─────────────┐  ┌───┴─────────┐  ┌───────────────────────────┐  │
│  │   API       │  │     UI      │  │  MCP Proxy  │  │     Code Manager          │  │
│  │  (Fastify)  │  │   (React)   │  │  (FastAPI)  │  │   (openagentic-exec)       │  │
│  └──────┬──────┘  └─────────────┘  └──────┬──────┘  └────────────┬──────────────┘  │
│         │                                  │                      │                 │
│         └──────────────┬──────────────────┴──────────────────────┘                 │
│                        │                                                            │
├────────────────────────┼────────────────────────────────────────────────────────────┤
│     LLM PROVIDERS      │                                                            │
│  ┌─────────────────────┴─────────────────────────────────────────────────────────┐ │
│  │  Gemini 2.5 Pro (Primary) ──► Ollama on HAL (Fallback/Code)                   │ │
│  │    • gemini-2.5-pro         • gpt-oss (chat)                                  │ │
│  │    • API Key auth           • qwen2.5-coder:7b (code)                         │ │
│  │                             • nomic-embed-text (embeddings)                   │ │
│  └───────────────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────────────┤
│     DEPENDENCIES (Deployed Separately)                                              │
│  ┌──────────────────┐  ┌─────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ PostgreSQL HA    │  │   Redis HA  │  │ Milvus GPU      │  │ Workspace MinIO  │  │
│  │ (pgvector)       │  │  (Sentinel) │  │ (Standalone)    │  │  (in chart)      │  │
│  │ DALEK - CPU      │  │             │  │ DALEK GPU 1     │  │                  │  │
│  └──────────────────┘  └─────────────┘  └─────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Ingress: nginx-ingress (with Gateway API Ready)

**Current Status:** Using nginx-ingress with Envoy Gateway templates ready for migration.

The chart includes full Gateway API support (Gateway + HTTPRoute templates) for migration to Envoy Gateway.
However, the current deployment uses nginx-ingress due to a cluster secret mounting issue.

**Migration Plan (when cluster issue is resolved):**
1. Install Envoy Gateway (see Step 2 below)
2. Set `gateway.enabled: true` in values
3. Set `ingress.enabled: false` in values
4. Upgrade the Helm release

**Why Gateway API?**
- Kubernetes Gateway API is the official successor to Ingress
- nginx-ingress retiring March 2026
- Native support for SSE/streaming (required for AI chat)
- Better observability and traffic management

## Cluster Hardware Configuration

| Node | Hardware | Role |
|------|----------|------|
| **HAL** (10.0.0.175) | RTX 3090 24GB | Native Ollama: gpt-oss (chat), qwen2.5-coder:7b (code), nomic-embed-text (embeddings) |
| **DALEK** (10.0.0.36) | 2x RTX 2080 Ti 11GB | GPU 0: Available, GPU 1: Milvus GPU standalone |

## Quick Start - K3s Local Deployment with pgvector HA + Milvus GPU

### Step 1: Add Helm Repositories

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add zilliztech https://zilliztech.github.io/milvus-helm/
helm repo update
```

### Step 2: (OPTIONAL) Install Gateway API CRDs and Envoy Gateway

> **Note:** This step is optional if using nginx-ingress (the current default).
> Only required if migrating to Gateway API by setting `gateway.enabled: true`.

```bash
# Install Gateway API CRDs (v1.2.1)
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.2.1/standard-install.yaml

# Wait for CRDs to be established
kubectl wait --for=condition=Established crd gateways.gateway.networking.k8s.io --timeout=60s
kubectl wait --for=condition=Established crd httproutes.gateway.networking.k8s.io --timeout=60s

# Install Envoy Gateway (v1.2.6)
helm install eg oci://docker.io/envoyproxy/gateway-helm \
  --version v1.2.6 \
  -n envoy-gateway-system \
  --create-namespace

# Wait for Envoy Gateway to be ready
kubectl wait --for=condition=Available deployment/envoy-gateway \
  -n envoy-gateway-system --timeout=120s

# Verify installation
kubectl get gatewayclass
# Should show: envoy   gateway.envoyproxy.io/gatewayclass-controller   Accepted   ...
```

### Step 3: Create Namespace and Secrets

```bash
# Create namespace
kubectl create namespace openagentic

# Create TLS secret (if using existing wildcard cert)
kubectl create secret tls openagentic-wildcard-tls \
  --cert=certs/wildcard.crt \
  --key=certs/wildcard.key \
  -n openagentic

# Create image pull secret for the openagentic Harbor registry
kubectl create secret docker-registry harbor-secret \
  --docker-server=harbor.agenticwork.io \
  --docker-username='<your-harbor-user>' \
  --docker-password='<your-harbor-token>' \
  -n openagentic
```

### Step 4: Install Dependencies (IN ORDER)

Dependencies must be installed in order. Each must be healthy before proceeding.

#### 4.1 PostgreSQL HA with pgvector (on DALEK)

```bash
# Install PostgreSQL HA with pgvector extension
helm install postgresql bitnami/postgresql \
  -n openagentic \
  -f helm/openagentic/postgresql-values.yaml

# Wait for PostgreSQL primary to be ready
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=postgresql,app.kubernetes.io/component=primary \
  -n openagentic --timeout=300s

# Verify pgvector extension is available
kubectl exec -n openagentic postgresql-primary-0 -- \
  psql -U openagentic -d openagenticchat -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

#### 4.2 Redis HA with Sentinel

```bash
# Install Redis HA
helm install redis bitnami/redis \
  -n openagentic \
  -f helm/openagentic/redis-values.yaml

# Wait for Redis master to be ready
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=redis,app.kubernetes.io/component=master \
  -n openagentic --timeout=300s

# Verify Redis is responding
kubectl exec -n openagentic redis-master-0 -- redis-cli -a openagentic123 PING
```

#### 4.3 Milvus GPU Standalone (on DALEK GPU 1)

```bash
# Install Milvus GPU standalone
helm install milvus zilliztech/milvus \
  -n openagentic \
  -f helm/openagentic/milvus-standalone-gpu.yaml

# Wait for Milvus standalone to be ready (takes 3-5 minutes)
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=milvus,app.kubernetes.io/component=standalone \
  -n openagentic --timeout=600s

# Verify Milvus is using GPU
kubectl logs -n openagentic -l app.kubernetes.io/name=milvus,app.kubernetes.io/component=standalone | grep -i gpu
```

### Step 5: Verify HAL Ollama is Running

Before deploying OpenAgentic, ensure HAL's native Ollama has the required models:

```bash
# Check Ollama is accessible
curl -s http://10.0.0.175:11434/api/tags | jq '.models[].name'

# Required models:
# - gpt-oss (chat)
# - qwen2.5-coder:7b (code mode)
# - nomic-embed-text (embeddings)

# Pull models if missing
ssh hal "ollama pull gpt-oss && ollama pull qwen2.5-coder:7b && ollama pull nomic-embed-text"
```

### Step 6: Install OpenAgentic

```bash
helm upgrade --install openagentic ./helm/openagentic \
  -n openagentic \
  -f helm/openagentic/values-k3s-local.yaml

# Wait for core services to be ready
kubectl wait --for=condition=ready pod -l app.kubernetes.io/component=api \
  -n openagentic --timeout=300s
```

### Step 7: Verify Deployment

```bash
# Check all pods
kubectl get pods -n openagentic -o wide

# Check services
kubectl get svc -n openagentic

# Check Gateway and HTTPRoutes
kubectl get gateway -n openagentic
kubectl get httproute -n openagentic

# Verify Gateway is programmed (should show "Programmed: True")
kubectl describe gateway openagentic-gateway -n openagentic | grep -A5 "Conditions:"

# Get the Envoy service external IP/port
kubectl get svc -n envoy-gateway-system -l gateway.envoyproxy.io/owning-gateway-namespace=openagentic

# Check API health
kubectl exec -n openagentic deployment/openagentic-api -- curl -s localhost:8000/api/health | jq

# Check models endpoint (via Gateway)
curl -s http://localhost:8080/api/models | jq '.models[].id'

# View API logs
kubectl logs -n openagentic -l app.kubernetes.io/component=api -f
```

## Configuration Files

| File | Purpose |
|------|---------|
| `values-k3s-local.yaml` | Main values file for K3s local deployment |
| `postgresql-values.yaml` | PostgreSQL HA with pgvector configuration |
| `redis-values.yaml` | Redis HA with Sentinel configuration |
| `milvus-standalone-gpu.yaml` | Milvus GPU standalone on DALEK GPU 1 |

## LLM Provider Configuration

The platform uses **Gemini 2.5 Pro** as the primary LLM provider with **Ollama** as fallback:

| Model | Provider | Purpose |
|-------|----------|---------|
| `gemini-2.5-pro` | Google AI | Primary chat, image, video, PDF (multimodal) |
| `gpt-oss` | Ollama (HAL) | Fallback chat model |
| `qwen2.5-coder:7b` | Ollama (HAL) | Code Mode model |
| `nomic-embed-text` | Ollama (HAL) | Embeddings |

**Gemini API Key**: Configured in `values-k3s-local.yaml` at line 74:
```yaml
GEMINI_API_KEY: "AQ.Ab8RN6K7dXJwQGgQ8Gx_trO1FEKc1ELYJ02kzfE-TubM71MMRw"
```

## GPU Assignment

| Component | Node | GPU | CUDA_VISIBLE_DEVICES |
|-----------|------|-----|---------------------|
| Ollama (chat/code) | HAL | RTX 3090 | Native (not containerized) |
| Milvus standalone | DALEK | GPU 1 (RTX 2080 Ti) | `1` |
| PostgreSQL (pgvector) | DALEK | N/A (CPU-based) | N/A |

**Note**: pgvector is a CPU-based PostgreSQL extension. It runs on DALEK for co-location with other data services but does not use GPU acceleration.

## Upgrading

```bash
# Upgrade dependencies first (if needed)
helm upgrade postgresql bitnami/postgresql -n openagentic -f helm/openagentic/postgresql-values.yaml
helm upgrade redis bitnami/redis -n openagentic -f helm/openagentic/redis-values.yaml
helm upgrade milvus zilliztech/milvus -n openagentic -f helm/openagentic/milvus-standalone-gpu.yaml

# Then upgrade the main chart
helm upgrade openagentic ./helm/openagentic \
  -n openagentic \
  -f helm/openagentic/values-k3s-local.yaml
```

## Uninstalling

```bash
# Uninstall in reverse order
helm uninstall openagentic -n openagentic
helm uninstall milvus -n openagentic
helm uninstall redis -n openagentic
helm uninstall postgresql -n openagentic

# Optionally delete PVCs (WARNING: data loss!)
kubectl delete pvc --all -n openagentic

# Delete namespace
kubectl delete namespace openagentic
```

## Troubleshooting

### Pods stuck in Pending

```bash
# Check events
kubectl describe pod <pod-name> -n openagentic

# Common causes:
# - No available nodes with resources
# - PVC not bound (check storage class)
# - Image pull errors (check registry credentials)
# - GPU not available (check nvidia-device-plugin)
```

### Gateway / HTTPRoute Issues

```bash
# Check if Gateway API CRDs are installed
kubectl get crd | grep gateway.networking.k8s.io

# Check if Envoy Gateway controller is running
kubectl get pods -n envoy-gateway-system

# Check Gateway status
kubectl get gateway -n openagentic -o yaml

# Check HTTPRoute status (look for "Accepted" and "ResolvedRefs" conditions)
kubectl get httproute -n openagentic -o yaml

# Check if Envoy proxy pods are created for your gateway
kubectl get pods -n envoy-gateway-system -l gateway.envoyproxy.io/owning-gateway-namespace=openagentic

# View Envoy Gateway controller logs
kubectl logs -n envoy-gateway-system deployment/envoy-gateway --tail=100

# View Envoy proxy logs (if proxy pods exist)
kubectl logs -n envoy-gateway-system -l gateway.envoyproxy.io/owning-gateway-namespace=openagentic --tail=100

# Common causes:
# - Gateway API CRDs not installed
# - Envoy Gateway not installed or not ready
# - TLS secret not found in namespace
# - Invalid hostname in Gateway spec
# - GatewayClass not accepted (check gatewayclass status)
```

### Gateway TLS issues

```bash
# Verify TLS secret exists
kubectl get secret openagentic-wildcard-tls -n openagentic

# Check TLS secret has correct data
kubectl get secret openagentic-wildcard-tls -n openagentic -o jsonpath='{.data}' | jq 'keys'
# Should show: ["tls.crt", "tls.key"]

# Test TLS termination
curl -v http://localhost:8080/api/health 2>&1 | grep -E "SSL|TLS|certificate"
```

### Milvus GPU issues

```bash
# Check if Milvus pod is using GPU
kubectl describe pod -n openagentic -l app.kubernetes.io/name=milvus,app.kubernetes.io/component=standalone | grep -A5 "Limits:"

# Check GPU allocation
kubectl exec -n openagentic -l app.kubernetes.io/name=milvus,app.kubernetes.io/component=standalone -- nvidia-smi

# Check Milvus logs for GPU initialization
kubectl logs -n openagentic -l app.kubernetes.io/name=milvus,app.kubernetes.io/component=standalone | grep -i "gpu\|cuda"
```

### Ollama connection issues

```bash
# Test Ollama from within cluster
kubectl run test-ollama --rm -it --image=curlimages/curl -n openagentic -- \
  curl -s http://10.0.0.175:11434/api/tags | head -20

# Check if models are loaded
curl -s http://10.0.0.175:11434/api/tags | jq '.models[].name'

# Test chat completion
curl -s http://10.0.0.175:11434/api/generate -d '{
  "model": "gpt-oss",
  "prompt": "Hello",
  "stream": false
}' | jq '.response'
```

### API won't start

```bash
# Check logs
kubectl logs -n openagentic -l app.kubernetes.io/component=api --tail=100

# Common causes:
# - Database not ready (check PostgreSQL pod)
# - Redis connection failed (check Redis pod)
# - Gemini API key invalid (check env vars)
# - Missing secrets
```

### Code Mode issues

```bash
# Check code-manager logs
kubectl logs -n openagentic -l app.kubernetes.io/component=code-manager --tail=50

# Check runner pods
kubectl get pods -n openagentic | grep openagentic-

# Check workspace MinIO
kubectl logs -n openagentic -l app.kubernetes.io/component=workspace-minio --tail=50
```

## Service Ports Reference

| Service | Port | Protocol | Description |
|---------|------|----------|-------------|
| openagentic-api | 8000 | HTTP | Main API |
| openagentic-ui | 80 | HTTP | React UI (nginx) |
| openagentic-mcp-proxy | 8080 | HTTP | MCP tool proxy |
| openagentic-code-manager | 8080 | HTTP | Code session management |
| openagentic-workspace-minio | 9000 | HTTP | Object storage API |
| postgresql | 5432 | TCP | PostgreSQL primary |
| postgresql-read | 5432 | TCP | PostgreSQL read replica |
| redis-master | 6379 | TCP | Redis master |
| milvus-standalone | 19530 | gRPC | Milvus vector DB |

## Related Documentation

- [AKS Deployment Prerequisites](DEPLOYMENT-PREREQS-AKS.md)
- [Fresh AKS Deployment Guide](DEPLOYMENT_AKS_FRESH.md)
- [Gateway API Migration](GATEWAY-API-MIGRATION.md)
- [Secrets Backup](SECRETS-BACKUP.md)

IF YOU GET LOST YOU MUWST FOLLOW THIS TO DEPLOY MILVUS WITH GPU SUPPORT USING WOODPECKER

Install Helm Chart for Milvus

Helm is a K8s package manager that can help you deploy Milvus quickly.

    Add Milvus Helm repository.

$ helm repo add milvus https://zilliztech.github.io/milvus-helm/

  
    
  

The Milvus Helm Charts repo at https://milvus-io.github.io/milvus-helm/ has been archived and you can get further updates from https://zilliztech.github.io/milvus-helm/ as follows:

helm repo add zilliztech https://zilliztech.github.io/milvus-helm
helm repo update
upgrade existing helm release
helm upgrade my-release zilliztech/milvus

  
    
  

The archived repo is still available for the charts up to 4.0.31. For later releases, use the new repo instead.

    Update charts locally.

$ helm repo update

  
    
  

Start Milvus

Once you have installed the Helm chart, you can start Milvus on Kubernetes. In this section, we will guide you through the steps to start Milvus with GPU support.

You should start Milvus with Helm by specifying the release name, the chart, and the parameters you expect to change. In this guide, we use my-release as the release name. To use a different release name, replace my-release in the following commands with the one you are using.

Milvus allows you to assign one or more GPU devices to Milvus.
1. Assign a single GPU device

Milvus with GPU support allows you to assign one or more GPU devices.

    Milvus cluster

    cat <<EOF > custom-values.yaml
    dataNode:
      resources:
        requests:
          nvidia.com/gpu: "1"
        limits:
          nvidia.com/gpu: "1"
    queryNode:
      resources:
        requests:
          nvidia.com/gpu: "1"
        limits:
          nvidia.com/gpu: "1"
    EOF

      
        
      

    $ helm install my-release milvus/milvus -f custom-values.yaml

      
        
      

    Milvus standalone

    cat <<EOF > custom-values.yaml
    standalone:
      resources:
        requests:
          nvidia.com/gpu: "1"
        limits:
          nvidia.com/gpu: "1"
    EOF

      
        
      

    $ helm install my-release milvus/milvus --set cluster.enabled=false --set etcd.replicaCount=1 --set minio.mode=standalone --set pulsarv3.enabled=false -f custom-values.yaml

      
        
      

2. Assign multiple GPU devices

In addition to a single GPU device, you can also assign multiple GPU devices to Milvus.

    Milvus cluster

    cat <<EOF > custom-values.yaml
    dataNode:
      resources:
        requests:
          nvidia.com/gpu: "2"
        limits:
          nvidia.com/gpu: "2"
    queryNode:
      resources:
        requests:
          nvidia.com/gpu: "2"
        limits:
          nvidia.com/gpu: "2"
    EOF

      
        
      

    In the configuration above, there are four CPUs available, and each dataNode and queryNode uses two GPUs. To assign different GPUs to the dataNode and the queryNode, you can modify the configuration accordingly by setting extraEnv in the configuration file as follows:

    cat <<EOF > custom-values.yaml
    dataNode:
      resources:
        requests:
          nvidia.com/gpu: "1"
        limits:
          nvidia.com/gpu: "1"
      extraEnv:
        - name: CUDA_VISIBLE_DEVICES
          value: "0"
    queryNode:
      resources:
        requests:
          nvidia.com/gpu: "1"
        limits:
          nvidia.com/gpu: "1"
      extraEnv:
        - name: CUDA_VISIBLE_DEVICES
          value: "1"
    EOF

      
        
      

    $ helm install my-release milvus/milvus -f custom-values.yaml

      
        
      

        The release name should only contain letters, numbers and dashes. Dots are not allowed in the release name.
        The default command line installs cluster version of Milvus while installing Milvus with Helm. Further setting is needed while installing Milvus standalone.
        According to the deprecated API migration guide of Kuberenetes, the policy/v1beta1 API version of PodDisruptionBudget is not longer served as of v1.25. You are suggested to migrate manifests and API clients to use the policy/v1 API version instead.
        As a workaround for users who still use the policy/v1beta1 API version of PodDisruptionBudget on Kuberenetes v1.25 and later, you can instead run the following command to install Milvus:
        helm install my-release milvus/milvus --set pulsar.bookkeeper.pdb.usePolicy=false,pulsar.broker.pdb.usePolicy=false,pulsar.proxy.pdb.usePolicy=false,pulsar.zookeeper.pdb.usePolicy=false
        See Milvus Helm Chart and Helm for more information.

    Milvus standalone

    cat <<EOF > custom-values.yaml
    dataNode:
      resources:
        requests:
          nvidia.com/gpu: "2"
        limits:
          nvidia.com/gpu: "2"
    queryNode:
      resources:
        requests:
          nvidia.com/gpu: "2"
        limits:
          nvidia.com/gpu: "2"
    EOF

      
        
      

    In the configuration above, there are four CPUs available, and each dataNode and queryNode uses two GPUs. To assign different GPUs to the dataNode and the queryNode, you can modify the configuration accordingly by setting extraEnv in the configuration file as follows:

    cat <<EOF > custom-values.yaml
    dataNode:
      resources:
        requests:
          nvidia.com/gpu: "1"
        limits:
          nvidia.com/gpu: "1"
      extraEnv:
        - name: CUDA_VISIBLE_DEVICES
          value: "0"
    queryNode:
      resources:
        requests:
          nvidia.com/gpu: "1"
        limits:
          nvidia.com/gpu: "1"
      extraEnv:
        - name: CUDA_VISIBLE_DEVICES
          value: "1"
    EOF

      
        
      

    $ helm install my-release milvus/milvus --set cluster.enabled=false --set etcd.replicaCount=1 --set minio.mode=standalone --set pulsarv3.enabled=false -f custom-values.yaml

      
        
      

2. Check Milvus status

Run the following command to check Milvus status:

$ kubectl get pods

  
    
  

After Milvus starts, the READY column displays 1/1 for all pods.

    Milvus cluster

    NAME                                             READY  STATUS   RESTARTS  AGE
    my-release-etcd-0                                  1/1     Running     0             3m24s
    my-release-etcd-1                                  1/1     Running     0             3m24s
    my-release-etcd-2                                  1/1     Running     0             3m24s
    my-release-milvus-datanode-698dbf7d77-rjkkq        1/1     Running     0             3m24s
    my-release-milvus-mixcoord-856d666559-rpj8z        1/1     Running     0             3m24s
    my-release-milvus-proxy-7f7cf47689-pzltw           1/1     Running     0             3m24s
    my-release-milvus-querynode-7fb6d5b5f8-92phj       1/1     Running     0             3m24s
    my-release-milvus-streamingnode-5867bfbcbf-cg9xx   1/1     Running     0             3m24s
    my-release-minio-0                                 1/1     Running     0             3m24s
    my-release-minio-1                                 1/1     Running     0             3m24s
    my-release-minio-2                                 1/1     Running     0             3m24s
    my-release-minio-3                                 1/1     Running     0             3m24s
    my-release-pulsarv3-bookie-0                       1/1     Running     0             3m24s
    my-release-pulsarv3-bookie-1                       1/1     Running     0             3m24s
    my-release-pulsarv3-bookie-2                       1/1     Running     0             3m24s
    my-release-pulsarv3-bookie-init-p8hcq              0/1     Completed   0             3m24s
    my-release-pulsarv3-broker-0                       1/1     Running     0             3m24s
    my-release-pulsarv3-broker-1                       1/1     Running     0             3m24s
    my-release-pulsarv3-proxy-0                        1/1     Running     0             3m24s
    my-release-pulsarv3-proxy-1                        1/1     Running     0             3m24s
    my-release-pulsarv3-pulsar-init-8kjsj              0/1     Completed   0             3m24s
    my-release-pulsarv3-recovery-0                     1/1     Running     0             3m24s
    my-release-pulsarv3-zookeeper-0                    1/1     Running     0             3m24s
    my-release-pulsarv3-zookeeper-1                    1/1     Running     0             3m24s
    my-release-pulsarv3-zookeeper-2                    1/1     Running     0             3m24s

      
        
      

    Milvus standalone

    NAME                                               READY   STATUS      RESTARTS   AGE
    my-release-etcd-0                                  1/1     Running     0          30s
    my-release-milvus-standalone-54c4f88cb9-f84pf      1/1     Running     0          30s
    my-release-minio-5564fbbddc-mz7f5                  1/1     Running     0          30s

      
        
      

3. Forward a local port to Milvus

Verify which local port the Milvus server is listening on. Replace the pod name with your own.

$ kubectl get pod my-release-milvus-proxy-6bd7f5587-ds2xv --template
='{{(index (index .spec.containers 0).ports 0).containerPort}}{{"\n"}}'
19530

  
    
  

Then, run the following command to forward a local port to the port at which Milvus serves.

$ kubectl port-forward service/my-release-milvus 27017:19530
Forwarding from 127.0.0.1:27017 -> 19530

  
    
  

Optionally, you can use :19530 instead of 27017:19530 in the above command to let kubectl allocate a local port for you so that you don’t have to manage port conflicts.

By default, kubectl’s port-forwarding only listens on localhost. Use the address flag if you want Milvus to listen on the selected or all IP addresses. The following command makes port-forward listen on all IP addresses on the host machine.

$ kubectl port-forward --address 0.0.0.0 service/my-release-milvus 27017:19530
Forwarding from 0.0.0.0:27017 -> 19530

  
    
  

Now, you can connect to Milvus using the forwarded port.
Access Milvus WebUI

Milvus ships with a built-in GUI tool called Milvus WebUI that you can access through your browser. Milvus Web UI enhances system observability with a simple and intuitive interface. You can use Milvus Web UI to observe the statistics and metrics of the components and dependencies of Milvus, check database and collection details, and list detailed Milvus configurations. For details about Milvus Web UI, see Milvus WebUI

To enable the access to the Milvus Web UI, you need to port-forward the proxy pod to a local port.

kubectl port-forward --address 0.0.0.0 service/my-release-milvus 27018:9091
Forwarding from 0.0.0.0:27018 -> 9091

  
    
  

Now, you can access Milvus Web UI at http://localhost:27018.
Uninstall Milvus

Run the following command to uninstall Milvus.

$ helm uninstall my-release