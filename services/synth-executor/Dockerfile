
# Proprietary and confidential. Unauthorized copying prohibited.

# Synth Executor - Minimal Secure Python Execution Environment
# Multi-stage build for smallest possible attack surface

# =============================================================================
# Stage 1: Build dependencies
# =============================================================================
FROM python:3.11-slim as builder

WORKDIR /build

# Install build dependencies. `gcc` is for native Python wheels;
# `jq + curl` are required by cdn/build-libs.sh to fetch + SHA-verify
# the JS/WASM libs we serve via /lib/* (see C0 plan — synth-executor
# pod owns the CDN, no separate synth-cdn sidecar).
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    jq \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the CDN lib payload. cdn/build-libs.sh reads cdn/lib-manifest.json,
# downloads each entry, verifies the pinned SHA-256, and extracts into
# cdn/dist/lib/. The final stage COPYs from there to /app/lib/.
COPY cdn/ /build/cdn/
RUN bash /build/cdn/build-libs.sh build

# =============================================================================
# Stage 2: Production image - Distroless-like minimal image
# =============================================================================
FROM gcr.io/distroless/python3-debian12:nonroot

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv

# Set environment
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Synth Executor configuration
ENV SYNTH_EXECUTOR_PORT=8090
ENV SYNTH_MAX_EXECUTION_TIME=30
ENV SYNTH_MAX_MEMORY_MB=256
ENV SYNTH_LOG_LEVEL=INFO

# OTEL configuration
ENV OTEL_SERVICE_NAME=synth-executor
ENV OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
ENV OTEL_PYTHON_LOG_CORRELATION=true

# Copy application code
WORKDIR /app
COPY --chown=nonroot:nonroot src/ /app/

# Copy the CDN lib payload baked in the builder stage. SYNTH_LIB_DIR
# defaults to /app/lib in server.py, where StaticFiles mounts /lib/*.
# The chown is mandatory — distroless runs as uid 65532, which can't
# read root-owned files (silent 404 from StaticFiles otherwise).
COPY --from=builder --chown=nonroot:nonroot /build/cdn/dist/lib/ /app/lib/

# Run as non-root user (65532 is the nonroot user in distroless)
USER 65532:65532

# Health check endpoint
EXPOSE 8090

# No shell available - direct Python execution
ENTRYPOINT ["python", "-m", "synth_executor"]
