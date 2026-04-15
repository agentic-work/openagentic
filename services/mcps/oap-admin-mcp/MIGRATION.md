# Admin MCP Migration Guide

## Overview

This document describes the migration from the TypeScript admin-mcp to the Python FastMCP implementation.

## What Changed

### Technology Stack

| Component | Old (TypeScript) | New (Python) |
|-----------|-----------------|--------------|
| Framework | @modelcontextprotocol/sdk | FastMCP |
| Language | TypeScript/Node.js | Python 3.11+ |
| Database Client | Prisma TypeScript | Prisma Python |
| Redis Client | ioredis | redis-py |
| Milvus Client | @zilliz/milvus2-sdk-node | pymilvus |
| Location | services/mcps/admin-mcp | services/mcps/admin-mcp-python |

### Architecture Changes

#### 1. Auth Model

**Old (TypeScript)**:
- Auth validation embedded in each tool handler
- User context extracted from request metadata
- Mixed admin checking logic

**New (Python)**:
- Auth validation delegated to MCP proxy
- Server assumes user is admin (validated upstream)
- Defense-in-depth validation available but optional
- Cleaner separation of concerns

#### 2. Tool Registration

**Old (TypeScript)**:
```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'admin_system_postgres_raw_query',
        description: '...',
        inputSchema: {...}
      },
      // ... more tools
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  switch (name) {
    case 'admin_system_postgres_raw_query':
      return await dbQuery(args);
    // ... more cases
  }
});
```

**New (Python)**:
```python
@mcp.tool(description="...")
async def admin_system_postgres_raw_query(
    query: str,
    params: Optional[List[str]] = None
) -> Dict[str, Any]:
    # Implementation
    return result
```

#### 3. Module Organization

**Old (TypeScript)**:
- Single monolithic file: `src/index.ts` (2400+ lines)
- All tools in one file
- Difficult to maintain and test

**New (Python)**:
- Modular structure:
  - `server.py` - Core server, PostgreSQL, Redis, Milvus tools
  - `user_tools.py` - User management tools
  - `audit_tools.py` - Audit log query tools
- Each module is independently testable
- Better code organization

#### 4. Database Access

**Old (TypeScript)**:
```typescript
const prisma = new PrismaClient();
const result = await prisma.$queryRawUnsafe(query, ...params);
```

**New (Python)**:
```python
prisma_client = Prisma()
await prisma_client.connect()
result = await prisma_client.query_raw(query, *params)
```

### Tool Compatibility

All tools from the TypeScript implementation have been migrated with the same names and schemas:

#### PostgreSQL Tools
- ✅ `admin_system_postgres_raw_query`
- ✅ `admin_system_postgres_list_tables`
- ✅ `admin_system_postgres_health_check`

#### Redis Tools
- ✅ `admin_system_redis_get_key`
- ✅ `admin_system_redis_set_key`
- ✅ `admin_system_redis_delete_keys`
- ✅ `admin_system_redis_list_keys_by_pattern`
- ✅ `admin_system_redis_clear_cache_by_pattern`
- ✅ `admin_system_redis_health_check`

#### Milvus Tools
- ✅ `admin_system_milvus_list_collections`
- ✅ `admin_system_milvus_get_collection_info`
- ✅ `admin_system_milvus_health_check`

#### User Management Tools
- ✅ `admin_system_users_list_all`
- ✅ `admin_system_users_get_by_id`
- ✅ `admin_system_users_update_properties`

#### Audit Log Tools
- ✅ `admin_audit_get_user_activity`
- ✅ `admin_audit_get_user_chats`
- ✅ `admin_audit_get_login_history`
- ✅ `admin_audit_get_error_analysis`
- ✅ `admin_audit_get_usage_statistics`

#### System Health Tools
- ✅ `admin_system_infrastructure_health_check`

#### Comprehensive Test Tool
- ⚠️ `admin_platform_comprehensive_test` - **NOT YET MIGRATED**
  - This tool requires HTTP client access to other services
  - Will be added in a future update

## Deployment Changes

### MCP Manager Configuration

**File**: `services/mcp-proxy/src/mcp_manager.py`

**Old**:
```python
self.servers["admin"] = MCPServer(MCPServerConfig(
    name="admin",
    command=["node", "/app/mcp-servers/admin-mcp/dist/index.js"],
    env=admin_env
))
```

**New**:
```python
self.servers["admin"] = MCPServer(MCPServerConfig(
    name="admin",
    command=["python", "-m", "admin_mcp_server.server"],
    env=admin_env
))
```

### Environment Variables

No changes to environment variables - the Python implementation uses the same configuration:

```env
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
REDIS_HOST=...
REDIS_PORT=...
MILVUS_HOST=...
MILVUS_PORT=...
LOG_LEVEL=info
```

### Docker Build

The Python implementation includes its own Dockerfile for containerized deployment:

```dockerfile
FROM python:3.11-slim
# ... (see Dockerfile)
CMD ["python", "-m", "admin_mcp_server.server"]
```

## Testing the Migration

### 1. Verify Server Starts

```bash
cd /app/mcp-servers/admin-mcp-python
python -m admin_mcp_server.server
```

Expected output:
```
================================================================================
Starting Admin MCP Server (FastMCP)
ADMIN USERS ONLY - Non-admin users will be rejected
================================================================================
✅ Redis connected successfully
✅ Milvus connected successfully
✅ Prisma (PostgreSQL) connected successfully
✅ Tool modules loaded successfully
✅ Admin MCP Server ready - waiting for requests
```

### 2. Test Tool Discovery

Via MCP Proxy:
```bash
curl http://mcp-proxy:8080/servers/admin/tools
```

Should return all admin tools with correct schemas.

### 3. Test Admin Access Control

**As Admin User**:
```bash
# Should work
curl -X POST http://mcp-proxy:8080/mcp/tool \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "server": "admin",
    "tool": "admin_system_redis_health_check",
    "arguments": {}
  }'
```

**As Non-Admin User**:
```bash
# Should be rejected with 403
curl -X POST http://mcp-proxy:8080/mcp/tool \
  -H "Authorization: Bearer <user-token>" \
  -d '{
    "server": "admin",
    "tool": "admin_system_redis_health_check",
    "arguments": {}
  }'
```

Expected: HTTP 403 with message: "Access denied. Admin privileges required to access 'admin' server."

### 4. Test Tool Execution

Test each category:

```python
# PostgreSQL
admin_system_postgres_health_check()

# Redis
admin_system_redis_health_check()

# Milvus
admin_system_milvus_health_check()

# Users
admin_system_users_list_all(limit=5)

# Audit
admin_audit_get_usage_statistics(top_n=10)

# System
admin_system_infrastructure_health_check()
```

## Rollback Plan

If issues are discovered after deployment:

### Option 1: Revert MCP Manager Config

```python
# In mcp_manager.py, revert to:
self.servers["admin"] = MCPServer(MCPServerConfig(
    name="admin",
    command=["node", "/app/mcp-servers/admin-mcp/dist/index.js"],
    env=admin_env
))
```

Restart mcp-proxy service.

### Option 2: Disable Admin MCP

```env
ADMIN_MCP_DISABLED=true
```

Restart mcp-proxy service.

## Benefits of Migration

### 1. Maintainability
- **Modular code structure** - easier to find and update tools
- **Type safety** - Python type hints + Pydantic validation
- **Cleaner codebase** - 3 files instead of 1 monolithic file

### 2. Performance
- **Async by default** - FastMCP uses asyncio throughout
- **Better connection pooling** - Prisma Python client optimizations
- **Reduced memory footprint** - Python uses less memory than Node.js for this use case

### 3. Developer Experience
- **Decorator-based tools** - simpler tool registration
- **Better error messages** - FastMCP provides clearer error handling
- **Easier testing** - Each tool module can be tested independently

### 4. Security
- **Clearer auth model** - Admin validation at proxy layer
- **Defense in depth** - Optional secondary validation in server
- **Better audit trails** - Structured logging with user context

## Known Issues

### 1. Comprehensive Platform Test
The `admin_platform_comprehensive_test` tool has not yet been migrated. This tool requires:
- HTTP client access to MCP proxy
- Complex coordination with other services
- Will be added in a future update

### 2. Prisma Python Limitations
Some Prisma TypeScript features are not available in Python:
- `queryRawUnsafe` → `query_raw` (requires positional params)
- Some advanced type transformations may differ

Workarounds have been implemented where necessary.

## Future Enhancements

1. **Add Comprehensive Test Tool** - Migrate the platform test tool
2. **Enhanced Metrics** - Add Prometheus metrics for tool execution
3. **Rate Limiting** - Add per-user rate limits for destructive operations
4. **Audit Trail** - Enhanced audit logging with user context
5. **Tool Permissions** - Fine-grained tool-level permissions

## Questions or Issues?

Contact the platform team if you encounter any issues during or after the migration.
