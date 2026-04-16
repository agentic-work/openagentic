# Proprietary and confidential. Unauthorized copying prohibited.

# =============================================================================
# OpenAgentic Build Script - SINGLE SOURCE OF TRUTH
# =============================================================================
# Builds Docker images with maximum performance using BuildKit
# Supports parallel builds, multi-arch, and proper caching
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# External dependency paths — sibling repos (../<name> from this repo's perspective).
# Each one is rsynced into the Docker build context fresh on every build so the
# images always carry the latest source from the developer's working tree.
# CDC vendoring is a separate concern and uses a different sync flow (--sync-cdc).
SIBLING_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
SDK_DIR="$SIBLING_ROOT/openagentic-sdk"
CLI_DIR="$SIBLING_ROOT/openagentic"
OAT_DIR="$SIBLING_ROOT/oat"
GHOSTPILOT_DIR="$SIBLING_ROOT/ghostpilot"

# CDC sync target
CDC_REPO="/mnt/synology/Code/company/cdc/openagentic/openagentic-omhs"

# Version info from version.json
VERSION_FILE="$REPO_ROOT/version.json"
if [ -f "$VERSION_FILE" ]; then
    PLATFORM_VERSION=$(grep '"version"' "$VERSION_FILE" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
    PLATFORM_CODENAME=$(grep '"codename"' "$VERSION_FILE" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
else
    PLATFORM_VERSION="0.0.0"
    PLATFORM_CODENAME="dev"
fi
GIT_COMMIT_FULL=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
IMMUTABLE_TAG="${PLATFORM_VERSION}-${GIT_COMMIT}"

# System resources
CPU_CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 8)
TOTAL_MEM_GB=$(free -g 2>/dev/null | awk '/^Mem:/{print $2}' || echo 32)

# Registries
LOCAL_REGISTRY="10.2.10.131:30500"
GAR_REGISTRY="us-east4-docker.pkg.dev/openagentic-dev/openagentic"
ACR_REGISTRY="acropenagentic.azurecr.io"
CDC_ACR_REGISTRY="omcpdevaksagenticregistry.azurecr.io"
DEFAULT_REGISTRY="$LOCAL_REGISTRY"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# =============================================================================
# Service Definitions - ALL deployable services
# =============================================================================
declare -A SERVICES=(
    # [service-name]="dockerfile-path:context-path:src-path-arg"
    # src-path-arg is optional, only for services that need SRC_PATH build arg
    ["openagentic-api"]="services/openagentic-api/Dockerfile:.:services/openagentic-api"
    ["openagentic-ui"]="services/openagentic-ui/Dockerfile:.:services/openagentic-ui"
    ["openagentic-mcp-proxy"]="services/openagentic-mcp-proxy/Dockerfile:.:services/openagentic-mcp-proxy"
    ["openagentic-manager"]="services/openagentic-manager/Dockerfile:.:"
    ["openagentic-exec"]="services/openagentic-exec/Dockerfile:.:"
    ["oap-admin-mcp"]="services/mcps/oap-admin-mcp/Dockerfile:.:"
    ["oap-azure-mcp"]="services/mcps/oap-azure-mcp/Dockerfile:.:"
    ["oap-aws-mcp"]="services/mcps/oap-aws-mcp/Dockerfile:.:"
    ["openagentic-synth"]="services/openagentic-synth/Dockerfile.slim:.:services/openagentic-synth"
    ["openagentic-proxy"]="services/openagentic-proxy/Dockerfile:.:services/openagentic-proxy"
    ["openagentic-workflows"]="services/openagentic-workflows/Dockerfile:.:services/openagentic-workflows"
)

# =============================================================================
# Help
# =============================================================================
show_help() {
    echo -e "${GREEN}OpenAgentic Build Script${NC}"
    echo -e "Version: $PLATFORM_VERSION ($PLATFORM_CODENAME) | Commit: $GIT_COMMIT"
    echo -e "System: $CPU_CORES CPUs, ${TOTAL_MEM_GB}GB RAM"
    echo ""
    echo "Usage: $0 [OPTIONS] [SERVICE...]"
    echo ""
    echo "Options:"
    echo "  --buildpush          Build and push to registry"
    echo "  --install-mode MODE  Companion install mode: vendored (default) | git"
    echo "                       vendored = rsync ../oat ../ghostpilot ../openagentic (local dev)"
    echo "                       git      = clone from agentic-work via PAT (CI / OMHS / downstream)"
    echo "  --gh-pat-file PATH   Path to GitHub PAT file (default: ~/.config/agentic/gh-pa)"
    echo "                       Only used when --install-mode=git"
    echo "  --companion-ref REF  Git ref for companion repos when --install-mode=git (default: v0.6.2)"
    echo "  --registry <url>     Registry URL (default: local k3s at $LOCAL_REGISTRY)"
    echo "  --registry gar       Push to Google Artifact Registry ($GAR_REGISTRY)"
    echo "  --registry acr       Push to Azure Container Registry ($ACR_REGISTRY)"
    echo "  --tag <tag>          Image tag (default: latest)"
    echo "  --no-cache           Build without Docker cache"
    echo "  --skip-npm           Skip SDK/CLI npm builds"
    echo "  --multiarch          Build multi-arch images (amd64 + arm64)"
    echo "  --platform <p>       Custom platform list (default: linux/amd64,linux/arm64)"
    echo "  --parallel           Build services in parallel (experimental)"
    echo "  --sync-cdc           Rsync services/helm/version.json to CDC repo (develop branch)"
    echo "  --help               Show this help"
    echo ""
    echo "Services:"
    for svc in "${!SERVICES[@]}"; do
        echo "  $svc"
    done | sort
    echo ""
    echo "Examples:"
    echo "  $0 --buildpush openagentic-api                         # Build + push to LOCAL k3s registry (fast)"
    echo "  $0 --buildpush --no-cache openagentic-api              # Build + push to local, no cache"
    echo "  $0 --buildpush --registry gar openagentic-api          # Build + push to GAR (production)"
    echo "  $0 --buildpush --registry acr openagentic-api           # Build + push to ACR (AKS dev)"
    echo "  $0 --buildpush --multiarch --registry gar              # Multi-arch build + push to GAR"
    echo "  $0 --skip-npm --buildpush openagentic-api              # Skip npm, build + push to local"
}

# =============================================================================
# Parse Arguments
# =============================================================================
BUILD_PUSH=false
NO_CACHE=""
SKIP_NPM=false
PARALLEL=false
MULTIARCH=false
SYNC_CDC=false
PLATFORMS="linux/amd64,linux/arm64"
REGISTRY="$DEFAULT_REGISTRY"
REGISTRY_EXPLICIT=false
IMAGE_TAG="latest"
SELECTED_SERVICES=()

# Companion install mode (vendored | git)
#   vendored — sibling rsync into build context (default, fast local iteration)
#   git      — git+install via PAT secret mount (downstream/CI builds)
INSTALL_MODE="vendored"
GH_PAT_FILE="${HOME}/.config/agentic/gh-pa"
COMPANION_REF="v0.6.2"

while [[ $# -gt 0 ]]; do
    case $1 in
        --buildpush) BUILD_PUSH=true; shift ;;
        --registry)
            REGISTRY_EXPLICIT=true
            case "$2" in
                gar|GAR|prod|production)
                    REGISTRY="$GAR_REGISTRY"
                    ;;
                acr|ACR|azure)
                    REGISTRY="$ACR_REGISTRY"
                    ;;
                cdc|CDC|cdc-acr)
                    REGISTRY="$CDC_ACR_REGISTRY"
                    ;;
                local|k3s)
                    REGISTRY="$LOCAL_REGISTRY"
                    ;;
                *)
                    REGISTRY="$2"
                    ;;
            esac
            shift 2
            ;;
        --tag) IMAGE_TAG="$2"; shift 2 ;;
        --no-cache) NO_CACHE="--no-cache"; shift ;;
        --skip-npm) SKIP_NPM=true; shift ;;
        --multiarch) MULTIARCH=true; shift ;;
        --platform) PLATFORMS="$2"; shift 2 ;;
        --parallel) PARALLEL=true; shift ;;
        --sync-cdc) SYNC_CDC=true; shift ;;
        --install-mode)
            case "$2" in
                vendored|git) INSTALL_MODE="$2" ;;
                *) echo -e "${RED}--install-mode must be 'vendored' or 'git' (got: $2)${NC}"; exit 1 ;;
            esac
            shift 2
            ;;
        --gh-pat-file) GH_PAT_FILE="$2"; shift 2 ;;
        --companion-ref) COMPANION_REF="$2"; shift 2 ;;
        --help|-h) show_help; exit 0 ;;
        -*) echo -e "${RED}Unknown option: $1${NC}"; show_help; exit 1 ;;
        *) SELECTED_SERVICES+=("$1"); shift ;;
    esac
done

# Determine if using local registry
IS_LOCAL_REGISTRY=false
if [[ "$REGISTRY" == "$LOCAL_REGISTRY" ]]; then
    IS_LOCAL_REGISTRY=true
fi

# If --sync-cdc only (no services, no build), skip straight to sync
if [ "$SYNC_CDC" = true ] && [ ${#SELECTED_SERVICES[@]} -eq 0 ] && [ "$BUILD_PUSH" = false ]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  OpenAgentic CDC Sync${NC}"
    echo -e "${GREEN}========================================${NC}"
    # Jump to sync section (handled below after build loop)
    SELECTED_SERVICES=()  # empty = skip build loop
else
    # If no services specified, build all
    if [ ${#SELECTED_SERVICES[@]} -eq 0 ]; then
        SELECTED_SERVICES=("${!SERVICES[@]}")
    fi
fi

# =============================================================================
# Header
# =============================================================================
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  OpenAgentic Build Script${NC}"
echo -e "${GREEN}  Version: $PLATFORM_VERSION ($PLATFORM_CODENAME)${NC}"
echo -e "${GREEN}  CPUs: $CPU_CORES | RAM: ${TOTAL_MEM_GB}GB${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
if [ "$IS_LOCAL_REGISTRY" = true ]; then
    echo -e "Registry: ${CYAN}$REGISTRY${NC} ${GREEN}(local k3s - fast)${NC}"
else
    echo -e "Registry: ${CYAN}$REGISTRY${NC} ${YELLOW}(remote - slower push/pull)${NC}"
fi
echo -e "Tag: ${CYAN}$IMAGE_TAG${NC}"
echo -e "Immutable: ${CYAN}$IMMUTABLE_TAG${NC}"
echo -e "Branch: ${CYAN}$GIT_BRANCH${NC}"
echo -e "Commit: ${CYAN}$GIT_COMMIT${NC} ($GIT_COMMIT_FULL)"
echo -e "Services: ${CYAN}${SELECTED_SERVICES[*]}${NC}"
echo -e "Install mode: ${CYAN}${INSTALL_MODE}${NC}$([ "$INSTALL_MODE" = "git" ] && echo " (companion ref: $COMPANION_REF)")"
echo -e "No-cache: ${CYAN}${NO_CACHE:-no}${NC}"
echo -e "Multi-arch: ${CYAN}${MULTIARCH}${NC}"
if [ "$MULTIARCH" = true ]; then
    echo -e "Platforms: ${CYAN}${PLATFORMS}${NC}"
fi

# Dirty tree warning
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo ""
    echo -e "${YELLOW}WARNING: Working tree has uncommitted changes!${NC}"
    echo -e "${YELLOW}  Images will contain untracked modifications.${NC}"
fi
echo ""

# =============================================================================
# Sibling-repo preflight — resolve and verify each ../<repo> the build depends on
# =============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Sibling Repository Resolution${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Sibling root: ${CYAN}$SIBLING_ROOT${NC}"

# Map of: env-var-name => "label|required"
# In vendored mode, sibling repos are required (we copy from them).
# In git mode, sibling repos are NOT required — we only need the PAT file
# and the build creates empty placeholder dirs for the COPY instructions.
SIBLING_REQUIRED="true"
if [ "$INSTALL_MODE" = "git" ]; then
    SIBLING_REQUIRED="false"
fi
declare -A SIBLING_LABELS=(
    ["SDK_DIR"]="LLM SDK (../openagentic-sdk)|$SIBLING_REQUIRED"
    ["CLI_DIR"]="openagentic CLI (../openagentic)|$SIBLING_REQUIRED"
    ["OAT_DIR"]="OAT/Synth Python (../oat)|$SIBLING_REQUIRED"
    ["GHOSTPILOT_DIR"]="GhostPilot (../ghostpilot)|false"
)

SIBLING_MISSING=0
for var in SDK_DIR CLI_DIR OAT_DIR GHOSTPILOT_DIR; do
    path="${!var}"
    label_required="${SIBLING_LABELS[$var]}"
    label="${label_required%|*}"
    required="${label_required#*|}"
    if [ -d "$path" ]; then
        echo -e "  ${GREEN}✓${NC} $label  →  ${CYAN}$path${NC}"
    else
        if [ "$required" = "true" ]; then
            echo -e "  ${RED}✗ MISSING (required)${NC} $label  →  ${RED}$path${NC}"
            SIBLING_MISSING=$((SIBLING_MISSING + 1))
        else
            echo -e "  ${YELLOW}⚠ missing (optional)${NC} $label  →  ${YELLOW}$path${NC}"
        fi
    fi
done

if [ "$SIBLING_MISSING" -gt 0 ]; then
    echo ""
    echo -e "${RED}ERROR: $SIBLING_MISSING required sibling repo(s) missing.${NC}"
    echo -e "${RED}  Each one must be cloned next to this repo at \$SIBLING_ROOT${NC}"
    echo -e "${RED}  Required: openagentic-sdk, openagentic, oat${NC}"
    echo -e "${RED}  Optional: ghostpilot${NC}"
    exit 1
fi
echo ""

# =============================================================================
# Setup BuildKit for maximum performance
# =============================================================================
export DOCKER_BUILDKIT=1
export BUILDKIT_PROGRESS=plain
export COMPOSE_DOCKER_CLI_BUILD=1

# =============================================================================
# Build SDK and CLI (if not skipped) — npm install + tsc compile in source repos.
# When --skip-npm is passed we trust the existing dist/ output in each sibling.
# Either way the COPY section below ALWAYS rsyncs fresh into the Docker context.
#
# In INSTALL_MODE=git we skip BOTH the source builds AND the rsync entirely —
# the Dockerfile fetches from agentic-work/{sdk,oat,ghostpilot,openagentic} via
# PAT and we only need empty placeholder dirs in the build context so the COPY
# instructions don't fail. Done in the placeholder block further down.
# =============================================================================
if [ "$INSTALL_MODE" = "git" ]; then
    echo -e "${YELLOW}INSTALL_MODE=git — skipping sibling source builds and rsync${NC}"
    echo -e "${YELLOW}  Companion ref: $COMPANION_REF${NC}"
    if [ ! -f "$GH_PAT_FILE" ]; then
        echo -e "${RED}ERROR: PAT file not found at $GH_PAT_FILE${NC}"
        echo -e "${RED}  Pass --gh-pat-file <path> or create one (chmod 600)${NC}"
        exit 1
    fi
    if [ ! -r "$GH_PAT_FILE" ]; then
        echo -e "${RED}ERROR: PAT file at $GH_PAT_FILE is not readable${NC}"
        exit 1
    fi
    PAT_PERMS=$(stat -c %a "$GH_PAT_FILE" 2>/dev/null || stat -f %A "$GH_PAT_FILE" 2>/dev/null)
    if [ "$PAT_PERMS" != "600" ]; then
        echo -e "${YELLOW}WARNING: PAT file perms are $PAT_PERMS (recommended: 600)${NC}"
    fi
    echo -e "${GREEN}  PAT file: $GH_PAT_FILE (perms $PAT_PERMS)${NC}"
elif [ "$SKIP_NPM" = false ]; then
    echo -e "${YELLOW}[1/3] Building SDK ($SDK_DIR)...${NC}"
    cd "$SDK_DIR"
    npm install --silent
    npm run build
    echo -e "${GREEN}SDK built${NC}"

    echo -e "${YELLOW}[2/3] Building CLI ($CLI_DIR)...${NC}"
    cd "$CLI_DIR"
    npm install --silent
    # tsc has pre-existing type errors but still emits JS (noEmitOnError defaults to false)
    npm run build || {
        echo -e "${YELLOW}CLI tsc reported errors (expected — pre-existing type issues)${NC}"
        if [ -f "$CLI_DIR/dist/entrypoints/cli.js" ]; then
            echo -e "${GREEN}CLI dist exists despite errors — continuing${NC}"
        else
            echo -e "${RED}CLI dist missing — build failed${NC}"
            exit 1
        fi
    }
    echo -e "${GREEN}CLI built${NC}"
else
    echo -e "${YELLOW}Skipping npm builds (--skip-npm) — will copy existing dist/ output${NC}"
fi

# =============================================================================
# Sibling-source vendoring — vendored mode rsyncs real content; git mode
# creates empty placeholder dirs so the Dockerfile COPY instructions still
# succeed. The conditional RUN steps inside the Dockerfile decide whether
# to use the copied content (vendored) or git clone over PAT (git).
# =============================================================================
cd "$REPO_ROOT"

if [ "$INSTALL_MODE" = "git" ]; then
    echo -e "${YELLOW}Creating empty placeholder dirs for git-mode build...${NC}"
    for d in sdk openagentic-cli oat ghostpilot; do
        rm -rf "$REPO_ROOT/$d" 2>/dev/null || true
        mkdir -p "$REPO_ROOT/$d"
        touch "$REPO_ROOT/$d/.gitkeep"
    done
    # openagentic-cli is COPY'd as 3 separate paths in the Dockerfile, so make
    # sure each subpath exists as well to keep COPY happy.
    mkdir -p "$REPO_ROOT/openagentic-cli/dist" "$REPO_ROOT/openagentic-cli/node_modules"
    touch "$REPO_ROOT/openagentic-cli/package.json"
    touch "$REPO_ROOT/openagentic-cli/dist/.gitkeep" "$REPO_ROOT/openagentic-cli/node_modules/.gitkeep"
    echo -e "  ${GREEN}✓${NC} placeholder dirs created (sdk, openagentic-cli, oat, ghostpilot)"
    echo -e "${GREEN}Git-mode placeholders ready${NC}"
else
echo -e "${YELLOW}Vendoring sibling-repo sources into Docker context...${NC}"

# ─── 1. LLM SDK (../openagentic-sdk → ./sdk) ────────────────────────────────
rm -rf "$REPO_ROOT/sdk" 2>/dev/null || true
mkdir -p "$REPO_ROOT/sdk"
rsync -a --exclude 'node_modules' --exclude '.git' --exclude '@eaDir' \
    "$SDK_DIR/" "$REPO_ROOT/sdk/"
SDK_FILE_COUNT=$(find "$REPO_ROOT/sdk" -type f 2>/dev/null | wc -l)
echo -e "  ${GREEN}✓${NC} sdk/  ($SDK_FILE_COUNT files from $SDK_DIR)"

# ─── 2. openagentic CLI (../openagentic → ./openagentic-cli) ───────────────────
# Use rsync everywhere to be idempotent — if a previous failed run or a manual
# test left partial files, rsync overwrites/refreshes instead of `cp`'s "File
# exists" abort. Same intent as the rm-rf above, just resilient to edge cases.
rm -rf "$REPO_ROOT/openagentic-cli" 2>/dev/null || true
mkdir -p "$REPO_ROOT/openagentic-cli"
if [ ! -f "$CLI_DIR/dist/entrypoints/cli.js" ]; then
    echo -e "${RED}ERROR: $CLI_DIR/dist/entrypoints/cli.js not found!${NC}"
    echo -e "${RED}Run 'cd $CLI_DIR && npm run build' first, or remove --skip-npm${NC}"
    exit 1
fi
rsync -a --delete "$CLI_DIR/dist/" "$REPO_ROOT/openagentic-cli/dist/"
cp "$CLI_DIR/package.json" "$REPO_ROOT/openagentic-cli/"
[ -f "$CLI_DIR/tsconfig.json" ] && cp "$CLI_DIR/tsconfig.json" "$REPO_ROOT/openagentic-cli/"
[ -d "$CLI_DIR/src" ] && rsync -a --delete "$CLI_DIR/src/" "$REPO_ROOT/openagentic-cli/src/"
if [ -d "$CLI_DIR/node_modules" ]; then
    # Resolve symlinks so file: deps become real copies inside the build context
    rsync -a --copy-links --exclude 'esbuild' --exclude '@esbuild' --exclude '.bin/esbuild*' \
        "$CLI_DIR/node_modules/" "$REPO_ROOT/openagentic-cli/node_modules/"
fi
# Ensure @agentic-work/llm-sdk inside openagentic-cli/node_modules is a fresh copy
# (it may have been a symlink in the dev tree). Sourced from $SDK_DIR which we
# already verified above. Use rsync for idempotency.
if [ -d "$SDK_DIR/dist" ]; then
    rm -rf "$REPO_ROOT/openagentic-cli/node_modules/@agentic-work/llm-sdk" 2>/dev/null || true
    mkdir -p "$REPO_ROOT/openagentic-cli/node_modules/@agentic-work/llm-sdk"
    rsync -a --delete "$SDK_DIR/dist/" "$REPO_ROOT/openagentic-cli/node_modules/@agentic-work/llm-sdk/dist/"
    cp "$SDK_DIR/package.json" "$REPO_ROOT/openagentic-cli/node_modules/@agentic-work/llm-sdk/"
    if [ -d "$SDK_DIR/node_modules" ]; then
        rsync -a --delete "$SDK_DIR/node_modules/" "$REPO_ROOT/openagentic-cli/node_modules/@agentic-work/llm-sdk/node_modules/" 2>/dev/null || true
    fi
fi
CLI_FILE_COUNT=$(find "$REPO_ROOT/openagentic-cli" -type f 2>/dev/null | wc -l)
CLI_DIST_TS=$(stat -c %y "$CLI_DIR/dist/entrypoints/cli.js" 2>/dev/null | cut -d. -f1)
echo -e "  ${GREEN}✓${NC} openagentic-cli/  ($CLI_FILE_COUNT files, dist built $CLI_DIST_TS)"

# ─── 3. OAT/Synth Python (../oat → ./oat) ───────────────────────────────────
# ALWAYS runs (independent of --skip-npm) — needed by openagentic-synth Dockerfile
rm -rf "$REPO_ROOT/oat" 2>/dev/null || true
mkdir -p "$REPO_ROOT/oat"
rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude '.git' --exclude '@eaDir' \
    --exclude 'demos' --exclude 'examples' --exclude 'tests' --exclude '.venv' \
    --exclude '.pytest_cache' \
    "$OAT_DIR/" "$REPO_ROOT/oat/"
OAT_FILE_COUNT=$(find "$REPO_ROOT/oat" -type f 2>/dev/null | wc -l)
echo -e "  ${GREEN}✓${NC} oat/  ($OAT_FILE_COUNT files from $OAT_DIR)"

# ─── 4. GhostPilot (../ghostpilot → ./ghostpilot) ───────────────────────────
# Optional — only copied if the sibling repo exists. Used by services/ghostpilot
# Dockerfile (companion test driver bundled into the platform image).
rm -rf "$REPO_ROOT/ghostpilot" 2>/dev/null || true
if [ -d "$GHOSTPILOT_DIR" ]; then
    mkdir -p "$REPO_ROOT/ghostpilot"
    rsync -a --exclude 'node_modules' --exclude '.git' --exclude '@eaDir' \
        --exclude 'package-lock.json' --exclude 'Thumbs.db' --exclude '*.mp4' \
        "$GHOSTPILOT_DIR/" "$REPO_ROOT/ghostpilot/"
    GP_FILE_COUNT=$(find "$REPO_ROOT/ghostpilot" -type f 2>/dev/null | wc -l)
    echo -e "  ${GREEN}✓${NC} ghostpilot/  ($GP_FILE_COUNT files from $GHOSTPILOT_DIR)"
else
    echo -e "  ${YELLOW}⚠${NC} ghostpilot/  (skipped — sibling repo not present)"
fi

echo -e "${GREEN}Sibling-source vendoring complete${NC}"
fi  # end INSTALL_MODE=vendored block
cd "$REPO_ROOT"

# =============================================================================
# Build Function
# =============================================================================
build_service() {
    local SERVICE="$1"
    local CONFIG="${SERVICES[$SERVICE]}"

    if [ -z "$CONFIG" ]; then
        echo -e "${RED}Unknown service: $SERVICE${NC}"
        return 1
    fi

    # Parse config: dockerfile:context:src_path
    IFS=':' read -r DOCKERFILE CONTEXT SRC_PATH <<< "$CONFIG"

    if [ ! -f "$DOCKERFILE" ]; then
        echo -e "${RED}Dockerfile not found: $DOCKERFILE${NC}"
        return 1
    fi

    local TARGET_IMAGE="$REGISTRY/$SERVICE:$IMAGE_TAG"

    echo -e "\n${YELLOW}Building: $SERVICE${NC}"
    echo -e "  Dockerfile: $DOCKERFILE"
    echo -e "  Context: $CONTEXT"
    echo -e "  Target: $TARGET_IMAGE"

    # Build args
    local BUILD_ARGS=(
        --build-arg "PLATFORM_VERSION=$PLATFORM_VERSION"
        --build-arg "PLATFORM_CODENAME=$PLATFORM_CODENAME"
        --build-arg "BUILD_TIME=$BUILD_TIME"
        --build-arg "GIT_COMMIT=$GIT_COMMIT_FULL"
        --build-arg "GIT_SHORT_COMMIT=$GIT_COMMIT"
        --build-arg "GIT_BRANCH=$GIT_BRANCH"
        --build-arg "INSTALL_MODE=$INSTALL_MODE"
        --build-arg "OAT_REF=$COMPANION_REF"
        --build-arg "GHOSTPILOT_REF=$COMPANION_REF"
        --build-arg "OPENAGENTIC_REF=$COMPANION_REF"
    )

    if [ -n "$SRC_PATH" ]; then
        BUILD_ARGS+=(--build-arg "SRC_PATH=$SRC_PATH")
    fi

    # Secret args (only used in git mode by services that consume the PAT)
    local SECRET_ARGS=()
    if [ "$INSTALL_MODE" = "git" ]; then
        SECRET_ARGS+=(--secret "id=gh_pat,src=$GH_PAT_FILE")
    fi

    local IMMUTABLE_IMAGE="$REGISTRY/$SERVICE:$IMMUTABLE_TAG"

    # Select buildx builder based on registry target
    local BUILDER="multiarch"
    if [ "$IS_LOCAL_REGISTRY" = true ]; then
        BUILDER="local"
    fi

    if [ "$MULTIARCH" = true ] || [ "$IS_LOCAL_REGISTRY" = true ]; then
        # Use buildx for: multi-arch builds OR local registry (needs insecure registry config)
        # IMPORTANT: invoke via array expansion, NEVER via string concat + eval.
        # The eval path collapsed quoted build-args like
        #   --build-arg "PLATFORM_CODENAME=Light It Up"
        # into three whitespace-split tokens and broke docker buildx parsing.
        local BUILDX_CMD=(docker buildx build --builder "$BUILDER")
        if [ "$MULTIARCH" = true ]; then
            BUILDX_CMD+=(--platform "$PLATFORMS")
        fi
        if [ -n "$NO_CACHE" ]; then
            BUILDX_CMD+=($NO_CACHE)
        fi
        BUILDX_CMD+=("${BUILD_ARGS[@]}")
        if [ ${#SECRET_ARGS[@]} -gt 0 ]; then
            BUILDX_CMD+=("${SECRET_ARGS[@]}")
        fi
        BUILDX_CMD+=(-t "$TARGET_IMAGE" -t "$IMMUTABLE_IMAGE" -f "$DOCKERFILE")
        if [ "$BUILD_PUSH" = true ]; then
            BUILDX_CMD+=(--push)
        else
            BUILDX_CMD+=(--load)
        fi
        BUILDX_CMD+=("$CONTEXT")

        echo -e "  Builder: $BUILDER"
        echo -e "  Command: ${BUILDX_CMD[*]}"

        if "${BUILDX_CMD[@]}"; then
            if [ "$BUILD_PUSH" = true ]; then
                echo -e "${GREEN}Built+Pushed: $SERVICE${NC}"
            else
                echo -e "${GREEN}Built: $SERVICE${NC}"
            fi
        else
            echo -e "${RED}Build failed: $SERVICE${NC}"
            return 1
        fi
    else
        # Single-arch to remote registry: regular docker build + push.
        # Array-expansion path — same rationale as the buildx branch above.
        local BUILD_CMD=(docker build)
        if [ -n "$NO_CACHE" ]; then
            BUILD_CMD+=($NO_CACHE)
        fi
        BUILD_CMD+=("${BUILD_ARGS[@]}")
        BUILD_CMD+=(-t "$TARGET_IMAGE" -t "$IMMUTABLE_IMAGE" -f "$DOCKERFILE" "$CONTEXT")

        echo -e "  Command: ${BUILD_CMD[*]}"

        if "${BUILD_CMD[@]}"; then
            echo -e "${GREEN}Built: $SERVICE${NC}"

            if [ "$BUILD_PUSH" = true ]; then
                echo -e "${CYAN}Pushing: $TARGET_IMAGE${NC}"
                docker push "$TARGET_IMAGE" || { echo -e "${RED}Push failed: $TARGET_IMAGE${NC}"; return 1; }
                echo -e "${CYAN}Pushing: $IMMUTABLE_IMAGE${NC}"
                docker push "$IMMUTABLE_IMAGE" || { echo -e "${RED}Push failed: $IMMUTABLE_IMAGE${NC}"; return 1; }
                echo -e "${GREEN}Pushed: $SERVICE (${IMAGE_TAG} + ${IMMUTABLE_TAG})${NC}"
            fi
        else
            echo -e "${RED}Build failed: $SERVICE${NC}"
            return 1
        fi
    fi
}

# =============================================================================
# Build Services
# =============================================================================
echo -e "\n${YELLOW}Building Docker images...${NC}"

FAILED_SERVICES=()
SUCCESS_SERVICES=()

for SERVICE in "${SELECTED_SERVICES[@]}"; do
    if build_service "$SERVICE"; then
        SUCCESS_SERVICES+=("$SERVICE")
    else
        FAILED_SERVICES+=("$SERVICE")
    fi
done

# =============================================================================
# CDC Repo Sync
# =============================================================================
if [ "$SYNC_CDC" = true ]; then
    echo -e "\n${YELLOW}Syncing to CDC repo...${NC}"

    if [ ! -d "$CDC_REPO/.git" ]; then
        echo -e "${RED}CDC repo not found at $CDC_REPO${NC}"
    else
        # Ensure CDC repo is on develop branch
        CDC_BRANCH=$(cd "$CDC_REPO" && git rev-parse --abbrev-ref HEAD)
        if [ "$CDC_BRANCH" != "develop" ]; then
            echo -e "${YELLOW}CDC repo is on '$CDC_BRANCH', switching to develop...${NC}"
            (cd "$CDC_REPO" && git checkout develop 2>/dev/null || git checkout -b develop)
        fi

        # Rsync services/ (source code)
        echo -e "  ${CYAN}Syncing services/...${NC}"
        rsync -av --delete \
            --exclude 'node_modules' \
            --exclude '.next' \
            --exclude 'dist' \
            --exclude '__pycache__' \
            --exclude '*.pyc' \
            --exclude '.venv' \
            --exclude '.turbo' \
            --exclude 'coverage' \
            --exclude '.env' \
            --exclude '.env.*' \
            "$REPO_ROOT/services/" "$CDC_REPO/services/" \
            | tail -3

        # Rsync helm/ (deployment configs) — exclude dev-only files
        echo -e "  ${CYAN}Syncing helm/...${NC}"
        rsync -av --delete --delete-excluded \
            --exclude 'values-k3s-*.yaml' \
            --exclude 'values-local-registry.yaml' \
            --exclude 'values-dev.yaml' \
            --exclude 'values-google-auth.yaml' \
            --exclude 'templates/attu/' \
            --exclude 'templates/uat-dashboard/' \
            --exclude 'templates/searxng/' \
            --exclude 'templates/cert-manager/' \
            --exclude 'templates/daemonsets/' \
            --exclude 'templates/dev-ui.yaml' \
            --exclude 'templates/aws-secrets.yaml' \
            --exclude 'templates/tests/' \
            "$REPO_ROOT/helm/" "$CDC_REPO/helm/" \
            | tail -3

        # Sync version.json
        echo -e "  ${CYAN}Syncing version.json...${NC}"
        cp "$REPO_ROOT/version.json" "$CDC_REPO/version.json"

        # Sync scripts/ (build tooling)
        echo -e "  ${CYAN}Syncing scripts/...${NC}"
        mkdir -p "$CDC_REPO/scripts"
        rsync -av --delete \
            "$REPO_ROOT/scripts/" "$CDC_REPO/scripts/" \
            | tail -3

        # Show diff summary
        CDC_CHANGES=$(cd "$CDC_REPO" && git status --short | wc -l)
        echo -e "${GREEN}CDC sync complete: $CDC_CHANGES files changed${NC}"
        echo -e "${YELLOW}  Remember to commit+push CDC repo separately${NC}"
    fi
fi

# =============================================================================
# Summary
# =============================================================================
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  Build Complete${NC}"
echo -e "${GREEN}========================================${NC}"

if [ ${#SUCCESS_SERVICES[@]} -gt 0 ]; then
    echo -e "${GREEN}Success (${#SUCCESS_SERVICES[@]}):${NC} ${SUCCESS_SERVICES[*]}"
fi

if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
    echo -e "${RED}Failed (${#FAILED_SERVICES[@]}):${NC} ${FAILED_SERVICES[*]}"
    exit 1
fi

if [ "$BUILD_PUSH" = true ]; then
    echo -e "\nImages pushed to: ${CYAN}$REGISTRY${NC}"
fi

echo ""
echo -e "${BLUE}Build Manifest${NC}"
echo -e "  Version:   $PLATFORM_VERSION ($PLATFORM_CODENAME)"
echo -e "  Commit:    $GIT_COMMIT ($GIT_BRANCH)"
echo -e "  Built:     $BUILD_TIME"
echo -e "  Tag:       $IMAGE_TAG"
echo -e "  Immutable: $IMMUTABLE_TAG"
