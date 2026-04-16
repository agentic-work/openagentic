# Proprietary and confidential. Unauthorized copying prohibited.

# Ollama initialization script
# Starts Ollama server and pulls required models

set -e

echo "=== Ollama Init Script ==="
echo "Starting Ollama server..."

# Start Ollama in the background
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
echo "Waiting for Ollama server to be ready..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
    if ollama list >/dev/null 2>&1; then
        echo "Ollama server is ready!"
        break
    fi
    attempt=$((attempt + 1))
    echo "Waiting for Ollama... (attempt $attempt/$max_attempts)"
    sleep 2
done

if [ $attempt -eq $max_attempts ]; then
    echo "ERROR: Ollama server failed to start"
    exit 1
fi

# Pull embedding model (required for vector operations)
EMBEDDING_MODEL="${OLLAMA_EMBEDDING_MODEL:-embeddinggemma}"
echo "Pulling embedding model: $EMBEDDING_MODEL"
ollama pull "$EMBEDDING_MODEL" || echo "Warning: Failed to pull $EMBEDDING_MODEL"

# Pull chat model (for local LLM inference)
CHAT_MODEL="${OLLAMA_CHAT_MODEL:-gpt-oss}"
echo "Pulling chat model: $CHAT_MODEL"
ollama pull "$CHAT_MODEL" || echo "Warning: Failed to pull $CHAT_MODEL"

# Optional: Pull vision model if configured
if [ -n "$OLLAMA_VISION_MODEL" ] && [ "$OLLAMA_VISION_MODEL" != "llava:latest" ]; then
    echo "Pulling vision model: $OLLAMA_VISION_MODEL"
    ollama pull "$OLLAMA_VISION_MODEL" || echo "Warning: Failed to pull $OLLAMA_VISION_MODEL"
fi

echo "=== Ollama initialization complete ==="
echo "Available models:"
ollama list

# Keep the container running by waiting on the Ollama process
wait $OLLAMA_PID
