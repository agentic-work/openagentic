
# Smart Dockerfile that works for both docker-compose and standalone builds
# Usage:
#   Standalone: docker build .
#   Compose: docker build --build-arg SRC_PATH=services/openagentic-api .
#
# MULTI-ARCH STRATEGY — cross-compile the TypeScript ONCE, ship arch-independent
# JS to both arches; build native modules per TARGET arch.
#
#   1. `js-builder` is pinned to the BUILD platform (`--platform=$BUILDPLATFORM`)
#      so `tsc` runs NATIVELY (fast, no V8-under-QEMU SIGSEGV). The compiled
#      `dist/` is pure JS and arch-independent, so the same artifact is reused
#      for every --platform leg. This is what kills the ~32min arm64 tsc.
#
#   2. `native-deps` uses a plain `FROM node:22-slim` which buildx resolves to
#      the TARGET arch per --platform leg. It (re)installs node_modules so the
#      native bindings (isolated-vm, @prisma/engines client engine, sharp,
#      canvas, bcrypt) are built/downloaded for the TARGET arch — NOT copied
#      from the amd64 js-builder. On the arm64 leg this runs under QEMU, but a
#      deps install just downloads prebuilt binaries (prebuild-install) and is
#      far cheaper than a full emulated tsc. The isolated-vm ABI check runs here
#      so a missing target-arch binary fails the build instead of shipping a
#      CrashLoopBackOff image.
#
#   3. The runtime stage (also plain `FROM node:22-slim` → TARGET arch) copies
#      `dist/` from js-builder (arch-independent) and `node_modules/` from
#      native-deps (TARGET-arch native bindings).
#
# Node 22-slim: isolated-vm@6.1.2 ships prebuilds for abi=127 (Node 22) and
# abi=137 (Node 24) only — NOT abi=115 (Node 20). Building on node:20-slim
# silently shipped images with no native binary because prebuild-install
# exits 0 when no prebuild matches and pnpm rebuild was a no-op (#375).
# Node 22 is the LTS that actually has a published isolated-vm prebuild.

# =============================================================================
# Stage 1: js-builder — runs on the BUILD platform (NATIVE tsc, no QEMU)
# Produces arch-independent compiled JS: /app/dist + /shared/*/dist
# =============================================================================
# BUILDPLATFORM is auto-provided by buildx; pinning the builder to it means tsc
# always runs on the native host CPU even when targeting a foreign --platform.
ARG BUILDPLATFORM
FROM --platform=$BUILDPLATFORM node:22-slim AS js-builder

WORKDIR /app

# Native-build toolchain — kept as a belt-and-suspenders fallback in case a
# future native dep ships without a matching prebuild. The js-builder does NOT
# ship its node_modules to runtime (native bindings here are BUILD-arch), so
# this toolchain is only needed if a postinstall/prisma-generate step compiles.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ make ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

# Path prefix for docker-compose builds (empty for standalone)
ARG SRC_PATH=.

# Stage the shared workspace packages alongside the api so the workspace:*
# deps resolve during install. Layout in builder:
#   /app                      api service (WORKDIR)
#   /shared/workflow-engine   workspace package (workspace:* dep target)
#   /shared/llm-sdk           workspace package (@agentic-work/llm-sdk)
COPY services/shared/workflow-engine/package.json     /shared/workflow-engine/package.json
COPY services/shared/workflow-engine/tsconfig.json    /shared/workflow-engine/tsconfig.json
COPY services/shared/workflow-engine/src              /shared/workflow-engine/src
COPY services/shared/llm-sdk/package.json             /shared/llm-sdk/package.json
COPY services/shared/llm-sdk/tsconfig.json            /shared/llm-sdk/tsconfig.json
COPY services/shared/llm-sdk/src                      /shared/llm-sdk/src
COPY services/shared/llm-sdk/scripts                  /shared/llm-sdk/scripts

# workflow-engine's package.json declares @agentic-work/llm-sdk as
# workspace:* — rewrite to file:/shared/llm-sdk for the standalone image.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/shared/workflow-engine/package.json','utf8'));let touched=false;if(p.dependencies&&p.dependencies['@agentic-work/llm-sdk']==='workspace:*'){p.dependencies['@agentic-work/llm-sdk']='file:/shared/llm-sdk';touched=true;}if(touched){fs.writeFileSync('/shared/workflow-engine/package.json',JSON.stringify(p,null,2));console.log('rewrote workflow-engine SDK dep');}"

# Copy package files and prisma schema first (before install).
# Note: per-service pnpm-lock.yaml does not exist (workspace lockfile is at repo root)
# and would be stripped below anyway. Skip the COPY — `pnpm install
# --no-frozen-lockfile` regenerates a per-image lockfile from package.json.
COPY ${SRC_PATH}/package.json ./
COPY ${SRC_PATH}/prisma ./prisma

# Inside the Docker builder there is no pnpm-workspace.yaml — the api
# image is built standalone, not inside the monorepo's pnpm workspace.
# Rewrite the workspace:* specifier for @openagentic/workflow-engine and
# the sibling-relative file: spec for @agentic-work/llm-sdk to point at
# the staged /shared and /openagentic-sdk directories. This keeps the source-tree
# specs intact for dev-time pnpm resolution while letting `pnpm install`
# succeed inside the image.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));let touched=false;if(p.dependencies&&p.dependencies['@openagentic/workflow-engine']==='workspace:*'){p.dependencies['@openagentic/workflow-engine']='file:/shared/workflow-engine';touched=true;}if(p.dependencies&&p.dependencies['@agentic-work/llm-sdk']==='workspace:*'){p.dependencies['@agentic-work/llm-sdk']='file:/shared/llm-sdk';touched=true;}if(touched){fs.writeFileSync('package.json',JSON.stringify(p,null,2));console.log('rewrote workspace deps');}"

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
# This also runs prisma generate as postinstall. Native bindings installed here
# are BUILD-arch and are NOT shipped to runtime — only dist/ is.
RUN pnpm install --no-frozen-lockfile

# Build llm-sdk first, symlink, then workflow-engine (which depends on it).
RUN ln -sfn /app/node_modules /shared/llm-sdk/node_modules && \
    cd /shared/llm-sdk && /app/node_modules/.bin/tsc -p tsconfig.json && \
    node scripts/fix-esm-imports.js && \
    rm -rf /app/node_modules/@agentic-work/llm-sdk && \
    mkdir -p /app/node_modules/@agentic-work && \
    ln -sfn /shared/llm-sdk /app/node_modules/@agentic-work/llm-sdk
RUN ln -sfn /app/node_modules /shared/workflow-engine/node_modules && \
    cd /shared/workflow-engine && /app/node_modules/.bin/tsc -p tsconfig.json && \
    rm -rf /app/node_modules/@openagentic/workflow-engine && \
    mkdir -p /app/node_modules/@openagentic && \
    ln -sfn /shared/workflow-engine /app/node_modules/@openagentic/workflow-engine

# Add cache-busting ARG
ARG CACHEBUST=1

# Copy source code
COPY ${SRC_PATH}/src ./src
COPY ${SRC_PATH}/tsconfig.json ./

# Clean any existing build artifacts. NOTE: tsconfig has incremental:true, which
# writes `tsconfig.tsbuildinfo` (NOT `.tsbuildinfo`) — a stale one makes tsc skip
# recompiling unchanged-looking files and silently ship stale .js. Remove the real
# name(s) so every build fully recompiles.
RUN rm -rf dist node_modules/.cache .tsbuildinfo *.tsbuildinfo tsconfig.tsbuildinfo

# Generate Prisma client with retry logic and checksum bypass for unreliable
# networks. (BUILD-arch engine; runtime regenerates the TARGET-arch engine in
# the native-deps stage. This generate only needs to produce the TS client types
# tsc consumes.)
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
RUN for i in 1 2 3; do pnpm prisma generate && break || sleep 5; done

# Build TypeScript NATIVELY on the build platform (no QEMU → no SIGSEGV, no
# --jitless, fast). After tsc, copy non-.ts assets into dist/ — tsc only emits
# .ts -> .js, so the sub-agent markdown files under src/agents/built-in/*.md and
# the pricing data JSON need an explicit cp step (postbuild:assets) or
# BuiltInAgentRegistry.loadBuiltInAgents() ENOENTs at api startup (#531).
RUN export NODE_OPTIONS="--max-old-space-size=4096" && \
    pnpm tsc && pnpm run postbuild:assets

# =============================================================================
# Stage 2: native-deps — runs on the TARGET platform (buildx per --platform leg)
# (Re)installs node_modules so native bindings (isolated-vm, prisma engine,
# sharp, canvas, bcrypt) are built/downloaded for the TARGET arch. Under QEMU on
# the foreign leg, but this is a deps download — NOT an emulated tsc.
# =============================================================================
FROM node:22-slim AS native-deps

WORKDIR /app

# Native-build toolchain — fallback in case a native dep on this TARGET arch
# ships without a matching prebuild and node-gyp must compile it.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ make ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

ARG SRC_PATH=.

# Stage the shared workspace packages (package.json + dist) so the file: deps
# resolve at install time. The dist/ comes from js-builder (arch-independent JS),
# so we don't recompile them here — we only need their package.json present for
# `pnpm install` to wire the file: dependency, plus the compiled dist for the
# symlink to resolve at runtime.
COPY --from=js-builder /shared/workflow-engine/package.json /shared/workflow-engine/package.json
COPY --from=js-builder /shared/workflow-engine/dist         /shared/workflow-engine/dist
COPY --from=js-builder /shared/llm-sdk/package.json         /shared/llm-sdk/package.json
COPY --from=js-builder /shared/llm-sdk/dist                 /shared/llm-sdk/dist

COPY ${SRC_PATH}/package.json ./
COPY ${SRC_PATH}/prisma ./prisma

# Same workspace:*/file: rewrites as js-builder so `pnpm install` resolves the
# shared packages from /shared.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));let touched=false;if(p.dependencies&&p.dependencies['@openagentic/workflow-engine']==='workspace:*'){p.dependencies['@openagentic/workflow-engine']='file:/shared/workflow-engine';touched=true;}if(p.dependencies&&p.dependencies['@agentic-work/llm-sdk']==='workspace:*'){p.dependencies['@agentic-work/llm-sdk']='file:/shared/llm-sdk';touched=true;}if(touched){fs.writeFileSync('package.json',JSON.stringify(p,null,2));console.log('rewrote workspace deps');}"
# workflow-engine's package.json (from js-builder) was already rewritten to
# file:/shared/llm-sdk, so its file: dep resolves here too.

RUN rm -f pnpm-lock.yaml
COPY ${SRC_PATH}/.npmrc* ./
RUN echo "auto-install-peers=true" > .npmrc && echo "shamefully-hoist=true" >> .npmrc

# Install — pulls TARGET-arch prebuilt native binaries (prebuild-install) for
# isolated-vm/sharp/canvas/bcrypt and the TARGET-arch prisma client engine via
# the postinstall prisma generate.
RUN pnpm install --no-frozen-lockfile

# Re-create the shared package symlinks so node resolution works for the ABI
# check below and at runtime.
RUN rm -rf /app/node_modules/@agentic-work/llm-sdk /app/node_modules/@openagentic/workflow-engine && \
    mkdir -p /app/node_modules/@agentic-work /app/node_modules/@openagentic && \
    ln -sfn /shared/llm-sdk /app/node_modules/@agentic-work/llm-sdk && \
    ln -sfn /shared/workflow-engine /app/node_modules/@openagentic/workflow-engine && \
    ln -sfn /app/node_modules /shared/llm-sdk/node_modules && \
    ln -sfn /app/node_modules /shared/workflow-engine/node_modules

# Belt-and-suspenders: force the TARGET-arch native binary for isolated-vm.
# prebuild-install exits 0 when no prebuild matches, so an explicit rebuild
# guarantees a binary exists for this arch (compiles via the toolchain above if
# no prebuild is published). isolated-vm reaches /app/node_modules via the
# shamefully-hoist; it is a transitive dep of @openagentic/workflow-engine.
RUN pnpm rebuild isolated-vm || npm rebuild isolated-vm || true

# Generate the TARGET-arch Prisma client engine (binaryTargets includes
# "native", which here resolves to the TARGET arch since this stage runs on it).
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
RUN for i in 1 2 3; do pnpm prisma generate && break || sleep 5; done

# Verify isolated-vm's native binary loads against THIS (TARGET) arch's Node ABI.
# Getting native modules wrong = arm64 image crashes at runtime; this check turns
# a missing/mismatched TARGET-arch binary into a build-time failure (#375).
RUN node -e "require('isolated-vm'); console.log('isolated-vm OK abi=' + process.versions.modules + ' arch=' + process.arch)"

# =============================================================================
# Stage 3: runtime — TARGET arch (plain FROM resolves per --platform leg)
# dist/ from js-builder (arch-independent) + node_modules from native-deps.
# node:22-slim — must match builder major. isolated-vm prebuilds are ABI-pinned
# and the builder/runtime ABI must match (#375).
# =============================================================================
FROM node:22-slim

# Version build args
ARG PLATFORM_VERSION=1.0.0
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

# Copy compiled JS from js-builder (arch-independent) and node_modules from
# native-deps (TARGET-arch native bindings — isolated-vm, prisma engine, sharp,
# canvas, bcrypt). These MUST come from native-deps, not js-builder, or the
# arm64 image would ship amd64 binaries and crash at runtime.
COPY --from=js-builder  /app/dist          ./dist
COPY --from=native-deps /app/node_modules  ./node_modules
COPY ${SRC_PATH}/prisma ./prisma
# Bring the shared workflow-engine + llm-sdk dist/ + package.json so the
# node_modules/@openagentic/workflow-engine + @agentic-work/llm-sdk symlinks
# resolve at runtime. dist/ is arch-independent JS from js-builder.
COPY --from=js-builder /shared/workflow-engine/dist          /shared/workflow-engine/dist
COPY --from=js-builder /shared/workflow-engine/package.json  /shared/workflow-engine/package.json
COPY --from=js-builder /shared/llm-sdk/dist                  /shared/llm-sdk/dist
COPY --from=js-builder /shared/llm-sdk/package.json          /shared/llm-sdk/package.json
RUN ln -sfn /app/node_modules /shared/workflow-engine/node_modules && \
    ln -sfn /app/node_modules /shared/llm-sdk/node_modules && \
    rm -rf /app/node_modules/@agentic-work/llm-sdk /app/node_modules/@openagentic/workflow-engine && \
    mkdir -p /app/node_modules/@agentic-work /app/node_modules/@openagentic && \
    ln -sfn /shared/llm-sdk /app/node_modules/@agentic-work/llm-sdk && \
    ln -sfn /shared/workflow-engine /app/node_modules/@openagentic/workflow-engine

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

# Health check. start-period covers the FULL first boot (Prisma schema push + Milvus
# collections + MCP tool indexing + secondary seed ~= 6-7 min with all 9 MCPs). Too short
# and the container flips `unhealthy` mid-boot, which breaks services that
# `depends_on api: service_healthy` (e.g. openagentic-workflows, whose template seed needs
# the api schema push done first).
HEALTHCHECK --interval=15s --timeout=10s --start-period=600s --retries=5 \
  CMD curl -f http://localhost:8000/api/health || exit 1

# Use entrypoint script
ENTRYPOINT ["./docker-entrypoint.sh"]
LABEL org.opencontainers.image.title="openagentic-api"
LABEL org.opencontainers.image.description="OpenAgentic API — orchestrator, chat, flows, code mode, MCP routing, RBAC, audit. Apache 2.0."
LABEL org.opencontainers.image.source="https://github.com/agentic-work/openagentic"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.vendor="AgenticWork LLC"
