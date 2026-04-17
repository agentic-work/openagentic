
# Proprietary and confidential. Unauthorized copying prohibited.

# OpenAgentic Custom Ollama Image
# Supports pre-pulled models and dynamic model loading from ConfigMap
#
# Build args:
#   MODELS - Comma-separated list of models to pre-pull at build time
#   BASE_IMAGE - Base Ollama image (default: ollama/ollama:latest)
#
# Runtime env vars:
#   OLLAMA_MODELS - Comma-separated list of models to ensure are available
#   OLLAMA_KEEP_ALIVE - How long to keep models loaded (default: 24h)
#   OLLAMA_MAX_LOADED_MODELS - Max models in memory (default: 2)
#   NVIDIA_VISIBLE_DEVICES - GPU device IDs (e.g., "0" or "1" or "0,1")

ARG BASE_IMAGE=ollama/ollama:latest
FROM ${BASE_IMAGE}

# Models to pre-pull at build time (comma-separated)
ARG MODELS=""

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy entrypoint script (use full path from repo root context)
COPY services/openagentic-ollama/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Pre-pull models at build time if specified
# This bakes the models into the image layer for faster startup
RUN if [ -n "$MODELS" ]; then \
      echo "=== Pre-pulling models at build time ===" && \
      # Start Ollama in background
      ollama serve & \
      OLLAMA_PID=$! && \
      # Wait for Ollama to be ready
      for i in $(seq 1 60); do \
        if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then \
          echo "Ollama is ready!"; \
          break; \
        fi; \
        echo "Waiting for Ollama... ($i/60)"; \
        sleep 2; \
      done && \
      # Pull each model
      echo "$MODELS" | tr ',' '\n' | while read model; do \
        model=$(echo "$model" | tr -d ' '); \
        if [ -n "$model" ]; then \
          echo "Pulling model: $model"; \
          ollama pull "$model" || echo "Warning: Failed to pull $model"; \
        fi; \
      done && \
      echo "=== Model pre-pull complete ===" && \
      ollama list && \
      # Stop Ollama
      kill $OLLAMA_PID 2>/dev/null || true; \
      wait $OLLAMA_PID 2>/dev/null || true; \
    else \
      echo "No models specified for pre-pull (MODELS arg is empty)"; \
    fi

# Default environment
ENV OLLAMA_HOST=0.0.0.0:11434
ENV OLLAMA_KEEP_ALIVE=24h
ENV OLLAMA_MAX_LOADED_MODELS=2

EXPOSE 11434

ENTRYPOINT ["/entrypoint.sh"]
