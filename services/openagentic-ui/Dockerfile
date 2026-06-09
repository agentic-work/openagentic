# Use ARG to get the source path (default to services/openagentic-ui for GitHub Actions)
ARG SRC_PATH=services/openagentic-ui

# =============================================================================
# Stage 1: Generate documentation manifests by scanning the full codebase
# Runs in an isolated stage so the repo-wide COPY doesn't bloat the UI build
# =============================================================================
FROM node:20-slim AS docs-generator

ARG SRC_PATH
WORKDIR /repo

# Copy the full codebase context the generators need
COPY services ./services
COPY version.json ./version.json

# Install UI deps (generators import from node_modules via tsx).
# Switch package.json to a file: spec so npm doesn't choke on workspace:*.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('services/openagentic-ui/package.json','utf8'));if(p.dependencies&&p.dependencies['@agentic-work/llm-sdk']==='workspace:*'){p.dependencies['@agentic-work/llm-sdk']='file:../shared/llm-sdk';fs.writeFileSync('services/openagentic-ui/package.json',JSON.stringify(p,null,2));}"
WORKDIR /repo/services/openagentic-ui
RUN npm install --ignore-scripts || echo "WARN: npm install failed, docs generation may be incomplete"

# Run doc generators — each gracefully skips if its source dir is missing
RUN npx tsx scripts/generate-docs.ts || echo "WARN: docs generation failed, using existing manifests"

# =============================================================================
# Stage 2: Build the UI
# =============================================================================
FROM node:20-slim AS ui-builder

# Install pnpm + build tools (some native deps require python/make/g++).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm

# Install dependencies
WORKDIR /app

ARG SRC_PATH

# Stage the vendored llm-sdk so the workspace:* dep can be rewritten to a
# file: ref that resolves inside the standalone image.
COPY services/shared/llm-sdk/package.json   /shared/llm-sdk/package.json
COPY services/shared/llm-sdk/tsconfig.json  /shared/llm-sdk/tsconfig.json
COPY services/shared/llm-sdk/src            /shared/llm-sdk/src
COPY services/shared/llm-sdk/scripts        /shared/llm-sdk/scripts

# Build the SDK to dist/ so its package.json `main`/`exports` resolve.
RUN ln -sfn /app/node_modules /shared/llm-sdk/node_modules || true

# Copy package files
COPY ${SRC_PATH}/package*.json ./
COPY ${SRC_PATH}/tsconfig*.json ./
COPY ${SRC_PATH}/tailwind.config.js ./
COPY ${SRC_PATH}/postcss.config.js ./
COPY ${SRC_PATH}/.npmrc* ./
COPY ${SRC_PATH}/eslint-plugin-admin-tokens ./eslint-plugin-admin-tokens

# Rewrite workspace:* to file: spec so install works in the standalone image.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));let touched=false;if(p.dependencies&&p.dependencies['@agentic-work/llm-sdk']==='workspace:*'){p.dependencies['@agentic-work/llm-sdk']='file:/shared/llm-sdk';touched=true;}if(touched){fs.writeFileSync('package.json',JSON.stringify(p,null,2));console.log('rewrote llm-sdk dep');}"

# Strip the root-level lockfile spec — re-resolve from package.json inside the image.
RUN rm -f pnpm-lock.yaml
RUN echo "shamefully-hoist=true" > .npmrc

# Install dependencies.
RUN pnpm install --no-frozen-lockfile
# Build the staged llm-sdk so Vite can resolve its dist/index.js entry.
# Then replace pnpm's file:-snapshot copy with a direct symlink to the
# freshly-built /shared/llm-sdk so Vite sees the populated dist/.
RUN cd /shared/llm-sdk && \
    /app/node_modules/.bin/tsc -p tsconfig.json && \
    node scripts/fix-esm-imports.js && \
    rm -rf /app/node_modules/@agentic-work/llm-sdk && \
    mkdir -p /app/node_modules/@agentic-work && \
    ln -sfn /shared/llm-sdk /app/node_modules/@agentic-work/llm-sdk

# Add cache-busting ARG
ARG CACHEBUST=1

# Build info arguments
ARG PLATFORM_VERSION=1.0.0
ARG PLATFORM_CODENAME=dev
ARG GIT_COMMIT=unknown
ARG GIT_SHORT_COMMIT=unknown
ARG GIT_BRANCH=unknown
ARG BUILD_TIME=unknown

# Copy source files
COPY ${SRC_PATH}/src ./src
COPY ${SRC_PATH}/public ./public
COPY ${SRC_PATH}/index.html ./
COPY ${SRC_PATH}/vite.config.ts ./
COPY ${SRC_PATH}/scripts ./scripts

# Clean build artifacts
RUN rm -rf dist node_modules/.cache .vite

# Copy generated documentation manifests from docs-generator stage
COPY --from=docs-generator /repo/services/openagentic-ui/public/docs/generated ./public/docs/generated

# Pure Frontend - Only needs API URL
ARG API_URL
ARG VITE_ENABLE_IMAGE_ANALYSIS=true
ARG VITE_ENABLE_DIAGRAM_CREATION=true
ARG VITE_ENABLE_AUTO_EXPORT=true

# Set environment variables for build
ENV NODE_ENV=production
ENV VITE_API_URL=${API_URL}
ENV VITE_ENABLE_IMAGE_ANALYSIS=${VITE_ENABLE_IMAGE_ANALYSIS}
ENV VITE_ENABLE_DIAGRAM_CREATION=${VITE_ENABLE_DIAGRAM_CREATION}
ENV VITE_ENABLE_AUTO_EXPORT=${VITE_ENABLE_AUTO_EXPORT}
ENV VITE_APP_VERSION=${PLATFORM_VERSION}
ENV VITE_VERSION=${PLATFORM_VERSION}
ENV VITE_CODENAME=${PLATFORM_CODENAME}
ENV VITE_GIT_COMMIT=${GIT_COMMIT}
ENV VITE_GIT_SHORT_COMMIT=${GIT_SHORT_COMMIT}
ENV VITE_GIT_BRANCH=${GIT_BRANCH}
ENV VITE_BUILD_TIME=${BUILD_TIME}

# Build the application — the docs-generator stage already produced the
# manifests, so the in-builder docs generation is suppressed.
ENV SKIP_DOCS_GENERATE=1
RUN pnpm run build

# Production stage
FROM nginx:alpine

# Re-declare ARG for the production stage
ARG SRC_PATH=services/openagentic-ui

# Create agentic user
RUN addgroup -g 1001 -S agentic && adduser -u 1001 -S agentic -G agentic

# Copy built UI files from ui-builder
COPY --chown=agentic:agentic --from=ui-builder /app/dist /usr/share/nginx/html

# Cache bust for nginx config - RUN command uses the ARG to invalidate layer cache
ARG NGINX_CONF_CACHEBUST=2026-03-17-v12-GRAFANA-NGINX-PROXY
RUN echo "nginx config cache bust: ${NGINX_CONF_CACHEBUST}"

# Copy nginx config template (will be processed by entrypoint)
COPY ${SRC_PATH}/nginx.conf.template /etc/nginx/conf.d/default.conf.template

# Copy entrypoint script with proper ownership
COPY --chown=agentic:agentic ${SRC_PATH}/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create health check endpoint
RUN echo "OK" > /usr/share/nginx/html/health && chown agentic:agentic /usr/share/nginx/html/health

# Set environment variables for runtime
ENV API_BASE_URL=/api \
    NGINX_WORKER_PROCESSES=auto \
    NGINX_WORKER_CONNECTIONS=1024

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/healthz || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
LABEL org.opencontainers.image.title="openagentic-ui"
LABEL org.opencontainers.image.description="OpenAgentic UI — the web interface for chat, flows, code mode and the admin console. Apache 2.0."
LABEL org.opencontainers.image.source="https://github.com/agentic-work/openagentic"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.vendor="AgenticWork LLC"
