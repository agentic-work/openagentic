# Migrating from Ingress to Gateway API

## Overview

The Kubernetes Gateway API is the successor to Ingress and provides more flexible, expressive, and role-oriented APIs for exposing HTTP services. As of November 2025, Gateway API v1.0+ is GA and widely supported across major cloud providers and Kubernetes distributions.

## Why Migrate to Gateway API?

1. **Future-Proof**: Ingress is being sunsetted in favor of Gateway API
2. **Better Route Management**: More granular control over HTTP routing
3. **Role Separation**: Gateway (infrastructure) and HTTPRoute (application) separation
4. **Advanced Features**: Better support for weighted traffic, header manipulation, and timeouts
5. **Cloud Native**: Native support from Azure, AWS, GCP gateway controllers

## Prerequisites

### 1. Install Gateway API CRDs

Gateway API requires Custom Resource Definitions (CRDs) to be installed on your cluster:

```bash
# Install Gateway API v1.0.0 CRDs
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.0.0/standard-install.yaml

# Verify CRDs are installed
kubectl get crd | grep gateway
```

Expected output:
```
gatewayclasses.gateway.networking.k8s.io
gateways.gateway.networking.k8s.io
httproutes.gateway.networking.k8s.io
```

### 2. Install a Gateway Controller

You need to install a Gateway controller on your AKS cluster. Choose one based on your requirements:

#### Option A: NGINX Gateway Fabric (Recommended for migration from NGINX Ingress)

```bash
# Add NGINX Gateway Fabric Helm repository
helm repo add nginx-stable https://helm.nginx.com/stable
helm repo update

# Install NGINX Gateway Fabric
helm install nginx-gateway nginx-stable/nginx-gateway \
  --namespace nginx-gateway \
  --create-namespace \
  --set service.type=LoadBalancer

# Verify installation
kubectl get gatewayclass
```

#### Option B: Azure Application Gateway for Containers

```bash
# Install Azure Application Gateway for Containers
# Follow Azure documentation:
# https://learn.microsoft.com/en-us/azure/application-gateway/for-containers/quickstart-deploy-application-gateway-for-containers-alb-controller

# Key steps:
# 1. Enable ALB preview feature
az feature register --namespace Microsoft.ContainerService --name AKS-ExtensionManager

# 2. Install ALB controller via Helm
helm install alb-controller oci://mcr.microsoft.com/application-lb/charts/alb-controller \
  --namespace alb-system \
  --create-namespace \
  --set albController.namespace=alb-system

# Verify GatewayClass
kubectl get gatewayclass azure-alb-external
```

#### Option C: Istio Gateway

```bash
# Install Istio
curl -L https://istio.io/downloadIstio | sh -
cd istio-*
export PATH=$PWD/bin:$PATH

# Install Istio with Gateway support
istioctl install --set profile=default -y

# Verify GatewayClass
kubectl get gatewayclass istio
```

## Migration Steps

### Step 1: Keep Ingress Running (Zero Downtime Migration)

```bash
# Deploy with BOTH Ingress and Gateway API enabled
helm upgrade openagentic ./helm/openagentic-v3 \
  --namespace openagentic-dev \
  --set ingress.enabled=true \
  --set gateway.enabled=true \
  --set gateway.gatewayClassName=nginx \  # or azure-alb, istio
  --set gateway.hostname=chat-dev.openagentic.io
```

### Step 2: Test Gateway API

```bash
# Get Gateway status
kubectl get gateway -n openagentic-dev

# Check HTTPRoute
kubectl get httproute -n openagentic-dev

# Describe Gateway for details
kubectl describe gateway openagentic -n openagentic-dev

# Test Gateway endpoint
curl https://chat-dev.openagentic.io/api/health
```

### Step 3: Switch Traffic to Gateway (Disable Ingress)

Once you've verified Gateway API is working:

```bash
# Disable Ingress, keep only Gateway API
helm upgrade openagentic ./helm/openagentic-v3 \
  --namespace openagentic-dev \
  --set ingress.enabled=false \
  --set gateway.enabled=true \
  --set gateway.gatewayClassName=nginx \
  --set gateway.hostname=chat-dev.openagentic.io
```

### Step 4: Update DNS (if needed)

If the Gateway created a new LoadBalancer with a different IP:

```bash
# Get the Gateway external IP
kubectl get gateway openagentic -n openagentic-dev \
  -o jsonpath='{.status.addresses[0].value}'

# Update your DNS A record to point to this IP
```

## Configuration Examples

### Development Environment

```yaml
# values-dev.yaml
ingress:
  enabled: false

gateway:
  enabled: true
  gatewayClassName: nginx
  hostname: chat-dev.openagentic.io
  tls:
    secretName: openagentic-dev-tls
  timeouts:
    api: 3600s
    mcp: 300s
```

### Production Environment with Azure ALB

```yaml
# values-prod.yaml
ingress:
  enabled: false

gateway:
  enabled: true
  gatewayClassName: azure-alb-external
  hostname: chat.openagentic.io
  annotations:
    alb.networking.azure.io/alb-name: "production-alb"
    alb.networking.azure.io/alb-namespace: "alb-system"
  tls:
    secretName: openagentic-prod-tls
  timeouts:
    api: 3600s
    mcp: 300s
  addresses:
    - type: IPAddress
      value: "20.30.40.50"  # Static IP
```

## Key Differences: Ingress vs Gateway API

| Feature | Ingress | Gateway API |
|---------|---------|-------------|
| **API Version** | networking.k8s.io/v1 | gateway.networking.k8s.io/v1 |
| **Main Resource** | Ingress | Gateway + HTTPRoute |
| **Role Separation** | Single resource | Gateway (infra) + HTTPRoute (app) |
| **Timeouts** | Controller-specific annotations | Native timeout support |
| **Weighted Traffic** | Limited/annotation-based | Native support |
| **TLS** | Ingress-level | Listener-level (more flexible) |
| **Path Matching** | Basic | Advanced (exact, prefix, regex) |

## Troubleshooting

### Gateway not getting an IP address

```bash
# Check Gateway status
kubectl describe gateway openagentic -n openagentic-dev

# Check controller logs
kubectl logs -n nginx-gateway deployment/nginx-gateway
```

### HTTPRoute not attaching to Gateway

```bash
# Check HTTPRoute status
kubectl describe httproute openagentic -n openagentic-dev

# Verify parentRefs match Gateway name
kubectl get httproute openagentic -n openagentic-dev -o yaml
```

### TLS certificate issues

```bash
# Verify TLS secret exists
kubectl get secret openagentic-tls -n openagentic-dev

# Check cert-manager (if using)
kubectl get certificate -n openagentic-dev
kubectl describe certificate openagentic-tls -n openagentic-dev
```

## Rollback Plan

If you need to rollback to Ingress:

```bash
# Re-enable Ingress, disable Gateway
helm upgrade openagentic ./helm/openagentic-v3 \
  --namespace openagentic-dev \
  --set ingress.enabled=true \
  --set gateway.enabled=false
```

## Resources

- [Kubernetes Gateway API Documentation](https://gateway-api.sigs.k8s.io/)
- [NGINX Gateway Fabric](https://docs.nginx.com/nginx-gateway-fabric/)
- [Azure Application Gateway for Containers](https://learn.microsoft.com/en-us/azure/application-gateway/for-containers/)
- [Gateway API Migration Guide](https://gateway-api.sigs.k8s.io/guides/migrating-from-ingress/)

## Support

For issues specific to openagentic Gateway API implementation, please check:
- Helm chart templates: `helm/openagentic-v3/templates/gateway.yaml` and `httproute.yaml`
- Values configuration: `helm/openagentic-v3/values.yaml` (search for "gateway:")
- Example configuration: `helm/openagentic-v3/values-gateway-example.yaml`
