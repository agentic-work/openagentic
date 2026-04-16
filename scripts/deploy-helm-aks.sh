# Proprietary and confidential. Unauthorized copying prohibited.

# OpenAgentic Helm Deployment to AKS
# Deploys the full stack using Helm with AKS-specific configuration

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  OpenAgentic Helm Deployment (AKS)${NC}"
echo -e "${GREEN}========================================${NC}"

# Configuration
NAMESPACE="openagentic"
RELEASE_NAME="openagentic"
HELM_CHART="./helm/openagenticchat-v3"
KEYVAULT_NAME="kv-openagentic"
ACR_NAME="acropenagentic"

# Check if kubectl is configured
if ! kubectl cluster-info &> /dev/null; then
    echo -e "${RED}Error: kubectl is not configured. Run 'az aks get-credentials' first.${NC}"
    exit 1
fi

echo -e "${BLUE}Target cluster: $(kubectl config current-context)${NC}"
echo ""

# Get Azure subscription and tenant IDs
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
AKS_IDENTITY_CLIENT_ID=$(az aks show --name aks-openagentic --resource-group rg-openagentic --query identityProfile.kubeletidentity.clientId -o tsv)

echo -e "${BLUE}Azure Configuration:${NC}"
echo "  Subscription: $SUBSCRIPTION_ID"
echo "  Tenant: $TENANT_ID"
echo "  AKS Identity: $AKS_IDENTITY_CLIENT_ID"
echo ""

# Create namespace
echo -e "${YELLOW}[1/6] Creating namespace...${NC}"
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -
echo -e "${GREEN}✓ Namespace ready${NC}"

# Create secrets in Key Vault if they don't exist
echo -e "\n${YELLOW}[2/6] Setting up Key Vault secrets...${NC}"

# Generate random secrets if needed
JWT_SECRET=$(openssl rand -base64 32)
API_SECRET=$(openssl rand -base64 32)
FRONTEND_SECRET=$(openssl rand -base64 32)
SIGNING_SECRET=$(openssl rand -base64 32)

# Set secrets in Key Vault
az keyvault secret set --vault-name $KEYVAULT_NAME --name jwt-secret --value "$JWT_SECRET" --output none || echo "jwt-secret already exists"
az keyvault secret set --vault-name $KEYVAULT_NAME --name api-secret-key --value "$API_SECRET" --output none || echo "api-secret-key already exists"
az keyvault secret set --vault-name $KEYVAULT_NAME --name frontend-secret --value "$FRONTEND_SECRET" --output none || echo "frontend-secret already exists"
az keyvault secret set --vault-name $KEYVAULT_NAME --name signing-secret --value "$SIGNING_SECRET" --output none || echo "signing-secret already exists"

echo -e "${GREEN}✓ Key Vault secrets configured${NC}"

# Add Helm repos
echo -e "\n${YELLOW}[3/6] Adding Helm repositories...${NC}"
helm repo add bitnami https://charts.bitnami.com/bitnami --force-update
helm repo add zilliztech https://zilliztech.github.io/milvus-helm/ --force-update
helm repo update
echo -e "${GREEN}✓ Helm repos updated${NC}"

# Update Helm dependencies
echo -e "\n${YELLOW}[4/6] Updating Helm dependencies...${NC}"
cd $HELM_CHART
helm dependency update
cd - > /dev/null
echo -e "${GREEN}✓ Dependencies updated${NC}"

# Deploy with Helm
echo -e "\n${YELLOW}[5/6] Deploying with Helm...${NC}"
helm upgrade --install $RELEASE_NAME $HELM_CHART \
    --namespace $NAMESPACE \
    --values $HELM_CHART/values-aks.yaml \
    --values $HELM_CHART/values-gpu.yaml \
    --set global.azure.subscriptionId=$SUBSCRIPTION_ID \
    --set azureKeyVault.tenantId=$TENANT_ID \
    --set azureKeyVault.identityClientId=$AKS_IDENTITY_CLIENT_ID \
    --set image.registry=$ACR_NAME.azurecr.io \
    --wait \
    --timeout 10m

echo -e "${GREEN}✓ Helm deployment complete${NC}"

# Wait for pods
echo -e "\n${YELLOW}[6/6] Waiting for pods to be ready...${NC}"
kubectl wait --for=condition=ready pod \
    --selector=app.kubernetes.io/instance=$RELEASE_NAME \
    --namespace=$NAMESPACE \
    --timeout=300s || echo "Some pods may still be starting..."

echo -e "${GREEN}✓ Pods are ready${NC}"

# Show deployment status
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Check deployment status:${NC}"
echo "  kubectl get pods -n $NAMESPACE"
echo "  kubectl get svc -n $NAMESPACE"
echo "  kubectl get ingress -n $NAMESPACE"
echo ""
echo -e "${BLUE}View logs:${NC}"
echo "  kubectl logs -f deployment/openagentic-api -n $NAMESPACE"
echo "  kubectl logs -f deployment/openagentic-ui -n $NAMESPACE"
echo ""
echo -e "${BLUE}Access application:${NC}"
echo "  https://test.openagentic.io"
echo ""
