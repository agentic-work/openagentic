# OpenAgentic Azure MCP Server — Chainguard hardened runtime (2026-04-22)
#
# Was: python:3.11-slim (Harbor Trivy: 156 HIGH). Now: chainguard distroless
# python. Same two-stage pattern as oap-aws-mcp. Non-root uid 65532, no shell,
# no apk at runtime.
#
# Security Guarantees (unchanged):
#   - NO DefaultAzureCredential
#   - NO Service Principal credentials
#   - User's token passed directly to Azure SDK
#   - User's RBAC permissions apply

ARG PYTHON_TAG=latest

# =============================================================================
# Stage 1: builder — installs Python deps + compiles source to bytecode
# =============================================================================
FROM cgr.dev/chainguard/python:${PYTHON_TAG}-dev AS builder

# Azure SDK wheels are all manylinux pre-built; no apk dependencies needed.
USER nonroot
WORKDIR /home/nonroot

COPY --chown=nonroot:nonroot services/mcps/oap-azure-mcp/requirements.txt /home/nonroot/requirements.txt

RUN python -m venv /home/nonroot/.venv \
 && /home/nonroot/.venv/bin/pip install --no-cache-dir -U pip setuptools wheel \
 && /home/nonroot/.venv/bin/pip install --no-cache-dir -r /home/nonroot/requirements.txt \
        fastapi uvicorn \
        opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp \
        opentelemetry-instrumentation-fastapi opentelemetry-instrumentation-httpx \
        prometheus-client python-json-logger structlog

COPY --chown=nonroot:nonroot services/mcps/shared/            /home/nonroot/app/shared/
COPY --chown=nonroot:nonroot services/mcps/oap-azure-mcp/src/ /home/nonroot/app/src/

# IP protection: compile both trees → .pyc then strip .py
RUN /home/nonroot/.venv/bin/python -m compileall -b /home/nonroot/app/src/ /home/nonroot/app/shared/ 2>/dev/null || true \
 && find /home/nonroot/app/src/ /home/nonroot/app/shared/ -name '*.py' -delete 2>/dev/null || true

# =============================================================================
# Stage 2: runtime — distroless, non-root, no shell
# =============================================================================
FROM cgr.dev/chainguard/python:${PYTHON_TAG}

LABEL org.opencontainers.image.title="oap-azure-mcp"
LABEL org.opencontainers.image.description="OpenAgentic Azure MCP — OBO-authenticated Azure SDK (az cli parity)"

LABEL org.opencontainers.image.source="https://github.com/agentic-work/openagentic/tree/main/services/mcps/oap-azure-mcp"

COPY --from=builder --chown=nonroot:nonroot /home/nonroot/.venv /home/nonroot/.venv
COPY --from=builder --chown=nonroot:nonroot /home/nonroot/app   /home/nonroot/app

USER nonroot
WORKDIR /home/nonroot/app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/home/nonroot/.venv/bin:/usr/local/bin:/usr/bin:/bin" \
    MCP_HTTP_MODE=true \
    LOG_LEVEL=INFO \
    LOG_FORMAT=json \
    OTEL_SERVICE_NAME=oap-azure-mcp \
    OTEL_RESOURCE_ATTRIBUTES="service.namespace=openagentic,deployment.environment=production" \
    MCP_SERVER_NAME=oap-azure-mcp \
    MCP_SERVER_PORT=8081

EXPOSE 8081

# No HEALTHCHECK — Deployment liveness/readiness probes cover /health.
ENTRYPOINT ["/home/nonroot/.venv/bin/python"]
CMD ["-m", "src.server"]
