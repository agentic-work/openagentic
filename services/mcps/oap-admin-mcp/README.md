# Admin MCP Server (Python FastMCP)

A Model Context Protocol (MCP) server that provides complete infrastructure control for **ADMIN USERS ONLY** via standardized interfaces.

## Overview

This is the refactored Python implementation of the admin-mcp server using FastMCP. It replaces the previous TypeScript implementation with a more maintainable and extensible architecture.

### Key Features

- **Admin-Only Access**: All tools require admin privileges - enforced at the MCP proxy level
- **FastMCP Framework**: Modern Python MCP implementation with decorators and type safety
- **Auth Integration**: Seamless integration with the MCP proxy's RBAC system
- **User Context Passthrough**: Admin operations run as the authenticated admin user
- **Comprehensive Infrastructure Control**: PostgreSQL, Redis, Milvus, User Management, and Audit Logs

## Architecture

### Security Model

```
User Request → MCP Proxy (validates is_admin) → Admin MCP Server → Infrastructure
                    ↓
              [RBAC Check]
                    ↓
         Only admins proceed
```

1. **MCP Proxy Layer**: Validates user authentication and checks `is_admin` flag
2. **Server Layer**: Receives validated admin context and executes operations
3. **Defense in Depth**: Server includes additional admin validation as secondary check

### Auth Flow

The admin-mcp server receives user context from the MCP proxy:

```python
{
    "user_id": "admin-user-id",
    "user_name": "Admin User",
    "email": "admin@example.com",
    "is_admin": true,
    "groups": ["admin-group-id-1", "admin-group-id-2"]
}
```

Non-admin users are rejected at the proxy level and never reach this server.

## Tools

### PostgreSQL Tools

- `admin_system_postgres_raw_query` - Execute raw SQL queries
- `admin_system_postgres_list_tables` - List all database tables
- `admin_system_postgres_health_check` - Check database health

### Redis Tools

- `admin_system_redis_get_key` - Get value by key
- `admin_system_redis_set_key` - Set key-value with optional TTL
- `admin_system_redis_delete_keys` - Delete one or more keys
- `admin_system_redis_list_keys_by_pattern` - List keys matching pattern
- `admin_system_redis_clear_cache_by_pattern` - Clear cache by pattern
- `admin_system_redis_health_check` - Check Redis health

### Milvus Tools

- `admin_system_milvus_list_collections` - List all vector collections
- `admin_system_milvus_get_collection_info` - Get collection details
- `admin_system_milvus_health_check` - Check Milvus health

### User Management Tools

- `admin_system_users_list_all` - List all platform users
- `admin_system_users_get_by_id` - Get user details by ID
- `admin_system_users_update_properties` - Update user properties

### Audit Log Tools

- `admin_audit_get_user_activity` - Get detailed user activity logs
- `admin_audit_get_user_chats` - Get chat messages and interactions
- `admin_audit_get_login_history` - Get login/logout history
- `admin_audit_get_error_analysis` - Get error analysis and trends
- `admin_audit_get_usage_statistics` - Get usage statistics and analytics

### System Health Tools

- `admin_system_infrastructure_health_check` - Get overall system health

## Installation

### Requirements

- Python 3.10+
- Prisma (for PostgreSQL access)
- Redis
- Milvus

### Setup

```bash
cd /app/mcp-servers/admin-mcp-python

# Install dependencies
pip install -r requirements.txt

# Or use pyproject.toml
pip install -e .

# Generate Prisma client
prisma generate
```

### Environment Variables

```env
# PostgreSQL
DATABASE_URL=postgresql://user:password@host:5432/database

# Redis
REDIS_URL=redis://host:6379
# OR
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional

# Milvus
MILVUS_HOST=localhost
MILVUS_PORT=19530
MILVUS_USERNAME=optional
MILVUS_PASSWORD=optional

# Logging
LOG_LEVEL=info
```

## Usage

### Running Directly

```bash
python -m admin_mcp_server.server
```

### Running via MCP Proxy

The MCP proxy automatically starts this server and routes admin requests to it.

## Development

### Project Structure

```
oap-admin-mcp/
├── src/
│   └── admin_mcp_server/
│       ├── __init__.py          # Package initialization
│       ├── server.py            # Main server with FastMCP setup
│       ├── user_tools.py        # User management tools
│       └── audit_tools.py       # Audit log query tools
├── requirements.txt             # Python dependencies
├── pyproject.toml              # Project configuration
├── schema.prisma               # Prisma schema
└── README.md                   # This file
```

### Adding New Tools

1. Define tool using FastMCP decorator:

```python
from .server import mcp, prisma_client

@mcp.tool(description="Your tool description")
async def admin_your_tool(param1: str, param2: int = 10) -> Dict[str, Any]:
    """Your tool implementation"""
    # Tool logic here
    return {"success": True, "result": "..."}
```

2. Import the module in `server.py`:

```python
from . import your_tools
```

3. Tools are automatically registered with FastMCP when the module is imported.

### Testing

```bash
# Test individual tool
mcp dev admin_system_redis_health_check

# Test server
python -m admin_mcp_server.server
```

## Migration from TypeScript

This Python implementation replaces the previous TypeScript implementation at `services/mcps/admin-mcp/`.

### Key Differences

1. **Framework**: FastMCP (Python) instead of @modelcontextprotocol/sdk (TypeScript)
2. **Database Access**: Prisma Python client instead of Prisma TypeScript
3. **Auth Model**: Simplified - relies on proxy validation instead of embedding auth in server
4. **Modularity**: Tools split into separate modules for better organization

### Migration Guide

The MCP proxy configuration has been updated to use the Python implementation:

```python
# mcp_manager.py
self.servers["admin"] = MCPServer(MCPServerConfig(
    name="admin",
    command=["python", "-m", "admin_mcp_server.server"],
    env=admin_env
))
```

## Security Considerations

1. **Admin-Only Access**: This server should NEVER be accessible to non-admin users
2. **Proxy Enforcement**: The MCP proxy must validate `is_admin` before routing requests
3. **Defense in Depth**: Server includes secondary admin validation (optional)
4. **Audit Logging**: All operations should be logged via the MCP proxy
5. **Dangerous Operations**: Raw SQL queries and cache clearing require extreme caution

## License

Apache-2.0 — see the root [LICENSE](../../../LICENSE).
