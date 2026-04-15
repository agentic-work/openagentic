# Copyright 2026 Gnomus.ai
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

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

# Install UI deps (generators import from node_modules via tsx)
WORKDIR /repo/services/openagentic-ui
RUN npm install --ignore-scripts || echo "WARN: npm install failed, docs generation may be incomplete"

# Run doc generators — each gracefully skips if its source dir is missing
RUN npx tsx scripts/generate-docs.ts || echo "WARN: docs generation failed, using existing manifests"

# =============================================================================
# Stage 2: Build the UI
# =============================================================================
FROM node:20-slim AS ui-builder

# Install dependencies
WORKDIR /app

ARG SRC_PATH

# Copy package files
COPY ${SRC_PATH}/package*.json ./
COPY ${SRC_PATH}/tsconfig*.json ./
COPY ${SRC_PATH}/tailwind.config.js ./
COPY ${SRC_PATH}/postcss.config.js ./

# Install dependencies
RUN npm install

# Add cache-busting ARG
ARG CACHEBUST=1

# Build info arguments
ARG PLATFORM_VERSION=0.0.0
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

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

LABEL org.opencontainers.image.vendor="OpenAgentic LLC"
LABEL org.opencontainers.image.licenses="LicenseRef-Proprietary"
LABEL com.openagentic.copyright="Copyright (c) 2024-2026 OpenAgentic LLC. All rights reserved."

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
    CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

# IP Protection: NOTICE and LICENSE
COPY NOTICE /NOTICE
COPY LICENSE /LICENSE

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]