# =============================================================================
# OPENAGENTIC-WORKFLOWS - Workflow Execution Service
# =============================================================================
FROM node:20-slim AS builder

WORKDIR /app
COPY services/openagentic-workflows/package.json ./
RUN npm install --production=false
COPY services/openagentic-workflows/prisma ./prisma
RUN npx prisma generate
COPY services/openagentic-workflows/tsconfig.json ./
COPY services/openagentic-workflows/src ./src
RUN npm run build

# -----------------------------------------------------------------------------
# Runtime
# -----------------------------------------------------------------------------
FROM node:20-slim

LABEL maintainer="OpenAgentic <engineering@openagentic.io>"
LABEL description="OpenAgentic Workflow Execution Service"
LABEL org.opencontainers.image.licenses="Apache-2.0"

RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init openssl ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY services/openagentic-workflows/package.json ./

ENV NODE_ENV=production
ENV PORT=3400

EXPOSE 3400

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3400/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"


CMD ["dumb-init", "node", "--max-old-space-size=2048", "dist/index.js"]
