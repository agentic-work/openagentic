# OpenAgentic Prometheus MCP Server

MCP server for querying Prometheus metrics, alerts, and targets.

## Tools

### prometheus_query
Execute an instant PromQL query.

### prometheus_query_range
Execute a range PromQL query over a time period.

### prometheus_alerts
Get all active alerts from Prometheus.

### prometheus_targets
Get all scrape targets and their health status.

### prometheus_metrics_list
List all available metric names.

### prometheus_metric_info
Get metadata and current values for a specific metric.

### prometheus_rules
Get all alerting and recording rules.

### prometheus_health_summary
Get a quick health summary of monitored services.

## Configuration

Environment variables:
- `PROMETHEUS_URL`: Prometheus server URL (default: http://prometheus:9090)

## Usage

```bash
# Run directly
python server.py

# Or via fastmcp
fastmcp run server.py
```
