
# OpenAgentic Synth - Minimal Secure Python Execution Environment
# Multi-stage build for smallest possible attack surface

# =============================================================================
# Stage 1: Build dependencies
# =============================================================================
FROM python:3.11-slim as builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# =============================================================================
# Stage 2: Production image - Distroless-like minimal image
# =============================================================================
FROM python:3.11-slim

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv

# Set environment
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# OpenAgentic Synth configuration
ENV OPENAGENTIC_SYNTH_PORT=8090
ENV OAT_MAX_EXECUTION_TIME=30
ENV OAT_MAX_MEMORY_MB=256
ENV OAT_LOG_LEVEL=INFO

# OTEL configuration
ENV OTEL_SERVICE_NAME=openagentic-synth
ENV OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
ENV OTEL_PYTHON_LOG_CORRELATION=true

# Copy application code
WORKDIR /app
COPY --chown=nonroot:nonroot src/ /app/

# Run as non-root user (65532 is the nonroot user in distroless)
# USER 65532:65532 (only valid in distroless)

# Health check endpoint
EXPOSE 8090

# No shell available - direct Python execution
ENTRYPOINT ["python", "-m", "openagentic_synth"]
