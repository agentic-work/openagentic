# Synth MCP server — stdio transport.
# Build:  docker build -t synth-mcp .
# Run:    docker run --rm -i synth-mcp        (stdio; wire into an MCP host)
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    SYNTH_PROVIDER=ollama \
    SYNTH_BASE_URL=http://localhost:11434

WORKDIR /app

# Install the package first (its own layer) so source-only edits don't
# re-resolve dependencies.
COPY pyproject.toml README.md LICENSE ./
COPY synth ./synth
RUN pip install .

# Drop privileges — synthesized code must never run as root.
RUN useradd --create-home --uid 10001 synth
USER synth

# Liveness: the package must import and the MCP entrypoint must be wired.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["python", "-c", "import synth.mcp.server"]

# stdio MCP server.
CMD ["python", "-m", "synth.mcp.server"]
