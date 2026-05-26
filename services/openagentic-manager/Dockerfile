

# =============================================================================
# OPENAGENTIC MANAGER - DISTROLESS HARDENED IMAGE (DHI)
# =============================================================================
#
# SECURITY MODEL:
# - Minimal attack surface - only essential binaries
# - No curl/wget - prevents download-and-execute attacks
# - No gcc/make - prevents compiling malicious code
# - No netcat/nmap - prevents reverse shells and scanning
# - No sudo - no privilege escalation
# - Sandbox users with ulimits - prevents DoS
#
# SUPPORTED LANGUAGES:
# - Python 3 (with pip for --user installs only)
# - Node.js 20 (with npm for local installs only)
# - Go (runtime only, no cgo)
# - PowerShell Core 7 (cross-platform PowerShell)
# - Bash scripting
#
# OPENAGENTIC BINARY: NOT INCLUDED (#0.6.2)
# -----------------------------------------------------------------------------
# In our production deployment EXECUTION_MODE=kubernetes, which routes session
# spawning through K8sSessionManager → per-user openagentic-exec pods. The
# manager itself never invokes the openagentic CLI — openagentic lives only
# inside the openagentic-exec image. Pulling it into THIS image was vestigial
# from when manager and exec were a single container.
#
# Removed (saves ~250MB and eliminates the gcloud-auth-on-build requirement
# of the GAR pull):
#   - ARG OPENAGENTIC_IMAGE (us-east4-docker.pkg.dev/...)
#   - FROM ${OPENAGENTIC_IMAGE} AS openagentic-cli-image
#   - COPY --from=openagentic-cli-image /opt/bun /opt/bun
#   - COPY --from=openagentic-cli-image /usr/local/lib/openagentic ...
#   - COPY --from=openagentic-cli-image /usr/local/bin/openagentic ...
#   - COPY openagentic-cli/* /usr/local/lib/openagentic/* (local overlay)
#   - ln -sf /opt/bun/bin/bun /usr/local/bin/bun
#
# If a future operator wants to run the manager with EXECUTION_MODE=local
# (no k8s, spawn openagentic as a child_process), they would need to either
# (a) install openagentic separately into the image, or (b) keep using the
# kubernetes mode. The src/sessionManager.ts local-spawn path remains in
# place but is unreachable in our deployment.
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Stage 1: Build the Manager
# -----------------------------------------------------------------------------
FROM node:20-slim AS manager-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/openagentic-manager/package*.json ./
RUN npm ci
COPY services/openagentic-manager/tsconfig.json ./
COPY services/openagentic-manager/src ./src
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 1b: SDK is no longer vendored. The openagentic bundle published to GAR
# already inlines @agentic-work/llm-sdk into its self-contained cli.js, so the
# manager pulls the whole prebuilt openagentic artifact instead. The previous
# sdk-builder stage that ran `npm ci` against sdk/package.json is removed.
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Stage 2: Build the Hardened Runtime
# -----------------------------------------------------------------------------
FROM node:20-slim AS runtime

LABEL maintainer="OpenAgentic <engineering@openagentic.io>"
LABEL description="Openagentic Manager - Hardened Code Mode Container"
LABEL security.hardened="true"

# -----------------------------------------------------------------------------
# Install ONLY essential runtime dependencies
# -----------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Process management
    procps \
    dumb-init \
    # Python runtime (no build tools)
    python3 \
    python3-pip \
    python3-venv \
    # Git (essential for dev work)
    git \
    # Text search (used by CLI)
    ripgrep \
    # JSON processing
    jq \
    # User management (for sandbox)
    passwd \
    # PowerShell dependencies
    apt-transport-https \
    ca-certificates \
    gnupg \
    # Minimal editor (for git commits etc)
    nano \
    # Temporarily install curl (will be removed later)
    curl \
  && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# Install PowerShell Core 7 (architecture-aware)
# -----------------------------------------------------------------------------
ARG PWSH_VERSION=7.4.1
RUN ARCH=$(dpkg --print-architecture) && \
  if [ "$ARCH" = "amd64" ]; then \
    curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-archive-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-archive-keyring.gpg] https://packages.microsoft.com/repos/microsoft-debian-bullseye-prod bullseye main" > /etc/apt/sources.list.d/microsoft.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends powershell \
    && rm -rf /var/lib/apt/lists/*; \
  elif [ "$ARCH" = "arm64" ]; then \
    curl -fsSL "https://github.com/PowerShell/PowerShell/releases/download/v${PWSH_VERSION}/powershell-${PWSH_VERSION}-linux-arm64.tar.gz" -o /tmp/pwsh.tar.gz \
    && mkdir -p /opt/microsoft/powershell/7 \
    && tar -xzf /tmp/pwsh.tar.gz -C /opt/microsoft/powershell/7 \
    && rm /tmp/pwsh.tar.gz \
    && ln -s /opt/microsoft/powershell/7/pwsh /usr/bin/pwsh \
    && chmod +x /opt/microsoft/powershell/7/pwsh; \
  else \
    echo "PowerShell not available for architecture: $ARCH - skipping"; \
  fi \
  # Verify installation (if available)
  && (pwsh --version || echo "PowerShell not installed")

# -----------------------------------------------------------------------------
# Install Go (runtime only - CGO_ENABLED=0, architecture-aware)
# -----------------------------------------------------------------------------
ARG GO_VERSION=1.22.0
RUN ARCH=$(dpkg --print-architecture) && \
  if [ "$ARCH" = "amd64" ]; then GO_ARCH="amd64"; \
  elif [ "$ARCH" = "arm64" ]; then GO_ARCH="arm64"; \
  else GO_ARCH="amd64"; fi && \
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" | tar -C /usr/local -xzf -
ENV PATH="/usr/local/go/bin:${PATH}"
ENV CGO_ENABLED=0

# -----------------------------------------------------------------------------
# code-server: NOT installed on the manager.
# Manager is a Node orchestrator that spawns openagentic-exec pods via
# K8sSessionManager. code-server runs inside those exec pods, never here.
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Install Homebrew (Linuxbrew) for user-scoped package management
# Each user gets their own Homebrew prefix in their home directory
# -----------------------------------------------------------------------------
ENV HOMEBREW_PREFIX=/home/linuxbrew/.linuxbrew
ENV HOMEBREW_CELLAR=/home/linuxbrew/.linuxbrew/Cellar
ENV HOMEBREW_REPOSITORY=/home/linuxbrew/.linuxbrew/Homebrew

# Install Homebrew dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    file \
    && rm -rf /var/lib/apt/lists/*

# Install Homebrew as a system-wide installation (users will have their own prefixes)
RUN git clone https://github.com/Homebrew/brew /home/linuxbrew/.linuxbrew/Homebrew \
  && mkdir -p /home/linuxbrew/.linuxbrew/bin \
  && ln -s /home/linuxbrew/.linuxbrew/Homebrew/bin/brew /home/linuxbrew/.linuxbrew/bin/brew \
  && chmod -R 755 /home/linuxbrew/.linuxbrew

# Create helper script for user-scoped Homebrew initialization
# Users can source this to set up their own brew prefix in their home directory
RUN cat > /usr/local/bin/setup-user-brew <<'BREWSCRIPT'
#!/bin/bash
# Setup user-scoped Homebrew
# Usage: source /usr/local/bin/setup-user-brew

USER_BREW_PREFIX="$HOME/.linuxbrew"
if [ ! -d "$USER_BREW_PREFIX" ]; then
  echo "Setting up Homebrew for user in $USER_BREW_PREFIX..."
  mkdir -p "$USER_BREW_PREFIX"
  cp -r /home/linuxbrew/.linuxbrew/* "$USER_BREW_PREFIX/"
  chmod -R u+w "$USER_BREW_PREFIX"
fi

export HOMEBREW_PREFIX="$USER_BREW_PREFIX"
export HOMEBREW_CELLAR="$USER_BREW_PREFIX/Cellar"
export HOMEBREW_REPOSITORY="$USER_BREW_PREFIX/Homebrew"
export PATH="$USER_BREW_PREFIX/bin:$USER_BREW_PREFIX/sbin:$PATH"
export MANPATH="$USER_BREW_PREFIX/share/man${MANPATH+:$MANPATH}:"
export INFOPATH="$USER_BREW_PREFIX/share/info:${INFOPATH:-}"

echo "Homebrew ready! Use 'brew install <package>' to install packages."
echo "Packages are installed to your personal prefix: $USER_BREW_PREFIX"
BREWSCRIPT
RUN chmod +x /usr/local/bin/setup-user-brew

# -----------------------------------------------------------------------------
# SECURITY: Remove dangerous binaries (AFTER all installations complete)
# NOTE: curl is KEPT for Homebrew package management (user-scoped)
# NOTE: gcc/make are KEPT for Homebrew to compile packages from source
# -----------------------------------------------------------------------------
RUN \
  # Keep curl for Homebrew (user-scoped package management)
  # Keep gcc/make for compiling Homebrew packages from source
  # Remove wget (prefer curl for consistency)
  rm -f /usr/bin/wget /usr/bin/fetch 2>/dev/null || true && \
  # Remove network tools (prevents reverse shells, scanning)
  rm -f /usr/bin/nc /usr/bin/ncat /usr/bin/netcat /usr/bin/nmap /usr/bin/telnet 2>/dev/null || true && \
  # Remove packet capture tools
  rm -f /usr/bin/tcpdump /usr/sbin/tcpdump /usr/bin/wireshark /usr/bin/tshark 2>/dev/null || true && \
  # Remove debugging tools (can attach to other processes)
  rm -f /usr/bin/gdb /usr/bin/lldb /usr/bin/strace /usr/bin/ltrace 2>/dev/null || true && \
  # Remove sudo completely
  rm -f /usr/bin/sudo /usr/sbin/sudo 2>/dev/null || true && \
  apt-get purge -y sudo 2>/dev/null || true && \
  # Remove cron (prevents persistence)
  rm -f /usr/bin/crontab /usr/sbin/cron 2>/dev/null || true && \
  # Remove at/batch (scheduled execution)
  rm -f /usr/bin/at /usr/bin/batch 2>/dev/null || true && \
  # Verify removals
  echo "=== SECURITY: Verifying dangerous binaries removed ===" && \
  for cmd in wget nc netcat nmap sudo gdb strace crontab; do \
    if command -v $cmd >/dev/null 2>&1; then \
      echo "WARNING: $cmd still exists!"; \
    else \
      echo "OK: $cmd removed"; \
    fi; \
  done && \
  echo "=== ALLOWED: curl (for Homebrew), gcc/make (for compiling) ==="

# -----------------------------------------------------------------------------
# Setup Application
# -----------------------------------------------------------------------------
WORKDIR /app

# Copy manager
COPY services/openagentic-manager/package*.json ./
COPY --from=manager-builder /app/node_modules ./node_modules
COPY --from=manager-builder /app/dist ./dist

# -----------------------------------------------------------------------------
# OpenAgentic CLI: NOT installed (#0.6.2)
# -----------------------------------------------------------------------------
# The openagentic binary lives only in openagentic-exec pods (spawned by
# K8sSessionManager). The manager process never execs it directly when
# EXECUTION_MODE=kubernetes (the default for our deployments). See the
# header comment block for the full rationale.

# -----------------------------------------------------------------------------
# Filesystem Security
# -----------------------------------------------------------------------------
# Workspaces directory - root owns, sandbox users get subdirs
RUN mkdir -p /workspaces && chmod 711 /workspaces

# Allow dynamic user creation (for sandbox users)
RUN chmod 644 /etc/passwd /etc/group \
  && chmod 640 /etc/shadow 2>/dev/null || true

# Create python/pip symlinks
RUN ln -sf /usr/bin/python3 /usr/bin/python 2>/dev/null || true

# -----------------------------------------------------------------------------
# Environment Configuration
# -----------------------------------------------------------------------------
ENV WORKSPACES_PATH=/workspaces
# OPENAGENTIC_PATH / CODE_SERVER_* are set in openagentic-exec, not here.

# PowerShell configuration
ENV POWERSHELL_TELEMETRY_OPTOUT=1
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1

# -----------------------------------------------------------------------------
# Final Security Hardening
# -----------------------------------------------------------------------------
# Remove apt/dpkg to prevent package installation
RUN rm -rf /var/lib/apt/lists/* \
  && rm -f /usr/bin/apt /usr/bin/apt-get /usr/bin/dpkg 2>/dev/null || true

# Remove shells users shouldn't use (keep bash for sandbox)
RUN rm -f /bin/sh.distrib 2>/dev/null || true

# Print security summary
RUN echo "=== DHI SECURITY SUMMARY ===" \
  && echo "Removed: wget, nc, nmap, sudo, gdb, strace, apt" \
  && echo "Kept for Homebrew: curl, gcc, make (user-scoped package management)" \
  && echo "Installed: python3, node, go, pwsh, git, ripgrep, brew" \
  && echo "Not installed: code-server (lives in openagentic-exec), openagentic CLI, s3fs, minio" \
  && echo "============================"

# -----------------------------------------------------------------------------
# Runtime
# -----------------------------------------------------------------------------
EXPOSE 3050

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3050/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["dumb-init", "node", "dist/index.js"]
