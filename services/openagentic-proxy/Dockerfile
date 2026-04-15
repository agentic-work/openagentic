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

# =============================================================================
# OPENAGENTIC-PROXY - Agent Orchestration Service
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

LABEL maintainer="OpenAgentic <engineering@openagentics.io>"
LABEL description="Openagentic-Proxy: Decoupled agent orchestration service"
LABEL org.opencontainers.image.vendor="OpenAgentic LLC"
LABEL org.opencontainers.image.licenses="LicenseRef-Proprietary"
LABEL com.openagentic.copyright="Copyright (c) 2024-2026 OpenAgentic LLC. All rights reserved."

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

# IP Protection: NOTICE and LICENSE
COPY NOTICE /NOTICE
COPY LICENSE /LICENSE

CMD ["dumb-init", "node", "dist/index.js"]
