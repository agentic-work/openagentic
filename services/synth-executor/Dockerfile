
# Proprietary and confidential. Unauthorized copying prohibited.

# Synth Executor - Minimal Secure Python Execution Environment
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

# Run as non-root user (65532 is the nonroot user in distroless)
USER 65532:65532

# Health check endpoint
EXPOSE 8090

# No shell available - direct Python execution
ENTRYPOINT ["python", "-m", "synth_executor"]
