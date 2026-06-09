FROM python:3.11-slim

ARG SRC_PATH=services/openagentic-mcp-proxy

WORKDIR /app

# Install system dependencies including Node.js for MCP servers
# --no-install-recommends cuts Mesa/GL/Vulkan pulls that only CVE-flag us (mcp-proxy
# never renders graphics). wget/build-essential removed — curl covers all download
# needs, and our Python deps all have prebuilt wheels.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    nodejs \
    npm \
    ca-certificates \
    lsb-release \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Azure CLI via pip3 — cross-platform (amd64 + arm64) and works on
# Debian Trixie where the aka.ms/InstallAzureCLIDeb script fails (no trixie support).
RUN pip3 install --no-cache-dir --break-system-packages azure-cli \
    || pip3 install --no-cache-dir azure-cli

# Install AWS CLI v2 (required by OpenAgentic AWS MCP for CLI command execution, architecture-aware)
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then AWS_ARCH="x86_64"; \
    elif [ "$ARCH" = "arm64" ]; then AWS_ARCH="aarch64"; \
    else AWS_ARCH="x86_64"; fi && \
    curl "https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}.zip" -o "awscliv2.zip" \
    && apt-get update && apt-get install -y unzip \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws \
    && aws --version

# Install Helm v3 — direct binary download, arch-aware (avoids get-helm-3 script
# which fails on Debian Trixie and under QEMU arm64 emulation)
RUN ARCH=$(dpkg --print-architecture) \
    && HELM_VER="v3.17.3" \
    && curl -fsSL "https://get.helm.sh/helm-${HELM_VER}-linux-${ARCH}.tar.gz" \
       | tar -xz -C /usr/local/bin --strip-components=1 "linux-${ARCH}/helm" \
    && helm version

# Install global Node.js dependencies for MCP servers
RUN npm install -g @modelcontextprotocol/server-sequential-thinking

# Install MCP Inspector for visual testing and debugging
RUN npm install -g @modelcontextprotocol/inspector

# Install uv via pip (pipx breaks under QEMU ARM64 emulation)
RUN pip install uv && \
    uv --version && \
    uvx --version

# Install mcp-server-fetch globally using uvx
# This ensures fetch MCP is available and properly configured
RUN uvx --with mcp-server-fetch mcp-server-fetch --version || echo "Fetch MCP server cached"

# Pre-install AWS MCP servers globally
RUN uvx --with awslabs.aws-api-mcp-server@latest --version || echo "AWS API MCP server cached"
RUN uvx --with awslabs.aws-knowledge-mcp-server@latest --version || echo "AWS Knowledge MCP server cached"

# Copy and install Python dependencies
COPY ${SRC_PATH}/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY ${SRC_PATH}/src/ ./src/
COPY ${SRC_PATH}/.env.example .env

# Copy and build all MCP servers from services/mcps
COPY services/mcps/ /app/mcp-servers/

# Build Node.js MCP servers with Prisma checksum bypass
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
# OpenAgentic Memory MCP - DISABLED (redundant - pipeline memory.stage.ts already does Milvus search)
# RUN cd /app/mcp-servers/oap-memory-mcp && npm install && npm run build && ls -la dist/
# AWC Formatting MCP - DISABLED (redundant - use system prompts for formatting)
# RUN cd /app/mcp-servers/awc-formatting-mcp && npm install && npm run build

# Build Python MCP servers

# Install OpenAgentic Admin MCP server dependencies (Platform-level admin + infrastructure control)
RUN cd /app/mcp-servers/oap-admin-mcp && pip install --no-cache-dir -r requirements.txt

# Install OpenAgentic Azure MCP server dependencies (ARM + Cost Management - consolidated)
RUN cd /app/mcp-servers/oap-azure-mcp && pip install --no-cache-dir -r requirements.txt

# Install OpenAgentic GCP MCP server dependencies (Platform-level GCP management via Service Account)
RUN cd /app/mcp-servers/oap-gcp-mcp && pip install --no-cache-dir -r requirements.txt

# Install OpenAgentic AWS MCP server dependencies (AWS via Azure AD OBO + Identity Center)
RUN cd /app/mcp-servers/oap-aws-mcp && pip install --no-cache-dir -r requirements.txt

# Install OpenAgentic Web MCP server dependencies (Intelligent web browsing and research)
RUN cd /app/mcp-servers/oap-web-mcp && pip install --no-cache-dir -r requirements.txt

# REMOVED: OpenAgentic ServiceNow MCP - not yet implemented
# REMOVED: OpenAgentic OpenAgentic MCP - moved to dedicated Code Mode (openagentic-manager + openagentic-exec)

# Install OpenAgentic Kubernetes MCP server dependencies (ADMIN-ONLY - K8s cluster management)
RUN cd /app/mcp-servers/oap-kubernetes-mcp && pip install --no-cache-dir -r requirements.txt

# Install OpenAgentic Prometheus MCP server dependencies (ADMIN-ONLY - Metrics querying and visualization)
RUN cd /app/mcp-servers/oap-prometheus-mcp && pip install --no-cache-dir -r requirements.txt

# Install OpenAgentic Agent Architect MCP server dependencies (Natural language agent/workflow creation)
RUN cd /app/mcp-servers/oap-agent-architect-mcp && pip install --no-cache-dir -r requirements.txt

# Install OpenAgentic GitHub MCP server dependencies (GitHub API operations via user OAuth tokens)
RUN cd /app/mcp-servers/oap-github-mcp && pip install --no-cache-dir -r requirements.txt

# REMOVED: OpenAgentic Knowledge MCP — out of scope (2026-05-01).
# Per-tool _meta cascade replaces the meta-MCP tool-guidance role.

# Version build args
ARG PLATFORM_VERSION=0.0.0
ARG PLATFORM_CODENAME=dev
ARG GIT_COMMIT=unknown
ARG GIT_SHORT_COMMIT=unknown
ARG GIT_BRANCH=unknown
ARG BUILD_TIME=unknown

ENV PLATFORM_VERSION=${PLATFORM_VERSION}
ENV PLATFORM_CODENAME=${PLATFORM_CODENAME}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV GIT_SHORT_COMMIT=${GIT_SHORT_COMMIT}
ENV GIT_BRANCH=${GIT_BRANCH}
ENV BUILD_TIME=${BUILD_TIME}

# Create non-root user and change ownership AFTER building
# RUN useradd -m -u 1000 mcpuser && chown -R mcpuser:mcpuser /app
# USER mcpuser

EXPOSE 8080

# Pre-compile Python source to bytecode (keep .py files for MCP server stdio launch)
RUN python -m compileall -b /app/src/ /app/mcp-servers/ 2>/dev/null || true

CMD ["python", "src/main.py"]