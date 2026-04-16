# Proprietary and confidential. Unauthorized copying prohibited.


# GitHub Actions Runner Controller Installation Script
# For Agentic WorkChat Project

set -e

echo "========================================="
echo "Installing GitHub Actions Runner Controller"
echo "========================================="

# Check prerequisites
command -v kubectl >/dev/null 2>&1 || { echo "kubectl is required but not installed. Aborting." >&2; exit 1; }
command -v helm >/dev/null 2>&1 || { echo "helm is required but not installed. Aborting." >&2; exit 1; }

# Step 1: Install cert-manager (required by ARC)
echo "Installing cert-manager..."
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.4/cert-manager.yaml
echo "Waiting for cert-manager to be ready..."
kubectl wait --for=condition=Available --timeout=300s deployment/cert-manager -n cert-manager

# Step 2: Add ARC Helm repository
echo "Adding Actions Runner Controller Helm repository..."
helm repo add actions-runner-controller https://actions-runner-controller.github.io/actions-runner-controller
helm repo update

# Step 3: Create namespace
echo "Creating actions-runner-system namespace..."
kubectl create namespace actions-runner-system --dry-run=client -o yaml | kubectl apply -f -

# Step 4: Install ARC
echo "Installing Actions Runner Controller..."
helm upgrade --install --namespace actions-runner-system \
  --create-namespace \
  --wait actions-runner-controller \
  actions-runner-controller/actions-runner-controller \
  --set syncPeriod=1m

# Step 5: Create GitHub authentication secret
echo "Creating GitHub authentication secret..."
echo "Please provide your GitHub Personal Access Token (PAT) with repo, workflow, and admin:org scopes:"
read -s GITHUB_TOKEN

kubectl create secret generic controller-manager \
  -n actions-runner-system \
  --from-literal=github_token=$GITHUB_TOKEN \
  --dry-run=client -o yaml | kubectl apply -f -

# Step 6: Create Docker registry secret for ACR
echo "Creating ACR authentication secret..."
echo "Please provide your Azure Container Registry username:"
read ACR_USERNAME
echo "Please provide your Azure Container Registry password:"
read -s ACR_PASSWORD

# Create docker config
DOCKER_CONFIG=$(echo -n "$ACR_USERNAME:$ACR_PASSWORD" | base64)
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: docker-config
  namespace: actions-runner-system
type: Opaque
data:
  config.json: $(echo "{\"auths\":{\"omcpdevaksagenticregistry.azurecr.io\":{\"auth\":\"$DOCKER_CONFIG\"}}}" | base64 -w0)
EOF

# Step 7: Deploy runner configuration
echo "Deploying runner configuration..."
kubectl apply -f .github/arc-runner-deployment.yaml

# Step 8: Verify deployment
echo "Verifying deployment..."
kubectl get runners -n actions-runner-system
kubectl get pods -n actions-runner-system

echo "========================================="
echo "GitHub Actions Runner Controller Installation Complete!"
echo "========================================="
echo ""
echo "To check runner status:"
echo "  kubectl get runners -n actions-runner-system"
echo ""
echo "To view runner logs:"
echo "  kubectl logs -n actions-runner-system -l app=actions-runner"
echo ""
echo "Next steps:"
echo "1. Add secrets to your GitHub repository:"
echo "   - ACR_USERNAME: Your Azure Container Registry username"
echo "   - ACR_PASSWORD: Your Azure Container Registry password"
echo "2. Push code to trigger workflows"
echo ""