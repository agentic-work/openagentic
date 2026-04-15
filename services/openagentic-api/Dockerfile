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

# Smart Dockerfile that works for both docker-compose and standalone builds
# Usage:
#   Standalone: docker build .
#   Compose: docker build --build-arg SRC_PATH=services/openagentic-api .

# Build stage
FROM node:20-slim AS api-builder

WORKDIR /app

# Install build dependencies including canvas requirements
# NOTE: apt-get upgrade removed - causes dpkg dependency errors under QEMU ARM64 emulation
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    python3-pip \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    pkg-config \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install pnpm
RUN npm install -g pnpm

# Path prefix for docker-compose builds (empty for standalone)
ARG SRC_PATH=.

# Copy package files and prisma schema first (before install)
COPY ${SRC_PATH}/package.json ./
COPY ${SRC_PATH}/pnpm-lock.yaml* ./
COPY ${SRC_PATH}/prisma ./prisma

# CRITICAL: .npmrc with shamefully-hoist=true is required for all SDKs to be
# requireable. Without this, pnpm installs in non-hoisted mode and packages
# like openai, @anthropic-ai/sdk, @google/genai are NOT found at runtime.
COPY ${SRC_PATH}/.npmrc* ./
RUN echo "auto-install-peers=true" > .npmrc && echo "shamefully-hoist=true" >> .npmrc

# Install all dependencies (including dev dependencies for build)
# This will also run prisma generate as postinstall with the correct schema
RUN pnpm install --no-frozen-lockfile

# Force rebuild canvas module to generate native bindings
RUN pnpm rebuild canvas

# Add cache-busting ARG
ARG CACHEBUST=1

# Copy source code
COPY ${SRC_PATH}/src ./src
COPY ${SRC_PATH}/tsconfig.json ./

# Clean any existing build artifacts
RUN rm -rf dist node_modules/.cache .tsbuildinfo

# Generate Prisma client with retry logic and checksum bypass for unreliable networks
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
RUN apt-get update && apt-get install -y openssl ca-certificates && \
    for i in 1 2 3; do pnpm prisma generate && break || sleep 5; done

# Build TypeScript (skip prisma generate since we already ran it above)
RUN pnpm tsc

# Production image
FROM node:20-slim

LABEL org.opencontainers.image.vendor="OpenAgentic LLC"
LABEL org.opencontainers.image.licenses="LicenseRef-Proprietary"
LABEL com.openagentic.copyright="Copyright (c) 2024-2026 OpenAgentic LLC. All rights reserved."

# Version build args
ARG PLATFORM_VERSION=0.0.0
ARG PLATFORM_CODENAME=Unknown
ARG BUILD_TIME=""
ARG GIT_COMMIT=unknown
ARG GIT_SHORT_COMMIT=unknown
ARG GIT_BRANCH=unknown

# Set version environment variables
ENV PLATFORM_VERSION=${PLATFORM_VERSION}
ENV PLATFORM_CODENAME=${PLATFORM_CODENAME}
ENV BUILD_TIME=${BUILD_TIME}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV GIT_SHORT_COMMIT=${GIT_SHORT_COMMIT}
ENV GIT_BRANCH=${GIT_BRANCH}

# Install system dependencies including canvas requirements and netcat for health checks
# NOTE: apt-get upgrade removed - causes dpkg dependency errors under QEMU ARM64 emulation
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    netcat-openbsd \
    ca-certificates \
    build-essential \
    python3 \
    python3-pip \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    pkg-config \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install diagram rendering tools: Mermaid CLI and PlantUML
# Mermaid CLI for technical diagrams (flowcharts, sequence, architecture)
# PlantUML for customer-facing diagrams with professional stencils and styling
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    default-jre-headless \
    graphviz \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Enable pnpm in production
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# Path prefix for docker-compose builds
ARG SRC_PATH=.

# Copy package.json and .npmrc for production
COPY ${SRC_PATH}/package.json ./
# CRITICAL: .npmrc with shamefully-hoist=true ensures ALL SDKs (openai, anthropic,
# @google/genai) are requireable. Without it, pnpm symlink mode hides them.
RUN echo "auto-install-peers=true" > .npmrc && echo "shamefully-hoist=true" >> .npmrc

# Copy built code, prisma, and node_modules from builder (already has all deps)
COPY --from=api-builder /app/dist ./dist
COPY --from=api-builder /app/node_modules ./node_modules
COPY ${SRC_PATH}/prisma ./prisma

# Copy version.json for the /api/version endpoint
COPY version.json ./

# Copy entrypoint script
COPY ${SRC_PATH}/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create uploads and logs directories
RUN mkdir -p uploads logs

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8000/api/health || exit 1

# IP Protection: NOTICE and LICENSE
COPY NOTICE /NOTICE
COPY LICENSE /LICENSE

# Use entrypoint script
ENTRYPOINT ["./docker-entrypoint.sh"]