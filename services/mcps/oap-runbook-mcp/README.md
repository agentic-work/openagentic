# OpenAgentic Runbook MCP Server

MCP server for executing automated remediation runbooks.

## Features

- **Built-in Runbooks**: Pre-defined runbooks for common remediation actions
- **Execution Tracking**: History of all runbook executions
- **Risk Levels**: Each runbook has a risk level (low/medium/high/critical)
- **Quick Helpers**: Convenience tools for common operations

## Built-in Runbooks

| Runbook | Risk | Description |
|---------|------|-------------|
| `restart-pod` | Medium | Restart a Kubernetes pod |
| `scale-deployment` | Medium | Scale deployment replicas |
| `rollback-deployment` | High | Rollback to previous version |
| `restart-service` | Medium | Rolling restart of a service |
| `check-pod-resources` | Low | Check CPU/memory usage |
| `check-service-health` | Low | Health endpoint check |
| `collect-diagnostics` | Low | Gather logs and events |
| `apply-resource-limits` | Medium | Update resource limits |
| `clear-redis-cache` | High | Clear Redis cache |
| `drain-node` | Critical | Drain a K8s node |

## Tools

| Tool | Description |
|------|-------------|
| `runbook_list` | List all available runbooks |
| `runbook_describe` | Get runbook details and parameters |
| `runbook_execute` | Execute a runbook |
| `runbook_history` | View execution history |
| `runbook_quick_restart` | Quick service restart |
| `runbook_quick_scale` | Quick deployment scale |
| `runbook_quick_diagnostics` | Quick diagnostics collection |

## Configuration

Environment variables:
- `RUNBOOK_DIR`: Directory for custom runbooks (default: `/app/runbooks`)
- `RUNBOOK_TIMEOUT`: Execution timeout in seconds (default: 300)
- `KUBERNETES_NAMESPACE`: Default namespace (default: `openagentic`)

## Usage Examples

```python
# List available runbooks
await runbook_list()

# Get runbook details
await runbook_describe(runbook="restart-pod")

# Execute a runbook
await runbook_execute(
    runbook="restart-pod",
    params='{"pod_name": "api-server", "namespace": "production"}'
)

# Quick restart
await runbook_quick_restart(service="api-server", namespace="production")

# View execution history
await runbook_history(limit=10)
```

## Risk Levels

- **Low**: Read-only/diagnostic operations
- **Medium**: Service restarts, scaling operations
- **High**: Rollbacks, cache clearing, data modifications
- **Critical**: Node drains, cluster-wide operations

## Access Control

This MCP server is available to **ADMIN users only**.
