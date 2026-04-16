# MCP Call Logging

This feature logs all Model Context Protocol (MCP) tool executions from the MCP Proxy service to the API database for analytics and auditing.

## Overview

The MCP Call Logging system provides:
- **Automatic logging** of all MCP tool calls
- **Fire-and-forget architecture** to avoid blocking tool execution
- **Comprehensive execution details** including parameters, results, and errors
- **Per-user tracking** for usage analytics
- **Performance metrics** including execution time
- **Batch logging support** for high-volume scenarios

## Architecture

```
┌─────────────────┐         ┌──────────────┐         ┌─────────────┐
│   MCP Proxy     │ ──────> │   API Logs   │ ──────> │  PostgreSQL │
│  (Python/FastAPI)│  HTTP   │   Endpoint   │  Write  │   Database  │
└─────────────────┘         └──────────────┘         └─────────────┘
     Background                  Fastify                  Prisma
      Task (async)               Route                   MCPUsage
```

### Components

1. **MCP Proxy** (`services/mcp-proxy/src/main.py`)
   - Executes MCP tool calls
   - Sends logs to API asynchronously using background tasks
   - Does not wait for log response (fire-and-forget)

2. **API Logs Endpoint** (`src/routes/mcp-logs.ts`)
   - Receives log data via HTTP POST
   - Validates and stores in database
   - Provides statistics endpoints

3. **Database** (PostgreSQL/Prisma)
   - Stores logs in `MCPUsage` table
   - Indexed for fast queries by user_id and timestamp

## Configuration

### MCP Proxy Configuration

Set the API base URL in MCP Proxy environment:

```bash
# In mcp-proxy .env or docker-compose
API_BASE_URL=http://openagenticchat-api:3000
```

**Default**: `http://openagenticchat-api:3000`

### No API Configuration Required

The API automatically exposes the logging endpoints. No additional configuration needed.

## API Endpoints

### Single Log Submission

```http
POST /api/mcp-logs
Content-Type: application/json
```

**Request Body:**
```json
{
  "user_id": "uuid-string",
  "instance_id": "uuid-string",
  "server_name": "admin-mcp",
  "tool_name": "get_user_stats",
  "method": "tools/call",
  "params": {
    "user_id": "123"
  },
  "result": {
    "total_messages": 100,
    "total_tokens": 50000
  },
  "error": null,
  "execution_time_ms": 45.3,
  "success": true,
  "timestamp": "2025-11-13T12:30:00.000Z"
}
```

**Response:**
```json
{
  "success": true,
  "id": "database-record-id"
}
```

### Batch Log Submission

For high-volume scenarios, submit multiple logs at once:

```http
POST /api/mcp-logs/batch
Content-Type: application/json
```

**Request Body:**
```json
{
  "logs": [
    {
      "user_id": "uuid-1",
      "server_name": "admin-mcp",
      "tool_name": "get_stats",
      "method": "tools/call",
      "execution_time_ms": 45,
      "success": true
    },
    {
      "user_id": "uuid-2",
      "server_name": "formatting-mcp",
      "tool_name": "format_code",
      "method": "tools/call",
      "execution_time_ms": 120,
      "success": true
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "inserted": 2,
  "failed": 0,
  "errors": []
}
```

### Get Statistics

```http
GET /api/mcp-logs/stats
```

**Optional Query Parameters:**
- `user_id` - Filter by specific user
- `tool_name` - Filter by specific tool
- `server_name` - Filter by MCP server
- `start_date` - Start of date range (ISO 8601)
- `end_date` - End of date range (ISO 8601)

**Response:**
```json
{
  "totalCalls": 5000,
  "successfulCalls": 4850,
  "failedCalls": 150,
  "averageExecutionTimeMs": 78.5,
  "totalExecutionTimeMs": 392500,
  "byTool": {
    "get_user_stats": 2000,
    "format_code": 1500,
    "search_knowledge": 1500
  },
  "byServer": {
    "admin-mcp": 2000,
    "formatting-mcp": 1500,
    "background-service-mcp": 1500
  },
  "timeRange": {
    "start": "2025-11-06T00:00:00Z",
    "end": "2025-11-13T23:59:59Z"
  }
}
```

## Data Schema

### MCPUsage Table

```prisma
model MCPUsage {
  id                String   @id @default(uuid())
  user_id           String
  instance_id       String?
  tool_name         String
  execution_time_ms Int
  request_size      Int?
  response_size     Int?
  success           Boolean
  error_message     String?
  request_metadata  Json?
  timestamp         DateTime @default(now())

  @@index([user_id])
  @@index([tool_name])
  @@index([timestamp])
}
```

### request_metadata Field

The `request_metadata` JSON field stores additional details:

```json
{
  "server": "admin-mcp",
  "method": "tools/call",
  "params": {
    "user_id": "123"
  }
}
```

## MCP Proxy Implementation

### Sending Logs

In `services/mcp-proxy/src/main.py`:

```python
async def send_mcp_log_to_api(
    user_id: str,
    server_name: str,
    tool_name: str,
    method: str,
    params: dict,
    result: Optional[dict],
    error: Optional[dict],
    execution_time_ms: float,
    success: bool
) -> None:
    """Send MCP call log to API database (fire-and-forget)"""
    try:
        async with httpx.AsyncClient() as client:
            log_data = {
                "user_id": user_id,
                "server_name": server_name,
                "tool_name": tool_name,
                "method": method,
                "params": params,
                "result": result,
                "error": error,
                "execution_time_ms": execution_time_ms,
                "success": success,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
            }

            await client.post(
                f"{API_BASE_URL}/api/mcp-logs",
                json=log_data,
                timeout=5.0
            )
    except Exception as e:
        logger.warning(f"Failed to send MCP log to API: {e}")
        # Don't raise - this is fire-and-forget
```

### Background Task Integration

```python
@router.post("/proxy/{target_server}")
async def proxy_mcp_request(
    target_server: str,
    mcp_request: MCPRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_user_id)
):
    # Execute MCP request
    start_time = time.time()
    result = await execute_mcp_call(target_server, mcp_request)
    execution_time_ms = (time.time() - start_time) * 1000

    # Log in background (non-blocking)
    if user_id:
        tool_name = mcp_request.params.get('name', 'unknown')
        background_tasks.add_task(
            send_mcp_log_to_api,
            user_id=user_id,
            server_name=target_server,
            tool_name=tool_name,
            method=mcp_request.method,
            params=mcp_request.params,
            result=result.get('result'),
            error=None,
            execution_time_ms=execution_time_ms,
            success=True
        )

    return result
```

## Usage Analytics

### Query Examples

**Most used tools:**
```sql
SELECT tool_name, COUNT(*) as usage_count
FROM "MCPUsage"
GROUP BY tool_name
ORDER BY usage_count DESC
LIMIT 10;
```

**Average execution time by tool:**
```sql
SELECT tool_name, AVG(execution_time_ms) as avg_time
FROM "MCPUsage"
GROUP BY tool_name
ORDER BY avg_time DESC;
```

**User activity:**
```sql
SELECT user_id, COUNT(*) as total_calls,
       SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful_calls
FROM "MCPUsage"
GROUP BY user_id;
```

**Error rate:**
```sql
SELECT server_name,
       COUNT(*) as total,
       SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as errors,
       (SUM(CASE WHEN NOT success THEN 1 ELSE 0 END)::float / COUNT(*) * 100) as error_rate
FROM "MCPUsage"
GROUP BY server_name;
```

## Performance Considerations

### Fire-and-Forget Pattern

Logs are sent asynchronously using FastAPI's `BackgroundTasks`:

- **No blocking**: MCP tool execution completes immediately
- **No waiting**: Client doesn't wait for database write
- **Failure tolerant**: If logging fails, tool execution succeeds

### Timeout

The log submission has a **5-second timeout**:
- If API is unreachable, log is dropped
- Warning is logged but execution continues
- No retry logic (keeps system responsive)

### Batch Processing

For high-volume scenarios, use batch endpoint:

```python
# Collect logs in memory
log_buffer = []

# Add to buffer
log_buffer.append(log_data)

# Flush when buffer reaches threshold
if len(log_buffer) >= 100:
    await client.post(f"{API_BASE_URL}/api/mcp-logs/batch",
                     json={"logs": log_buffer})
    log_buffer.clear()
```

## Monitoring

### Database Growth

Monitor `MCPUsage` table size:

```sql
SELECT
  pg_size_pretty(pg_total_relation_size('MCPUsage')) as total_size,
  COUNT(*) as total_records
FROM "MCPUsage";
```

### Cleanup Old Logs

Optionally clean up logs older than 90 days:

```sql
DELETE FROM "MCPUsage"
WHERE timestamp < NOW() - INTERVAL '90 days';
```

### Index Performance

Ensure indexes are being used:

```sql
EXPLAIN ANALYZE
SELECT * FROM "MCPUsage"
WHERE user_id = 'some-uuid'
  AND timestamp > NOW() - INTERVAL '7 days';
```

## Security Considerations

### Data Privacy

- **PII in params**: Tool parameters may contain sensitive data
- **User tracking**: All calls are tied to user_id
- **Retention policy**: Consider data retention limits

### Access Control

- Log endpoints are **publicly accessible** (no auth required)
- Consider adding authentication if exposed externally
- Statistics endpoint could expose user behavior patterns

### Recommendations

1. **Add authentication** to log endpoints in production
2. **Sanitize sensitive parameters** before logging
3. **Implement data retention** policy (e.g., 90 days)
4. **Encrypt at rest** for sensitive tool parameters

## Troubleshooting

### Logs Not Appearing

**Check 1**: Verify MCP Proxy can reach API
```bash
# From mcp-proxy container
curl http://openagenticchat-api:3000/health
```

**Check 2**: Check MCP Proxy logs for errors
```bash
docker logs mcp-proxy | grep "Failed to send MCP log"
```

**Check 3**: Verify API_BASE_URL is set correctly
```bash
docker exec mcp-proxy env | grep API_BASE_URL
```

### High Log Volume

**Symptom**: Database growing too fast

**Solution 1**: Implement sampling (log 1 in N requests)
```python
import random
if random.random() < 0.1:  # 10% sampling
    background_tasks.add_task(send_mcp_log_to_api, ...)
```

**Solution 2**: Use batch endpoint with buffering

**Solution 3**: Reduce retention period

### Performance Impact

**Symptom**: Slow API responses

**Check**: Database indexes are being used
```sql
-- Should use index on user_id
EXPLAIN SELECT * FROM "MCPUsage" WHERE user_id = '...';
```

**Solution**: Add composite indexes if needed
```sql
CREATE INDEX idx_mcp_usage_user_timestamp
ON "MCPUsage" (user_id, timestamp DESC);
```

## Future Enhancements

- [ ] Grafana dashboard for MCP metrics
- [ ] Automatic data retention (delete old logs)
- [ ] Rate limiting per user/tool
- [ ] Cost tracking per tool execution
- [ ] Alerting on error thresholds
- [ ] Export logs to analytics platforms
- [ ] Real-time metrics streaming
- [ ] Tool execution tracing/correlation IDs
