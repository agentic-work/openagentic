# OpenAgentic Workflows
#
# Was: cgr.dev/chainguard/node distroless. apk on Wolfi doesn't ship a
# 'python-3' package (would need 'python-3.13' or similar versioned name) —
# fix attempt failed, so switched to node:22-slim for parity with the api
# service. Chainguard hardening is tracked as a separate cleanup task —
# the workflows service needs node-gyp to compile isolated-vm@6.1.2 against
# the runtime ABI, and the toolchain story is simpler under Debian.
#
# Node 22 specifically because isolated-vm@6.1.2 ships prebuilds for abi=127
# (Node 22) and abi=137 (Node 24) only — abi=115 (Node 20) has none and
# silently shipped binary-less images previously.
#
# MULTI-ARCH STRATEGY — cross-compile the TypeScript ONCE, ship arch-independent
# JS to both arches; build native modules per TARGET arch.
#
#   1. `js-builder` is pinned to the BUILD platform (`--platform=$BUILDPLATFORM`)
#      so `tsc` runs NATIVELY (fast, no V8-under-QEMU SIGSEGV). The compiled
#      `dist/` is pure JS and arch-independent and is reused for every leg.
#   2. `native-deps` uses a plain `FROM node:22-slim` → resolved to the TARGET
#      arch per --platform leg. It (re)installs node_modules so the native
#      bindings (isolated-vm, prisma client engine) are built/downloaded for the
#      TARGET arch — NOT copied from the amd64 js-builder. Runs under QEMU on the
#      foreign leg, but a deps install just pulls prebuilt binaries — far cheaper
#      than an emulated tsc. The isolated-vm ABI check runs here so a missing
#      target-arch binary fails the build instead of shipping a crashing image.
#   3. The runtime stage (also plain `FROM node:22-slim` → TARGET arch) copies
#      `dist/` from js-builder + `node_modules/` from native-deps.

# =============================================================================
# Stage 1: js-builder — runs on the BUILD platform (NATIVE tsc, no QEMU)
# npm install + Prisma generate (types) + TypeScript compile.
# Produces arch-independent compiled JS: /app/dist + /shared/*/dist
# =============================================================================
# BUILDPLATFORM is auto-provided by buildx; pinning the builder to it means tsc
# always runs on the native host CPU even when targeting a foreign --platform.
ARG BUILDPLATFORM
FROM --platform=$BUILDPLATFORM node:22-slim AS js-builder

# Layout in the builder:
#   /app                                 workflows service (WORKDIR)
#   /shared/workflow-engine              shared package (file: dep target)
#
# The workflows package.json declares
#   "@openagentic/workflow-engine": "file:../shared/workflow-engine"
# which npm resolves relative to /app — i.e. /shared/workflow-engine.
# We copy the shared package's sources first so npm install can wire up
# the file: dependency, then we build the shared package's dist/ in
# place so the runtime stage can pick it up via the symlink in
# node_modules/@openagentic/workflow-engine.
WORKDIR /app

# Native-build toolchain — required for isolated-vm@6.1.2 (B1 sandbox / S0-2).
# node:22-slim does not ship python/g++/make; install them so node-gyp can
# compile if needed. Native bindings built here are BUILD-arch and are NOT
# shipped to runtime — only dist/ is.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ make ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/*

# Stage the shared workflow-engine package into the parent of /app so
# the file:../shared/workflow-engine dep resolves at install time.
COPY services/shared/workflow-engine/package.json     /shared/workflow-engine/package.json
COPY services/shared/workflow-engine/tsconfig.json    /shared/workflow-engine/tsconfig.json
COPY services/shared/workflow-engine/src              /shared/workflow-engine/src

# Stage the vendored llm-sdk as a workspace sibling and rewrite the
# workspace:* spec in workflow-engine to a file: dep that resolves
# inside the container (no sibling openagentic-sdk dir in OSS).
COPY services/shared/llm-sdk/package.json   /shared/llm-sdk/package.json
COPY services/shared/llm-sdk/tsconfig.json  /shared/llm-sdk/tsconfig.json
COPY services/shared/llm-sdk/src            /shared/llm-sdk/src
COPY services/shared/llm-sdk/scripts        /shared/llm-sdk/scripts
# Strip the SDK's `prepare` hook so npm install on consumers doesn't
# try to build it before tsc is available.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/shared/llm-sdk/package.json','utf8'));if(p.scripts){delete p.scripts.prepare;delete p.scripts.prepublishOnly;}fs.writeFileSync('/shared/llm-sdk/package.json',JSON.stringify(p,null,2));"
# Build SDK now so workflow-engine + workflows can consume it.
RUN cd /shared/llm-sdk && npm install --ignore-scripts --no-save && \
    /shared/llm-sdk/node_modules/.bin/tsc -p tsconfig.json && \
    node scripts/fix-esm-imports.js
# workflow-engine declares workspace:* — rewrite to file:/shared/llm-sdk
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/shared/workflow-engine/package.json','utf8'));if(p.dependencies&&p.dependencies['@agentic-work/llm-sdk']==='workspace:*'){p.dependencies['@agentic-work/llm-sdk']='file:/shared/llm-sdk';fs.writeFileSync('/shared/workflow-engine/package.json',JSON.stringify(p,null,2));}"

COPY services/openagentic-workflows/package.json ./
# Workflows declares workspace:* for both deps — rewrite to file: paths.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));let touched=false;if(p.dependencies&&p.dependencies['@agentic-work/llm-sdk']==='workspace:*'){p.dependencies['@agentic-work/llm-sdk']='file:/shared/llm-sdk';touched=true;}if(p.dependencies&&p.dependencies['@openagentic/workflow-engine']==='workspace:*'){p.dependencies['@openagentic/workflow-engine']='file:/shared/workflow-engine';touched=true;}if(touched){fs.writeFileSync('package.json',JSON.stringify(p,null,2));}"
RUN npm install --legacy-peer-deps
# NOTE: native bindings (isolated-vm) installed here are BUILD-arch only; the
# TARGET-arch binary is produced in the native-deps stage. No rebuild needed
# here — js-builder only needs the JS to type-check + compile.

# Build the shared package's dist/ so the runtime stage can consume it.
# The shared package's tsconfig emits to /shared/workflow-engine/dist —
# the symlink at /app/node_modules/@openagentic/workflow-engine points
# there, so the consumer's runtime resolves the compiled JS via the
# package.json `exports` map. The symlink to /app/node_modules lets the
# shared sources resolve their bare imports (isolated-vm, axios, etc.)
# during type-check; without it tsc fails because NodeNext refuses to
# walk past the package boundary.
# Symlink the built llm-sdk into /app/node_modules so workflow-engine's
# tsc can resolve `@agentic-work/llm-sdk` bare imports.
RUN rm -rf /app/node_modules/@agentic-work/llm-sdk && \
    mkdir -p /app/node_modules/@agentic-work && \
    ln -sfn /shared/llm-sdk /app/node_modules/@agentic-work/llm-sdk && \
    ln -sfn /app/node_modules /shared/workflow-engine/node_modules && \
    cd /shared/workflow-engine && /app/node_modules/.bin/tsc -p tsconfig.json

COPY services/openagentic-workflows/prisma ./prisma
# Prisma generate here produces the TS client types tsc consumes (BUILD-arch
# engine; the TARGET-arch engine is regenerated in native-deps).
RUN npx prisma generate

COPY services/openagentic-workflows/tsconfig.json ./
COPY services/openagentic-workflows/src ./src
# Permanent template payload — copied into builder then forwarded to runtime
# below. The boot path (`templateSeeder.ts`) reads /app/templates/*.json on
# every workflows-svc boot and idempotently upserts them so every tenant
# sees the same canonical AIOps template gallery.
COPY services/openagentic-workflows/seed/templates ./templates
# Compile TypeScript NATIVELY on the build platform (no QEMU → no SIGSEGV, no
# --jitless, fast). Clean the incremental tsbuildinfo first so a stale one
# never makes tsc skip recompiling and ship stale .js.
RUN rm -f tsconfig.tsbuildinfo *.tsbuildinfo && \
    export NODE_OPTIONS="--max-old-space-size=4096" && \
    npm run build

# =============================================================================
# Stage 2: native-deps — runs on the TARGET platform (buildx per --platform leg)
# (Re)installs production node_modules so native bindings (isolated-vm, prisma
# client engine) are built/downloaded for the TARGET arch. Under QEMU on the
# foreign leg, but this is a deps download — NOT an emulated tsc.
# =============================================================================
FROM node:22-slim AS native-deps

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ make ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/*

# Stage the shared packages: package.json (for file: dep resolution) + the
# arch-independent dist/ from js-builder (no recompile here).
COPY --from=js-builder /shared/workflow-engine/package.json /shared/workflow-engine/package.json
COPY --from=js-builder /shared/workflow-engine/dist         /shared/workflow-engine/dist
COPY --from=js-builder /shared/llm-sdk/package.json         /shared/llm-sdk/package.json
COPY --from=js-builder /shared/llm-sdk/dist                 /shared/llm-sdk/dist

COPY services/openagentic-workflows/package.json ./
# Same file: rewrites as js-builder so npm install resolves the shared packages.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));let touched=false;if(p.dependencies&&p.dependencies['@agentic-work/llm-sdk']==='workspace:*'){p.dependencies['@agentic-work/llm-sdk']='file:/shared/llm-sdk';touched=true;}if(p.dependencies&&p.dependencies['@openagentic/workflow-engine']==='workspace:*'){p.dependencies['@openagentic/workflow-engine']='file:/shared/workflow-engine';touched=true;}if(touched){fs.writeFileSync('package.json',JSON.stringify(p,null,2));}"

COPY services/openagentic-workflows/prisma ./prisma

# Install ALL deps (incl. dev). The pinned `prisma` CLI is a devDependency, so
# we must NOT --omit=dev before `prisma generate` — otherwise npx fetches the
# LATEST prisma (v7) from the network, which rejects the v6 `url = env(...)`
# schema syntax and fails the build. Install full, generate with the pinned CLI,
# then prune dev below. This pulls TARGET-arch prebuilt native binaries too.
RUN npm install --legacy-peer-deps
# Force the TARGET-arch native binary for isolated-vm. prebuild-install exits 0
# when no prebuild matches, so an explicit rebuild guarantees a binary exists for
# this arch (compiles via the toolchain above if no prebuild is published).
RUN npm rebuild isolated-vm

# Generate the TARGET-arch Prisma client engine (binaryTargets includes
# "native", which here resolves to the TARGET arch since this stage runs on it).
# Uses the locally-installed pinned prisma@6 CLI (NOT a network npx fetch).
RUN ./node_modules/.bin/prisma generate

# Verify isolated-vm's native binary loads against THIS (TARGET) arch's Node ABI.
# Getting native modules wrong = arm64 image crashes at runtime; this turns a
# missing/mismatched TARGET-arch binary into a build-time failure (#375).
RUN node -e "require('isolated-vm'); console.log('isolated-vm OK abi=' + process.versions.modules + ' arch=' + process.arch)"

# Drop dev deps now that the client is generated. `@prisma/client` + the
# generated engine under node_modules/.prisma are production deps and survive the
# prune; the prisma CLI + tsc + types are removed for image-size hygiene. This
# mirrors the original `npm prune --omit=dev`.
RUN npm prune --omit=dev

# =============================================================================
# Stage 3: runtime — TARGET arch (plain FROM resolves per --platform leg)
# dist/ from js-builder (arch-independent) + node_modules from native-deps.
# node:22-slim with curl for health probes.
# =============================================================================
FROM node:22-slim

LABEL org.opencontainers.image.title="openagentic-workflows"
LABEL org.opencontainers.image.description="OpenAgentic workflow execution service"

WORKDIR /app

# Runtime: curl for health probes, ca-certificates for TLS.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# node_modules with TARGET-arch native bindings (isolated-vm, prisma engine)
# MUST come from native-deps, not js-builder, or the arm64 image would ship
# amd64 binaries and crash at runtime.
COPY --from=native-deps /app/node_modules           ./node_modules
# Compiled JS is arch-independent — from js-builder.
COPY --from=js-builder  /app/dist                   ./dist
COPY --from=js-builder  /app/prisma                 ./prisma
# Permanent template payload — read on boot by templateSeeder.ts.
COPY --from=js-builder  /app/templates              ./templates
# Bring the shared package's dist/ into the runtime image so the
# node_modules/@openagentic/workflow-engine symlink (file: dep) resolves
# to a real on-disk dist/. We only need dist/ + package.json at runtime —
# src/ stays out for image-size hygiene.
COPY --from=js-builder /shared/workflow-engine/dist          /shared/workflow-engine/dist
COPY --from=js-builder /shared/workflow-engine/package.json  /shared/workflow-engine/package.json
# Vendored llm-sdk runtime artifacts.
COPY --from=js-builder /shared/llm-sdk/dist                  /shared/llm-sdk/dist
COPY --from=js-builder /shared/llm-sdk/package.json          /shared/llm-sdk/package.json
# Re-create the node_modules symlink so the shared dist/'s bare imports
# (isolated-vm, axios) resolve at runtime via standard Node walk-up.
# Node uses realpath when resolving through symlinks, so the .js files
# at /shared/workflow-engine/dist/ need a node_modules sibling.
RUN ln -sfn /app/node_modules /shared/workflow-engine/node_modules && \
    ln -sfn /app/node_modules /shared/llm-sdk/node_modules && \
    rm -rf /app/node_modules/@agentic-work/llm-sdk /app/node_modules/@openagentic/workflow-engine && \
    mkdir -p /app/node_modules/@agentic-work /app/node_modules/@openagentic && \
    ln -sfn /shared/llm-sdk /app/node_modules/@agentic-work/llm-sdk && \
    ln -sfn /shared/workflow-engine /app/node_modules/@openagentic/workflow-engine
COPY services/openagentic-workflows/package.json ./

ENV NODE_ENV=production \
    PORT=3400 \
    NODE_OPTIONS=--max-old-space-size=2048

EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3400/health || exit 1

ENTRYPOINT ["node"]
CMD ["dist/index.js"]
LABEL org.opencontainers.image.source="https://github.com/agentic-work/openagentic"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.vendor="AgenticWork LLC"
