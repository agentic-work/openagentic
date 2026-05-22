# OpenAgentic AWS MCP Server — Chainguard hardened runtime (2026-04-22)
#
# Migrated from `python:3.11-slim` (157 HIGH / 19 CRITICAL per Harbor Trivy)
# to cgr.dev/chainguard/python — distroless, non-root by default, daily CVE
# rebuilds, SBOM attached. See harbor.agenticwork.io for the before/after
# scan delta.
#
# Two stages:
#   builder  — cgr.dev/chainguard/python:latest-dev (has apk + shell) for
#              installing AWS CLI v2 + pip deps into a venv, then compiling
#              the MCP server source to bytecode.
#   runtime  — cgr.dev/chainguard/python:latest (no shell, no apk, no curl)
#              carries only the venv, the AWS CLI install tree, and the
#              pre-compiled .pyc. Image is uid 65532 by default.
#
# Build from repo root with scripts/build.sh — this Dockerfile assumes the
# build context is the repo root, not services/mcps/oap-aws-mcp.

ARG PYTHON_TAG=latest

# =============================================================================
# Stage 1: builder — install AWS CLI + Python deps + compile server code
# =============================================================================
FROM cgr.dev/chainguard/python:${PYTHON_TAG}-dev AS builder

# apk requires root; drop back to nonroot for everything else.
USER root
RUN apk add --no-cache curl unzip groff less \
 && ARCH=$(uname -m) \
 && case "$ARCH" in \
      x86_64) AWS_ARCH="x86_64" ;; \
      aarch64) AWS_ARCH="aarch64" ;; \
      *) AWS_ARCH="x86_64" ;; \
    esac \
 && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}.zip" -o /tmp/awscliv2.zip \
 && cd /tmp && unzip -q awscliv2.zip \
 && ./aws/install --install-dir /opt/aws-cli --bin-dir /opt/aws-cli/bin \
 && rm -rf /tmp/awscliv2.zip /tmp/aws

USER nonroot
WORKDIR /home/nonroot

COPY --chown=nonroot:nonroot services/mcps/oap-aws-mcp/requirements.txt /home/nonroot/requirements.txt

RUN python -m venv /home/nonroot/.venv \
 && /home/nonroot/.venv/bin/pip install --no-cache-dir -U pip setuptools wheel \
 && /home/nonroot/.venv/bin/pip install --no-cache-dir -r /home/nonroot/requirements.txt \
        fastapi uvicorn \
        opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp \
        opentelemetry-instrumentation-fastapi opentelemetry-instrumentation-httpx \
        prometheus-client python-json-logger structlog

# Pre-create /home/nonroot/app/ as nonroot so py_compile's atomic-write temp
# file (`server.pyc.<rand>`) can be created in the same dir. Docker buildkit's
# implicit-parent-dir creation for COPY leaves the dir root-owned even when
# `--chown=nonroot:nonroot` is set on the COPY, which broke py_compile here.
RUN mkdir -p /home/nonroot/app
COPY --chown=nonroot:nonroot services/mcps/shared/ /home/nonroot/app/shared/
COPY --chown=nonroot:nonroot services/mcps/oap-aws-mcp/server.py /home/nonroot/app/server.py

# IP protection: compile source to bytecode then strip .py files.
# Hard-fail mode (was || true / 2>/dev/null until 2026-05-18) — silent
# compile failure shipped an image with no executable .pyc, which only
# surfaced at container start as `python: can't open file 'server.pyc'`.
# Now: any compile error aborts the build, and the final `test -f` asserts
# server.pyc exists before we proceed to the runtime stage.
RUN /home/nonroot/.venv/bin/python -m compileall -b /home/nonroot/app/shared/ \
 && /home/nonroot/.venv/bin/python -c "import py_compile, sys; py_compile.compile('/home/nonroot/app/server.py', '/home/nonroot/app/server.pyc', doraise=True)" \
 && /home/nonroot/.venv/bin/python -c "import os; [os.remove(os.path.join(r,f)) for r,_,fs in os.walk('/home/nonroot/app/shared') for f in fs if f.endswith('.py')]" \
 && rm -f /home/nonroot/app/server.py \
 && test -f /home/nonroot/app/server.pyc

# =============================================================================
# Stage 2: runtime — distroless python, non-root, no shell, no package mgr
# =============================================================================
FROM cgr.dev/chainguard/python:${PYTHON_TAG}

LABEL org.opencontainers.image.title="oap-aws-mcp"
LABEL org.opencontainers.image.description="OpenAgentic AWS MCP — OBO-authenticated AWS operations"

LABEL org.opencontainers.image.source="https://github.com/agentic-work/agentic/tree/main/services/mcps/oap-aws-mcp"

COPY --from=builder /opt/aws-cli /opt/aws-cli
COPY --from=builder --chown=nonroot:nonroot /home/nonroot/.venv /home/nonroot/.venv
COPY --from=builder --chown=nonroot:nonroot /home/nonroot/app  /home/nonroot/app

USER nonroot
WORKDIR /home/nonroot/app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/home/nonroot/.venv/bin:/opt/aws-cli/bin:/usr/local/bin:/usr/bin:/bin" \
    MCP_HTTP_MODE=true \
    LOG_LEVEL=INFO \
    LOG_FORMAT=json \
    OTEL_SERVICE_NAME=oap-aws-mcp \
    OTEL_RESOURCE_ATTRIBUTES="service.namespace=openagentic,deployment.environment=production" \
    MCP_SERVER_NAME=oap-aws-mcp \
    MCP_SERVER_PORT=8082

EXPOSE 8082

# No HEALTHCHECK directive — distroless runtime has no curl/wget. k8s
# liveness/readiness probes in the Deployment manifest cover /health.

ENTRYPOINT ["/home/nonroot/.venv/bin/python"]
CMD ["/home/nonroot/app/server.pyc"]
