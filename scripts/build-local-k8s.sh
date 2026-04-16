# Proprietary and confidential. Unauthorized copying prohibited.

# Build images for local Docker Desktop Kubernetes
# Docker Desktop K8s can use images directly from the local Docker daemon
# No registry needed - just build with the right tags

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Image tag - default to "latest" for local dev
TAG="${1:-latest}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Building OpenAgenticChat Images for Docker Desktop K8s ===${NC}"
echo "Project root: $PROJECT_ROOT"
echo "Tag: $TAG"
echo ""

cd "$PROJECT_ROOT"

# Enable BuildKit for faster builds
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# Custom images to build (matching docker-compose)
# These use the EXACT names from values-docker-desktop-local.yaml
declare -A IMAGES
IMAGES["agentic-openagenticchat-api"]="./services/openagenticchat-api/Dockerfile"
IMAGES["agentic-openagenticchat-ui"]="./services/openagenticchat-ui/Dockerfile"
IMAGES["agentic-mcp-proxy"]="./services/mcp-proxy/Dockerfile"
IMAGES["agentic-openagenticcode-manager"]="./services/openagenticcode-manager/Dockerfile"

# Build each image
for IMAGE in "${!IMAGES[@]}"; do
    DOCKERFILE="${IMAGES[$IMAGE]}"

    # Determine context
    if [[ "$IMAGE" == "agentic-openagenticcode-manager" ]]; then
        CONTEXT="./services/openagenticcode-manager"
    else
        CONTEXT="."
    fi

    echo -e "${YELLOW}Building $IMAGE:$TAG${NC}"
    echo "  Dockerfile: $DOCKERFILE"
    echo "  Context: $CONTEXT"

    # Build with appropriate args
    if [[ "$IMAGE" == "agentic-openagenticchat-api" ]]; then
        docker build -t "$IMAGE:$TAG" \
            --build-arg SRC_PATH=services/openagenticchat-api \
            -f "$DOCKERFILE" \
            "$CONTEXT"
    elif [[ "$IMAGE" == "agentic-openagenticchat-ui" ]]; then
        docker build -t "$IMAGE:$TAG" \
            --build-arg SRC_PATH=services/openagenticchat-ui \
            -f "$DOCKERFILE" \
            "$CONTEXT"
    else
        docker build -t "$IMAGE:$TAG" \
            -f "$DOCKERFILE" \
            "$CONTEXT"
    fi

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}  ✓ Built $IMAGE:$TAG${NC}"
    else
        echo -e "${RED}  ✗ Failed to build $IMAGE${NC}"
        exit 1
    fi
    echo ""
done

echo -e "${GREEN}=== All images built successfully ===${NC}"
echo ""
echo "Images available for Docker Desktop Kubernetes:"
docker images | grep -E "^agentic-" | head -10

echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Deploy to Docker Desktop K8s:"
echo "   helm upgrade --install openagenticchat ./helm/openagenticchat-v3 \\"
echo "     -f ./helm/openagenticchat-v3/values-docker-desktop-local.yaml \\"
echo "     -n openagenticchat --create-namespace"
echo ""
echo "2. Watch deployment progress:"
echo "   kubectl get pods -n openagenticchat -w"
