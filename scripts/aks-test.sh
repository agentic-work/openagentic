# Proprietary and confidential. Unauthorized copying prohibited.

# ===================================================================================================
# AKS CLUSTER TEST SCRIPT
# ===================================================================================================
# Run OpenAgentic platform tests on private AKS clusters via az aks command invoke
#
# Usage:
#   ./scripts/aks-test.sh -g <resource-group> -n <cluster-name> [--full] [--namespace <ns>]
#
# Examples:
#   # Quick health check
#   ./scripts/aks-test.sh -g openagentic-rg -n openagentic-aks
#
#   # Comprehensive test (LLM models, Workflows, Code Mode)
#   ./scripts/aks-test.sh -g openagentic-rg -n openagentic-aks --full
#
#   # Custom namespace
#   ./scripts/aks-test.sh -g openagentic-rg -n openagentic-aks --namespace production
# ===================================================================================================

set -e

# Default values
NAMESPACE="openagentic"
TEST_TYPE="quick"
RESOURCE_GROUP=""
CLUSTER_NAME=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
    echo "Usage: $0 -g <resource-group> -n <cluster-name> [OPTIONS]"
    echo ""
    echo "Required:"
    echo "  -g, --resource-group    Azure resource group name"
    echo "  -n, --name              AKS cluster name"
    echo ""
    echo "Options:"
    echo "  --full                  Run comprehensive tests (LLM, Workflows, Code Mode)"
    echo "  --namespace <ns>        Kubernetes namespace (default: openagentic)"
    echo "  --wait                  Wait for test completion and show logs"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  # Quick health check"
    echo "  $0 -g my-rg -n my-aks"
    echo ""
    echo "  # Full test with wait"
    echo "  $0 -g my-rg -n my-aks --full --wait"
    exit 1
}

# Parse arguments
WAIT_FOR_COMPLETION=false
while [[ $# -gt 0 ]]; do
    case $1 in
        -g|--resource-group)
            RESOURCE_GROUP="$2"
            shift 2
            ;;
        -n|--name)
            CLUSTER_NAME="$2"
            shift 2
            ;;
        --namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        --full)
            TEST_TYPE="full"
            shift
            ;;
        --wait)
            WAIT_FOR_COMPLETION=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

# Validate required args
if [ -z "$RESOURCE_GROUP" ] || [ -z "$CLUSTER_NAME" ]; then
    echo -e "${RED}Error: Resource group and cluster name are required${NC}"
    usage
fi

# Check az CLI is installed
if ! command -v az &> /dev/null; then
    echo -e "${RED}Error: Azure CLI (az) is not installed${NC}"
    exit 1
fi

# Generate unique job name
TIMESTAMP=$(date +%s)

if [ "$TEST_TYPE" = "full" ]; then
    JOB_NAME="test-full-$TIMESTAMP"
    CRONJOB_NAME="openagentic-comprehensive-test"
    echo -e "${BLUE}Running comprehensive platform tests...${NC}"
else
    JOB_NAME="test-$TIMESTAMP"
    CRONJOB_NAME="openagentic-cluster-test"
    echo -e "${BLUE}Running quick health check...${NC}"
fi

echo ""
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Cluster:        $CLUSTER_NAME"
echo "  Namespace:      $NAMESPACE"
echo "  Job Name:       $JOB_NAME"
echo ""

# Create the test job
echo -e "${YELLOW}Creating test job...${NC}"
az aks command invoke \
    --resource-group "$RESOURCE_GROUP" \
    --name "$CLUSTER_NAME" \
    --command "kubectl create job $JOB_NAME --from=cronjob/$CRONJOB_NAME -n $NAMESPACE"

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to create test job${NC}"
    exit 1
fi

echo -e "${GREEN}Test job created: $JOB_NAME${NC}"

if [ "$WAIT_FOR_COMPLETION" = true ]; then
    echo ""
    echo -e "${YELLOW}Waiting for test completion...${NC}"

    # Wait a bit for job to start
    sleep 5

    # Poll for completion (max 5 minutes)
    MAX_WAIT=300
    WAITED=0

    while [ $WAITED -lt $MAX_WAIT ]; do
        STATUS=$(az aks command invoke \
            --resource-group "$RESOURCE_GROUP" \
            --name "$CLUSTER_NAME" \
            --command "kubectl get job $JOB_NAME -n $NAMESPACE -o jsonpath='{.status.conditions[0].type}'" \
            2>/dev/null | grep -o "Complete\|Failed" || echo "Running")

        if [ "$STATUS" = "Complete" ] || [ "$STATUS" = "Failed" ]; then
            break
        fi

        echo -n "."
        sleep 10
        WAITED=$((WAITED + 10))
    done

    echo ""
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}                      TEST RESULTS                          ${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Get logs
    az aks command invoke \
        --resource-group "$RESOURCE_GROUP" \
        --name "$CLUSTER_NAME" \
        --command "kubectl logs job/$JOB_NAME -n $NAMESPACE"

    echo ""

    if [ "$STATUS" = "Complete" ]; then
        echo -e "${GREEN}✓ Tests completed successfully${NC}"
        exit 0
    elif [ "$STATUS" = "Failed" ]; then
        echo -e "${RED}✗ Tests failed${NC}"
        exit 1
    else
        echo -e "${YELLOW}⚠ Tests timed out after ${MAX_WAIT}s${NC}"
        exit 1
    fi
else
    echo ""
    echo "To view test results, run:"
    echo ""
    echo "  az aks command invoke \\"
    echo "    --resource-group $RESOURCE_GROUP \\"
    echo "    --name $CLUSTER_NAME \\"
    echo "    --command \"kubectl logs job/$JOB_NAME -n $NAMESPACE\""
    echo ""
fi
