# Proprietary and confidential. Unauthorized copying prohibited.

# OpenAgentic Ollama Entrypoint
# Models are pre-baked into the image at build time - just start serving
#
# Environment variables:
#   OLLAMA_MODELS - Optional: comma-separated list of additional models to verify/pull
#   OLLAMA_PRIMARY_MODEL - Optional: model to pre-warm after startup

set -e

echo "========================================"
echo "OpenAgentic Ollama Container Starting"
echo "========================================"
echo "Host: ${OLLAMA_HOST:-0.0.0.0:11434}"
echo "Keep Alive: ${OLLAMA_KEEP_ALIVE:-24h}"
echo "Max Loaded Models: ${OLLAMA_MAX_LOADED_MODELS:-2}"
echo "GPU Devices: ${NVIDIA_VISIBLE_DEVICES:-all}"
echo "========================================"

# Show pre-baked models
echo "Pre-baked models in this image:"
ls -la /root/.ollama/models/manifests/registry.ollama.ai/library/ 2>/dev/null || echo "(checking on startup)"
echo "========================================"

# Just exec ollama serve - models are already in the image
exec ollama serve
