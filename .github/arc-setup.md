# GitHub Actions Runner Controller (ARC) Setup

## Overview
This guide sets up GitHub Actions Runner Controller to enable fast, scalable CI/CD builds for the Agentic WorkChat project.

## Benefits
- **Fast parallel builds**: Run multiple Docker builds simultaneously
- **Auto-scaling**: Runners scale based on workflow demand
- **Cost-effective**: Only use resources when needed
- **Containerized builds**: Consistent build environment

## Prerequisites
- Kubernetes cluster (same cluster running the app)
- Helm 3.x installed
- GitHub Personal Access Token or GitHub App credentials
- kubectl access to the cluster

## Installation Steps

### 1. Install cert-manager (required by ARC)
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.4/cert-manager.yaml
kubectl wait --for=condition=Available --timeout=300s deployment/cert-manager -n cert-manager
```

### 2. Install Actions Runner Controller
```bash
helm repo add actions-runner-controller https://actions-runner-controller.github.io/actions-runner-controller
helm repo update

# Create namespace
kubectl create namespace actions-runner-system

# Install ARC
helm upgrade --install --namespace actions-runner-system \
  --create-namespace \
  --wait actions-runner-controller \
  actions-runner-controller/actions-runner-controller \
  --set syncPeriod=1m
```

### 3. Create GitHub Authentication Secret

#### Option A: Using Personal Access Token (simpler)
```bash
kubectl create secret generic controller-manager \
  -n actions-runner-system \
  --from-literal=github_token=YOUR_GITHUB_PAT
```
Required PAT scopes: `repo`, `workflow`, `admin:org` (if using org runners)

#### Option B: Using GitHub App (recommended for production)
```bash
kubectl create secret generic controller-manager \
  -n actions-runner-system \
  --from-literal=github_app_id=YOUR_APP_ID \
  --from-literal=github_app_installation_id=YOUR_INSTALLATION_ID \
  --from-literal=github_app_private_key="$(cat path-to-private-key.pem)"
```

### 4. Deploy Runner Scale Set

Create `arc-runner-deployment.yaml`:
```yaml
apiVersion: actions.summerwind.dev/v1alpha1
kind: RunnerDeployment
metadata:
  name: openagenticchat-runner
  namespace: actions-runner-system
spec:
  replicas: 2
  template:
    spec:
      repository: cdcent/agentic
      labels:
        - self-hosted
        - linux
        - x64
        - docker
      dockerEnabled: true
      dockerdWithinRunnerContainer: true
      resources:
        limits:
          cpu: "4"
          memory: "8Gi"
        requests:
          cpu: "2"
          memory: "4Gi"
      volumeMounts:
        - name: docker-storage
          mountPath: /var/lib/docker
      volumes:
        - name: docker-storage
          emptyDir:
            sizeLimit: 50Gi
---
apiVersion: actions.summerwind.dev/v1alpha1
kind: HorizontalRunnerAutoscaler
metadata:
  name: openagenticchat-runner-autoscaler
  namespace: actions-runner-system
spec:
  scaleTargetRef:
    kind: RunnerDeployment
    name: openagenticchat-runner
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: PercentageRunnersBusy
      scaleUpThreshold: '0.75'
      scaleDownThreshold: '0.25'
      scaleUpFactor: '2'
      scaleDownFactor: '0.5'
```

Apply the configuration:
```bash
kubectl apply -f arc-runner-deployment.yaml
```

### 5. Configure ACR Access for Runners

Create a secret with ACR credentials:
```bash
kubectl create secret docker-registry acr-secret \
  -n actions-runner-system \
  --docker-server=omcpdevaksagenticregistry.azurecr.io \
  --docker-username=YOUR_ACR_USERNAME \
  --docker-password=YOUR_ACR_PASSWORD
```

## GitHub Workflow Configuration

Create `.github/workflows/build-and-push.yml`:
```yaml
name: Build and Push Images

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

env:
  REGISTRY: omcpdevaksagenticregistry.azurecr.io

jobs:
  build-api:
    runs-on: [self-hosted, linux, x64, docker]
    steps:
      - uses: actions/checkout@v4

      - name: Log in to ACR
        run: |
          echo "${{ secrets.ACR_PASSWORD }}" | docker login ${{ env.REGISTRY }} \
            -u ${{ secrets.ACR_USERNAME }} --password-stdin

      - name: Build and push API
        run: |
          cd services/openagenticchat-api
          docker build -t ${{ env.REGISTRY }}/openagenticchat-api:${{ github.sha }} \
                       -t ${{ env.REGISTRY }}/openagenticchat-api:latest .
          docker push ${{ env.REGISTRY }}/openagenticchat-api:${{ github.sha }}
          docker push ${{ env.REGISTRY }}/openagenticchat-api:latest

  build-ui:
    runs-on: [self-hosted, linux, x64, docker]
    steps:
      - uses: actions/checkout@v4

      - name: Log in to ACR
        run: |
          echo "${{ secrets.ACR_PASSWORD }}" | docker login ${{ env.REGISTRY }} \
            -u ${{ secrets.ACR_USERNAME }} --password-stdin

      - name: Build and push UI
        run: |
          cd services/openagenticchat-ui
          docker build -t ${{ env.REGISTRY }}/openagenticchat-ui:${{ github.sha }} \
                       -t ${{ env.REGISTRY }}/openagenticchat-ui:latest .
          docker push ${{ env.REGISTRY }}/openagenticchat-ui:${{ github.sha }}
          docker push ${{ env.REGISTRY }}/openagenticchat-ui:latest

  build-mcp:
    runs-on: [self-hosted, linux, x64, docker]
    steps:
      - uses: actions/checkout@v4

      - name: Log in to ACR
        run: |
          echo "${{ secrets.ACR_PASSWORD }}" | docker login ${{ env.REGISTRY }} \
            -u ${{ secrets.ACR_USERNAME }} --password-stdin

      - name: Build and push MCP Orchestrator
        run: |
          cd services/mcp-orchestrator
          docker build -t ${{ env.REGISTRY }}/mcp-orchestrator:${{ github.sha }} \
                       -t ${{ env.REGISTRY }}/mcp-orchestrator:latest .
          docker push ${{ env.REGISTRY }}/mcp-orchestrator:${{ github.sha }}
          docker push ${{ env.REGISTRY }}/mcp-orchestrator:latest

  deploy:
    needs: [build-api, build-ui, build-mcp]
    runs-on: [self-hosted, linux, x64]
    if: github.ref == 'refs/heads/develop'
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to TST
        run: |
          helm upgrade openagenticchat-tst ./helm/openagenticchat-v3 \
            -f helm/values-tst.yaml \
            --namespace openagenticchat-tst \
            --set api.image.tag=${{ github.sha }} \
            --set ui.image.tag=${{ github.sha }} \
            --set mcpOrchestrator.image.tag=${{ github.sha }}
```

## Monitoring

Check runner status:
```bash
kubectl get runners -n actions-runner-system
kubectl get pods -n actions-runner-system
```

View runner logs:
```bash
kubectl logs -n actions-runner-system -l app=actions-runner
```

## Optimization Tips

1. **Use build caching**: Configure Docker buildx for layer caching
2. **Parallel builds**: Run API, UI, and MCP builds concurrently
3. **Resource tuning**: Adjust runner CPU/memory based on build requirements
4. **Registry mirror**: Set up local registry mirror for faster pulls

## Troubleshooting

### Runners not registering
- Check GitHub token/app permissions
- Verify repository name in RunnerDeployment
- Check controller-manager logs: `kubectl logs -n actions-runner-system deployment/actions-runner-controller`

### Build failures
- Ensure ACR credentials are correct
- Check runner pod logs for Docker daemon issues
- Verify network connectivity to ACR

### Performance issues
- Increase runner resources
- Add more replicas in HorizontalRunnerAutoscaler
- Enable Docker layer caching