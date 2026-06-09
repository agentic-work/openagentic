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
# Symlink the built llm-sdk into /app/node_modules so workflow-engine's
# tsc can resolve `@agentic-work/llm-sdk` bare imports.
RUN rm -rf /app/node_modules/@agentic-work/llm-sdk && \
    mkdir -p /app/node_modules/@agentic-work && \
    ln -sfn /shared/llm-sdk /app/node_modules/@agentic-work/llm-sdk && \
    ln -sfn /app/node_modules /shared/workflow-engine/node_modules && \
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
# Vendored llm-sdk runtime artifacts.
COPY --from=builder /shared/llm-sdk/dist                  /shared/llm-sdk/dist
COPY --from=builder /shared/llm-sdk/package.json          /shared/llm-sdk/package.json
# Re-create the node_modules symlink so the shared dist/'s bare imports
# (isolated-vm, axios) resolve at runtime via standard Node walk-up.
# Node uses realpath when resolving through symlinks, so the .js files
# at /shared/workflow-engine/dist/ need a node_modules sibling.
RUN ln -sfn /app/node_modules /shared/workflow-engine/node_modules && \
    ln -sfn /app/node_modules /shared/llm-sdk/node_modules && \
    rm -rf /app/node_modules/@agentic-work/llm-sdk && \
    mkdir -p /app/node_modules/@agentic-work && \
    ln -sfn /shared/llm-sdk /app/node_modules/@agentic-work/llm-sdk
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
