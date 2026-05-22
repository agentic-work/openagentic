

"""
Incident MCP Server - FastMCP Implementation

Provides tools to manage the incident lifecycle - create, update, escalate, resolve.
This enables LLMs to track and manage incidents as part of AIOps workflows.

IMPORTANT: This MCP server is available to ADMIN users only.
"""

import os
import sys
import json
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
from enum import Enum
import uuid

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

# Configure structured logging via shared observability module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-incident-mcp')
except ImportError:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        stream=sys.stderr
    )
    logger = logging.getLogger("incident-mcp")

# Initialize FastMCP server
mcp = FastMCP("Incident MCP Server - Incident Lifecycle Management")

# ============================================================================
# DATA MODELS
# ============================================================================

class Severity(str, Enum):
    SEV1 = "sev1"  # Critical - total outage
    SEV2 = "sev2"  # Major - significant impact
    SEV3 = "sev3"  # Minor - limited impact
    SEV4 = "sev4"  # Low - informational

class Status(str, Enum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    IDENTIFIED = "identified"
    MITIGATING = "mitigating"
    RESOLVED = "resolved"
    CLOSED = "closed"

class TimelineEntry(BaseModel):
    timestamp: str
    action: str
    description: str
    author: str = "OpenAgentic AI"

class Incident(BaseModel):
    id: str
    title: str
    description: str
    severity: str
    status: str
    service: str
    created_at: str
    updated_at: str
    resolved_at: Optional[str] = None
    closed_at: Optional[str] = None
    assigned_to: Optional[str] = None
    timeline: List[Dict[str, Any]] = []
    related_alerts: List[str] = []
    runbooks_executed: List[str] = []
    tags: List[str] = []
    impact: Optional[str] = None
    root_cause: Optional[str] = None
    resolution: Optional[str] = None

# ============================================================================
# IN-MEMORY STORAGE
# ============================================================================

# In-memory incident storage (would be replaced with database in production)
incidents: Dict[str, Incident] = {}

def generate_incident_id() -> str:
    """Generate a human-readable incident ID"""
    now = datetime.utcnow()
    count = len([i for i in incidents.values() if i.created_at.startswith(now.strftime('%Y-%m-%d'))])
    return f"INC-{now.strftime('%Y%m%d')}-{count + 1:04d}"

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def format_incident(incident: Incident, verbose: bool = False) -> str:
    """Format an incident for display"""
    severity_icons = {
        "sev1": "🔴 SEV1",
        "sev2": "🟠 SEV2",
        "sev3": "🟡 SEV3",
        "sev4": "🔵 SEV4"
    }

    status_icons = {
        "open": "📋",
        "investigating": "🔍",
        "identified": "🎯",
        "mitigating": "🔧",
        "resolved": "✅",
        "closed": "📁"
    }

    sev = severity_icons.get(incident.severity, "⚪")
    stat = status_icons.get(incident.status, "❓")

    lines = [
        f"{sev} | {stat} {incident.status.upper()}",
        f"ID: {incident.id}",
        f"Title: {incident.title}",
        f"Service: {incident.service}",
        f"Created: {incident.created_at}",
    ]

    if incident.assigned_to:
        lines.append(f"Assigned: {incident.assigned_to}")

    if verbose:
        lines.append(f"\nDescription: {incident.description}")

        if incident.impact:
            lines.append(f"Impact: {incident.impact}")

        if incident.tags:
            lines.append(f"Tags: {', '.join(incident.tags)}")

        if incident.related_alerts:
            lines.append(f"Related Alerts: {', '.join(incident.related_alerts[:5])}")

        if incident.root_cause:
            lines.append(f"Root Cause: {incident.root_cause}")

        if incident.resolution:
            lines.append(f"Resolution: {incident.resolution}")

        if incident.timeline:
            lines.append("\nTimeline:")
            for entry in incident.timeline[-10:]:  # Last 10 entries
                lines.append(f"  [{entry['timestamp']}] {entry['action']}: {entry['description']}")

    return "\n".join(lines)

def add_timeline_entry(incident: Incident, action: str, description: str, author: str = "OpenAgentic AI"):
    """Add a timeline entry to an incident"""
    incident.timeline.append({
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "action": action,
        "description": description,
        "author": author
    })
    incident.updated_at = datetime.utcnow().isoformat() + "Z"

# ============================================================================
# TOOL DEFINITIONS
# ============================================================================

@mcp.tool()
async def incident_create(
    title: str = Field(description="Short title describing the incident"),
    description: str = Field(description="Detailed description of what's happening"),
    severity: str = Field(description="Severity level: sev1 (critical), sev2 (major), sev3 (minor), sev4 (low)"),
    service: str = Field(description="Affected service or system"),
    impact: Optional[str] = Field(default=None, description="Description of business/user impact"),
    related_alerts: Optional[str] = Field(default=None, description="Comma-separated list of related alert names"),
    tags: Optional[str] = Field(default=None, description="Comma-separated list of tags")
) -> str:
    """
    Create a new incident.

    This starts the incident lifecycle. Use appropriate severity:
    - SEV1: Total service outage, critical business impact
    - SEV2: Major degradation, significant user impact
    - SEV3: Minor issues, limited impact
    - SEV4: Low priority, informational
    """
    try:
        # Validate severity
        if severity.lower() not in ["sev1", "sev2", "sev3", "sev4"]:
            return f"Invalid severity: {severity}. Must be sev1, sev2, sev3, or sev4"

        incident_id = generate_incident_id()
        now = datetime.utcnow().isoformat() + "Z"

        incident = Incident(
            id=incident_id,
            title=title,
            description=description,
            severity=severity.lower(),
            status="open",
            service=service,
            created_at=now,
            updated_at=now,
            impact=impact,
            related_alerts=related_alerts.split(",") if related_alerts else [],
            tags=tags.split(",") if tags else []
        )

        add_timeline_entry(incident, "CREATED", f"Incident created with severity {severity}")

        incidents[incident_id] = incident

        output = [
            "=== Incident Created ===",
            "",
            format_incident(incident),
            "",
            "Next steps:",
            "  1. Assign the incident: incident_assign(id, assignee)",
            "  2. Update status to investigating: incident_update_status(id, 'investigating')",
            "  3. Add updates as you investigate: incident_add_note(id, note)"
        ]

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in incident_create: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def incident_list(
    status: Optional[str] = Field(default=None, description="Filter by status (open, investigating, identified, mitigating, resolved, closed)"),
    severity: Optional[str] = Field(default=None, description="Filter by severity (sev1, sev2, sev3, sev4)"),
    service: Optional[str] = Field(default=None, description="Filter by service name"),
    limit: int = Field(default=20, description="Maximum number of incidents to return")
) -> str:
    """
    List incidents with optional filters.

    Shows active and recent incidents for situational awareness.
    """
    try:
        filtered = list(incidents.values())

        if status:
            filtered = [i for i in filtered if i.status == status.lower()]
        if severity:
            filtered = [i for i in filtered if i.severity == severity.lower()]
        if service:
            filtered = [i for i in filtered if service.lower() in i.service.lower()]

        # Sort by severity (sev1 first) then by created_at (newest first)
        severity_order = {"sev1": 0, "sev2": 1, "sev3": 2, "sev4": 3}
        filtered.sort(key=lambda x: (severity_order.get(x.severity, 4), x.created_at), reverse=False)

        filtered = filtered[:limit]

        if not filtered:
            return "No incidents found matching criteria"

        output = [
            "=== Incidents ===",
            f"Showing {len(filtered)} incident(s)",
            "=" * 60,
            ""
        ]

        # Group by severity
        by_sev: Dict[str, List[Incident]] = {"sev1": [], "sev2": [], "sev3": [], "sev4": []}
        for inc in filtered:
            if inc.severity in by_sev:
                by_sev[inc.severity].append(inc)

        for sev in ["sev1", "sev2", "sev3", "sev4"]:
            if by_sev[sev]:
                output.append(f"\n{sev.upper()} ({len(by_sev[sev])}):")
                output.append("-" * 40)
                for inc in by_sev[sev]:
                    output.append(format_incident(inc))
                    output.append("")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in incident_list: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def incident_get(
    id: str = Field(description="Incident ID (e.g., INC-20240115-0001)")
) -> str:
    """
    Get detailed information about a specific incident.

    Shows full incident details including timeline and resolution.
    """
    try:
        incident = incidents.get(id)
        if not incident:
            return f"Incident {id} not found"

        output = [
            "=== Incident Details ===",
            "",
            format_incident(incident, verbose=True)
        ]

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in incident_get: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def incident_update_status(
    id: str = Field(description="Incident ID"),
    status: str = Field(description="New status: investigating, identified, mitigating, resolved"),
    note: Optional[str] = Field(default=None, description="Optional note explaining the status change")
) -> str:
    """
    Update the status of an incident.

    Status progression: open -> investigating -> identified -> mitigating -> resolved -> closed
    """
    try:
        incident = incidents.get(id)
        if not incident:
            return f"Incident {id} not found"

        valid_statuses = ["investigating", "identified", "mitigating", "resolved", "closed"]
        if status.lower() not in valid_statuses:
            return f"Invalid status: {status}. Must be one of: {', '.join(valid_statuses)}"

        old_status = incident.status
        incident.status = status.lower()

        if status.lower() == "resolved":
            incident.resolved_at = datetime.utcnow().isoformat() + "Z"
        elif status.lower() == "closed":
            incident.closed_at = datetime.utcnow().isoformat() + "Z"

        description = f"Status changed from {old_status} to {status}"
        if note:
            description += f": {note}"

        add_timeline_entry(incident, "STATUS_CHANGE", description)

        return f"Incident {id} status updated to {status}\n\n{format_incident(incident)}"

    except Exception as e:
        logger.error(f"Error in incident_update_status: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def incident_assign(
    id: str = Field(description="Incident ID"),
    assignee: str = Field(description="Name or email of person to assign")
) -> str:
    """
    Assign an incident to a person.

    Clear ownership helps with accountability and coordination.
    """
    try:
        incident = incidents.get(id)
        if not incident:
            return f"Incident {id} not found"

        old_assignee = incident.assigned_to
        incident.assigned_to = assignee

        if old_assignee:
            add_timeline_entry(incident, "REASSIGNED", f"Reassigned from {old_assignee} to {assignee}")
        else:
            add_timeline_entry(incident, "ASSIGNED", f"Assigned to {assignee}")

        return f"Incident {id} assigned to {assignee}\n\n{format_incident(incident)}"

    except Exception as e:
        logger.error(f"Error in incident_assign: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def incident_add_note(
    id: str = Field(description="Incident ID"),
    note: str = Field(description="Update note or finding"),
    action_type: str = Field(default="UPDATE", description="Action type: UPDATE, FINDING, ACTION_TAKEN, ESCALATION")
) -> str:
    """
    Add a note or update to an incident timeline.

    Use this to document investigation progress, findings, and actions taken.
    """
    try:
        incident = incidents.get(id)
        if not incident:
            return f"Incident {id} not found"

        add_timeline_entry(incident, action_type.upper(), note)

        return f"Note added to incident {id}\n\nLatest timeline:\n" + "\n".join(
            f"  [{e['timestamp']}] {e['action']}: {e['description']}"
            for e in incident.timeline[-5:]
        )

    except Exception as e:
        logger.error(f"Error in incident_add_note: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def incident_escalate(
    id: str = Field(description="Incident ID"),
    new_severity: str = Field(description="New severity level (sev1, sev2, sev3)"),
    reason: str = Field(description="Reason for escalation")
) -> str:
    """
    Escalate an incident to a higher severity.

    Use when impact increases or issue is more serious than initially assessed.
    """
    try:
        incident = incidents.get(id)
        if not incident:
            return f"Incident {id} not found"

        old_severity = incident.severity
        incident.severity = new_severity.lower()

        add_timeline_entry(incident, "ESCALATED", f"Escalated from {old_severity} to {new_severity}: {reason}")

        output = [
            f"Incident {id} escalated from {old_severity} to {new_severity}",
            f"Reason: {reason}",
            "",
            format_incident(incident)
        ]

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in incident_escalate: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def incident_resolve(
    id: str = Field(description="Incident ID"),
    resolution: str = Field(description="Description of how the incident was resolved"),
    root_cause: Optional[str] = Field(default=None, description="Root cause if identified")
) -> str:
    """
    Resolve an incident with resolution details.

    Documents the fix and optionally the root cause for future reference.
    """
    try:
        incident = incidents.get(id)
        if not incident:
            return f"Incident {id} not found"

        incident.status = "resolved"
        incident.resolved_at = datetime.utcnow().isoformat() + "Z"
        incident.resolution = resolution
        if root_cause:
            incident.root_cause = root_cause

        add_timeline_entry(incident, "RESOLVED", f"Resolved: {resolution}")
        if root_cause:
            add_timeline_entry(incident, "ROOT_CAUSE", f"Root cause: {root_cause}")

        output = [
            f"Incident {id} resolved",
            "",
            format_incident(incident, verbose=True),
            "",
            "Next steps:",
            "  - Consider creating a postmortem",
            "  - Close incident when confirmed stable: incident_close(id)"
        ]

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in incident_resolve: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def incident_close(
    id: str = Field(description="Incident ID"),
    final_note: Optional[str] = Field(default=None, description="Final closing note")
) -> str:
    """
    Close an incident after resolution is confirmed.

    Closes the incident lifecycle. Should be done after confirming fix is stable.
    """
    try:
        incident = incidents.get(id)
        if not incident:
            return f"Incident {id} not found"

        if incident.status != "resolved":
            return f"Cannot close incident {id} - must be resolved first (current status: {incident.status})"

        incident.status = "closed"
        incident.closed_at = datetime.utcnow().isoformat() + "Z"

        note = final_note or "Incident confirmed resolved and closed"
        add_timeline_entry(incident, "CLOSED", note)

        return f"Incident {id} closed\n\n{format_incident(incident, verbose=True)}"

    except Exception as e:
        logger.error(f"Error in incident_close: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def incident_link_runbook(
    id: str = Field(description="Incident ID"),
    runbook: str = Field(description="Name of runbook that was executed"),
    result: str = Field(description="Result of runbook execution (success/failed)")
) -> str:
    """
    Link a runbook execution to an incident.

    Documents remediation actions taken for the incident.
    """
    try:
        incident = incidents.get(id)
        if not incident:
            return f"Incident {id} not found"

        incident.runbooks_executed.append(f"{runbook} ({result})")
        add_timeline_entry(incident, "RUNBOOK", f"Executed runbook '{runbook}': {result}")

        return f"Runbook '{runbook}' linked to incident {id}"

    except Exception as e:
        logger.error(f"Error in incident_link_runbook: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def incident_summary() -> str:
    """
    Get a summary of current incident status.

    Provides a quick overview of active incidents by severity.
    """
    try:
        active = [i for i in incidents.values() if i.status not in ["resolved", "closed"]]

        by_severity = {"sev1": 0, "sev2": 0, "sev3": 0, "sev4": 0}
        by_status = {"open": 0, "investigating": 0, "identified": 0, "mitigating": 0}

        for inc in active:
            if inc.severity in by_severity:
                by_severity[inc.severity] += 1
            if inc.status in by_status:
                by_status[inc.status] += 1

        output = [
            "=== Incident Summary ===",
            "",
            f"Active Incidents: {len(active)}",
            "",
            "By Severity:",
            f"  🔴 SEV1 (Critical): {by_severity['sev1']}",
            f"  🟠 SEV2 (Major):    {by_severity['sev2']}",
            f"  🟡 SEV3 (Minor):    {by_severity['sev3']}",
            f"  🔵 SEV4 (Low):      {by_severity['sev4']}",
            "",
            "By Status:",
            f"  📋 Open:          {by_status['open']}",
            f"  🔍 Investigating: {by_status['investigating']}",
            f"  🎯 Identified:    {by_status['identified']}",
            f"  🔧 Mitigating:    {by_status['mitigating']}",
        ]

        # Show critical incidents
        critical = [i for i in active if i.severity == "sev1"]
        if critical:
            output.append("")
            output.append("Critical Incidents (SEV1):")
            for inc in critical:
                output.append(f"  - {inc.id}: {inc.title} [{inc.status}]")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in incident_summary: {e}")
        return f"Error: {str(e)}"

# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

def main():
    """Run the MCP server"""
    logger.info("Starting Incident MCP Server")
    mcp.run()

if __name__ == "__main__":
    main()
