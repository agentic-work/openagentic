# MCP Proxy Service

**Centralized MCP Server Manager with User Session Isolation**

The MCP Proxy is a Python FastAPI service that manages Model Context Protocol (MCP) servers, providing user session isolation, OAuth token management, and centralized tool execution.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [User Session Management](#user-session-management)
- [OAuth Integration](#oauth-integration)
- [Development](#development)
- [Deployment](#deployment)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

---

## Overview

The MCP Proxy service acts as a centralized gateway for all MCP (Model Context Protocol) servers in the OpenAgentic platform. It provides:

- **Lifecycle Management**: Start, stop, restart, and monitor MCP servers
- **User Session Isolation**: Per-user MCP instances for secure multi-tenancy
- **OAuth Integration**: Automatic token management for Azure and other cloud MCPs
- **Tool Discovery**: Centralized registry of all available MCP tools
- **Health Monitoring**: Automatic health checks and recovery
- **Metrics**: Prometheus-compatible metrics for observability

### Why MCP Proxy?

The dedicated MCP Proxy provides centralized MCP management:

1. **Clear Separation**: MCP management separate from LLM integration
2. **User Isolation**: Each user gets their own MCP instances
3. **OAuth at Scale**: Per-user cloud credentials, not shared service principals
4. **Better Monitoring**: Dedicated metrics and health checks
5. **Flexibility**: Easy to add new MCP servers without touching LLM code

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Proxy Service                        │
│                      (Python FastAPI)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │   MCP Manager   │  │ Session Manager  │  │  OAuth Manager │ │
│  │                 │  │                  │  │                │ │
│  │ • Start/Stop    │  │ • User Sessions  │  │ • Token Mgmt   │ │
│  │ • Health Check  │  │ • Isolation      │  │ • Auto Refresh │ │
│  │ • Recovery      │  │ • Redis Tracking │  │ • Encryption   │ │
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
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ System MCPs  │     │  User MCPs   │     │   Cloud MCPs │
│              │     │              │     │              │
│ • admin      │     │ • User1      │     │ • aws        │
│ • web        │     │   Azure MCP  │     │ • azure      │
│ • github     │     │ • User2      │     │ • gcp        │
│ • kubernetes │     │   Azure MCP  │     │              │
│ • prometheus │     │ • User3      │     │              │
│ • loki       │     │   Azure MCP  │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
```

The wired built-in MCP servers (see `src/mcp_manager.py` `initialize_servers`) are: **aws, azure, gcp, kubernetes, prometheus, loki, github, admin, web** (9). Azure runs as per-user instances with OBO tokens; the rest are system-level.

### Component Responsibilities

| Component | File | Purpose |
|-----------|------|---------|
| **Main Application** | `src/main.py` | FastAPI app, routes, tool execution |
| **MCP Manager** | `src/mcp_manager.py` | MCP lifecycle, process management, health |
| **Session Manager** | `src/user_session_manager.py` | Per-user Azure MCP session isolation |
| **OAuth Manager** | `src/azure_oauth.py` | Azure AD OAuth |
| **OBO Strategy** | `src/azure_obo_strategy.py` | Azure AD on-behalf-of token exchange |
| **Tool Indexer** | `src/tool_indexer.py` | Tool discovery & indexing |
| **Tool Search** | `src/tool_search.py` | Semantic tool search |
| **Static UI** | `src/static/index.html` | Web-based MCP inspector |

---

## Features

### 1. User Session Isolation

Each user gets their own isolated MCP instances:

```python
# User1 requests Azure VM list
# → MCP Proxy creates User1's Azure MCP with User1's OAuth token
# → User1 sees only their VMs

# User2 requests Azure VM list
# → MCP Proxy creates User2's Azure MCP with User2's OAuth token
# → User2 sees only their VMs
```

**Benefits:**
- No shared credentials
- Azure RBAC respected per user
- Audit trail per user
- Compliance-friendly

### 2. OAuth Token Management

Automatic OAuth token lifecycle:

1. User authenticates → API sends OAuth token to MCP Proxy
2. MCP Proxy creates user session with encrypted token
3. Token used for all user's Azure MCP operations
4. Automatic token refresh before expiry
5. Session cleanup on logout/timeout

**Supported OAuth Providers:**
- Azure AD (Microsoft Identity Platform)
- AWS Cognito (planned)
- Google OAuth (planned)

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

# Azure OAuth Configuration
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_REDIRECT_URI=http://localhost:3000/auth/callback

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

The Azure MCP runs as a per-user instance with OBO authentication
(see `src/user_session_manager.py`); the AWS and admin MCPs can also be attached
as remote HTTP servers via their respective `*_MCP_URL` env vars.

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

### User Session Management

#### POST /user-sessions/start

Start a per-user Azure MCP session with OBO authentication.

**Request:**
```json
{
  "user_id": "user-123",
  "email": "user@example.com",
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}
```

#### POST /user-sessions/stop

Stop a user's MCP session.

**Request:**
```json
{
  "user_id": "user-123"
}
```

#### GET /user-sessions

List all active user sessions.

#### GET /user-sessions/{user_id}

Get a specific user's session info, including their per-user Azure MCP tools.

### Health & Monitoring

#### GET /health

Health check endpoint.

#### GET /version

Service version information.

#### GET /metrics

Prometheus-compatible HTTP metrics (text format), exposed via
`prometheus-fastapi-instrumentator`.

---

## User Session Management

### Session Lifecycle

```mermaid
sequenceDiagram
    participant User
    participant API
    participant MCPProxy
    participant Azure
    participant MCPServer

    User->>API: Login (Azure AD)
    API->>Azure: OAuth request
    Azure->>API: OAuth token
    API->>MCPProxy: POST /user-sessions/start
    MCPProxy->>Redis: Store session
    MCPProxy->>MCPServer: Start user's Azure MCP
    MCPServer->>MCPServer: Initialize with OAuth token
    MCPProxy->>API: Session created

    User->>API: Execute Azure tool
    API->>MCPProxy: POST /call
    MCPProxy->>MCPServer: Route to user's MCP
    MCPServer->>Azure: Use user's OAuth token
    Azure->>MCPServer: Azure resources
    MCPServer->>MCPProxy: Tool result
    MCPProxy->>API: Result
    API->>User: Display result

    User->>API: Logout
    API->>MCPProxy: POST /user-sessions/stop
    MCPProxy->>MCPServer: Stop user's MCP
    MCPProxy->>Redis: Delete session
    MCPProxy->>API: Session destroyed
```

### Session Storage (Redis)

```python
# Redis key structure
mcp:session:{user_id} = {
    "session_id": "session-456",
    "user_id": "user-123",
    "oauth_token_encrypted": "...",
    "mcp_servers": ["user-azure-mcp"],
    "created_at": "2025-01-13T10:30:00Z",
    "expires_at": "2025-01-13T11:30:00Z",
    "last_activity": "2025-01-13T10:35:00Z"
}

# TTL set to session expiry
TTL mcp:session:user-123 → 3600 seconds
```

---

## OAuth Integration

### Azure AD OAuth Flow

```python
# 1. User authenticates via Azure AD (handled by API)
# 2. API receives OAuth token
# 3. API sends token to MCP Proxy

# In MCP Proxy (src/azure_oauth.py):
class AzureOAuthService:
    def __init__(self, redis_client: redis.Redis):
        # tenant_id / client_id / client_secret are read from the environment
        self.msal_app = msal.ConfidentialClientApplication(
            self.client_id,
            authority=self.authority,
            client_credential=self.client_secret,
        )

    def refresh_token(self, refresh_token: str) -> Dict[str, Any]:
        """Refresh an expired access token"""
        result = self.msal_app.acquire_token_by_refresh_token(
            refresh_token=refresh_token,
            scopes=self.scopes,
        )
        return {
            "access_token": result["access_token"],
            "refresh_token": result.get("refresh_token"),
            "expires_in": result.get("expires_in", 3600),
            "token_type": result.get("token_type", "Bearer"),
        }
```

On-behalf-of (OBO) token exchange for per-user cloud access lives in
`src/azure_obo_strategy.py`.

---

## Development

### Project Structure

```
openagentic-mcp-proxy/
├── src/
│   ├── main.py                    # FastAPI application + routes
│   ├── mcp_manager.py             # MCP lifecycle management
│   ├── user_session_manager.py    # Per-user Azure MCP session isolation
│   ├── azure_oauth.py             # Azure AD OAuth
│   ├── azure_obo_strategy.py      # Azure AD on-behalf-of token exchange
│   ├── tool_indexer.py            # Tool discovery & indexing
│   ├── tool_search.py             # Semantic tool search
│   ├── tools/
│   │   └── formatting_instructions.py
│   └── static/
│       └── index.html             # MCP Inspector UI
├── tests/
│   ├── conftest.py
│   ├── test_auth_hardening.py
│   ├── test_azure_obo_strategy.py
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

### User Session Not Creating

**Symptoms:**
- `POST /user-sessions/start` returns 500 error
- User's Azure MCP tools not available

**Solutions:**
1. Check OAuth token valid: Decode JWT, verify expiry
2. Check Redis connection: `redis-cli ping`
3. Verify Azure credentials: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
4. Check MCP Proxy logs for OAuth errors
5. Verify user has Azure RBAC permissions

### Tool Execution Timeout

**Symptoms:**
- `POST /call` times out
- Tool shows as "in_progress" indefinitely

**Solutions:**
1. Check the MCP server logs for errors
2. Check Redis connectivity
3. Verify the tool parameters are valid
4. Check the underlying service (Azure API, etc.) is responsive

### OAuth Token Refresh Failing

**Symptoms:**
- Logs show "Failed to refresh OAuth token"
- User's Azure tools stop working after 1 hour

**Solutions:**
1. Verify the refresh token is being stored
2. Check the Azure AD app registration has the `offline_access` scope
3. Verify the Azure AD credentials are correct
4. Review the Azure AD sign-in/audit logs for errors

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
