# OpenAgentic Loki MCP Server

MCP server for querying logs via Grafana Loki.

## Features

- **Log Queries**: Execute LogQL queries against Loki
- **Error Search**: Quick search for errors across services
- **Log Tailing**: Get recent logs (like `tail -f`)
- **Label Discovery**: List available labels and values
- **Log Metrics**: Count logs and calculate rates
- **Context View**: See logs around a specific entry

## Tools

| Tool | Description |
|------|-------------|
| `loki_query` | Execute LogQL queries |
| `loki_search_errors` | Search for error/exception logs |
| `loki_tail` | Get most recent log lines |
| `loki_labels` | List available label names |
| `loki_label_values` | Get values for a specific label |
| `loki_count_logs` | Count log entries over time |
| `loki_log_rate` | Calculate log rate (lines/sec) |
| `loki_context` | Get log context around an entry |
| `loki_streams` | List active log streams |

## Configuration

Environment variables:
- `LOKI_URL`: Loki server URL (default: `http://loki:3100`)

## LogQL Examples

```logql
# All logs from an app
{app="nginx"}

# Filter by namespace and search for errors
{namespace="openagentic"} |= "error"

# Case-insensitive regex match
{job="kubernetes-pods"} |~ "(?i)exception"

# Parse JSON and filter
{app="api"} | json | status >= 500

# Count errors per minute
count_over_time({app="api"} |= "error"[1m])
```

## Usage

```python
# Query logs
await loki_query('{namespace="openagentic"} |= "error"', limit=100, start="1h")

# Search for errors
await loki_search_errors(namespace="openagentic", time_range="30m")

# Tail recent logs
await loki_tail('{app="api"}', lines=50)
```

## Access Control

This MCP server is available to **ADMIN users only**.
