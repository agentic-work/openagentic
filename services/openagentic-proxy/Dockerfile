# =============================================================================
# AGENT-PROXY - Agent Orchestration Service
# =============================================================================
FROM node:20-slim AS builder

WORKDIR /app
COPY services/openagentic-proxy/package.json ./
RUN npm install --production=false
COPY services/openagentic-proxy/tsconfig.json ./
COPY services/openagentic-proxy/src ./src
RUN npm run build

# -----------------------------------------------------------------------------
# Runtime
# -----------------------------------------------------------------------------
FROM node:20-slim

LABEL maintainer="OpenAgentic <engineering@openagentic.io>"
LABEL description="Agent-Proxy: Decoupled agent orchestration service"

RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY services/openagentic-proxy/package.json ./

ENV NODE_ENV=production
ENV PORT=3300

EXPOSE 3300

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3300/api/agents/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["dumb-init", "node", "dist/index.js"]
