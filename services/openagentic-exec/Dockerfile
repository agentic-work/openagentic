FROM node:20-slim

# ── System deps ─────────────────────────────────────────────────────────────
# curl + ca-certificates: claude installer download
# git: claude installer may need it; also useful for workspace operations
# python3 + build-essential: compile node-pty native addon
# unzip: claude installer fallback extraction
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl ca-certificates git python3 build-essential unzip && \
    rm -rf /var/lib/apt/lists/*

# ── Install Claude Code CLI ──────────────────────────────────────────────────
# The installer drops a symlink at /root/.local/bin/claude pointing to
# /root/.local/share/claude/versions/<ver>.  We symlink the resolved target
# into /usr/local/bin so it is in PATH for any user/process in the container.
# The final `claude --version` is the build-time proof: if this fails, the
# build fails — intentional.
RUN curl -fsSL https://claude.ai/install.sh | bash && \
    CLAUDE_BIN="$(command -v claude 2>/dev/null || \
        find /root -name claude 2>/dev/null | grep -E '/(bin|\.local/bin)/claude$' | head -1)" && \
    test -n "$CLAUDE_BIN" || { echo "ERROR: claude binary not found after install"; exit 1; } && \
    ln -sf "$CLAUDE_BIN" /usr/local/bin/claude && \
    /usr/local/bin/claude --version

# ── Application ─────────────────────────────────────────────────────────────
# SRC_PATH defaults to the service dir (standalone build).
# When built via docker compose from repo root, compose passes SRC_PATH.
ARG SRC_PATH=services/openagentic-exec

WORKDIR /app

COPY ${SRC_PATH}/package*.json ./

# npm ci builds node-pty natively using the python3 + build-essential above
RUN npm ci

COPY ${SRC_PATH}/tsconfig.json ./
COPY ${SRC_PATH}/src ./src

RUN npm run build

# ── Runtime config ───────────────────────────────────────────────────────────
ENV PORT=3060 \
    WORKSPACES_PATH=/workspaces \
    NODE_ENV=production

RUN mkdir -p /workspaces

EXPOSE 3060

CMD ["node", "dist/index.js"]
