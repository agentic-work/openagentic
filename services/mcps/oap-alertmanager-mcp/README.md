# OpenAgentic Alertmanager MCP Server

MCP server for managing Prometheus Alertmanager alerts and silences.

## Features

- **Alert Management**: View active, silenced, and inhibited alerts
- **Silence Management**: Create, view, and delete silences
- **Alert Groups**: View how alerts are grouped
- **Receivers**: See notification routing configuration
- **Status**: Check Alertmanager cluster health

## Tools

| Tool | Description |
|------|-------------|
| `alertmanager_get_alerts` | Get current alerts with filtering |
| `alertmanager_get_alert_groups` | View alerts grouped by labels |
| `alertmanager_get_silences` | List all silences |
| `alertmanager_create_silence` | Silence an alert by name |
| `alertmanager_delete_silence` | Delete/expire a silence |
| `alertmanager_silence_by_labels` | Silence alerts matching labels |
| `alertmanager_get_receivers` | List notification receivers |
| `alertmanager_status` | Get cluster status |
| `alertmanager_summary` | Quick overview of alert status |

## Configuration

Environment variables:
- `ALERTMANAGER_URL`: Alertmanager server URL (default: `http://alertmanager:9093`)

## Usage Examples

```python
# Get all critical alerts
await alertmanager_get_alerts(filter="severity=critical")

# Create a 2-hour silence for an alert
await alertmanager_create_silence(
    alertname="HighMemoryUsage",
    duration="2h",
    comment="Investigating memory leak"
)

# Silence all warning alerts in staging namespace
await alertmanager_silence_by_labels(
    labels='{"namespace":"staging","severity":"warning"}',
    duration="4h",
    comment="Staging maintenance window"
)

# Get quick summary
await alertmanager_summary()
```

## Access Control

This MCP server is available to **ADMIN users only**.
