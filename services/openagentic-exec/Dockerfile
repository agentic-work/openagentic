# syntax=docker/dockerfile:1.4

# =============================================================================
# AGENTICODE EXEC - LEAN EXECUTION CONTAINER
# =============================================================================
#
# This container runs AgentiCode CLI sessions (CCR remote-session mode).
# It's controlled by openagentic-manager via REST API and WebSocket.
# AgentiCode CLI always routes through the AgenticWork SDK/API for LLM access.
#
# LEAN PHILOSOPHY:
# - Only pre-install essentials (Node.js, git, ripgrep)
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
# DUAL-MODE COMPANION INSTALL (#0.6.2)
# -----------------------------------------------------------------------------
# This image installs three sibling tools — synth, brainbow, openagentic — and
# supports two install modes selected by --build-arg INSTALL_MODE=...:
#
#   INSTALL_MODE=vendored   (DEFAULT — used by our local build.sh)
#     Each tool is rsynced from the sibling source repo into the build
#     context by scripts/build.sh, then COPY'd into the image and installed
#     from local files. Fast iteration, no network calls during build,
#     no PAT required.
#
#   INSTALL_MODE=git        (used by OMHS GitHub Actions and downstream CI)
#     Each tool is `git clone`'d from agentic-work/{synth,brainbow,openagentic}
#     at tag $TOOL_REF, then installed. Authentication is via a fine-grained
#     PAT mounted as a BuildKit secret (id=gh_pat, Contents:Read-only on
#     the 3 source repos). The PAT NEVER lands in image layers or in
#     `docker history` — it lives only in /run/secrets during the RUN.
#
# In git mode, scripts/build.sh creates empty placeholder dirs (synth/,
# brainbow/, openagentic-cli/) so the COPY instructions still succeed —
# the copied content is then ignored by the RUN steps which fetch from git.
#
# Build invocations:
#   Local (vendored, default):
#     ./scripts/build.sh openagentic-exec --buildpush
#
#   OMHS / CI (git mode):
#     docker buildx build \
#       --build-arg INSTALL_MODE=git \
#       --secret id=gh_pat,env=GH_PAT \
#       -f services/openagentic-exec/Dockerfile .
# -----------------------------------------------------------------------------

ARG INSTALL_MODE=vendored
ARG SYNTH_REF=v0.6.2
ARG BRAINBOW_REF=v0.6.2
ARG AGENTICODE_REF=v0.6.2

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

LABEL maintainer="AgenticWork <engineering@openagentic.io>"
LABEL description="Agenticode Exec - Lean Execution Container with Homebrew"
LABEL security.hardened="true"

# -----------------------------------------------------------------------------
# Install Minimal System Dependencies
# -----------------------------------------------------------------------------
# Only what's needed for: exec daemon, Homebrew, sandbox
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Process management
    procps \
    dumb-init \
    # Build tools (required by Homebrew to compile formulae)
    build-essential \
    # Git (essential for development + Homebrew)
    git \
    # Text search (AgentiCode CLI uses ripgrep)
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

# Synth (LLM tool-synthesis; formerly OAT) — install the `synth` Python
# package so openagentic-exec can call it for on-demand tool synthesis.
# Dual-mode: vendored (default) installs from ./synth in build context;
# git mode `pip install`s from agentic-work/synth@$SYNTH_REF via PAT secret mount.
# In git mode build.sh creates an empty placeholder ./synth dir so the COPY
# instruction still succeeds.
ARG INSTALL_MODE
ARG SYNTH_REF
COPY synth /tmp/synth-install
# NOTE: vendored mode (default in CI) copies synth from ./synth at COPY above.
# Git mode is developer-only (requires GH_PAT secret + BuildKit --mount).
# az acr build does NOT support BuildKit, so we must not use --mount here.
RUN set -e; \
    if [ "$INSTALL_MODE" = "git" ]; then \
      echo "ERROR: git install mode requires BuildKit (not supported by az acr build)" && exit 1; \
    else \
      pip install --no-cache-dir --break-system-packages /tmp/synth-install; \
    fi && \
    rm -rf /tmp/synth-install && \
    python3 -c 'import synth; print("synth", getattr(synth, "__version__", "?"))' && \
    echo "Synth installed ($INSTALL_MODE mode @ ${SYNTH_REF})"

# Rust (rustup, shared install so all sandbox users can use it)
ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal \
  && chmod -R a+rX /usr/local/rustup /usr/local/cargo \
  && echo "Rust installed"
ENV PATH="/usr/local/cargo/bin:${PATH}"

# -----------------------------------------------------------------------------
# GhostPilot — dual-mode (vendored | git)
# -----------------------------------------------------------------------------
# GhostPilot is a puppeteer-core-based browser automation server used by the
# agentic cloud_operations flow (Bob test etc.) and the GP auto-approve harness.
# It needs Chromium + the system libs Chromium links against. We install the
# Debian chromium package and point puppeteer-core at it via
# PUPPETEER_EXECUTABLE_PATH so puppeteer-core skips its own download.
#
# vendored mode: ./brainbow rsynced in by scripts/build.sh from ../brainbow
# (was ghostpilot pre-2026-05-14 — canonical repo name is brainbow now).
# git mode: cloned from agentic-work/brainbow@$BRAINBOW_REF via PAT secret
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-sandbox \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ARG INSTALL_MODE
ARG BRAINBOW_REF
COPY brainbow /opt/brainbow
RUN set -e; \
    if [ "$INSTALL_MODE" = "git" ]; then \
      echo "ERROR: git install mode requires BuildKit (not supported by az acr build)" && exit 1; \
    fi && \
    cd /opt/brainbow && \
    rm -rf node_modules package-lock.json && \
    npm install --omit=dev --no-audit --no-fund && \
    chmod -R a+rX /opt/brainbow && \
    echo "Brainbow installed ($INSTALL_MODE mode @ ${BRAINBOW_REF:-vendored})"

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium
ENV BRAINBOW_PATH=/opt/brainbow
ENV GHOST_PORT=4444

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
# Agenticode CLI runs under Bun (type: "module", uses top-level await + native
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
# AgentiCode CLI — dual-mode (vendored | git)
# -----------------------------------------------------------------------------
# vendored mode: build.sh rsyncs ../openagentic (with @agentic-work/llm-sdk
#   already in node_modules from rsync-override) into ./openagentic-cli/.
#   We COPY the dist/, package.json, and node_modules tree into
#   /usr/local/lib/openagentic and wrap with a bun launcher.
#
# git mode: clone agentic-work/openagentic@$AGENTICODE_REF, run npm install
#   inside the clone (which respects the `overrides` block in openagentic's
#   package.json that pulls @agentic-work/llm-sdk from openagentic-sdk@git
#   via the same PAT). dist/ is shipped in the openagentic repo so no
#   `npm run build` needed here.
ARG INSTALL_MODE
ARG AGENTICODE_REF
ARG SDK_REF=v0.6.2
COPY openagentic-cli /tmp/openagentic-vendored
# NOTE: vendored mode (default in CI) uses pre-built openagentic-cli from
# the COPY above. Git mode is developer-only and requires BuildKit --mount
# which az acr build does NOT support. Fail fast if someone accidentally
# sets INSTALL_MODE=git in CI.
RUN set -e && \
    mkdir -p /usr/local/lib/openagentic && \
    if [ "$INSTALL_MODE" = "git" ]; then \
      echo "ERROR: git install mode requires BuildKit (not supported by az acr build)" && exit 1; \
    else \
      cp -r /tmp/openagentic-vendored/dist /usr/local/lib/openagentic/dist && \
      cp /tmp/openagentic-vendored/package.json /usr/local/lib/openagentic/package.json && \
      cp -r /tmp/openagentic-vendored/node_modules /usr/local/lib/openagentic/node_modules; \
    fi && \
    rm -rf /tmp/openagentic-vendored /tmp/openagentic-git && \
    printf '#!/bin/sh\nexec /opt/bun/bin/bun /usr/local/lib/openagentic/dist/entrypoints/cli.js "$@"\n' > /usr/local/bin/openagentic && \
    chmod +x /usr/local/bin/openagentic && \
    test -f /usr/local/lib/openagentic/dist/entrypoints/cli.js && \
    test -f /usr/local/lib/openagentic/package.json && \
    echo "openagentic installed ($INSTALL_MODE mode @ ${AGENTICODE_REF:-vendored})" && \
    (/usr/local/bin/openagentic --version 2>&1 | head -3 || echo "openagentic wrapper installed (version probe optional)")

# -----------------------------------------------------------------------------
# Copy Tutorial Notebooks
# -----------------------------------------------------------------------------
# These are template notebooks that get copied to user workspaces on first login
COPY services/openagentic-exec/notebooks /var/lib/openagentic/notebooks
RUN chmod -R 755 /var/lib/openagentic/notebooks

# -----------------------------------------------------------------------------
# Copy Workspace Templates (AGENTICODE.md, README.md)
# -----------------------------------------------------------------------------
# These templates are copied to each user's workspace root on first login
# They provide initial context for the LLM and documentation for users
COPY services/openagentic-exec/templates /app/templates
RUN chmod -R 644 /app/templates/*

# -----------------------------------------------------------------------------
# Seed openagentic plugin marketplace + skills (build-time bake)
#
# anthropics/claude-plugins-official  — official plugin marketplace (bundles
#                                       superpowers, playwright, github, etc.)
# anthropics/skills                    — curated standalone skills library
#
# The seed dir mechanism (AGENTICODE_PLUGIN_SEED_DIR) lets openagentic find
# marketplaces at startup without a runtime network call. Structure required:
#   $seed/known_marketplaces.json
#   $seed/marketplaces/claude-plugins-official/   (git clone — plugin monorepo)
#   $seed/skills/                                 (git clone — standalone skills)
#
# Skills from $seed/skills/ surface in /skills; plugins from
# $seed/marketplaces/claude-plugins-official/ surface in /plugins. The
# superpowers plugin is ENABLED BY DEFAULT via a seeded settings.json so
# every new codemode pod boots with superpowers ready without a manual
# install step.
#
# Both clones are depth=1 to minimise image size. Staleness is refreshed
# only on image rebuild — runtime operates fully offline.
# -----------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/openagentic-seed/marketplaces \
  && git clone --depth 1 \
       https://github.com/anthropics/claude-plugins-official.git \
       /opt/openagentic-seed/marketplaces/claude-plugins-official \
  && echo "claude-plugins-official cloned" \
  && git clone --depth 1 \
       https://github.com/anthropics/skills.git \
       /opt/openagentic-seed/skills \
  && echo "anthropics/skills cloned" \
  && git clone --depth 1 \
       https://github.com/obra/superpowers.git \
       /opt/openagentic-seed/marketplaces/superpowers \
  && echo "obra/superpowers cloned (default-enabled, #334)"

# Write the known_marketplaces.json for the seed directory so openagentic
# registers the official marketplace automatically on first startup.
# Both marketplaces — claude-plugins-official AND obra/superpowers —
# are registered as readonly seeded marketplaces; user-installed plugins
# layer on top via the daemon's per-user known_marketplaces.json under
# AGENTICODE_CONFIG_DIR. installLocation is rewritten to absolute paths
# by the reconciler when it reads this file.
RUN printf '{\n  "claude-plugins-official": {\n    "source": { "source": "github", "repo": "anthropics/claude-plugins-official" },\n    "installLocation": "/opt/openagentic-seed/marketplaces/claude-plugins-official",\n    "lastUpdated": "2026-04-25T00:00:00.000Z",\n    "autoUpdate": false\n  },\n  "superpowers": {\n    "source": { "source": "github", "repo": "obra/superpowers" },\n    "installLocation": "/opt/openagentic-seed/marketplaces/superpowers",\n    "lastUpdated": "2026-04-25T00:00:00.000Z",\n    "autoUpdate": false\n  }\n}\n' \
      > /opt/openagentic-seed/known_marketplaces.json

# Pre-seed the user-config plugins/<marketplace>/enabled flag so superpowers
# is ON by default in every fresh codemode pod. The daemon's reconciler
# layers this with the seed marketplace at boot. Users can /plugins →
# Disable to turn it off; the disabled state persists in their workspace
# PVC under AGENTICODE_CONFIG_DIR.
RUN mkdir -p /home/openagentic/.openagentic/plugins \
  && printf '{\n  "marketplaces": {\n    "superpowers": { "enabled": true },\n    "claude-plugins-official": { "enabled": false }\n  }\n}\n' \
       > /home/openagentic/.openagentic/plugins/settings.json \
  && chmod 644 /home/openagentic/.openagentic/plugins/settings.json

RUN chmod -R a+rX /opt/openagentic-seed

# Point the daemon at the seed. openagentic reads this on startup and
# registers seed marketplaces as read-only entries that survive without
# a network git-clone. The skills path is also wired here so /skills
# resolves to the baked library at boot time.
ENV AGENTICODE_PLUGIN_SEED_DIR=/opt/openagentic-seed
# AGENTICODE_CONFIG_DIR — runtime user (uid 10001, openagentic) owns this.
# Moved from /root/.openagentic when the pod stopped running as root
# (see securityContext in code-manager's k8sSessionManager pod-spec).
# The daemon writes its own known_marketplaces.json here on first
# merge, layering user-installed plugins on top of the seed.
ENV AGENTICODE_CONFIG_DIR=/home/openagentic/.openagentic
ENV HOME=/home/openagentic
# Per-user tool install prefixes so `pip --user`, `npm install -g`,
# `cargo install`, `go install` all land somewhere uid 10001 owns.
ENV NPM_CONFIG_PREFIX=/home/openagentic/.npm-global
# npm cache MUST live on overlay (or any non-geesefs FS), not on the
# /workspaces PVC which is mounted via fuse.geesefs with default_permissions.
# geesefs silently drops chmod +x — so npx-installed binaries lose the
# exec bit and fail with "playwright-mcp: Permission denied" the moment
# any MCP-driven plugin (like @playwright/mcp@latest) tries to spawn its
# CLI shim. Pinning the cache to /home/openagentic (overlay) keeps the
# install on a real POSIX FS while still being writable by uid 10001.
# Diagnosed 2026-05-01 while wiring playwright into openagentic pods.
ENV NPM_CONFIG_CACHE=/home/openagentic/.npm
ENV CARGO_HOME=/home/openagentic/.cargo
ENV PATH="/home/openagentic/.local/bin:/home/openagentic/.npm-global/bin:/home/openagentic/.cargo/bin:${PATH}"

# Pre-create the config home and symlink skills so every user session
# immediately has the baked skills available.
#
# IMPORTANT: anthropics/skills clones with the actual skill folders one
# level deep at `/opt/openagentic-seed/skills/skills/<skill-name>/` (the
# repo top level holds README.md, THIRD_PARTY_NOTICES.md, skills/, spec/,
# template/). openagentic looks for skills at `<config-dir>/skills/<name>/`,
# so the symlink target must be the inner `skills/` subdir, not the repo
# root, or every skill discovery returns zero. Caught 2026-04-24 in live
# diagnostics — model reported zero skills despite the clone succeeding.
#
# NON-ROOT: config home moved from /root/.openagentic to
# /home/openagentic/.openagentic so the runtime user (uid 10001) owns it.
RUN mkdir -p /home/openagentic/.openagentic \
  && ln -sf /opt/openagentic-seed/skills/skills /home/openagentic/.openagentic/skills

# NOTE: superpowers-by-default is a follow-up. The superpowers plugin
# lives at github.com/obra/superpowers (standalone repo), NOT inside
# anthropics/claude-plugins-official. Baking it as a default-enabled
# plugin requires either a synthetic marketplace wrapper pointing at
# obra/superpowers, or seeding it directly into the user's plugins/
# directory with a matching manifest entry. Both are separate from the
# code-server rip. Track as a separate ticket; for now the user can
# install manually via /plugins → Discover → superpowers@... once the
# appropriate marketplace is added.

# -----------------------------------------------------------------------------
# Non-root runtime user (uid 10001, gid 10001)
# -----------------------------------------------------------------------------
# The pod's securityContext (in openagentic-manager k8sSessionManager.ts)
# sets runAsUser=10001 / runAsGroup=10001 / fsGroup=10001 so the daemon
# can never escalate to root. Each pod is already 1:1 with an AAD user
# at the k8s pod boundary; uid 10001 in pod-A vs uid 10001 in pod-B are
# completely isolated. fsGroup chowns the per-user PVC mount so
# /workspaces/<userId> is writable by the daemon without any cap perks.
RUN groupadd -g 10001 openagentic \
  && useradd  -u 10001 -g 10001 -m -d /home/openagentic -s /bin/bash openagentic \
  && mkdir -p /home/openagentic/.openagentic/debug \
              /home/openagentic/.openagentic/logs \
              /home/openagentic/.openagentic/plugins \
              /home/openagentic/.local/bin \
              /home/openagentic/.npm-global/lib \
              /home/openagentic/.npm \
              /home/openagentic/.cargo \
              /home/openagentic/.cache \
  && chown -R 10001:10001 /home/openagentic \
  # Make Homebrew + Rust + Cargo prefixes writable by the runtime user so
  # the agent can `brew install`, `cargo install`, `npm install -g` etc.
  # without sudo. Pod is non-root + cap-stripped so this only widens the
  # *uid 10001* surface, never the host's. /opt/tools already chowned below
  # for the install-runtime-tools.sh background task.
  && chown -R 10001:10001 /home/linuxbrew /usr/local/cargo /usr/local/rustup

# -----------------------------------------------------------------------------
# Filesystem Security
# -----------------------------------------------------------------------------
RUN mkdir -p /workspaces \
  && chown 10001:10001 /workspaces \
  && chmod 770 /workspaces
RUN chmod 644 /etc/passwd /etc/group \
  && chmod 640 /etc/shadow 2>/dev/null || true

# Lock down system paths - sandbox users get read-only access to dev tools
# Go, Rust, Cargo, and app code are readable but not modifiable
RUN chmod -R a+rX,o-w /usr/local/go \
  && chmod -R a+rX,o-w /usr/local/rustup \
  && chmod -R a+rX,o-w /usr/local/cargo \
  && chmod -R a+rX,o-w /app

# Copy entrypoint + runtime tools installer + npm-fast / venv-fast wrappers
# + runtime-notes.md crib sheet (loaded into the daemon's system prompt
# so the agent doesn't re-discover the geesefs strip-exec-bits gotcha
# every fresh session).
COPY services/openagentic-exec/docker-entrypoint.sh /docker-entrypoint.sh
COPY services/openagentic-exec/install-runtime-tools.sh /app/install-runtime-tools.sh
COPY services/openagentic-exec/npm-fast.sh /usr/local/bin/npm-fast
COPY services/openagentic-exec/venv-fast.sh /usr/local/bin/venv-fast
COPY services/openagentic-exec/runtime-notes.md /etc/openagentic/runtime-notes.md
RUN chmod +x /docker-entrypoint.sh /app/install-runtime-tools.sh \
             /usr/local/bin/npm-fast /usr/local/bin/venv-fast

# Create tools cache directory (can be backed by PVC for persistence)
# Owned by 10001 so the runtime user can install brew/uv/cargo bins here
# without needing CAP_CHOWN / SETUID. install-runtime-tools.sh runs as 10001.
RUN mkdir -p /opt/tools/bin /opt/tools/.versions \
  && chown -R 10001:10001 /opt/tools \
  && chmod -R 755 /opt/tools

# -----------------------------------------------------------------------------
# Environment Configuration
# -----------------------------------------------------------------------------
# PORT defaults to the CCR remote-session daemon port (3070). k8s auto-injects
# PORT=<first-service-port> when the pod joins a Service, but keeping the image
# default aligned with the daemon's bind port means a bare `docker run` (no
# k8s) still lands the daemon on 3070, matching EXPOSE/HEALTHCHECK below.
ENV PORT=3070
ENV AGENTICODE_DAEMON_PORT=3070
ENV AGENTICODE_PATH=/usr/local/bin/openagentic
ENV WORKSPACES_PATH=/workspaces
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
EXPOSE 3070

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3070/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Drop to the non-root runtime user. Pod securityContext also enforces this
# (runAsNonRoot:true, runAsUser:10001) — but baking it into the image means
# `docker run` outside k8s also lands non-root, and any cap leak in the pod
# spec can't escalate beyond what 10001 has on the image filesystem.
USER 10001:10001

# Entrypoint sets up the local workspace (PVC-mounted at /workspaces), then
# execs `openagentic --remote-session` (CCR-only mode, 2026-04-22).
ENTRYPOINT ["/docker-entrypoint.sh"]
