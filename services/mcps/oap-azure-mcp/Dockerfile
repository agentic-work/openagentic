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

# OpenAgentic Azure MCP Server - Full Azure SDK (az cli Parity)
# Runs as the USER authenticated via Azure AD - NO SERVICE PRINCIPAL
#
# Service Discovery:
#   - Service name: oap-azure-mcp
#   - Port: 8081
#   - Health: /health
#   - Metrics: /metrics
#
# Observability:
#   - OTEL traces: exports to OTEL_EXPORTER_OTLP_ENDPOINT
#   - Prometheus metrics: /metrics endpoint
#   - Structured JSON logs: scraped by Loki via stdout
#
# Security Guarantees:
#   - NO DefaultAzureCredential
#   - NO Service Principal credentials
#   - User's token passed directly to Azure SDK
#   - User's RBAC permissions apply
#
# Build Note:
#   Build from repo root with: docker build -f services/mcps/oap-azure-mcp/Dockerfile .
#   Or use build.sh which handles the context correctly

FROM python:3.11-slim

LABEL maintainer="OpenAgentic <devops@openagentics.io>"
LABEL description="OpenAgentic Azure MCP Server - Full Azure SDK with az cli parity"
LABEL version="2.0.0"
LABEL org.opencontainers.image.vendor="OpenAgentic LLC"
LABEL org.opencontainers.image.licenses="LicenseRef-Proprietary"
LABEL com.openagentic.copyright="Copyright (c) 2024-2026 OpenAgentic LLC. All rights reserved."

WORKDIR /app

# Install system dependencies
# Note: We do NOT install Azure CLI - we use the Azure SDK directly
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for layer caching
COPY services/mcps/oap-azure-mcp/requirements.txt .

# Install Python dependencies including observability packages
RUN pip install --no-cache-dir -r requirements.txt \
    # HTTP server for remote MCP mode
    fastapi \
    uvicorn \
    # OTEL for distributed tracing
    opentelemetry-api \
    opentelemetry-sdk \
    opentelemetry-exporter-otlp \
    opentelemetry-instrumentation-fastapi \
    opentelemetry-instrumentation-httpx \
    # Prometheus metrics
    prometheus-client \
    # Structured logging for Loki
    python-json-logger \
    structlog

# Copy shared utilities (http_transport module)
COPY services/mcps/shared/ ./shared/

# Copy source code
COPY services/mcps/oap-azure-mcp/src/ ./src/

# IP Protection: compile Python source to bytecode and strip .py files
RUN python -m compileall -b /app/src/ /app/shared/ 2>/dev/null; \
    find /app/src/ /app/shared/ -name '*.py' -delete 2>/dev/null || true

# IP Protection: NOTICE and LICENSE
COPY NOTICE /NOTICE
COPY LICENSE /LICENSE

# Create non-root user for security (CRIT-004 compliance)
RUN useradd -m -u 1000 -s /bin/bash mcp \
    && chown -R mcp:mcp /app

USER mcp

# Environment variables for observability and HTTP mode
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # Enable HTTP mode for remote MCP control
    MCP_HTTP_MODE=true \
    # Logging
    LOG_LEVEL=INFO \
    LOG_FORMAT=json \
    # OTEL - set OTEL_EXPORTER_OTLP_ENDPOINT at runtime
    OTEL_SERVICE_NAME=oap-azure-mcp \
    OTEL_RESOURCE_ATTRIBUTES="service.namespace=openagentic,deployment.environment=production" \
    # MCP Server config
    MCP_SERVER_NAME=oap-azure-mcp \
    MCP_SERVER_PORT=8081

# Health check for Kubernetes probes
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${MCP_SERVER_PORT}/health || exit 1

# Expose HTTP port
EXPOSE 8081

# Start server in HTTP mode
CMD ["python", "-m", "src.server"]
