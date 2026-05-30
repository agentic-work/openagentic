FROM node:20-slim

# ── System deps ─────────────────────────────────────────────────────────────
# curl + ca-certificates: claude installer download
# git: claude installer may need it; also useful for workspace operations
# python3 + build-essential: compile node-pty native addon
# unzip: claude installer fallback extraction
# gosu: privilege-drop from root → claudeuser in entrypoint
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl ca-certificates git python3 build-essential unzip gosu && \
    rm -rf /var/lib/apt/lists/*

# ── Non-root user ─────────────────────────────────────────────────────────────
# uid 10001 so the runtime process is never root (required for
# --dangerously-skip-permissions, which claude refuses under root/sudo).
RUN useradd -m -u 10001 -s /bin/bash claudeuser

# ── Install Claude Code CLI as claudeuser ─────────────────────────────────────
# The installer must run as the target user so it lands in /home/claudeuser/.local
# (not /root/.local which is mode 700 and unreadable by others).
# We then resolve the installed binary and symlink it into /usr/local/bin so
# it is in PATH for all users/processes.
# The final `su claudeuser -c '...'` --version call is the build-time proof gate:
# if claude is not executable as the non-root user, the build fails here.
RUN su claudeuser -c 'HOME=/home/claudeuser curl -fsSL https://claude.ai/install.sh | bash' && \
    CLAUDE_BIN="$(su claudeuser -c 'command -v claude' 2>/dev/null || \
        find /home/claudeuser/.local -name claude 2>/dev/null | grep -E '/bin/claude$' | head -1)" && \
    test -n "$CLAUDE_BIN" || { echo "ERROR: claude binary not found after install"; exit 1; } && \
    ln -sf "$CLAUDE_BIN" /usr/local/bin/claude && \
    su claudeuser -c '/usr/local/bin/claude --version'

# ── Application ─────────────────────────────────────────────────────────────
# SRC_PATH defaults to the service dir (standalone build).
# When built via docker compose from repo root, compose passes SRC_PATH.
ARG SRC_PATH=services/openagentic-exec

WORKDIR /app

COPY ${SRC_PATH}/package*.json ./

# npm ci builds node-pty natively using the python3 + build-essential above.
# Runs as root so the native build has no permission issues.
RUN npm ci

COPY ${SRC_PATH}/tsconfig.json ./
COPY ${SRC_PATH}/src ./src

RUN npm run build

# Make /app fully readable/executable by all so claudeuser (uid 10001) can
# require() the compiled JS and node-pty's native .node addon at runtime.
RUN chmod -R a+rX /app

# ── Entrypoint ───────────────────────────────────────────────────────────────
COPY ${SRC_PATH}/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# ── Runtime config ───────────────────────────────────────────────────────────
ENV PORT=3060 \
    WORKSPACES_PATH=/workspaces \
    NODE_ENV=production

RUN mkdir -p /workspaces

EXPOSE 3060

ENTRYPOINT ["/app/docker-entrypoint.sh"]
