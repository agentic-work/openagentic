# OpenAgentic Admin MCP Server - Isolated Container
# System administration and configuration management
#
# Service Discovery:
#   - Service name: oap-admin-mcp
#   - Port: 8083
#   - Health: /health
#   - Metrics: /metrics
#
# Observability:
#   - OTEL traces: exports to OTEL_EXPORTER_OTLP_ENDPOINT
#   - Prometheus metrics: /metrics endpoint
#   - Structured JSON logs: scraped by Loki via stdout
#
# Build Note:
#   Build from repo root with: docker build -f services/mcps/oap-admin-mcp/Dockerfile .
#   Or use build.sh which handles the context correctly

FROM python:3.11-slim

LABEL maintainer="OpenAgentic <devops@openagentic.io>"
LABEL description="OpenAgentic Admin MCP Server - System administration tools"
LABEL version="1.0.0"

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY services/mcps/oap-admin-mcp/requirements.txt .
COPY services/mcps/oap-admin-mcp/pyproject.toml ./

# Install Python dependencies + observability packages
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
COPY services/mcps/oap-admin-mcp/src/ ./src/
COPY services/mcps/oap-admin-mcp/server.py ./

# Install package as root
RUN pip install -e .

# IP Protection: compile Python source to bytecode and strip .py files
RUN python -m compileall -b /app/src/ /app/shared/ 2>/dev/null; \
    python -c "import py_compile; py_compile.compile('/app/server.py', '/app/server.pyc')" 2>/dev/null; \
    find /app/src/ /app/shared/ -name '*.py' -delete 2>/dev/null; \
    rm -f /app/server.py 2>/dev/null || true

# Create non-root user (CRIT-004 compliance)
RUN useradd -m -u 1000 -s /bin/bash mcp

RUN chown -R mcp:mcp /app

# Switch to non-root user
USER mcp

# Environment variables for observability and HTTP mode
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # Enable HTTP mode for remote MCP control
    MCP_HTTP_MODE=true \
    # Logging
    LOG_LEVEL=INFO \
    LOG_FORMAT=json \
    OTEL_SERVICE_NAME=oap-admin-mcp \
    OTEL_RESOURCE_ATTRIBUTES="service.namespace=openagentic,deployment.environment=production" \
    MCP_SERVER_NAME=oap-admin-mcp \
    MCP_SERVER_PORT=8083

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${MCP_SERVER_PORT}/health || exit 1

EXPOSE 8083

# Start server in HTTP mode
CMD ["python", "-m", "admin_mcp_server.server"]
