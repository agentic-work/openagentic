

# =============================================================================
# OpenAgentic Hot Deploy Script
# =============================================================================
# Deploys source code changes to running K8s pods WITHOUT full Docker rebuilds.
# Use this for development. Use build.sh for production/CI.
#
# Tier 1: Config changes  → pipe + reload      (~5-10 seconds)
# Tier 2: Source changes   → local build + copy (~30-120 seconds)
# Tier 3: Dep/Dockerfile   → full rebuild       (use build.sh)
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[0;90m'
NC='\033[0m'

# Defaults
NAMESPACE="agentic-dev"
DRY_RUN=false
AUTO_DETECT=false
FORCE=false
SELECTED_SERVICES=()

# Timing
timer_start() { TIMER_START=$(date +%s%N); }
timer_elapsed() {
    local end=$(date +%s%N)
    local ms=$(( (end - TIMER_START) / 1000000 ))
    if [ $ms -lt 1000 ]; then
        echo "${ms}ms"
    else
        local s=$((ms / 1000))
        local frac=$((ms % 1000 / 100))
        echo "${s}.${frac}s"
    fi
}

# =============================================================================
# Service Definitions
# =============================================================================
# Maps service name to: component-label:container-name:service-type:source-path
declare -A SERVICES=(
    ["ui"]="ui:ui:static:services/openagentic-ui"
    ["api"]="api:api:typescript:services/openagentic-api"
    ["mcp-proxy"]="mcp-proxy:mcp-proxy:python:services/openagentic-mcp-proxy"
    ["code-manager"]="code-manager:code-manager:typescript:services/openagentic-manager"
    ["oap-admin-mcp"]="oap-admin-mcp:oap-admin-mcp:python:services/mcps/oap-admin-mcp"
    ["oap-azure-mcp"]="oap-azure-mcp:oap-azure-mcp:python:services/mcps/oap-azure-mcp"
    ["oap-aws-mcp"]="oap-aws-mcp:oap-aws-mcp:python:services/mcps/oap-aws-mcp"
    ["nginx-config"]="ui:ui:nginx-config:services/openagentic-ui"
)

# Files that require full rebuild if changed
NON_HOTDEPLOYABLE=(
    "Dockerfile"
    "package.json"
    "pnpm-lock.yaml"
    "package-lock.json"
    "requirements.txt"
    "prisma/schema.prisma"
    "docker-entrypoint.sh"
    ".npmrc"
)

# =============================================================================
# Help
# =============================================================================
show_help() {
    echo -e "${GREEN}OpenAgentic Hot Deploy${NC} - Fast development deployment"
    echo ""
    echo "Usage: $0 [OPTIONS] [SERVICE...]"
    echo ""
    echo "Services:"
    echo "  ui              React UI (Vite build + copy static files)"
    echo "  api             Fastify API (TypeScript compile + copy)"
    echo "  mcp-proxy       MCP Proxy (copy Python files)"
    echo "  code-manager    Code Manager (TypeScript compile + copy)"
    echo "  oap-admin-mcp   Admin MCP server (copy Python files)"
    echo "  oap-azure-mcp   Azure MCP server (copy Python files)"
    echo "  oap-aws-mcp     AWS MCP server (copy Python files)"
    echo "  nginx-config    UI nginx config only (envsubst + reload)"
    echo ""
    echo "Options:"
    echo "  --auto           Auto-detect changed services from git diff"
    echo "  --namespace, -n  K8s namespace (default: $NAMESPACE)"
    echo "  --dry-run        Show what would be done without executing"
    echo "  --force          Skip safety checks"
    echo "  --help, -h       Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 api                    # Deploy API source changes"
    echo "  $0 ui                     # Build UI locally + deploy"
    echo "  $0 nginx-config           # Deploy nginx config change (~5s)"
    echo "  $0 mcp-proxy oap-admin-mcp  # Deploy multiple services"
    echo "  $0 --auto                 # Auto-detect and deploy changes"
    echo "  $0 --auto --dry-run       # Show what --auto would do"
    echo ""
    echo -e "${DIM}For dependency/Dockerfile changes, use: ./scripts/build.sh${NC}"
}

# =============================================================================
# Parse Arguments
# =============================================================================
while [[ $# -gt 0 ]]; do
    case $1 in
        --auto) AUTO_DETECT=true; shift ;;
        --namespace|-n) NAMESPACE="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --force) FORCE=true; shift ;;
        --help|-h) show_help; exit 0 ;;
        -*) echo -e "${RED}Unknown option: $1${NC}"; show_help; exit 1 ;;
        *) SELECTED_SERVICES+=("$1"); shift ;;
    esac
done

# =============================================================================
# Utility Functions
# =============================================================================
log() { echo -e "${BLUE}[hotdeploy]${NC} $*"; }
log_step() { echo -e "${BLUE}[hotdeploy]${NC} ${YELLOW}[$1]${NC} $2"; }
log_ok() { echo -e "${BLUE}[hotdeploy]${NC} ${GREEN}✓${NC} $*"; }
log_warn() { echo -e "${BLUE}[hotdeploy]${NC} ${YELLOW}⚠${NC} $*"; }
log_err() { echo -e "${BLUE}[hotdeploy]${NC} ${RED}✗${NC} $*"; }
log_time() { echo -e "${BLUE}[hotdeploy]${NC} ${DIM}($1)${NC}"; }

find_pod() {
    local component="$1"
    kubectl get pod -n "$NAMESPACE" \
        -l "app.kubernetes.io/component=$component" \
        -o jsonpath='{.items[0].metadata.name}' 2>/dev/null
}

find_all_pods() {
    local component="$1"
    kubectl get pod -n "$NAMESPACE" \
        -l "app.kubernetes.io/component=$component" \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null
}

check_pod_running() {
    local pod="$1"
    local phase
    phase=$(kubectl get pod -n "$NAMESPACE" "$pod" -o jsonpath='{.status.phase}' 2>/dev/null)
    [ "$phase" = "Running" ]
}

# =============================================================================
# Auto-Detection
# =============================================================================
auto_detect_services() {
    local changed_files
    changed_files=$(cd "$REPO_ROOT" && git diff --name-only HEAD 2>/dev/null)

    if [ -z "$changed_files" ]; then
        # Also check unstaged changes
        changed_files=$(cd "$REPO_ROOT" && git diff --name-only 2>/dev/null)
    fi

    if [ -z "$changed_files" ]; then
        log_warn "No changed files detected in git"
        exit 0
    fi

    local needs_rebuild=()
    local detected_services=()
    local ui_source=false
    local ui_config=false

    while IFS= read -r file; do
        # Check for non-hotdeployable changes
        local basename
        basename=$(basename "$file")
        for blocked in "${NON_HOTDEPLOYABLE[@]}"; do
            if [ "$basename" = "$blocked" ] || [[ "$file" == *"$blocked" ]]; then
                needs_rebuild+=("$file")
            fi
        done

        # Map files to services
        case "$file" in
            services/openagentic-ui/nginx.conf.template)
                ui_config=true ;;
            services/openagentic-ui/src/*)
                ui_source=true ;;
            services/openagentic-api/src/*)
                detected_services+=("api") ;;
            services/openagentic-mcp-proxy/src/*)
                detected_services+=("mcp-proxy") ;;
            services/openagentic-manager/src/*)
                detected_services+=("code-manager") ;;
            services/mcps/oap-admin-mcp/*)
                detected_services+=("oap-admin-mcp") ;;
            services/mcps/oap-azure-mcp/*)
                detected_services+=("oap-azure-mcp") ;;
            services/mcps/oap-aws-mcp/*)
                detected_services+=("oap-aws-mcp") ;;
        esac
    done <<< "$changed_files"

    # Warn about non-hotdeployable changes
    if [ ${#needs_rebuild[@]} -gt 0 ] && [ "$FORCE" = false ]; then
        log_warn "These changes require a full rebuild (use build.sh):"
        for f in "${needs_rebuild[@]}"; do
            echo -e "  ${RED}-${NC} $f"
        done
        echo ""
    fi

    # Add UI services
    if [ "$ui_config" = true ]; then
        detected_services+=("nginx-config")
    fi
    if [ "$ui_source" = true ]; then
        detected_services+=("ui")
    fi

    # Deduplicate
    local unique_services=()
    declare -A seen
    for svc in "${detected_services[@]}"; do
        if [ -z "${seen[$svc]}" ]; then
            unique_services+=("$svc")
            seen[$svc]=1
        fi
    done

    if [ ${#unique_services[@]} -eq 0 ]; then
        log_warn "No hotdeployable changes detected"
        exit 0
    fi

    log "Auto-detected services: ${unique_services[*]}"
    SELECTED_SERVICES=("${unique_services[@]}")
}

# =============================================================================
# Deploy: nginx config (Tier 1)
# =============================================================================
deploy_nginx_config() {
    local pod="$1"
    local src="$REPO_ROOT/services/openagentic-ui/nginx.conf.template"

    if [ ! -f "$src" ]; then
        log_err "nginx.conf.template not found at $src"
        return 1
    fi

    log_step "1/3" "Copying template to pod..."
    if [ "$DRY_RUN" = true ]; then
        echo "  Would copy: $src → /tmp/nginx-hotdeploy.conf"
        echo "  Would run: envsubst + nginx -s reload"
        return 0
    fi

    # Copy template into pod (kubectl cp is reliable; cat pipe truncates large files)
    kubectl cp "$src" "$NAMESPACE/${pod}:/tmp/nginx-hotdeploy.conf" -c ui

    log_step "2/3" "Processing template with envsubst..."
    # Backup current config before overwriting
    kubectl exec -n "$NAMESPACE" "$pod" -c ui -- cp /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak 2>/dev/null || true
    kubectl exec -n "$NAMESPACE" "$pod" -c ui -- sh -c '
        DNS_RESOLVER=$(grep "^nameserver" /etc/resolv.conf | head -1 | awk "{print \$2}")
        [ -z "$DNS_RESOLVER" ] && DNS_RESOLVER="10.43.0.10"
        export DNS_RESOLVER
        envsubst "\${API_HOST} \${API_PORT} \${MCP_HOST} \${MCP_PORT} \${DOCS_HOST} \${DOCS_PORT} \${FRONTEND_SECRET} \${REDIS_COMMANDER_HOST} \${REDIS_COMMANDER_PORT} \${ATTU_HOST} \${ATTU_PORT} \${AWCODE_MANAGER_HOST} \${AWCODE_MANAGER_PORT} \${CODE_SERVER_HOST} \${CODE_SERVER_PORT} \${OPENAGENTIC_PROXY_HOST} \${OPENAGENTIC_PROXY_PORT} \${DNS_RESOLVER}" \
            < /tmp/nginx-hotdeploy.conf \
            > /etc/nginx/conf.d/default.conf
    '

    log_step "3/3" "Testing and reloading nginx..."
    if ! kubectl exec -n "$NAMESPACE" "$pod" -c ui -- nginx -t 2>&1; then
        log_err "nginx config test FAILED — rolling back"
        kubectl exec -n "$NAMESPACE" "$pod" -c ui -- sh -c 'cp /etc/nginx/conf.d/default.conf.bak /etc/nginx/conf.d/default.conf 2>/dev/null || true'
        return 1
    fi
    kubectl exec -n "$NAMESPACE" "$pod" -c ui -- nginx -s reload 2>&1

    log_ok "nginx config deployed and reloaded"
}

# =============================================================================
# Deploy: UI static files (Tier 2)
# =============================================================================
deploy_ui() {
    local pod="$1"
    local src_dir="$REPO_ROOT/services/openagentic-ui"

    if [ ! -d "$src_dir/node_modules" ]; then
        log_err "node_modules not found. Run: cd services/openagentic-ui && npm install"
        return 1
    fi

    log_step "1/4" "Building UI locally (Vite)..."
    if [ "$DRY_RUN" = true ]; then
        echo "  Would run: npm run build in $src_dir"
        echo "  Would copy: dist/ → /usr/share/nginx/html/"
        return 0
    fi

    timer_start
    (cd "$src_dir" && npm run build 2>&1) | tail -5
    log_time "Build: $(timer_elapsed)"

    log_step "2/4" "Backing up runtime config.js..."
    kubectl exec -n "$NAMESPACE" "$pod" -c ui -- \
        sh -c 'cp /usr/share/nginx/html/config.js /tmp/config.js.bak 2>/dev/null || true'

    log_step "3/4" "Deploying static files to pod..."
    timer_start
    # Clear old hashed assets to prevent stale files
    kubectl exec -n "$NAMESPACE" "$pod" -c ui -- \
        sh -c 'rm -rf /usr/share/nginx/html/assets/*'

    # Copy new build output
    kubectl cp "$src_dir/dist/." "$NAMESPACE/$pod:/usr/share/nginx/html/" -c ui
    log_time "Copy: $(timer_elapsed)"

    log_step "4/4" "Restoring runtime config.js..."
    kubectl exec -n "$NAMESPACE" "$pod" -c ui -- \
        sh -c 'cp /tmp/config.js.bak /usr/share/nginx/html/config.js 2>/dev/null || true'

    log_ok "UI deployed (no restart needed - nginx serves new files immediately)"
}

# =============================================================================
# Deploy: TypeScript service (Tier 2)
# =============================================================================
deploy_typescript() {
    local pod="$1"
    local container="$2"
    local src_dir="$REPO_ROOT/$3"
    local service_name="$4"

    if [ ! -d "$src_dir/node_modules" ]; then
        log_err "node_modules not found. Run: cd $3 && pnpm install"
        return 1
    fi

    log_step "1/4" "Compiling TypeScript locally..."
    if [ "$DRY_RUN" = true ]; then
        echo "  Would run: npx tsc in $src_dir"
        echo "  Would copy: dist/ → /app/dist/"
        echo "  Would restart: kill 1 in container"
        return 0
    fi

    timer_start
    (cd "$src_dir" && npx tsc 2>&1) || {
        log_err "TypeScript compilation failed"
        return 1
    }
    log_time "Compile: $(timer_elapsed)"

    log_step "2/4" "Copying compiled JS to pod..."
    timer_start
    kubectl cp "$src_dir/dist/." "$NAMESPACE/$pod:/app/dist/" -c "$container"
    log_time "Copy: $(timer_elapsed)"

    log_step "3/4" "Restarting process..."
    timer_start
    kubectl exec -n "$NAMESPACE" "$pod" -c "$container" -- kill 1 2>/dev/null || true

    log_step "4/4" "Waiting for pod to recover..."
    local retries=0
    while [ $retries -lt 30 ]; do
        if check_pod_running "$pod"; then
            # Check if the container is ready
            local ready
            ready=$(kubectl get pod -n "$NAMESPACE" "$pod" -o jsonpath="{.status.containerStatuses[?(@.name=='$container')].ready}" 2>/dev/null)
            if [ "$ready" = "true" ]; then
                break
            fi
        fi
        sleep 2
        retries=$((retries + 1))
    done
    log_time "Restart: $(timer_elapsed)"

    if [ $retries -ge 30 ]; then
        log_warn "Pod may not be fully ready - check logs:"
        echo "  kubectl logs -n $NAMESPACE $pod -c $container --tail=20"
    else
        log_ok "$service_name deployed and running"
    fi
}

# =============================================================================
# Deploy: Python service (Tier 2)
# =============================================================================
deploy_python() {
    local pod="$1"
    local container="$2"
    local src_dir="$REPO_ROOT/$3"
    local service_name="$4"

    log_step "1/3" "Copying Python files to pod..."
    if [ "$DRY_RUN" = true ]; then
        echo "  Would copy: src/ → /app/src/"
        echo "  Would restart: kill 1 in container"
        return 0
    fi

    timer_start
    # For MCP proxy, copy src/
    if [ -d "$src_dir/src" ]; then
        kubectl cp "$src_dir/src/." "$NAMESPACE/$pod:/app/src/" -c "$container"
    fi
    # For standalone MCP servers that might have different structure
    if [ -d "$src_dir/server" ]; then
        kubectl cp "$src_dir/server/." "$NAMESPACE/$pod:/app/server/" -c "$container"
    fi
    log_time "Copy: $(timer_elapsed)"

    log_step "2/3" "Restarting process..."
    timer_start
    kubectl exec -n "$NAMESPACE" "$pod" -c "$container" -- kill 1 2>/dev/null || true

    log_step "3/3" "Waiting for pod to recover..."
    local retries=0
    while [ $retries -lt 20 ]; do
        if check_pod_running "$pod"; then
            local ready
            ready=$(kubectl get pod -n "$NAMESPACE" "$pod" -o jsonpath="{.status.containerStatuses[?(@.name=='$container')].ready}" 2>/dev/null)
            if [ "$ready" = "true" ]; then
                break
            fi
        fi
        sleep 2
        retries=$((retries + 1))
    done
    log_time "Restart: $(timer_elapsed)"

    if [ $retries -ge 20 ]; then
        log_warn "Pod may not be fully ready - check logs:"
        echo "  kubectl logs -n $NAMESPACE $pod -c $container --tail=20"
    else
        log_ok "$service_name deployed and running"
    fi
}

# =============================================================================
# Main Deploy Dispatcher
# =============================================================================
deploy_service() {
    local service="$1"
    local config="${SERVICES[$service]}"

    if [ -z "$config" ]; then
        log_err "Unknown service: $service"
        echo "  Available: ${!SERVICES[*]}"
        return 1
    fi

    IFS=':' read -r component container svc_type src_path <<< "$config"

    echo ""
    log "=== Deploying: ${CYAN}$service${NC} ==="

    # Find the pod
    local pod
    pod=$(find_pod "$component")
    if [ -z "$pod" ]; then
        log_err "No running pod found for component=$component in namespace=$NAMESPACE"
        return 1
    fi
    log "Pod: $pod"

    if ! check_pod_running "$pod" && [ "$FORCE" = false ]; then
        log_err "Pod $pod is not in Running state"
        return 1
    fi

    timer_start

    case "$svc_type" in
        nginx-config)
            # Deploy to ALL pods (nginx config must be consistent across replicas)
            local all_pods
            all_pods=$(find_all_pods "$component")
            local pod_count=0
            while IFS= read -r p; do
                [ -z "$p" ] && continue
                pod_count=$((pod_count + 1))
                if [ "$pod_count" -gt 1 ]; then
                    log "Pod: $p (replica $pod_count)"
                fi
                deploy_nginx_config "$p"
            done <<< "$all_pods"
            ;;
        static)
            deploy_ui "$pod"
            ;;
        typescript)
            deploy_typescript "$pod" "$container" "$src_path" "$service"
            ;;
        python)
            deploy_python "$pod" "$container" "$src_path" "$service"
            ;;
        *)
            log_err "Unknown service type: $svc_type"
            return 1
            ;;
    esac

    local total
    total=$(timer_elapsed)
    log "Total for $service: ${GREEN}$total${NC}"
}

# =============================================================================
# Main
# =============================================================================

# Auto-detect if requested
if [ "$AUTO_DETECT" = true ]; then
    auto_detect_services
fi

# Must have at least one service
if [ ${#SELECTED_SERVICES[@]} -eq 0 ]; then
    echo -e "${RED}No service specified.${NC} Use --auto or specify a service."
    echo ""
    show_help
    exit 1
fi

# Header
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  OpenAgentic Hot Deploy${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Namespace: ${CYAN}$NAMESPACE${NC}"
echo -e "Services:  ${CYAN}${SELECTED_SERVICES[*]}${NC}"
if [ "$DRY_RUN" = true ]; then
    echo -e "Mode:      ${YELLOW}DRY RUN${NC}"
fi
echo ""

OVERALL_START=$(date +%s%N)

# Deploy each service
FAILED=()
SUCCESS=()
for service in "${SELECTED_SERVICES[@]}"; do
    if deploy_service "$service"; then
        SUCCESS+=("$service")
    else
        FAILED+=("$service")
    fi
done

# Summary
OVERALL_END=$(date +%s%N)
OVERALL_MS=$(( (OVERALL_END - OVERALL_START) / 1000000 ))
OVERALL_S=$((OVERALL_MS / 1000))
OVERALL_FRAC=$((OVERALL_MS % 1000 / 100))

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Hot Deploy Complete${NC}"
echo -e "${GREEN}========================================${NC}"

if [ ${#SUCCESS[@]} -gt 0 ]; then
    echo -e "${GREEN}Success (${#SUCCESS[@]}):${NC} ${SUCCESS[*]}"
fi
if [ ${#FAILED[@]} -gt 0 ]; then
    echo -e "${RED}Failed (${#FAILED[@]}):${NC} ${FAILED[*]}"
fi
echo -e "Total time: ${CYAN}${OVERALL_S}.${OVERALL_FRAC}s${NC} ${DIM}(vs ~10-15min full rebuild)${NC}"
echo ""

[ ${#FAILED[@]} -eq 0 ] || exit 1
