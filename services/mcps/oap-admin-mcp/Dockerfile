# OpenAgentic Admin MCP Server — Chainguard hardened runtime (2026-04-22)
#
# Was: python:3.11-slim (Harbor Trivy: 1023 HIGH). Now: chainguard distroless
# python. Same two-stage pattern as oap-aws-mcp — see its Dockerfile for the
# long-form explanation. Non-root uid 65532, no shell, no apk at runtime.

ARG PYTHON_TAG=latest

# =============================================================================
# Stage 1: builder — installs Python deps + the admin_mcp_server package
# =============================================================================
FROM cgr.dev/chainguard/python:${PYTHON_TAG}-dev AS builder

USER root
# gcc/make available by default in the -dev image; no apk calls needed for
# psycopg2-binary / pymilvus / fastmcp — they ship manylinux wheels.

USER nonroot
WORKDIR /home/nonroot

COPY --chown=nonroot:nonroot services/mcps/oap-admin-mcp/requirements.txt /home/nonroot/requirements.txt
COPY --chown=nonroot:nonroot services/mcps/oap-admin-mcp/pyproject.toml  /home/nonroot/pkg/pyproject.toml
COPY --chown=nonroot:nonroot services/mcps/oap-admin-mcp/src/            /home/nonroot/pkg/src/

RUN python -m venv /home/nonroot/.venv \
 && /home/nonroot/.venv/bin/pip install --no-cache-dir -U pip setuptools wheel \
 && /home/nonroot/.venv/bin/pip install --no-cache-dir -r /home/nonroot/requirements.txt \
        fastapi uvicorn \
        opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp \
        opentelemetry-instrumentation-fastapi opentelemetry-instrumentation-httpx \
        prometheus-client python-json-logger structlog \
 && /home/nonroot/.venv/bin/pip install --no-cache-dir /home/nonroot/pkg

COPY --chown=nonroot:nonroot services/mcps/shared/              /home/nonroot/app/shared/
COPY --chown=nonroot:nonroot services/mcps/oap-admin-mcp/server.py /home/nonroot/app/server.py

# IP protection: compile → .pyc, drop .py
# Each step has `|| true` because the chainguard python:latest-dev image
# doesn't always ship `find`, and a single failing step in an && chain
# previously aborted the whole build. The .pyc files are nice-to-have
# (source-hiding) but not load-time-required.
RUN /home/nonroot/.venv/bin/python -m compileall -b /home/nonroot/app/shared/ 2>/dev/null || true \
 && /home/nonroot/.venv/bin/python -c "import py_compile; py_compile.compile('/home/nonroot/app/server.py', '/home/nonroot/app/server.pyc')" 2>/dev/null || true \
 && /home/nonroot/.venv/bin/python -c "import os; [os.remove(os.path.join(r,f)) for r,_,fs in os.walk('/home/nonroot/app/shared') for f in fs if f.endswith('.py')]" 2>/dev/null || true \
 && rm -f /home/nonroot/app/server.py || true

# =============================================================================
# Stage 2: runtime — distroless, non-root, no shell
# =============================================================================
FROM cgr.dev/chainguard/python:${PYTHON_TAG}

LABEL org.opencontainers.image.title="oap-admin-mcp"
LABEL org.opencontainers.image.description="OpenAgentic admin MCP — system + platform administration"

LABEL org.opencontainers.image.source="https://github.com/agentic-work/agentic/tree/main/services/mcps/oap-admin-mcp"

COPY --from=builder --chown=nonroot:nonroot /home/nonroot/.venv /home/nonroot/.venv
COPY --from=builder --chown=nonroot:nonroot /home/nonroot/app   /home/nonroot/app

USER nonroot
WORKDIR /home/nonroot/app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/home/nonroot/.venv/bin:/usr/local/bin:/usr/bin:/bin" \
    # admin_mcp_server.server looks up http_transport via two legacy paths
    # (`$pkg/../../shared` and hardcoded `/app/shared`). Neither lines up
    # with the Chainguard layout; PYTHONPATH surfaces the shared module at
    # its new home so `run_with_http_support` resolves → HTTP mode fires,
    # not stdio-which-exits-on-EOF.
    PYTHONPATH="/home/nonroot/app/shared:/home/nonroot/app" \
    MCP_HTTP_MODE=true \
    LOG_LEVEL=INFO \
    LOG_FORMAT=json \
    OTEL_SERVICE_NAME=oap-admin-mcp \
    OTEL_RESOURCE_ATTRIBUTES="service.namespace=openagentic,deployment.environment=production" \
    MCP_SERVER_NAME=oap-admin-mcp \
    MCP_SERVER_PORT=8083

EXPOSE 8083

# No HEALTHCHECK — /health is hit by the Deployment's liveness/readiness probes.
ENTRYPOINT ["/home/nonroot/.venv/bin/python"]
CMD ["-m", "admin_mcp_server.server"]
