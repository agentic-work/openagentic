# =============================================================================
# AGENT-PROXY — Chainguard hardened runtime (2026-04-22)
# =============================================================================
# Was: node:20-slim (Harbor Trivy: 144 HIGH). Now: cgr.dev/chainguard/node —
# distroless, non-root uid 65532, no shell, no apt, daily CVE rebuilds,
# SBOM attached, cosign-signed. Node.js handles PID 1 signals natively since
# v10, so the dumb-init wrapper from the old Dockerfile is unnecessary.

ARG NODE_TAG=22

# =============================================================================
# Stage 1: builder — has shell + npm for TypeScript compile
# =============================================================================
FROM node:22-slim AS builder

WORKDIR /app

COPY --chown=65532:65532 services/openagentic-proxy/package.json ./
RUN npm install

COPY --chown=65532:65532 services/openagentic-proxy/tsconfig.json ./
COPY --chown=65532:65532 services/openagentic-proxy/src ./src
RUN npm run build \
 && npm prune --omit=dev

# =============================================================================
# Stage 2: runtime — distroless node, non-root, no shell
# =============================================================================
FROM node:22-slim

LABEL org.opencontainers.image.title="openagentic-proxy"
LABEL org.opencontainers.image.description="OpenAgentic agent orchestration service"

WORKDIR /app

COPY --from=builder --chown=65532:65532 /app/node_modules       ./node_modules
COPY --from=builder --chown=65532:65532 /app/dist               ./dist
COPY --chown=65532:65532 services/openagentic-proxy/package.json      ./

ENV NODE_ENV=production \
    PORT=3300

EXPOSE 3300

# No HEALTHCHECK — distroless runtime has nothing to shell out with.
# k8s liveness/readiness probes in the Deployment manifest hit
# /api/agents/health directly.

USER 65532:65532
ENTRYPOINT ["node"]
CMD ["dist/index.js"]
