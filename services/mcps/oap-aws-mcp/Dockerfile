# OpenAgentic AWS MCP Server - Isolated Container
# AWS operations via Identity Center OBO authentication
#
# Service Discovery:
#   - Service name: oap-aws-mcp
#   - Port: 8082
#   - Health: /health
#   - Metrics: /metrics
#
# Observability:
#   - OTEL traces: exports to OTEL_EXPORTER_OTLP_ENDPOINT
#   - Prometheus metrics: /metrics endpoint
#   - Structured JSON logs: scraped by Loki via stdout
#
# Build Note:
#   Build from repo root with: docker build -f services/mcps/oap-aws-mcp/Dockerfile .
#   Or use build.sh which handles the context correctly

FROM python:3.11-slim

LABEL maintainer="OpenAgentic <devops@openagentic.io>"
LABEL description="OpenAgentic AWS MCP Server - Universal AWS operations via Identity Center OBO"
LABEL version="1.0.0"
LABEL org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app

# Install AWS CLI v2 and system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    groff \
    less \
    && ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "amd64" ]; then AWS_ARCH="x86_64"; \
       elif [ "$ARCH" = "arm64" ]; then AWS_ARCH="aarch64"; \
       else AWS_ARCH="x86_64"; fi \
    && curl "https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Verify AWS CLI installation
RUN aws --version

# Copy requirements first for layer caching
COPY services/mcps/oap-aws-mcp/requirements.txt .

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

# Copy server code
COPY services/mcps/oap-aws-mcp/server.py .

# IP Protection: compile Python source to bytecode and strip .py files
RUN python -m compileall -b /app/shared/ 2>/dev/null; \
    python -c "import py_compile; py_compile.compile('/app/server.py', '/app/server.pyc')" 2>/dev/null; \
    find /app/shared/ -name '*.py' -delete 2>/dev/null; \
    rm -f /app/server.py 2>/dev/null || true


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
    OTEL_SERVICE_NAME=oap-aws-mcp \
    OTEL_RESOURCE_ATTRIBUTES="service.namespace=openagentic,deployment.environment=production" \
    # MCP Server config
    MCP_SERVER_NAME=oap-aws-mcp \
    MCP_SERVER_PORT=8082

# Health check for Kubernetes probes
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${MCP_SERVER_PORT}/health || exit 1

# Expose HTTP port
EXPOSE 8082

# Start server in HTTP mode
CMD ["python", "server.pyc"]
