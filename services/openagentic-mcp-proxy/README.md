# MCP Proxy Service

**Centralized MCP Server Manager**

The MCP Proxy is a Python FastAPI service that manages Model Context Protocol (MCP) servers, providing inter-service authentication and centralized tool execution. Cloud MCPs (aws/azure/gcp) authenticate with service-principal / static-keypair / ADC credentials.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Cloud MCP Credentials](#cloud-mcp-credentials)
- [Development](#development)
- [Deployment](#deployment)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

---

## Overview

The MCP Proxy service acts as a centralized gateway for all MCP (Model Context Protocol) servers in the OpenAgentic platform. It provides:

- **Lifecycle Management**: Start, stop, restart, and monitor MCP servers
- **Inter-service Authentication**: Validates the api→proxy service token (HS256 JWT / `oa_sys_` HMAC / internal API key) and local-auth `oa_` user API keys
- **Cloud Credentials**: Service-principal / static-keypair / ADC creds for the cloud MCPs
- **Tool Discovery**: Centralized registry of all available MCP tools
- **Health Monitoring**: Automatic health checks and recovery
- **Metrics**: Prometheus-compatible metrics for observability

### Why MCP Proxy?

The dedicated MCP Proxy provides centralized MCP management:

1. **Clear Separation**: MCP management separate from LLM integration
2. **Single Credential Model**: Cloud MCPs share a service-principal / static-keypair / ADC credential set
3. **Better Monitoring**: Dedicated metrics and health checks
4. **Flexibility**: Easy to add new MCP servers without touching LLM code

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Proxy Service                        │
│                      (Python FastAPI)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │   MCP Manager   │  │  Auth Resolver   │  │  Tool Indexer  │ │
│  │                 │  │                  │  │                │ │
│  │ • Start/Stop    │  │ • HS256 JWT      │  │ • Index tools  │ │
│  │ • Health Check  │  │ • oa_sys_ HMAC   │  │ • Redis-backed │ │
│  │ • Recovery      │  │ • oa_ API key    │  │ • Semantic     │ │
│  └─────────────────┘  └──────────────────┘  └────────────────┘ │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Tool Registry & Discovery                    │   │
│  │  • Redis-backed tool index                               │   │
│  │  • Semantic search for tools                             │   │
│  │  • Availability tracking                                 │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
      ┌──────────────┐               ┌──────────────┐
      │ System MCPs  │               │   Cloud MCPs │
      │              │               │              │
      │ • admin      │               │ • aws        │
      │ • web        │               │ • azure      │
      │ • github     │               │ • gcp        │
      │ • kubernetes │               │  (SP/static/ │
      │ • prometheus │               │   ADC creds) │
      │ • loki       │               │              │
      └──────────────┘               └──────────────┘
```

The wired built-in MCP servers (see `src/mcp_manager.py` `initialize_servers`) are: **aws, azure, gcp, kubernetes, prometheus, loki, github, admin, web** (9). All run as system-level subprocesses; the cloud MCPs authenticate with a shared service-principal / static-keypair / ADC credential set.

### Component Responsibilities

| Component | File | Purpose |
|-----------|------|---------|
| **Main Application** | `src/main.py` | FastAPI app, routes, auth resolution, tool execution |
| **MCP Manager** | `src/mcp_manager.py` | MCP lifecycle, process management, health |
| **Tool Indexer** | `src/tool_indexer.py` | Tool discovery & indexing |
| **Tool Search** | `src/tool_search.py` | Semantic tool search |
| **Static UI** | `src/static/index.html` | Web-based MCP inspector |

---

## Features

### 1. Inter-service Authentication

Every request is resolved per-request by `get_user_info` in `src/main.py`,
which accepts only these credential types (fail-closed otherwise):

- **`oa_sys_` system token** — HMAC-verified against `INTERNAL_SERVICE_SECRET` (api→proxy SP context)
- **`oa_` user API key** — validated against the api's `/api/auth/me` (local-auth)
- **`INTERNAL_API_KEY`** — plain match for the api→proxy service path
- **Internal HS256 JWT** — verified against the shared signing secret (`JWT_SECRET` / `SIGNING_SECRET`)

When `ENABLE_AUTH=false` (local dev only), a request with no Authorization
header falls back to a local system-admin context.

### 2. Cloud MCP Credentials

The cloud MCPs (aws/azure/gcp) authenticate with a shared credential set,
supplied via each server's `config.env` (built from `os.getenv` in
`mcp_manager.initialize_servers`) and the read-only host CLI mounts:

- **Azure** — service principal (`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_SUBSCRIPTION_ID`); also powers the SP-based cost dashboards
- **AWS** — static keypair (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`)
- **GCP** — service account / ADC (`GCP_PROJECT_ID` / `GCP_CREDENTIALS_JSON` / `GCP_CREDENTIALS_FILE`)

### 3. Health Monitoring & Auto-Recovery

MCP Proxy monitors MCP server health and can restart crashed subprocesses. See `MCPManager` in `src/mcp_manager.py` for the lifecycle and recovery logic, and the `/servers/{server_id}/restart` route in `src/main.py`.

**Health Checks:**
- Process alive check
- Server status reported via `GET /health`

### 4. Tool Discovery & Registry

MCP tools are indexed for discovery and semantic search (see `src/tool_indexer.py` and `src/tool_search.py`).

**Tool Discovery API:**
- List all tools: `GET /tools`
- List tools for a server: `GET /servers/{server_name}/tools`

### 5. Metrics & Observability

Prometheus-compatible HTTP metrics are exposed at `/metrics` via
`prometheus-fastapi-instrumentator` (request counts, latencies, status codes).

---

## Installation

### Prerequisites

- Python 3.11+
- Node.js 18+ (for JavaScript-based MCPs)
- Redis 7.0+
- PostgreSQL 16+ (for session persistence)

### Local Development

```bash
# Clone repository
git clone https://github.com/agentic-work/openagentic.git
cd openagentic/services/openagentic-mcp-proxy

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install Node.js for MCP servers
npm install -g @modelcontextprotocol/sdk

# Set environment variables
cp .env.example .env
# Edit .env with your configuration

# Run service
uvicorn src.main:app --reload --host 0.0.0.0 --port 8080
```

### Docker

```bash
# Build image
docker build -t mcp-proxy:latest .

# Run container
docker run -d \
  --name mcp-proxy \
  -p 8080:8080 \
  -e REDIS_URL=redis://redis:6379 \
  -e DATABASE_URL=postgresql://user:pass@postgres:5432/openagentic \
  mcp-proxy:latest
```

### Kubernetes

```bash
# Deploy via Helm
helm install openagentic ./helm/openagentic \
  --set mcpProxy.enabled=true \
  --set mcpProxy.replicas=2
```

---

## Configuration

### Environment Variables

```bash
# Server Configuration
PORT=8080
HOST=0.0.0.0
LOG_LEVEL=info
WORKERS=4

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
REDIS_DB=0

# Database Configuration (for session persistence)
DATABASE_URL=postgresql://user:pass@localhost:5432/openagentic

# Milvus Configuration (for semantic tool search)
MILVUS_HOST=localhost
MILVUS_PORT=19530

# Inter-service auth (must match the api)
JWT_SECRET=your-strong-random-signing-key
SIGNING_SECRET=your-strong-random-signing-key
INTERNAL_SERVICE_SECRET=your-internal-service-secret
INTERNAL_API_KEY=your-internal-api-key

# Cloud MCP credentials (service principal / static keypair / ADC)
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-sp-client-id
AZURE_CLIENT_SECRET=your-sp-client-secret
AZURE_SUBSCRIPTION_ID=your-subscription-id
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
GCP_PROJECT_ID=your-project-id
GCP_CREDENTIALS_JSON=your-service-account-json

# Built-in MCP Server Toggles (set to "true" to disable a server)
OpenAgentic_ADMIN_MCP_DISABLED=false
OpenAgentic_WEB_MCP_DISABLED=false
OpenAgentic_GITHUB_MCP_DISABLED=false
OpenAgentic_KUBERNETES_MCP_DISABLED=false
OpenAgentic_PROMETHEUS_MCP_DISABLED=false
OpenAgentic_LOKI_MCP_DISABLED=false
OpenAgentic_AWS_MCP_DISABLED=false
OpenAgentic_AZURE_MCP_DISABLED=false
OpenAgentic_GCP_MCP_DISABLED=false
```

### MCP Server Registration

Built-in MCP servers are registered programmatically in
`MCPManager.initialize_servers` (`src/mcp_manager.py`), each gated behind a
disable env var (see the toggles above). Most are spawned as FastMCP stdio
subprocesses, e.g.:

```python
self.servers["openagentic_admin"] = MCPServer(MCPServerConfig(
    name="openagentic_admin",
    command=["fastmcp", "run", "-t", "stdio", "/app/mcp-servers/oap-admin-mcp/server.py"],
    env={"LOG_LEVEL": "info"},
))
```

The Azure MCP authenticates with a service principal (`AZURE_CLIENT_ID` /
`AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID`); the Azure
and AWS MCPs can also be attached as remote HTTP servers via their respective
`*_MCP_URL` env vars.

---

## API Reference

The endpoints below are the actual FastAPI routes in `src/main.py`. Authentication
is resolved per-request from the forwarded user context.

### Tool Execution

#### POST /call

Execute a single MCP tool.

**Request:**
```json
{
  "server": "openagentic_admin",
  "tool": "get_users",
  "arguments": {
    "limit": 10,
    "offset": 0
  }
}
```

The response includes the tool result plus a structured error envelope and
cache metadata.

#### POST /batch-call

Execute multiple MCP tool calls in one request.

#### POST /mcp and POST /mcp/tool

Lower-level MCP JSON-RPC passthrough endpoints (`tools/list`, `tools/call`, etc.).

#### GET /tools

List all indexed tools across registered servers.

#### GET /servers/{server_name}/tools

List tools for a single server.

### Server Management

- `GET /servers` — list registered MCP servers
- `POST /servers` — register a server
- `POST /servers/{server_id}/start` — start a server
- `POST /servers/{server_id}/stop` — stop a server
- `POST /servers/{server_id}/restart` — restart a server
- `DELETE /servers/{server_id}` — remove a server
- `GET /servers/enabled` — list enabled servers
- `GET /servers/{server_id}/enabled` — check whether a server is enabled

### Health & Monitoring

#### GET /health

Health check endpoint.

#### GET /version

Service version information.

#### GET /metrics

Prometheus-compatible HTTP metrics (text format), exposed via
`prometheus-fastapi-instrumentator`.

---

## Cloud MCP Credentials

The cloud MCPs authenticate with a single shared credential set (no per-user
token exchange). Credentials reach each MCP subprocess two ways:

1. **`config.env` merge** — each cloud MCP's env block in
   `mcp_manager.initialize_servers` is built from `os.getenv(...)` and merged
   into the spawned subprocess env (see the NIST 800-53 SC-4 filtered child-process
   env in `src/mcp_manager.py`).
2. **Read-only host CLI mounts** — `~/.azure`, `~/.aws`, `~/.config/gcloud`,
   `~/.kube` are mounted read-only so the SDKs (`az`, `boto3`, `google-auth`)
   pick up their default credential chains.

| Provider | Credential model | Env |
|----------|------------------|-----|
| **Azure** | Service principal | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SUBSCRIPTION_ID` |
| **AWS** | Static keypair | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| **GCP** | Service account / ADC | `GCP_PROJECT_ID`, `GCP_CREDENTIALS_JSON`, `GCP_CREDENTIALS_FILE` |

The Azure service principal also backs the SP-based Azure cost dashboards.

---

## Development

### Project Structure

```
openagentic-mcp-proxy/
├── src/
│   ├── main.py                    # FastAPI application + routes + auth resolution
│   ├── mcp_manager.py             # MCP lifecycle management
│   ├── tool_indexer.py            # Tool discovery & indexing
│   ├── tool_search.py             # Semantic tool search
│   ├── tools/
│   │   └── formatting_instructions.py
│   └── static/
│       └── index.html             # MCP Inspector UI
├── tests/
│   ├── conftest.py
│   ├── test_auth_hardening.py
│   ├── test_jwt_auth.py
│   └── test_tool_search.py
├── requirements.txt               # Python dependencies
├── requirements-dev.txt           # Dev/test dependencies
├── pytest.ini                     # Pytest configuration
├── Dockerfile                     # Docker image
└── README.md                      # This file
```

### Running Tests

```bash
# Unit tests
pytest tests/ -v

# Integration tests
pytest tests/integration/ -v

# Coverage
pytest --cov=src tests/
```

### Adding a New MCP Server

Built-in MCP servers are registered programmatically in
`MCPManager.initialize_servers` (`src/mcp_manager.py`).

1. **Create the MCP server** (Node.js or Python — see `services/mcps/*`).
2. **Register it in `initialize_servers`**, gated behind a disable env var, e.g.:
   ```python
   if not os.getenv("OpenAgentic_MY_NEW_MCP_DISABLED", "false").lower() == "true":
       self.servers["openagentic_my_new"] = MCPServer(MCPServerConfig(
           name="openagentic_my_new",
           command=["fastmcp", "run", "-t", "stdio", "/app/mcp-servers/oap-my-new-mcp/server.py"],
           env={"LOG_LEVEL": "info"},
       ))
   ```
3. **Restart the MCP Proxy** so the new server is spawned and indexed.

---

## Deployment

### Docker Compose

```yaml
services:
  mcp-proxy:
    image: mcp-proxy:latest
    ports:
      - "8080:8080"
    environment:
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://user:pass@postgres:5432/db
      - AZURE_TENANT_ID=${AZURE_TENANT_ID}
      - AZURE_CLIENT_ID=${AZURE_CLIENT_ID}
      - AZURE_CLIENT_SECRET=${AZURE_CLIENT_SECRET}
    depends_on:
      - redis
      - postgres
    volumes:
      - ./mcp-servers:/app/mcp-servers
    restart: unless-stopped
```

### Kubernetes

See the platform Helm chart at [helm/openagentic/](../../helm/openagentic/) for the full Kubernetes manifests.

**Key Resources** (see `helm/openagentic/templates/mcp-proxy.yaml` and `mcp-proxy-rbac.yaml`):
- **Deployment**: spawns the proxy and its built-in MCP subprocesses
- **Service**: ClusterIP, port 8080
- **ServiceAccount + ClusterRole + ClusterRoleBinding**: in-cluster RBAC for the kubernetes MCP
- **Secrets**: configuration is loaded from the `openagentic-secrets` secret

---

## Monitoring

The proxy exposes Prometheus-compatible HTTP metrics at `GET /metrics` via
`prometheus-fastapi-instrumentator` (request counts, latencies, and status codes
per route). Liveness/health is reported by `GET /health`, and version by
`GET /version`. Build alerts and dashboards on top of these standard HTTP and
process metrics.

---

## Troubleshooting

### MCP Server Won't Start

**Symptoms:**
- `GET /health` shows server status as "down"
- Logs show "Failed to start MCP server"

**Solutions:**
1. Check the proxy logs for the failing server name
2. Verify the runtime is installed (`fastmcp`/`python` for Python MCPs, `node`/`npx` for Node MCPs)
3. Check the MCP server file exists, e.g. `ls /app/mcp-servers/oap-admin-mcp/server.py`
4. Verify environment variables are set correctly
5. Confirm the server is not disabled via its `*_MCP_DISABLED` toggle

### Cloud MCP Authentication Failing

**Symptoms:**
- Azure/AWS/GCP tool calls return auth errors
- Cloud MCP tools not available

**Solutions:**
1. Verify the cloud credentials are set: Azure (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SUBSCRIPTION_ID`), AWS (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), GCP (`GCP_PROJECT_ID`, `GCP_CREDENTIALS_JSON`)
2. Check the read-only host CLI mounts exist (`~/.azure`, `~/.aws`, `~/.config/gcloud`)
3. Verify the service principal / keypair / service account has the required RBAC
4. Check MCP Proxy logs for the failing cloud MCP subprocess
5. Check Redis connection: `redis-cli ping`

### Tool Execution Timeout

**Symptoms:**
- `POST /call` times out
- Tool shows as "in_progress" indefinitely

**Solutions:**
1. Check the MCP server logs for errors
2. Check Redis connectivity
3. Verify the tool parameters are valid
4. Check the underlying service (Azure API, etc.) is responsive

### Inter-service Auth Rejected (401)

**Symptoms:**
- The api's tool calls to the proxy return 401
- Logs show "internal token verification unavailable" or "System token verification failed"

**Solutions:**
1. Confirm `JWT_SECRET` / `SIGNING_SECRET` match between the api and the proxy
2. Confirm `INTERNAL_SERVICE_SECRET` matches (used for the `oa_sys_` HMAC)
3. Confirm `INTERNAL_API_KEY` matches the api's `API_INTERNAL_KEY`
4. Verify none of the signing keys are a `dev-secret*` placeholder (boot fails closed)

---

## Contributing

### Development Workflow

1. Fork repository
2. Create feature branch: `git checkout -b feature/my-new-feature`
3. Make changes
4. Run tests: `pytest tests/`
5. Run linter: `black src/ && flake8 src/`
6. Commit: `git commit -m "feat: add new feature"`
7. Push: `git push origin feature/my-new-feature`
8. Create pull request

### Code Style

- **Python**: Black formatter, Flake8 linter
- **Type Hints**: Required for all functions
- **Docstrings**: Google-style docstrings
- **Tests**: Minimum 80% coverage

---

## License

Apache-2.0 License — see [LICENSE](../../LICENSE)

---

## Support

- **Issues**: https://github.com/agentic-work/openagentic/issues
- **Email**: hello@agenticwork.io
