# GitHub Actions Runner Controller Setup for AKS

## Prerequisites in GitHub Repository

### 1. Create Repository Secrets
Go to your GitHub repository → Settings → Secrets and variables → Actions

Add these secrets:
- `ACR_USERNAME`: Service principal client ID or ACR username
- `ACR_PASSWORD`: Service principal client secret or ACR password
- `KUBE_CONFIG`: Base64 encoded kubeconfig (optional, for deployments)

### 2. Create GitHub Personal Access Token
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Create a token with these scopes:
   - `repo` - Full control of private repositories
   - `workflow` - Update GitHub Actions workflows
   - `admin:org` - Full control of orgs (if using org-level runners)

### 3. Install ARC in your AKS cluster

```bash
# Install cert-manager (required dependency)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.4/cert-manager.yaml

# Add ARC Helm repository
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

# Create GitHub auth secret with your PAT
kubectl create secret generic controller-manager \
  -n actions-runner-system \
  --from-literal=github_token=YOUR_GITHUB_PAT
```

### 4. Create ACR Docker Config Secret

```bash
# Create docker config for ACR authentication
kubectl create secret docker-registry acr-secret \
  -n actions-runner-system \
  --docker-server=omcpdevaksagenticregistry.azurecr.io \
  --docker-username=YOUR_ACR_USERNAME \
  --docker-password=YOUR_ACR_PASSWORD

# Or create a docker config secret
ACR_AUTH=$(echo -n "YOUR_ACR_USERNAME:YOUR_ACR_PASSWORD" | base64)
kubectl create secret generic docker-config \
  -n actions-runner-system \
  --from-literal=config.json='{"auths":{"omcpdevaksagenticregistry.azurecr.io":{"auth":"'$ACR_AUTH'"}}}'
```

### 5. Deploy the Runner

```bash
kubectl apply -f .github/arc-runner-deployment.yaml
```

### 6. Enable GitHub Actions in Repository
1. Go to Settings → Actions → General
2. Set Actions permissions: "Allow all actions and reusable workflows"
3. Set Workflow permissions: "Read and write permissions"
4. Check "Allow GitHub Actions to create and approve pull requests"

### 7. Service Principal for AKS Deployments (Optional)

If runners need to deploy to AKS:

```bash
# Create service principal
az ad sp create-for-rbac \
  --name "github-actions-arc" \
  --role contributor \
  --scopes /subscriptions/1a195e6e-c768-4411-a35d-955b0ab7b80f/resourceGroups/ocio-omcp-dev-moderate-rg \
  --sdk-auth

# Save the output as AZURE_CREDENTIALS secret in GitHub
```

### 8. Network Configuration

Since runners are in the same AKS cluster:
- Internal communication uses Kubernetes DNS
- No additional firewall rules needed
- Runners can access cluster services directly

### 9. RBAC for Runners (if deploying to same cluster)

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: github-runner
  namespace: actions-runner-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: github-runner-admin
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
- kind: ServiceAccount
  name: github-runner
  namespace: actions-runner-system
```

## Testing the Setup

1. Check runner registration:
```bash
kubectl get runners -n actions-runner-system
```

2. View runner pods:
```bash
kubectl get pods -n actions-runner-system
```

3. Check runner logs:
```bash
kubectl logs -n actions-runner-system -l app=actions-runner
```

4. Trigger a workflow to test:
- Push to main/develop branch
- Create a pull request
- Manually trigger workflow

## Troubleshooting

### Runners not registering
- Check GitHub PAT has correct scopes
- Verify repository name in runner deployment
- Check controller-manager logs

### ACR authentication failures
- Verify ACR credentials in secrets
- Check docker-config secret format
- Ensure service principal has ACR pull permissions

### Deployment failures
- Check runner has correct RBAC permissions
- Verify kubeconfig if deploying cross-namespace
- Check network policies aren't blocking access