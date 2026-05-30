# OpenAgentic Incident MCP Server

MCP server for incident lifecycle management.

## Features

- **Incident Creation**: Create incidents with severity, impact, and tags
- **Status Tracking**: Progress through investigating -> identified -> mitigating -> resolved -> closed
- **Timeline**: Automatic timeline of all incident activities
- **Escalation**: Escalate severity when impact increases
- **Resolution**: Document resolution and root cause
- **Runbook Linking**: Link executed runbooks to incidents

## Severity Levels

| Level | Icon | Description |
|-------|------|-------------|
| SEV1 | 🔴 | Critical - Total service outage, critical business impact |
| SEV2 | 🟠 | Major - Significant degradation, major user impact |
| SEV3 | 🟡 | Minor - Limited issues, some users affected |
| SEV4 | 🔵 | Low - Informational, minimal impact |

## Status Progression

```
open -> investigating -> identified -> mitigating -> resolved -> closed
```

## Tools

| Tool | Description |
|------|-------------|
| `incident_create` | Create a new incident |
| `incident_list` | List incidents with filters |
| `incident_get` | Get detailed incident info |
| `incident_update_status` | Update incident status |
| `incident_assign` | Assign incident to a person |
| `incident_add_note` | Add timeline note |
| `incident_escalate` | Escalate severity |
| `incident_resolve` | Resolve with resolution details |
| `incident_close` | Close a resolved incident |
| `incident_link_runbook` | Link runbook execution |
| `incident_summary` | Get overall summary |

## Usage Examples

```python
# Create an incident
await incident_create(
    title="API latency spike",
    description="P95 latency increased to 5s",
    severity="sev2",
    service="api-server",
    impact="Users experiencing slow responses"
)

# Update status
await incident_update_status(
    id="INC-20240115-0001",
    status="investigating",
    note="Checking database connections"
)

# Add investigation notes
await incident_add_note(
    id="INC-20240115-0001",
    note="Found connection pool exhaustion",
    action_type="FINDING"
)

# Resolve the incident
await incident_resolve(
    id="INC-20240115-0001",
    resolution="Increased connection pool size from 10 to 50",
    root_cause="Insufficient database connection pool"
)

# Get summary
await incident_summary()
```

## Access Control

This MCP server is available to **ADMIN users only**.
