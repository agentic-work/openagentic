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

# =============================================================================
# Stage 1: builder — npm install + Prisma generate + TypeScript compile
# =============================================================================
FROM node:22-slim AS builder

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
# compile the .node binary against the runtime Node version. Toolchain stays
# in the builder layer only; the compiled binary is COPYd into runtime.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ make ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/*

# Stage the shared workflow-engine package into the parent of /app so
# the file:../shared/workflow-engine dep resolves at install time.
COPY services/shared/workflow-engine/package.json     /shared/workflow-engine/package.json
COPY services/shared/workflow-engine/tsconfig.json    /shared/workflow-engine/tsconfig.json
COPY services/shared/workflow-engine/src              /shared/workflow-engine/src

# Tier A (2026-05-13): both packages declare
#   "@agentic-work/llm-sdk": "file:.../openagentic-sdk"
# which from /app and /shared/workflow-engine both normalize to
# /openagentic-sdk inside the container. Stage the SDK's prebuilt dist/ +
# package.json so the file: dep resolves at install time. The SDK ships
# with dist/ pre-built (npm prepare hook); we only need dist + package.json
# at runtime for the canonical event builders. build.sh rsyncs the sibling
# SDK into `<context>/sdk/` (see scripts/build.sh §1).
#
# Strip the `prepare` script from the staged SDK package.json so npm's
# file: dep handling doesn't try to rebuild the SDK inside this image
# (which lacks the SDK's devDependencies: tsc, etc.). dist/ is already
# baked from the host build.
COPY openagentic-sdk/package.json    /openagentic-sdk/package.json.orig
COPY openagentic-sdk/dist            /openagentic-sdk/dist
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/openagentic-sdk/package.json.orig','utf8'));if(p.scripts){delete p.scripts.prepare;delete p.scripts.prepublishOnly;}fs.writeFileSync('/openagentic-sdk/package.json',JSON.stringify(p,null,2));"

COPY services/openagentic-workflows/package.json ./
RUN npm install
# Force rebuild of native deps (isolated-vm) from source — prebuild-install
# silently exits 0 when no prebuild matches; explicit rebuild guarantees the
# .node binary is present.
RUN npm rebuild isolated-vm

# Build the shared package's dist/ so the runtime stage can consume it.
# The shared package's tsconfig emits to /shared/workflow-engine/dist —
# the symlink at /app/node_modules/@openagentic/workflow-engine points
# there, so the consumer's runtime resolves the compiled JS via the
# package.json `exports` map. The symlink to /app/node_modules lets the
# shared sources resolve their bare imports (isolated-vm, axios, etc.)
# during type-check; without it tsc fails because NodeNext refuses to
# walk past the package boundary.
RUN ln -sfn /app/node_modules /shared/workflow-engine/node_modules && \
    cd /shared/workflow-engine && /app/node_modules/.bin/tsc -p tsconfig.json

COPY services/openagentic-workflows/prisma ./prisma
RUN npx prisma generate

COPY services/openagentic-workflows/tsconfig.json ./
COPY services/openagentic-workflows/src ./src
# Permanent template payload — copied into builder then forwarded to runtime
# below. The boot path (`templateSeeder.ts`) reads /app/templates/*.json on
# every workflows-svc boot and idempotently upserts them so every tenant
# sees the same canonical AIOps template gallery.
COPY services/openagentic-workflows/seed/templates ./templates
RUN npm run build \
 && npm prune --omit=dev

# =============================================================================
# Stage 2: runtime — node:22-slim with curl for health probes
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

COPY --from=builder /app/node_modules           ./node_modules
COPY --from=builder /app/dist                   ./dist
COPY --from=builder /app/prisma                 ./prisma
# Permanent template payload — read on boot by templateSeeder.ts.
COPY --from=builder /app/templates              ./templates
# Bring the shared package's dist/ into the runtime image so the
# node_modules/@openagentic/workflow-engine symlink (file: dep) resolves
# to a real on-disk dist/. We only need dist/ + package.json at runtime —
# src/ stays out for image-size hygiene.
COPY --from=builder /shared/workflow-engine/dist          /shared/workflow-engine/dist
COPY --from=builder /shared/workflow-engine/package.json  /shared/workflow-engine/package.json
# Tier A — bring openagentic-sdk dist/ + package.json so the
# node_modules/@agentic-work/llm-sdk symlink resolves at runtime.
COPY --from=builder /openagentic-sdk/dist                 /openagentic-sdk/dist
COPY --from=builder /openagentic-sdk/package.json         /openagentic-sdk/package.json
# Re-create the node_modules symlink so the shared dist/'s bare imports
# (isolated-vm, axios) resolve at runtime via standard Node walk-up.
# Node uses realpath when resolving through symlinks, so the .js files
# at /shared/workflow-engine/dist/ need a node_modules sibling.
RUN ln -sfn /app/node_modules /shared/workflow-engine/node_modules
COPY services/openagentic-workflows/package.json ./

ENV NODE_ENV=production \
    PORT=3400 \
    NODE_OPTIONS=--max-old-space-size=2048

EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3400/health || exit 1

ENTRYPOINT ["node"]
CMD ["dist/index.js"]
