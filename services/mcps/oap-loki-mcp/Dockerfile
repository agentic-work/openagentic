# oap-loki-mcp — Chainguard hardened runtime
#
# Loki MCP — LogQL queries
# Mirrors services/mcps/oap-gcp-mcp/Dockerfile distroless pattern.

ARG PYTHON_TAG=latest

FROM cgr.dev/chainguard/python:${PYTHON_TAG}-dev AS builder

USER nonroot
WORKDIR /home/nonroot

COPY --chown=nonroot:nonroot services/mcps/oap-loki-mcp/requirements.txt /home/nonroot/requirements.txt

RUN python -m venv /home/nonroot/.venv \
 && /home/nonroot/.venv/bin/pip install --no-cache-dir -U pip setuptools wheel \
 && /home/nonroot/.venv/bin/pip install --no-cache-dir -r /home/nonroot/requirements.txt \
        fastapi uvicorn \
        opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp \
        opentelemetry-instrumentation-fastapi opentelemetry-instrumentation-httpx \
        prometheus-client python-json-logger structlog

COPY --chown=nonroot:nonroot services/mcps/shared/ /home/nonroot/app/shared/
COPY --chown=nonroot:nonroot services/mcps/oap-loki-mcp/server.py /home/nonroot/app/server.py
COPY --chown=nonroot:nonroot services/mcps/oap-loki-mcp/src/ /home/nonroot/app/src/

RUN /home/nonroot/.venv/bin/python -m compileall -b /home/nonroot/app/shared/ 2>/dev/null || true \
 && /home/nonroot/.venv/bin/python -m compileall -b /home/nonroot/app/src/ 2>/dev/null || true \
 && /home/nonroot/.venv/bin/python -c "import py_compile; py_compile.compile('/home/nonroot/app/server.py', '/home/nonroot/app/server.pyc')" 2>/dev/null || true \
 && /home/nonroot/.venv/bin/python -c "import os; [os.remove(os.path.join(r,f)) for r,_,fs in os.walk('/home/nonroot/app/shared') for f in fs if f.endswith('.py')]" 2>/dev/null || true \
 && /home/nonroot/.venv/bin/python -c "import os; [os.remove(os.path.join(r,f)) for r,_,fs in os.walk('/home/nonroot/app/src') for f in fs if f.endswith('.py')]" 2>/dev/null || true \
 && rm -f /home/nonroot/app/server.py || true

FROM cgr.dev/chainguard/python:${PYTHON_TAG}

LABEL org.opencontainers.image.title="oap-loki-mcp"
LABEL org.opencontainers.image.description="Loki MCP — LogQL queries"

LABEL org.opencontainers.image.source="https://github.com/agentic-work/openagentic/tree/main/services/mcps/oap-loki-mcp"

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
    OTEL_SERVICE_NAME=oap-loki-mcp \
    OTEL_RESOURCE_ATTRIBUTES="service.namespace=openagentic,deployment.environment=production" \
    MCP_SERVER_NAME=oap-loki-mcp \
    MCP_SERVER_PORT=8089

EXPOSE 8089

ENTRYPOINT ["/home/nonroot/.venv/bin/python"]
CMD ["/home/nonroot/app/server.pyc"]
