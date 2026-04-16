# syntax=docker/dockerfile:1.4
# Copyright 2026 Gnomus.ai
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# =============================================================================
# OPENAGENTIC EXEC - LEAN EXECUTION CONTAINER
# =============================================================================
#
# This container runs OpenAgentic CLI sessions and code-server.
# It's controlled by openagentic-manager via REST API and WebSocket.
# OpenAgentic CLI always routes through the OpenAgentic SDK/API for LLM access.
#
# LEAN PHILOSOPHY:
# - Only pre-install essentials (Node.js, git, ripgrep, code-server)
# - Users install everything else via Homebrew: brew install go python kubectl etc.
# - Homebrew is pre-installed and available to all sandbox users
# - Persistent per-user pods mean brew installs survive across sessions
#
# SECURITY MODEL:
# - Sandbox users with ulimits (process/memory limits)
# - Each session runs as isolated Linux user
# - Network policies enforced at K8s level
#
# =============================================================================
#
# DUAL-MODE COMPANION INSTALL
# -----------------------------------------------------------------------------
# This image installs two sibling tools — oat, openagentic — and supports
# two install modes selected by --build-arg INSTALL_MODE=...:
#
#   INSTALL_MODE=vendored   (DEFAULT — used by our local build.sh)
#     Each tool is rsynced from the sibling source repo into the build
#     context by scripts/build.sh, then COPY'd into the image and installed
#     from local files. Fast iteration, no network calls during build.
#
#   INSTALL_MODE=git        (used by CI)
#     Each tool is `git clone`'d from agentic-work/{oat,openagentic} at
#     tag $TOOL_REF, then installed. For public repos no PAT is needed;
#     for private, mount as a BuildKit secret.
#
# In git mode, scripts/build.sh creates empty placeholder dirs (oat/,
# openagentic-cli/) so the COPY instructions still succeed — the copied
# content is then ignored by the RUN steps which fetch from git.
# -----------------------------------------------------------------------------

ARG INSTALL_MODE=vendored
ARG OAT_REF=v0.6.2
ARG OPENAGENTIC_REF=v0.6.2

# -----------------------------------------------------------------------------
# Stage 1: Build the Exec Daemon
# -----------------------------------------------------------------------------
FROM node:20-slim AS exec-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/openagentic-exec/package*.json ./
RUN npm ci
COPY services/openagentic-exec/tsconfig.json ./
COPY services/openagentic-exec/src ./src
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 1b: SDK is now bundled into openagentic-cli/node_modules/@agentic-work/llm-sdk
# No separate build stage needed — build.sh copies the compiled SDK directly.
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Stage 2: Lean Runtime
# -----------------------------------------------------------------------------
FROM node:20-slim AS runtime

LABEL maintainer="OpenAgentic <engineering@openagentics.io>"
LABEL description="Openagentic Exec - Lean Execution Container with Homebrew"
LABEL security.hardened="true"
LABEL org.opencontainers.image.licenses="Apache-2.0"


# -----------------------------------------------------------------------------
# Install Minimal System Dependencies
# -----------------------------------------------------------------------------
# Only what's needed for: exec daemon, Code, code-server, Homebrew, sandbox
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Process management
    procps \
    dumb-init \
    # Build tools (required by Homebrew to compile formulae)
    build-essential \
    # Git (essential for development + Homebrew)
    git \
    # Text search (OpenAgentic CLI uses ripgrep)
    ripgrep \
    jq \
    # User management (sandbox user creation)
    passwd \
    # Network tools
    curl \
    wget \
    ca-certificates \
    gnupg \
    # Minimal editor
    nano \
    # Archive tools
    unzip \
    tar \
    gzip \
    # SSH client (git operations)
    openssh-client \
    # S3FS-FUSE for mounting MinIO buckets as filesystem
    s3fs \
    fuse \
    # Homebrew requirements
    file \
    locales \
    python3-minimal \
    python3-pip \
    python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && localedef -i en_US -f UTF-8 en_US.UTF-8

# -----------------------------------------------------------------------------
# Install Homebrew (available to all sandbox users)
# -----------------------------------------------------------------------------
# Homebrew is the ONLY package manager users need. Install once, share with all users.
# Pre-built bottles mean most installs are fast (no compilation).
# Example usage:
#   brew install go python kubectl helm awscli terraform rust
#   brew install gh fd fzf bat tree
# Manual install via git clone (the official installer refuses to run as root in Docker)
RUN useradd -m -s /bin/bash linuxbrew \
  && mkdir -p /home/linuxbrew/.linuxbrew \
  && git clone --depth=1 https://github.com/Homebrew/brew /home/linuxbrew/.linuxbrew/Homebrew \
  && mkdir -p /home/linuxbrew/.linuxbrew/bin \
           /home/linuxbrew/.linuxbrew/etc \
           /home/linuxbrew/.linuxbrew/include \
           /home/linuxbrew/.linuxbrew/lib \
           /home/linuxbrew/.linuxbrew/opt \
           /home/linuxbrew/.linuxbrew/sbin \
           /home/linuxbrew/.linuxbrew/share \
           /home/linuxbrew/.linuxbrew/var/homebrew/linked \
           /home/linuxbrew/.linuxbrew/Cellar \
           /home/linuxbrew/.linuxbrew/Caskroom \
  && ln -sf ../Homebrew/bin/brew /home/linuxbrew/.linuxbrew/bin/brew \
  # Make Homebrew readable but NOT writable by sandbox users (security hardening)
  # Users install language-specific tools to their home dir: pip --user, cargo install, go install
  && chmod -R a+rX /home/linuxbrew/.linuxbrew \
  && echo "Homebrew installed at /home/linuxbrew/.linuxbrew (read-only for sandbox users)"

# Create system-wide profile script for Homebrew
RUN echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' > /etc/profile.d/homebrew.sh \
  && chmod +x /etc/profile.d/homebrew.sh

# -----------------------------------------------------------------------------
# Install Dev Tools (pre-installed so LLM can use them immediately)
# These are NON-DESTRUCTIVE dev tools - users can't modify system, only LLM can
# -----------------------------------------------------------------------------

# uv - Fast Python package manager (replaces pip for speed)
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="/usr/local/bin" sh \
  && uv --version \
  && echo "uv installed successfully"

# Go compiler
ARG GO_VERSION=1.23.6
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz" -o /tmp/go.tar.gz \
  && tar -C /usr/local -xzf /tmp/go.tar.gz \
  && rm /tmp/go.tar.gz \
  && echo "Go ${GO_VERSION} installed"
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH="/tmp/go"

# PowerShell (Microsoft repo)
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
      curl -fsSL "https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb" -o /tmp/ms-prod.deb \
      && dpkg -i /tmp/ms-prod.deb \
      && rm /tmp/ms-prod.deb \
      && apt-get update \
      && apt-get install -y --no-install-recommends powershell \
      && rm -rf /var/lib/apt/lists/* \
      && echo "PowerShell installed"; \
    else \
      echo "PowerShell not available for $ARCH, skipping"; \
    fi

# .NET SDK (uses Microsoft repo already added by PowerShell)
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends dotnet-sdk-8.0 \
      && rm -rf /var/lib/apt/lists/* \
      && dotnet --version \
      && echo ".NET SDK installed"; \
    else \
      echo ".NET SDK not available for $ARCH, skipping"; \
    fi

# GitHub CLI (gh) - essential for git operations with user OAuth tokens
RUN ARCH=$(dpkg --print-architecture) && \
    GH_VERSION="2.67.0" && \
    if [ "$ARCH" = "amd64" ]; then GH_ARCH="linux_amd64"; \
    elif [ "$ARCH" = "arm64" ]; then GH_ARCH="linux_arm64"; \
    else GH_ARCH="linux_${ARCH}"; fi && \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_${GH_ARCH}.tar.gz" -o /tmp/gh.tar.gz \
  && tar -xzf /tmp/gh.tar.gz -C /tmp \
  && mv /tmp/gh_${GH_VERSION}_${GH_ARCH}/bin/gh /usr/local/bin/gh \
  && chmod +x /usr/local/bin/gh \
  && rm -rf /tmp/gh* \
  && gh --version \
  && echo "GitHub CLI installed"

# Python dev tools: Jupyter kernel, common libraries
RUN pip install --no-cache-dir --break-system-packages \
    ipykernel \
    jupyter-core \
    nbformat \
    pytest \
  && python3 -m ipykernel install --name python3 --display-name "Python 3" \
  && echo "Python dev tools installed"

# OAT (On-demand Agent Tooling) is provided as a separate service
# (openagentic-synth). The exec sandbox does NOT need it baked in — it calls
# the synth service over HTTP at runtime when tool synthesis is needed.

# Rust (rustup, shared install so all sandbox users can use it)
ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal \
  && chmod -R a+rX /usr/local/rustup /usr/local/cargo \
  && echo "Rust installed"
ENV PATH="/usr/local/cargo/bin:${PATH}"

# -----------------------------------------------------------------------------
# Install code-server (VS Code Web)
# -----------------------------------------------------------------------------
ARG CODE_SERVER_VERSION=4.96.4
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server_${CODE_SERVER_VERSION}_${ARCH}.deb" -o /tmp/code-server.deb \
  && dpkg -i /tmp/code-server.deb \
  && rm /tmp/code-server.deb \
  && mkdir -p /var/lib/code-server \
  && chmod 755 /var/lib/code-server

# -----------------------------------------------------------------------------
# Pre-install Minimal VS Code Extensions (users can install more via code-server)
# -----------------------------------------------------------------------------
ENV EXTENSIONS_DIR=/var/lib/code-server/extensions
RUN mkdir -p $EXTENSIONS_DIR

# Only essentials - users install language-specific extensions as needed
# Non-fatal: marketplace may be temporarily unavailable (502 etc.)
RUN code-server --extensions-dir $EXTENSIONS_DIR --install-extension dbaeumer.vscode-eslint || true; \
    code-server --extensions-dir $EXTENSIONS_DIR --install-extension esbenp.prettier-vscode || true; \
    code-server --extensions-dir $EXTENSIONS_DIR --install-extension eamodio.gitlens || true; \
    code-server --extensions-dir $EXTENSIONS_DIR --install-extension redhat.vscode-yaml || true; \
    code-server --extensions-dir $EXTENSIONS_DIR --install-extension pkief.material-icon-theme || true; \
    code-server --extensions-dir $EXTENSIONS_DIR --install-extension usernamehw.errorlens || true; \
    code-server --extensions-dir $EXTENSIONS_DIR --install-extension ms-python.python || true; \
    code-server --extensions-dir $EXTENSIONS_DIR --install-extension ms-toolsai.jupyter || true; \
    code-server --extensions-dir $EXTENSIONS_DIR --install-extension golang.go || true; \
    code-server --extensions-dir $EXTENSIONS_DIR --install-extension rust-lang.rust-analyzer || true

# Lock down extensions
RUN chmod -R 755 $EXTENSIONS_DIR

# -----------------------------------------------------------------------------
# Chromium (for browser-automation MCPs like Playwright MCP)
# -----------------------------------------------------------------------------
# Chromium is installed for any browser-automation MCPs that users may wire
# in at runtime. We install the Debian chromium package and point puppeteer-
# core at it via PUPPETEER_EXECUTABLE_PATH so puppeteer-core skips its own
# download.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-sandbox \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium

# -----------------------------------------------------------------------------
# Setup Application
# -----------------------------------------------------------------------------
WORKDIR /app

# Copy exec daemon
COPY services/openagentic-exec/package*.json ./
COPY --from=exec-builder /app/node_modules ./node_modules
COPY --from=exec-builder /app/dist ./dist

# -----------------------------------------------------------------------------
# Bun runtime — installed from the upstream GitHub release per oven-sh/bun docs
# -----------------------------------------------------------------------------
# Openagentic CLI runs under Bun (type: "module", uses top-level await + native
# esbuild bindings that are simpler under Bun than Node). We install Bun to
# /opt/bun and symlink into /usr/local/bin so sandbox users can resolve it.
ARG BUN_VERSION=1.1.42
RUN ARCH=$(dpkg --print-architecture) && \
    case "$ARCH" in \
      amd64) BUN_ARCH="linux-x64" ;; \
      arm64) BUN_ARCH="linux-aarch64" ;; \
      *) echo "unsupported arch: $ARCH" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-${BUN_ARCH}.zip" -o /tmp/bun.zip && \
    unzip -q /tmp/bun.zip -d /tmp && \
    mkdir -p /opt/bun/bin && \
    mv "/tmp/bun-${BUN_ARCH}/bun" /opt/bun/bin/bun && \
    chmod +x /opt/bun/bin/bun && \
    ln -sf /opt/bun/bin/bun /usr/local/bin/bun && \
    rm -rf /tmp/bun.zip /tmp/bun-${BUN_ARCH} && \
    bun --version
ENV PATH="/opt/bun/bin:$PATH"

# -----------------------------------------------------------------------------
# Coding CLI — bring your own
# -----------------------------------------------------------------------------
# OSS exec doesn't bake in a coding CLI. The user picks one and installs it
# into the sandbox at runtime via env (CODING_CLI=claude-code | aider | ...)
# or by `npm i -g <cli>` / `pip install <cli>` from the terminal. The exec
# daemon exposes an "open coding CLI" command that shells out to whatever's
# on PATH for the configured adapter.

# -----------------------------------------------------------------------------
# Copy Tutorial Notebooks
# -----------------------------------------------------------------------------
# These are template notebooks that get copied to user workspaces on first login
COPY services/openagentic-exec/notebooks /var/lib/openagentic/notebooks
RUN chmod -R 755 /var/lib/openagentic/notebooks

# -----------------------------------------------------------------------------
# Copy Workspace Templates (OPENAGENTIC.md, README.md)
# -----------------------------------------------------------------------------
# These templates are copied to each user's workspace root on first login
# They provide initial context for the LLM and documentation for users
COPY services/openagentic-exec/templates /app/templates
RUN chmod -R 644 /app/templates/*

# -----------------------------------------------------------------------------
# Filesystem Security
# -----------------------------------------------------------------------------
RUN mkdir -p /workspaces && chmod 777 /workspaces
RUN chmod 644 /etc/passwd /etc/group \
  && chmod 640 /etc/shadow 2>/dev/null || true

# Lock down system paths - sandbox users get read-only access to dev tools
# Go, Rust, Cargo, and app code are readable but not modifiable
RUN chmod -R a+rX,o-w /usr/local/go \
  && chmod -R a+rX,o-w /usr/local/rustup \
  && chmod -R a+rX,o-w /usr/local/cargo \
  && chmod -R a+rX,o-w /app \
  && chmod -R 755 /var/lib/code-server/extensions

# -----------------------------------------------------------------------------
# S3FS Configuration for FUSE mounts
# -----------------------------------------------------------------------------
# Allow non-root users to access FUSE mounts
RUN echo "user_allow_other" >> /etc/fuse.conf

# Copy entrypoint + runtime tools installer
COPY services/openagentic-exec/docker-entrypoint.sh /docker-entrypoint.sh
COPY services/openagentic-exec/install-runtime-tools.sh /app/install-runtime-tools.sh
RUN chmod +x /docker-entrypoint.sh /app/install-runtime-tools.sh

# Create tools cache directory (can be backed by PVC for persistence)
RUN mkdir -p /opt/tools/bin /opt/tools/.versions \
  && chmod -R 755 /opt/tools

# -----------------------------------------------------------------------------
# Environment Configuration
# -----------------------------------------------------------------------------
ENV PORT=3060
ENV OPENAGENTIC_PATH=/usr/local/bin/openagentic
ENV WORKSPACES_PATH=/workspaces
ENV CODE_SERVER_BINARY=/usr/bin/code-server
ENV CODE_SERVER_BASE_PORT=3100
ENV CODE_SERVER_MAX_INSTANCES=100
ENV CODE_SERVER_EXTENSIONS_DIR=/var/lib/code-server/extensions
ENV SANDBOX_ENABLED=true
ENV SANDBOX_UID_MIN=10000
ENV SANDBOX_UID_MAX=60000
# CLI backend: always openagentic-cli (routes through SDK/API)
ENV CLI_BACKEND=openagentic-cli
# Default model for code mode (overridable at deploy via Helm values)
ARG DEFAULT_MODEL=""
ENV DEFAULT_MODEL=${DEFAULT_MODEL}
# Homebrew + runtime tools
ENV HOMEBREW_PREFIX=/home/linuxbrew/.linuxbrew
ENV PATH="/opt/tools/bin:${HOMEBREW_PREFIX}/bin:${HOMEBREW_PREFIX}/sbin:${PATH}"

# -----------------------------------------------------------------------------
# Final Cleanup
# -----------------------------------------------------------------------------
RUN rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# -----------------------------------------------------------------------------
# Runtime
# -----------------------------------------------------------------------------
EXPOSE 3060
EXPOSE 3100-3199
EXPOSE 3200-3299

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3060/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# IP Protection: NOTICE and LICENSE
COPY NOTICE /NOTICE
COPY LICENSE /LICENSE

# Entrypoint mounts MinIO bucket via s3fs, then runs the daemon
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["dumb-init", "node", "dist/index.js"]
