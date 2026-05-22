
# Smart Dockerfile that works for both docker-compose and standalone builds
# Usage:
#   Standalone: docker build .
#   Compose: docker build --build-arg SRC_PATH=services/openagentic-api .

# Build stage
# Node 22-slim: isolated-vm@6.1.2 ships prebuilds for abi=127 (Node 22) and
# abi=137 (Node 24) only — NOT abi=115 (Node 20). Building on node:20-slim
# silently shipped images with no native binary because prebuild-install
# exits 0 when no prebuild matches and pnpm rebuild was a no-op (#375).
# Node 22 is the LTS that actually has a published isolated-vm prebuild.
FROM node:22-slim AS api-builder

WORKDIR /app

# Native-build toolchain — kept as a belt-and-suspenders fallback in case a
# future native dep ships without a matching prebuild. With node:22-slim and
# isolated-vm@6.1.2 the abi=127 prebuild is used directly, so this toolchain
# is no longer the critical path; it just lets node-gyp compile if needed.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ make ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

# Path prefix for docker-compose builds (empty for standalone)
ARG SRC_PATH=.

# Stage the shared workflow-engine package alongside the api so the
# workspace:* dep resolves during install. Layout in builder:
#   /app                      api service (WORKDIR)
#   /shared/workflow-engine   shared package (workspace:* dep target)
#   /openagentic-sdk          vendored @agentic-work/llm-sdk (sibling repo)
COPY services/shared/workflow-engine/package.json     /shared/workflow-engine/package.json
COPY services/shared/workflow-engine/tsconfig.json    /shared/workflow-engine/tsconfig.json
COPY services/shared/workflow-engine/src              /shared/workflow-engine/src

# Vendored SDK — the build script rsyncs ../openagentic-sdk to
# ./openagentic-sdk/ in the build context (canonical repo name).
# The api package.json declares the dep as
# `file:../../../openagentic-sdk`, which is unresolvable inside Docker.
# Stage it at /openagentic-sdk and rewrite the dep below.
COPY openagentic-sdk /openagentic-sdk

# Sev-0 (2026-05-13) — workflow-engine's package.json also references
# `file:../../../../openagentic-sdk`. pnpm resolves that to /openagentic-sdk
# (4 ups from /shared/workflow-engine = /) which doesn't exist. Rewrite
# it in-place to point at the staged /openagentic-sdk path, same fix as api/package.json
# below.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/shared/workflow-engine/package.json','utf8'));let touched=false;if(p.dependencies&&typeof p.dependencies['@agentic-work/llm-sdk']==='string'&&p.dependencies['@agentic-work/llm-sdk'].startsWith('file:')){p.dependencies['@agentic-work/llm-sdk']='file:/openagentic-sdk';touched=true;}if(touched){fs.writeFileSync('/shared/workflow-engine/package.json',JSON.stringify(p,null,2));console.log('rewrote workflow-engine SDK dep');}"

# Copy package files and prisma schema first (before install).
# Note: per-service pnpm-lock.yaml does not exist (workspace lockfile is at repo root)
# and would be stripped on line 75 anyway. Skip the COPY — `pnpm install
# --no-frozen-lockfile` below regenerates a per-image lockfile from package.json.
COPY ${SRC_PATH}/package.json ./
COPY ${SRC_PATH}/prisma ./prisma

# Inside the Docker builder there is no pnpm-workspace.yaml — the api
# image is built standalone, not inside the monorepo's pnpm workspace.
# Rewrite the workspace:* specifier for @openagentic/workflow-engine and
# the sibling-relative file: spec for @agentic-work/llm-sdk to point at
# the staged /shared and /openagentic-sdk directories. This keeps the source-tree
# specs intact for dev-time pnpm resolution while letting `pnpm install`
# succeed inside the image.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));let touched=false;if(p.dependencies&&p.dependencies['@openagentic/workflow-engine']==='workspace:*'){p.dependencies['@openagentic/workflow-engine']='file:/shared/workflow-engine';touched=true;}if(p.dependencies&&typeof p.dependencies['@agentic-work/llm-sdk']==='string'&&p.dependencies['@agentic-work/llm-sdk'].startsWith('file:')){p.dependencies['@agentic-work/llm-sdk']='file:/openagentic-sdk';touched=true;}if(touched){fs.writeFileSync('package.json',JSON.stringify(p,null,2));console.log('rewrote workspace/sibling deps');}"

# pnpm-lock.yaml was generated with workspace:* — strip it so the
# rewritten file: dep resolves cleanly. Lockfile integrity is
# re-established by pnpm install --no-frozen-lockfile below.
RUN rm -f pnpm-lock.yaml

# CRITICAL: .npmrc with shamefully-hoist=true is required for all SDKs to be
# requireable. Without this, pnpm installs in non-hoisted mode and packages
# like openai, @anthropic-ai/sdk, @google/genai are NOT found at runtime.
COPY ${SRC_PATH}/.npmrc* ./
RUN echo "auto-install-peers=true" > .npmrc && echo "shamefully-hoist=true" >> .npmrc

# Install all dependencies (including dev dependencies for build).
# This also runs prisma generate as postinstall.
RUN pnpm install --no-frozen-lockfile

# Build the shared workflow-engine package's dist/ so the symlink at
# /app/node_modules/@openagentic/workflow-engine resolves to compiled JS.
# The shared package's tsconfig points at its own ./dist; we build using
# the api's locally-installed tsc. The symlink to /app/node_modules lets
# the shared sources resolve their bare imports (isolated-vm, axios,
# etc.) during type-check; without it tsc fails because NodeNext refuses
# to walk past the package boundary.
RUN ln -sfn /app/node_modules /shared/workflow-engine/node_modules && \
    cd /shared/workflow-engine && /app/node_modules/.bin/tsc -p tsconfig.json

# Replace pnpm's file:-dep snapshot of @openagentic/workflow-engine (which
# was copied at install time, BEFORE dist/ existed, so the package.json
# `exports` map points at .d.ts files that aren't there) with a real
# symlink to the freshly-built /shared/workflow-engine. Without this,
# `pnpm tsc` later in the api fails with TS2307 "Cannot find module
# @openagentic/workflow-engine/nodes/registry" — the cached snapshot
# never sees the dist build. shamefully-hoist=true means the package
# lives at the top of node_modules, not inside .pnpm/.
RUN rm -rf /app/node_modules/@openagentic/workflow-engine && \
    mkdir -p /app/node_modules/@openagentic && \
    ln -sfn /shared/workflow-engine /app/node_modules/@openagentic/workflow-engine

# Verify isolated-vm native binary loads against the builder Node ABI.
# isolated-vm@6.1.2 publishes prebuilds for abi=127 (Node 22) and abi=137
# (Node 24); on Node 22-slim the abi=127 prebuild is picked up by
# prebuild-install at `pnpm install` time and no compile is needed. If a
# future bump leaves us on a Node version with no matching prebuild, this
# `require('isolated-vm')` will throw at build time instead of silently
# shipping a CrashLoopBackOff image to prod (#375). If you see this fail,
# either align the base image to a Node major isolated-vm prebuilds for,
# or invoke `pnpm rebuild isolated-vm` here (build tools are installed
# above for that fallback).
RUN node -e "require('isolated-vm'); console.log('isolated-vm OK abi=' + process.versions.modules)"

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

# Build TypeScript (skip prisma generate since we already ran it above).
# After tsc, copy non-.ts assets into dist/ — tsc only emits .ts -> .js,
# so the sub-agent markdown files under src/agents/built-in/*.md need an
# explicit cp step or BuiltInAgentRegistry.loadBuiltInAgents() ENOENTs at
# api startup (#531).
RUN pnpm tsc && pnpm run postbuild:assets

# Production image
# node:22-slim — must match builder major. isolated-vm prebuilds are
# ABI-pinned and the builder/runtime ABI must match (#375).
FROM node:22-slim

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

# Runtime deps:
#   curl, netcat-openbsd → health/startup checks
#   ca-certificates → TLS
# PDF export runs client-side (ClientExportService). DOCX/MD/Text use pure
# JS libs. No chromium / puppeteer on the server.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    netcat-openbsd \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

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
# Bring the shared workflow-engine dist/ + package.json so the
# node_modules/@openagentic/workflow-engine symlink resolves at runtime.
# Only dist/ + package.json are needed; src/ is omitted for image-size hygiene.
COPY --from=api-builder /shared/workflow-engine/dist          /shared/workflow-engine/dist
COPY --from=api-builder /shared/workflow-engine/package.json  /shared/workflow-engine/package.json
# Re-create the node_modules symlink so the shared dist/'s bare imports
# (isolated-vm, axios) resolve at runtime via standard Node walk-up.
RUN ln -sfn /app/node_modules /shared/workflow-engine/node_modules

# Copy RBAC system prompts (rev-2 chatmode plan §Layer-1).
# Loaded by RoleKeyedSystemPrompt.ts at runtime via fileURLToPath
# resolution from the dist/ tree → ../../../../prompts/. Cached
# per role after first read.
COPY ${SRC_PATH}/prompts ./prompts

# Copy version.json for the /api/version endpoint
COPY version.json ./

# Copy entrypoint script
COPY ${SRC_PATH}/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create uploads and logs directories
RUN mkdir -p uploads logs

# #56 — Hot-deploy compatibility: chown /app/dist + /shared/workflow-engine
# to the `node` user so `kubectl cp` from a developer can update compiled
# JS without root. Pod runs as uid 1000 (node) and previously couldn't
# overwrite root-owned files in /app/dist, so every API change required a
# full image rebuild + rollout. The image still ships as root-built;
# only ownership of mutable working dirs is relaxed.
RUN chown -R node:node /app/dist /app/uploads /app/logs /shared/workflow-engine

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8000/api/health || exit 1

# Use entrypoint script
ENTRYPOINT ["./docker-entrypoint.sh"]