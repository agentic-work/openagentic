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
│ • Memory     │     │ • User1      │     │ • Azure Cost │
│ • Admin      │     │   Azure MCP  │     │ • AWS MCP    │
│ • Background │     │ • User2      │     │              │
│ • Formatting │     │   Azure MCP  │     │              │
│ • Fetch      │     │ • User3      │     │              │
│              │     │   Azure MCP  │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
```

### Component Responsibilities

| Component | File | Purpose |
|-----------|------|---------|
| **Main Application** | `src/main.py` | FastAPI app, routes, WebSocket handling |
| **MCP Manager** | `src/mcp_manager.py` | MCP lifecycle, process management, health |
| **Session Manager** | `src/user_session_manager.py` | User session isolation, Redis tracking |
| **OAuth Manager** | `src/azure_oauth.py` | Azure AD OAuth, token refresh |
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

MCP Proxy continuously monitors MCP server health:

```python
# Health check every 30 seconds
if mcp_process.poll() is not None:
    log.error(f"MCP {server_id} crashed, restarting...")
    restart_mcp(server_id)
    notify_admin(server_id, "auto_recovered")
```

**Health Checks:**
- Process alive check
- Response time monitoring
- Error rate tracking
- Resource usage monitoring

### 4. Tool Discovery & Registry

All MCP tools indexed in Redis for fast discovery:

```json
{
  "tool_id": "admin_mcp.get_user_analytics",
  "server_id": "admin-mcp",
  "name": "get_user_analytics",
  "description": "Retrieve user activity analytics",
  "parameters": {
    "user_id": "string",
    "start_date": "string",
    "end_date": "string"
  },
  "category": "analytics",
  "last_updated": "2025-01-13T10:30:00Z"
}
```

**Tool Discovery API:**
- List all tools: `GET /tools/list`
- Search tools: `GET /tools/search?q=analytics`
- Get tool details: `GET /tools/{tool_id}`

### 5. Metrics & Observability

Prometheus metrics exposed at `/metrics`:

```
# MCP Server Metrics
mcp_server_status{server_id="admin-mcp"} 1
mcp_server_uptime_seconds{server_id="admin-mcp"} 3600
mcp_server_restarts_total{server_id="admin-mcp"} 0

# Tool Execution Metrics
mcp_tool_executions_total{tool_id="admin_mcp.get_users",status="success"} 150
mcp_tool_execution_duration_seconds{tool_id="admin_mcp.get_users"} 0.320

# Session Metrics
mcp_user_sessions_active 12
mcp_user_sessions_created_total 156
mcp_user_sessions_destroyed_total 144

# OAuth Metrics
mcp_oauth_token_refreshes_total{provider="azure"} 45
mcp_oauth_token_refresh_failures_total{provider="azure"} 2
```

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
git clone https://github.com/your-org/openagentic.git
cd openagentic/services/mcp-proxy

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
helm install openagentic ./helm/openagenticchat-v3 \
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

# MCP Server Configuration
ADMIN_MCP_DISABLED=false
MEMORY_MCP_DISABLED=false
BACKGROUND_SERVICE_MCP_DISABLED=false
FORMATTING_MCP_DISABLED=false
FETCH_MCP_DISABLED=false
AZURE_COST_MCP_DISABLED=false

# User MCP Configuration
USER_AZURE_MCP_ENABLED=true
USER_AZURE_MCP_TIMEOUT=3600  # Session timeout in seconds

# Health Check Configuration
HEALTH_CHECK_INTERVAL=30  # Seconds
AUTO_RESTART_ENABLED=true
MAX_RESTART_ATTEMPTS=3
```

### MCP Server Configuration

MCPs can be configured via config files or environment variables:

```json
// config/mcps.json
{
  "servers": [
    {
      "id": "admin-mcp",
      "type": "node",
      "command": "node",
      "args": ["/app/mcp-servers/admin-mcp/dist/index.js"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}",
        "REDIS_URL": "${REDIS_URL}"
      },
      "enabled": true,
      "shared": true  // Shared across all users
    },
    {
      "id": "user-azure-mcp",
      "type": "node",
      "command": "node",
      "args": ["/app/mcp-servers/azure-mcp/dist/index.js"],
      "env": {
        "AZURE_TENANT_ID": "${AZURE_TENANT_ID}"
      },
      "enabled": true,
      "shared": false,  // Per-user instances
      "oauth_required": true,
      "oauth_provider": "azure"
    }
  ]
}
```

---

## API Reference

### Tool Execution

#### POST /tools/call

Execute an MCP tool.

**Request:**
```json
{
  "tool_id": "admin_mcp.get_users",
  "parameters": {
    "limit": 10,
    "offset": 0
  },
  "user_id": "user-123",
  "session_id": "session-456"
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "users": [...],
    "total": 50
  },
  "execution_time_ms": 320,
  "tool_id": "admin_mcp.get_users",
  "timestamp": "2025-01-13T10:30:00Z"
}
```

#### GET /tools/list

List all available tools.

**Query Parameters:**
- `server_id` (optional) - Filter by MCP server
- `category` (optional) - Filter by category
- `search` (optional) - Search tool names/descriptions

**Response:**
```json
{
  "tools": [
    {
      "tool_id": "admin_mcp.get_users",
      "server_id": "admin-mcp",
      "name": "get_users",
      "description": "Retrieve list of users",
      "parameters": {...},
      "category": "user_management"
    }
  ],
  "total": 25,
  "page": 1,
  "page_size": 50
}
```

### Session Management

#### POST /sessions/start

Start a user MCP session.

**Request:**
```json
{
  "user_id": "user-123",
  "oauth_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "provider": "azure",
  "mcp_servers": ["user-azure-mcp"]
}
```

**Response:**
```json
{
  "session_id": "session-456",
  "user_id": "user-123",
  "mcp_servers": ["user-azure-mcp"],
  "created_at": "2025-01-13T10:30:00Z",
  "expires_at": "2025-01-13T11:30:00Z"
}
```

#### DELETE /sessions/{user_id}

Stop user's MCP session.

**Response:**
```json
{
  "success": true,
  "user_id": "user-123",
  "servers_stopped": ["user-azure-mcp"],
  "stopped_at": "2025-01-13T10:45:00Z"
}
```

### Health & Monitoring

#### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime_seconds": 3600,
  "mcp_servers": {
    "admin-mcp": "healthy",
    "memory-mcp": "healthy"
  },
  "redis": "connected",
  "database": "connected"
}
```

#### GET /metrics

Prometheus metrics (text format).

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
    API->>MCPProxy: POST /sessions/start
    MCPProxy->>Redis: Store session
    MCPProxy->>MCPServer: Start user's Azure MCP
    MCPServer->>MCPServer: Initialize with OAuth token
    MCPProxy->>API: Session created

    User->>API: Execute Azure tool
    API->>MCPProxy: POST /tools/call
    MCPProxy->>MCPServer: Route to user's MCP
    MCPServer->>Azure: Use user's OAuth token
    Azure->>MCPServer: Azure resources
    MCPServer->>MCPProxy: Tool result
    MCPProxy->>API: Result
    API->>User: Display result

    User->>API: Logout
    API->>MCPProxy: DELETE /sessions/{user_id}
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
class AzureOAuthManager:
    def __init__(self, tenant_id, client_id, client_secret):
        self.msal_app = msal.ConfidentialClientApplication(
            client_id,
            authority=f"https://login.microsoftonline.com/{tenant_id}",
            client_credential=client_secret
        )

    async def refresh_token(self, refresh_token: str):
        """Refresh OAuth token before expiry"""
        result = self.msal_app.acquire_token_by_refresh_token(
            refresh_token,
            scopes=["https://management.azure.com/.default"]
        )
        return result["access_token"]

    async def validate_token(self, token: str) -> bool:
        """Validate OAuth token"""
        # Decode JWT, check expiry, verify signature
        ...
```

### Token Refresh Strategy

```python
# Background task runs every 5 minutes
@repeat_every(seconds=300)
async def refresh_expiring_tokens():
    """Refresh tokens expiring in next 10 minutes"""
    sessions = await get_sessions_with_expiring_tokens(buffer_minutes=10)

    for session in sessions:
        try:
            new_token = await oauth_manager.refresh_token(
                session["refresh_token"]
            )
            await update_session_token(session["user_id"], new_token)
            logger.info(f"Refreshed token for user {session['user_id']}")
        except Exception as e:
            logger.error(f"Failed to refresh token: {e}")
            await notify_user_token_expired(session["user_id"])
```

---

## Development

### Project Structure

```
mcp-proxy/
├── src/
│   ├── main.py                    # FastAPI application
│   ├── mcp_manager.py             # MCP lifecycle management
│   ├── user_session_manager.py    # User session isolation
│   ├── azure_oauth.py             # Azure OAuth integration
│   ├── tool_registry.py           # Tool discovery & indexing
│   ├── health_monitor.py          # Health checks & recovery
│   ├── metrics.py                 # Prometheus metrics
│   └── static/
│       └── index.html             # MCP Inspector UI
├── config/
│   └── mcps.json                  # MCP server configuration
├── tests/
│   ├── test_mcp_manager.py
│   ├── test_session_manager.py
│   └── test_oauth.py
├── requirements.txt               # Python dependencies
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

1. **Create MCP server** (Node.js or Python)
2. **Add to config/mcps.json:**
   ```json
   {
     "id": "my-new-mcp",
     "type": "node",
     "command": "node",
     "args": ["/app/mcp-servers/my-new-mcp/dist/index.js"],
     "enabled": true,
     "shared": true
   }
   ```
3. **Add enable/disable env var:**
   ```bash
   MY_NEW_MCP_DISABLED=false
   ```
4. **Update MCP Manager** (`src/mcp_manager.py`)
5. **Restart MCP Proxy**

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

See [helm/openagenticchat-v3/templates/mcp-proxy/](../../helm/openagenticchat-v3/templates/mcp-proxy/) for full Kubernetes manifests.

**Key Resources:**
- **Deployment**: 2 replicas, rolling update strategy
- **Service**: ClusterIP, port 8080
- **HPA**: Auto-scale 2-10 replicas based on CPU/memory
- **ConfigMap**: MCP server configuration
- **Secrets**: OAuth credentials, Redis password

---

## Monitoring

### Grafana Dashboard

Import dashboard from `observability/dashboards/mcp-proxy-dashboard.json`:

**Panels:**
- MCP Server Status (up/down)
- Tool Execution Rate
- Tool Execution Duration (p50, p95, p99)
- User Session Count
- OAuth Token Refresh Rate
- Error Rate by MCP Server

### Alerts

Recommended Prometheus alerts:

```yaml
groups:
  - name: mcp_proxy
    rules:
      - alert: MCPServerDown
        expr: mcp_server_status == 0
        for: 2m
        annotations:
          summary: "MCP server {{ $labels.server_id }} is down"

      - alert: HighToolExecutionErrors
        expr: rate(mcp_tool_executions_total{status="error"}[5m]) > 0.1
        for: 5m
        annotations:
          summary: "High error rate for tool {{ $labels.tool_id }}"

      - alert: OAuthTokenRefreshFailures
        expr: rate(mcp_oauth_token_refresh_failures_total[10m]) > 0
        for: 5m
        annotations:
          summary: "OAuth token refresh failing for {{ $labels.provider }}"
```

---

## Troubleshooting

### MCP Server Won't Start

**Symptoms:**
- `GET /health` shows server status as "down"
- Logs show "Failed to start MCP server"

**Solutions:**
1. Check MCP server logs: `docker logs mcp-proxy | grep "mcp-server-id"`
2. Verify Node.js installed: `node --version`
3. Check MCP server file exists: `ls /app/mcp-servers/admin-mcp/dist/index.js`
4. Verify environment variables set correctly
5. Try manual start: `node /app/mcp-servers/admin-mcp/dist/index.js`

### User Session Not Creating

**Symptoms:**
- `POST /sessions/start` returns 500 error
- User's Azure MCP tools not available

**Solutions:**
1. Check OAuth token valid: Decode JWT, verify expiry
2. Check Redis connection: `redis-cli ping`
3. Verify Azure credentials: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
4. Check MCP Proxy logs for OAuth errors
5. Verify user has Azure RBAC permissions

### Tool Execution Timeout

**Symptoms:**
- `POST /tools/call` times out after 30 seconds
- Tool shows as "in_progress" indefinitely

**Solutions:**
1. Check MCP server logs for errors
2. Increase timeout: `TOOL_EXECUTION_TIMEOUT=60`
3. Check Redis connectivity
4. Verify tool parameters are valid
5. Check underlying service (Azure API, etc.) is responsive

### OAuth Token Refresh Failing

**Symptoms:**
- Logs show "Failed to refresh OAuth token"
- User's Azure tools stop working after 1 hour

**Solutions:**
1. Verify refresh token is being stored
2. Check Azure AD app registration has offline_access scope
3. Verify Azure AD credentials are correct
4. Check token refresh background task is running
5. Review Azure AD audit logs for errors

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

MIT License - see [LICENSE](../../LICENSE)

---

## Support

- **Documentation**: https://docs.openagentic.io/mcp-proxy
- **Issues**: https://github.com/your-org/openagentic/issues
- **Slack**: #mcp-proxy-dev
- **Email**: mcp-proxy-team@openagentic.io

---

**Version**: 1.0.0
**Last Updated**: 2025-01-13
**Maintainers**: MCP Team
