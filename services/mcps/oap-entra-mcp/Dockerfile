# OpenAgentic Entra / M365 MCP Server — Chainguard hardened runtime
#
# App-only Microsoft 365 (Mail · Calendar) over Microsoft Graph
# (graph.microsoft.com/v1.0/users/{id}/...). Thin httpx wrapper; app-only Graph
# token minted via azure-identity's ClientSecretCredential. No Azure SDK / no OBO.
#
# Mirrors the oap-gcp-mcp pattern: distroless cgr.dev/chainguard/python with a
# builder stage for venv + bytecode compile, runtime stage that carries only the
# venv + .pyc.
#
# In production this MCP runs INSIDE the mcp-proxy pod via
# `fastmcp run -t stdio /app/mcp-servers/oap-entra-mcp/server.py` (the proxy
# Dockerfile COPYs services/mcps/ and pip-installs this requirements.txt). This
# standalone image exists for parity / isolated runs.
#
# Build from repo root with scripts/build.sh — this Dockerfile assumes the build
# context is the repo root, not services/mcps/oap-entra-mcp.

ARG PYTHON_TAG=latest

# =============================================================================
# Stage 1: builder — install Python deps + compile server code
# =============================================================================
FROM cgr.dev/chainguard/python:${PYTHON_TAG}-dev AS builder

USER nonroot
WORKDIR /home/nonroot

COPY --chown=nonroot:nonroot services/mcps/oap-entra-mcp/requirements.txt /home/nonroot/requirements.txt

RUN python -m venv /home/nonroot/.venv \
 && /home/nonroot/.venv/bin/pip install --no-cache-dir -U pip setuptools wheel \
 && /home/nonroot/.venv/bin/pip install --no-cache-dir -r /home/nonroot/requirements.txt \
        fastapi uvicorn \
        opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp \
        opentelemetry-instrumentation-fastapi opentelemetry-instrumentation-httpx \
        prometheus-client python-json-logger structlog

COPY --chown=nonroot:nonroot services/mcps/shared/ /home/nonroot/app/shared/
COPY --chown=nonroot:nonroot services/mcps/oap-entra-mcp/src/server.py /home/nonroot/app/server.py
COPY --chown=nonroot:nonroot services/mcps/oap-entra-mcp/src/__init__.py /home/nonroot/app/__init__.py

# Compile source to bytecode then strip .py files. Each step has `|| true`
# because the chainguard python:latest-dev image doesn't always ship `find`, and
# a single failing step in an && chain would otherwise abort the whole build.
RUN /home/nonroot/.venv/bin/python -m compileall -b /home/nonroot/app/shared/ 2>/dev/null || true \
 && /home/nonroot/.venv/bin/python -c "import py_compile; py_compile.compile('/home/nonroot/app/server.py', '/home/nonroot/app/server.pyc')" 2>/dev/null || true \
 && /home/nonroot/.venv/bin/python -c "import os; [os.remove(os.path.join(r,f)) for r,_,fs in os.walk('/home/nonroot/app/shared') for f in fs if f.endswith('.py')]" 2>/dev/null || true \
 && rm -f /home/nonroot/app/server.py || true

# =============================================================================
# Stage 2: runtime — distroless python, non-root, no shell, no package mgr
# =============================================================================
FROM cgr.dev/chainguard/python:${PYTHON_TAG}

LABEL org.opencontainers.image.title="oap-entra-mcp"
LABEL org.opencontainers.image.description="OpenAgentic Entra / M365 MCP — app-only Mail/Calendar via Microsoft Graph"
LABEL org.opencontainers.image.source="https://github.com/agentic-work/openagentic/tree/main/services/mcps/oap-entra-mcp"

COPY --from=builder --chown=nonroot:nonroot /home/nonroot/.venv /home/nonroot/.venv
COPY --from=builder --chown=nonroot:nonroot /home/nonroot/app  /home/nonroot/app

USER nonroot
WORKDIR /home/nonroot/app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/home/nonroot/.venv/bin:/usr/local/bin:/usr/bin:/bin" \
    MCP_HTTP_MODE=true \
    LOG_LEVEL=INFO \
    LOG_FORMAT=json \
    OTEL_SERVICE_NAME=oap-entra-mcp \
    OTEL_RESOURCE_ATTRIBUTES="service.namespace=openagentic,deployment.environment=production" \
    MCP_SERVER_NAME=oap-entra-mcp \
    MCP_SERVER_PORT=8085

EXPOSE 8085

# No HEALTHCHECK directive — distroless runtime has no curl/wget. k8s
# liveness/readiness probes in the Deployment manifest cover /health.

ENTRYPOINT ["/home/nonroot/.venv/bin/python"]
CMD ["/home/nonroot/app/server.pyc"]
