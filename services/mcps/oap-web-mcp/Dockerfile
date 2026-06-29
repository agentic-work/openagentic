# OpenAgentic Web MCP — Chainguard hardened runtime
#
# Mirror of oap-gcp-mcp / oap-aws-mcp distroless pattern. Web-MCP is the
# grounding backbone: web_search via SearXNG, web_fetch + readability,
# web_verify_fact for corrective-RAG, web_store_knowledge for ingestion
# into the Milvus + pgvector RAG index.
#
# No CLI install — pure-Python httpx + bs4 + readability stack.
#
# Build from repo root via scripts/build.sh oap-web-mcp.

ARG PYTHON_TAG=latest

# =============================================================================
# Stage 1: builder — install Python deps + compile server code
# =============================================================================
FROM cgr.dev/chainguard/python:${PYTHON_TAG}-dev AS builder

USER nonroot
WORKDIR /home/nonroot

COPY --chown=nonroot:nonroot services/mcps/oap-web-mcp/requirements.txt /home/nonroot/requirements.txt

RUN python -m venv /home/nonroot/.venv \
 && /home/nonroot/.venv/bin/pip install --no-cache-dir -U pip setuptools wheel \
 && /home/nonroot/.venv/bin/pip install --no-cache-dir -r /home/nonroot/requirements.txt \
        fastapi uvicorn \
        opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp \
        opentelemetry-instrumentation-fastapi opentelemetry-instrumentation-httpx \
        prometheus-client python-json-logger structlog

COPY --chown=nonroot:nonroot services/mcps/shared/ /home/nonroot/app/shared/
COPY --chown=nonroot:nonroot services/mcps/oap-web-mcp/server.py /home/nonroot/app/server.py

# IP protection: compile to bytecode then strip .py. Each step has `|| true`
# to tolerate missing find/sed in chainguard python:latest-dev.
RUN /home/nonroot/.venv/bin/python -m compileall -b /home/nonroot/app/shared/ 2>/dev/null || true \
 && /home/nonroot/.venv/bin/python -c "import py_compile; py_compile.compile('/home/nonroot/app/server.py', '/home/nonroot/app/server.pyc')" 2>/dev/null || true \
 && /home/nonroot/.venv/bin/python -c "import os; [os.remove(os.path.join(r,f)) for r,_,fs in os.walk('/home/nonroot/app/shared') for f in fs if f.endswith('.py')]" 2>/dev/null || true \
 && rm -f /home/nonroot/app/server.py || true

# =============================================================================
# Stage 2: runtime — distroless python, non-root, no shell, no package mgr
# =============================================================================
FROM cgr.dev/chainguard/python:${PYTHON_TAG}

LABEL org.opencontainers.image.title="oap-web-mcp"
LABEL org.opencontainers.image.description="OpenAgentic Web MCP — grounding backbone (SearXNG, web fetch, fact-verify, RAG ingest)"

LABEL org.opencontainers.image.source="https://github.com/agentic-work/openagentic/tree/main/services/mcps/oap-web-mcp"

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
    OTEL_SERVICE_NAME=oap-web-mcp \
    OTEL_RESOURCE_ATTRIBUTES="service.namespace=openagentic,deployment.environment=production" \
    MCP_SERVER_NAME=oap-web-mcp \
    MCP_SERVER_PORT=8085

EXPOSE 8085

ENTRYPOINT ["/home/nonroot/.venv/bin/python"]
CMD ["/home/nonroot/app/server.pyc"]
