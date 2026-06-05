#!/bin/sh

# In Kubernetes, wait for container network stack to fully initialize
# This helps prevent DNS resolution failures that occur immediately after container start
if [ -f /var/run/secrets/kubernetes.io/serviceaccount/namespace ]; then
    echo "Kubernetes detected, waiting 10s for network stack initialization..."
    sleep 10
fi

# Set default values if not provided
export API_HOST="${API_HOST:-localhost}"
export API_PORT="${API_PORT:-8000}"
export MCP_HOST="${MCP_HOST:-localhost}"
export MCP_PORT="${MCP_PORT:-3001}"
export DOCS_HOST="${DOCS_HOST:-localhost}"
export DOCS_PORT="${DOCS_PORT:-80}"

echo "========================================="
echo "OpenAgentic UI Container Starting"
echo "========================================="
echo "API Backend: http://${API_HOST}:${API_PORT}"
echo "MCP Backend: http://${MCP_HOST}:${MCP_PORT}"
echo "Docs Backend: http://${DOCS_HOST}:${DOCS_PORT}"
echo "========================================="

# Replace runtime config values in config.js
CONFIG_FILE="/usr/share/nginx/html/config.js"
if [ -f "$CONFIG_FILE" ]; then
    echo "Updating runtime configuration..."

    # Map environment variables to config values
    # Use VITE_API_URL if set, otherwise use relative /api path (nginx will proxy to backend)
    API_URL_VALUE="${VITE_API_URL:-/api}"

    # NOTE: The login-path IdP placeholders (VITE_AAD_* / VITE_AZURE_* /
    # VITE_AUTH_PROVIDER / *_LOGIN_ENABLED) are intentionally NOT substituted
    # here anymore. Identity providers are a runtime, DB-driven registry served
    # by GET /api/auth/directories — no client-id / tenant / authority is ever
    # baked into config.js or shipped to the browser.
    sed -i "s|VITE_API_URL_PLACEHOLDER|${API_URL_VALUE}|g" "$CONFIG_FILE"
    sed -i "s|VITE_API_KEY_PLACEHOLDER|${VITE_API_KEY:-${API_KEY:-}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_FRONTEND_SECRET_PLACEHOLDER|${VITE_FRONTEND_SECRET:-${FRONTEND_SECRET:-}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_SIGNING_SECRET_PLACEHOLDER|${VITE_SIGNING_SECRET:-${SIGNING_SECRET:-}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_AUTH_MODE_PLACEHOLDER|${VITE_AUTH_MODE:-${AUTH_MODE:-production}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_MAINTENANCE_MODE_PLACEHOLDER|${VITE_MAINTENANCE_MODE:-${MAINTENANCE_MODE:-false}}|g" "$CONFIG_FILE"
    sed -i "s|VITE_DEV_LOGIN_PAGE_PLACEHOLDER|${VITE_DEV_LOGIN_PAGE:-${DEV_LOGIN_PAGE:-false}}|g" "$CONFIG_FILE"

    echo "Runtime configuration updated"
    echo "  API_URL: ${API_URL_VALUE}"
    echo "  DEV_LOGIN_PAGE: ${VITE_DEV_LOGIN_PAGE:-${DEV_LOGIN_PAGE:-false}}"
    echo "  Identity providers: runtime via /api/auth/directories (DB-driven)"
fi

# Set default values if not provided
export API_HOST=${API_HOST:-openagentic-api}
export API_PORT=${API_PORT:-8000}
export DOCS_HOST=${DOCS_HOST:-openagentic-docs}
export DOCS_PORT=${DOCS_PORT:-80}
# Redis Commander configuration
export REDIS_COMMANDER_HOST=${REDIS_COMMANDER_HOST:-redis-commander}
export REDIS_COMMANDER_PORT=${REDIS_COMMANDER_PORT:-8081}
echo "Redis Commander: http://${REDIS_COMMANDER_HOST}:${REDIS_COMMANDER_PORT}"

# Attu (Milvus Admin) configuration
export ATTU_HOST=${ATTU_HOST:-attu}
export ATTU_PORT=${ATTU_PORT:-3000}
echo "Attu (Milvus Admin): http://${ATTU_HOST}:${ATTU_PORT}"

# MCP Proxy configuration - routes to mcp-proxy service
export MCP_HOST=${MCP_HOST:-mcp-proxy}
export MCP_PORT=${MCP_PORT:-3001}
echo "MCP Proxy: http://${MCP_HOST}:${MCP_PORT}"

# Agent Proxy configuration - agent orchestration service
export OPENAGENTIC_PROXY_HOST=${OPENAGENTIC_PROXY_HOST:-openagentic-proxy}
export OPENAGENTIC_PROXY_PORT=${OPENAGENTIC_PROXY_PORT:-3300}

# Detect Kubernetes environment and use FQDN for nginx resolver compatibility
# nginx resolver doesn't use /etc/resolv.conf search domains, so we need FQDN
K8S_NAMESPACE=""
if [ -f /var/run/secrets/kubernetes.io/serviceaccount/namespace ]; then
    K8S_NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)
    echo "Detected Kubernetes namespace: ${K8S_NAMESPACE}"

    # Convert short hostnames to FQDN for nginx resolver
    # Only if they don't already contain dots (not already FQDN)
    if ! echo "$API_HOST" | grep -q '\.'; then
        export API_HOST="${API_HOST}.${K8S_NAMESPACE}.svc.cluster.local"
    fi
    if ! echo "$MCP_HOST" | grep -q '\.'; then
        export MCP_HOST="${MCP_HOST}.${K8S_NAMESPACE}.svc.cluster.local"
    fi
    if ! echo "$REDIS_COMMANDER_HOST" | grep -q '\.'; then
        export REDIS_COMMANDER_HOST="${REDIS_COMMANDER_HOST}.${K8S_NAMESPACE}.svc.cluster.local"
    fi
    if ! echo "$ATTU_HOST" | grep -q '\.'; then
        export ATTU_HOST="${ATTU_HOST}.${K8S_NAMESPACE}.svc.cluster.local"
    fi
    if ! echo "$OPENAGENTIC_PROXY_HOST" | grep -q '\.'; then
        export OPENAGENTIC_PROXY_HOST="${OPENAGENTIC_PROXY_HOST}.${K8S_NAMESPACE}.svc.cluster.local"
    fi
fi

# Substitute environment variables in nginx config
if [ -f /etc/nginx/conf.d/default.conf.template ]; then
    echo "Configuring nginx with environment variables..."

    # Detect DNS resolver from /etc/resolv.conf
    # In Docker: 127.0.0.11, in K8s: typically 10.43.0.10 or similar
    DNS_RESOLVER=$(grep '^nameserver' /etc/resolv.conf | head -1 | awk '{print $2}')
    if [ -z "$DNS_RESOLVER" ]; then
        DNS_RESOLVER="127.0.0.11"  # Docker default
    fi
    export DNS_RESOLVER
    echo "  DNS_RESOLVER: ${DNS_RESOLVER}"

    envsubst '${API_HOST} ${API_PORT} ${MCP_HOST} ${MCP_PORT} ${DOCS_HOST} ${DOCS_PORT} ${FRONTEND_SECRET} ${REDIS_COMMANDER_HOST} ${REDIS_COMMANDER_PORT} ${ATTU_HOST} ${ATTU_PORT} ${OPENAGENTIC_PROXY_HOST} ${OPENAGENTIC_PROXY_PORT} ${DNS_RESOLVER}' \
        < /etc/nginx/conf.d/default.conf.template \
        > /etc/nginx/conf.d/default.conf
    echo "nginx configuration complete"
else
    echo "Warning: No nginx template found, using default configuration"
fi

# Wait for DNS to be ready in Kubernetes before starting nginx
# nginx validates all upstreams at startup, so DNS must be available
if [ -n "$K8S_NAMESPACE" ]; then
    echo "Waiting for DNS to be ready..."
    MAX_RETRIES=30
    RETRY_COUNT=0
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if nslookup ${API_HOST} >/dev/null 2>&1; then
            echo "DNS is ready"
            break
        fi
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "  Waiting for DNS... attempt $RETRY_COUNT/$MAX_RETRIES"
        sleep 1
    done
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        echo "WARNING: DNS not ready after $MAX_RETRIES seconds, proceeding anyway"
    fi

    # Additional delay to ensure DNS cache is warm
    # nginx may fail if DNS isn't fully propagated even though nslookup succeeds
    echo "Waiting additional 5s for DNS propagation..."
    sleep 5
fi

# Start nginx with retry logic for k8s DNS timing issues
echo "Starting nginx..."
if [ -n "$K8S_NAMESPACE" ]; then
    MAX_NGINX_RETRIES=5
    NGINX_RETRY=0
    while [ $NGINX_RETRY -lt $MAX_NGINX_RETRIES ]; do
        # Test nginx config first
        echo "Testing nginx config..."
        if nginx -t 2>&1; then
            echo "nginx config test passed, starting..."
            exec nginx -g 'daemon off;'
        else
            NGINX_RETRY=$((NGINX_RETRY + 1))
            echo "nginx config test failed (attempt $NGINX_RETRY/$MAX_NGINX_RETRIES)"
            nginx -t 2>&1 || true  # Show the actual error
            echo "Retrying in 3s..."
            sleep 3
        fi
    done
    echo "ERROR: nginx failed to start after $MAX_NGINX_RETRIES attempts"
    echo "Final nginx -t output:"
    nginx -t 2>&1 || true
    exit 1
else
    exec nginx -g 'daemon off;'
fi