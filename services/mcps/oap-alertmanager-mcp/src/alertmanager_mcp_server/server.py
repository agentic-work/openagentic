#!/usr/bin/env python3
# Copyright 2026 Gnomus.ai
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Alertmanager MCP Server - FastMCP Implementation

Provides tools to manage Prometheus Alertmanager alerts.
This enables LLMs to silence alerts, view alert groups, and manage routing.

IMPORTANT: This MCP server is available to ADMIN users only.
"""

import os
import sys
import json
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
import uuid

import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

# Configure structured logging via shared observability module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-alertmanager-mcp')
except ImportError:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        stream=sys.stderr
    )
    logger = logging.getLogger("alertmanager-mcp")

# Initialize FastMCP server
mcp = FastMCP("Alertmanager MCP Server - Manage Alerts and Silences")

# Alertmanager configuration
ALERTMANAGER_URL = os.getenv("ALERTMANAGER_URL", "http://alertmanager:9093")


# ============================================================================
# ALERTMANAGER CLIENT
# ============================================================================

class AlertmanagerClient:
    """Client for interacting with Alertmanager API"""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=30.0)

    async def get_alerts(
        self,
        active: bool = True,
        silenced: bool = False,
        inhibited: bool = False,
        unprocessed: bool = False,
        filter_matchers: Optional[List[str]] = None,
        receiver: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get alerts matching criteria"""
        params = {
            "active": str(active).lower(),
            "silenced": str(silenced).lower(),
            "inhibited": str(inhibited).lower(),
            "unprocessed": str(unprocessed).lower()
        }

        if filter_matchers:
            params["filter"] = filter_matchers
        if receiver:
            params["receiver"] = receiver

        response = await self.client.get(
            f"{self.base_url}/api/v2/alerts",
            params=params
        )
        response.raise_for_status()
        return response.json()

    async def get_alert_groups(self) -> List[Dict[str, Any]]:
        """Get alert groups"""
        response = await self.client.get(f"{self.base_url}/api/v2/alerts/groups")
        response.raise_for_status()
        return response.json()

    async def get_silences(self, filter_matchers: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Get all silences"""
        params = {}
        if filter_matchers:
            params["filter"] = filter_matchers

        response = await self.client.get(
            f"{self.base_url}/api/v2/silences",
            params=params
        )
        response.raise_for_status()
        return response.json()

    async def create_silence(
        self,
        matchers: List[Dict[str, Any]],
        starts_at: str,
        ends_at: str,
        created_by: str,
        comment: str
    ) -> Dict[str, Any]:
        """Create a new silence"""
        silence = {
            "matchers": matchers,
            "startsAt": starts_at,
            "endsAt": ends_at,
            "createdBy": created_by,
            "comment": comment
        }

        response = await self.client.post(
            f"{self.base_url}/api/v2/silences",
            json=silence
        )
        response.raise_for_status()
        return response.json()

    async def delete_silence(self, silence_id: str) -> None:
        """Delete/expire a silence"""
        response = await self.client.delete(
            f"{self.base_url}/api/v2/silence/{silence_id}"
        )
        response.raise_for_status()

    async def get_receivers(self) -> List[Dict[str, Any]]:
        """Get all receivers"""
        response = await self.client.get(f"{self.base_url}/api/v2/receivers")
        response.raise_for_status()
        return response.json()

    async def get_status(self) -> Dict[str, Any]:
        """Get Alertmanager status"""
        response = await self.client.get(f"{self.base_url}/api/v2/status")
        response.raise_for_status()
        return response.json()


# Global client instance
alertmanager_client = AlertmanagerClient(ALERTMANAGER_URL)


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def format_alert(alert: Dict[str, Any]) -> str:
    """Format a single alert for display"""
    labels = alert.get("labels", {})
    annotations = alert.get("annotations", {})
    status = alert.get("status", {})

    alertname = labels.get("alertname", "Unknown")
    severity = labels.get("severity", "unknown")
    state = status.get("state", "unknown")

    # Status indicators
    state_icon = {"firing": "🔥", "pending": "⏳", "resolved": "✅"}.get(state, "❓")
    severity_icon = {"critical": "🔴", "warning": "🟡", "info": "🔵"}.get(severity, "⚪")

    lines = [
        f"{state_icon} {severity_icon} {alertname} [{severity}]",
        f"   State: {state}",
    ]

    if annotations.get("summary"):
        lines.append(f"   Summary: {annotations['summary']}")
    if annotations.get("description"):
        desc = annotations['description'][:200] + "..." if len(annotations.get('description', '')) > 200 else annotations.get('description', '')
        lines.append(f"   Description: {desc}")

    # Add key labels
    key_labels = {k: v for k, v in labels.items() if k not in ['alertname', 'severity']}
    if key_labels:
        label_str = ", ".join(f"{k}={v}" for k, v in list(key_labels.items())[:5])
        lines.append(f"   Labels: {label_str}")

    starts_at = alert.get("startsAt", "")
    if starts_at:
        try:
            dt = datetime.fromisoformat(starts_at.replace('Z', '+00:00'))
            lines.append(f"   Started: {dt.strftime('%Y-%m-%d %H:%M:%S UTC')}")
        except:
            pass

    return "\n".join(lines)


def format_silence(silence: Dict[str, Any]) -> str:
    """Format a silence for display"""
    status = silence.get("status", {}).get("state", "unknown")
    status_icon = {"active": "🔇", "pending": "⏳", "expired": "⏰"}.get(status, "❓")

    matchers = silence.get("matchers", [])
    matcher_strs = []
    for m in matchers:
        name = m.get("name", "")
        value = m.get("value", "")
        is_regex = m.get("isRegex", False)
        is_equal = m.get("isEqual", True)
        op = "=~" if is_regex else ("=" if is_equal else "!=")
        matcher_strs.append(f"{name}{op}\"{value}\"")

    lines = [
        f"{status_icon} Silence: {silence.get('id', 'unknown')[:8]}...",
        f"   Status: {status}",
        f"   Matchers: {{{', '.join(matcher_strs)}}}",
        f"   Created by: {silence.get('createdBy', 'unknown')}",
        f"   Comment: {silence.get('comment', 'No comment')}",
    ]

    try:
        starts_at = datetime.fromisoformat(silence.get('startsAt', '').replace('Z', '+00:00'))
        ends_at = datetime.fromisoformat(silence.get('endsAt', '').replace('Z', '+00:00'))
        lines.append(f"   Duration: {starts_at.strftime('%Y-%m-%d %H:%M')} to {ends_at.strftime('%Y-%m-%d %H:%M')}")
    except:
        pass

    return "\n".join(lines)


# ============================================================================
# TOOL DEFINITIONS
# ============================================================================

@mcp.tool()
async def alertmanager_get_alerts(
    active: bool = Field(default=True, description="Include active alerts"),
    silenced: bool = Field(default=False, description="Include silenced alerts"),
    inhibited: bool = Field(default=False, description="Include inhibited alerts"),
    filter: Optional[str] = Field(default=None, description="Label filter (e.g., 'severity=critical', 'alertname=HighMemory')")
) -> str:
    """
    Get current alerts from Alertmanager.

    Returns a list of alerts with their status, severity, and details.
    Use filters to narrow down results.
    """
    try:
        filter_matchers = [filter] if filter else None
        alerts = await alertmanager_client.get_alerts(
            active=active,
            silenced=silenced,
            inhibited=inhibited,
            filter_matchers=filter_matchers
        )

        if not alerts:
            return "No alerts found matching criteria"

        # Group by severity
        by_severity: Dict[str, List] = {"critical": [], "warning": [], "info": [], "other": []}
        for alert in alerts:
            severity = alert.get("labels", {}).get("severity", "other")
            if severity not in by_severity:
                severity = "other"
            by_severity[severity].append(alert)

        output = [
            "=== Current Alerts ===",
            f"Total: {len(alerts)}",
            f"  Critical: {len(by_severity['critical'])}",
            f"  Warning: {len(by_severity['warning'])}",
            f"  Info: {len(by_severity['info'])}",
            "=" * 60,
            ""
        ]

        for severity in ["critical", "warning", "info", "other"]:
            severity_alerts = by_severity[severity]
            if severity_alerts:
                output.append(f"\n{severity.upper()} ({len(severity_alerts)}):")
                output.append("-" * 40)
                for alert in severity_alerts:
                    output.append(format_alert(alert))
                    output.append("")

        return "\n".join(output)

    except httpx.HTTPError as e:
        return f"HTTP error getting alerts: {str(e)}"
    except Exception as e:
        logger.error(f"Error in alertmanager_get_alerts: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def alertmanager_get_alert_groups() -> str:
    """
    Get alerts grouped by their labels.

    Shows how alerts are grouped together based on Alertmanager's grouping configuration.
    """
    try:
        groups = await alertmanager_client.get_alert_groups()

        if not groups:
            return "No alert groups found"

        output = [
            "=== Alert Groups ===",
            f"Total groups: {len(groups)}",
            "=" * 60,
            ""
        ]

        for group in groups:
            labels = group.get("labels", {})
            alerts = group.get("alerts", [])
            receiver = group.get("receiver", {}).get("name", "unknown")

            label_str = ", ".join(f"{k}={v}" for k, v in labels.items()) if labels else "(no labels)"
            output.append(f"Group: {{{label_str}}}")
            output.append(f"  Receiver: {receiver}")
            output.append(f"  Alerts: {len(alerts)}")

            for alert in alerts[:5]:  # Show first 5
                alertname = alert.get("labels", {}).get("alertname", "Unknown")
                severity = alert.get("labels", {}).get("severity", "unknown")
                state = alert.get("status", {}).get("state", "unknown")
                output.append(f"    - {alertname} [{severity}] ({state})")

            if len(alerts) > 5:
                output.append(f"    ... and {len(alerts) - 5} more")
            output.append("")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in alertmanager_get_alert_groups: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def alertmanager_get_silences(
    filter: Optional[str] = Field(default=None, description="Label filter for silences")
) -> str:
    """
    Get all silences from Alertmanager.

    Shows active, pending, and expired silences.
    """
    try:
        filter_matchers = [filter] if filter else None
        silences = await alertmanager_client.get_silences(filter_matchers)

        if not silences:
            return "No silences found"

        # Group by state
        by_state: Dict[str, List] = {"active": [], "pending": [], "expired": []}
        for silence in silences:
            state = silence.get("status", {}).get("state", "expired")
            if state not in by_state:
                state = "expired"
            by_state[state].append(silence)

        output = [
            "=== Silences ===",
            f"Total: {len(silences)}",
            f"  Active: {len(by_state['active'])}",
            f"  Pending: {len(by_state['pending'])}",
            f"  Expired: {len(by_state['expired'])}",
            "=" * 60,
            ""
        ]

        for state in ["active", "pending", "expired"]:
            state_silences = by_state[state]
            if state_silences:
                output.append(f"\n{state.upper()} ({len(state_silences)}):")
                output.append("-" * 40)
                for silence in state_silences[:10]:  # Limit displayed
                    output.append(format_silence(silence))
                    output.append("")
                if len(state_silences) > 10:
                    output.append(f"... and {len(state_silences) - 10} more")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in alertmanager_get_silences: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def alertmanager_create_silence(
    alertname: str = Field(description="Alert name to silence (exact match)"),
    duration: str = Field(default="2h", description="Duration of silence (e.g., '30m', '2h', '1d')"),
    comment: str = Field(description="Reason for silencing this alert"),
    created_by: str = Field(default="OpenAgentic AI", description="Who is creating this silence"),
    additional_matchers: Optional[str] = Field(default=None, description="Additional matchers as JSON array, e.g., '[{\"name\":\"severity\",\"value\":\"warning\"}]'")
) -> str:
    """
    Create a silence for an alert.

    Silences prevent alerts from being sent to receivers.
    Use for planned maintenance or to suppress known issues.
    """
    try:
        # Parse duration
        import re
        match = re.match(r'^(\d+)([mhdw])$', duration.lower())
        if not match:
            return f"Invalid duration format: {duration}. Use format like '30m', '2h', '1d'"

        value, unit = int(match.group(1)), match.group(2)
        multipliers = {'m': 60, 'h': 3600, 'd': 86400, 'w': 604800}
        duration_seconds = value * multipliers[unit]

        now = datetime.utcnow()
        starts_at = now.isoformat() + "Z"
        ends_at = (now + timedelta(seconds=duration_seconds)).isoformat() + "Z"

        # Build matchers
        matchers = [
            {
                "name": "alertname",
                "value": alertname,
                "isRegex": False,
                "isEqual": True
            }
        ]

        # Add additional matchers if provided
        if additional_matchers:
            try:
                extra = json.loads(additional_matchers)
                for m in extra:
                    matchers.append({
                        "name": m.get("name"),
                        "value": m.get("value"),
                        "isRegex": m.get("isRegex", False),
                        "isEqual": m.get("isEqual", True)
                    })
            except json.JSONDecodeError:
                return f"Invalid JSON for additional_matchers: {additional_matchers}"

        result = await alertmanager_client.create_silence(
            matchers=matchers,
            starts_at=starts_at,
            ends_at=ends_at,
            created_by=created_by,
            comment=comment
        )

        silence_id = result.get("silenceID", "unknown")

        output = [
            "=== Silence Created ===",
            f"Silence ID: {silence_id}",
            f"Alert: {alertname}",
            f"Duration: {duration}",
            f"Ends at: {ends_at}",
            f"Created by: {created_by}",
            f"Comment: {comment}",
            "",
            "To delete this silence, use:",
            f"  alertmanager_delete_silence(silence_id=\"{silence_id}\")"
        ]

        return "\n".join(output)

    except httpx.HTTPError as e:
        return f"HTTP error creating silence: {str(e)}"
    except Exception as e:
        logger.error(f"Error in alertmanager_create_silence: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def alertmanager_delete_silence(
    silence_id: str = Field(description="ID of the silence to delete/expire")
) -> str:
    """
    Delete/expire a silence.

    This will cause the silenced alerts to resume firing.
    """
    try:
        await alertmanager_client.delete_silence(silence_id)

        return f"Silence {silence_id} has been deleted/expired successfully.\nAlerts matching this silence will now fire."

    except httpx.HTTPError as e:
        if e.response and e.response.status_code == 404:
            return f"Silence {silence_id} not found"
        return f"HTTP error deleting silence: {str(e)}"
    except Exception as e:
        logger.error(f"Error in alertmanager_delete_silence: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def alertmanager_silence_by_labels(
    labels: str = Field(description="JSON object of label matchers (e.g., '{\"namespace\":\"staging\",\"severity\":\"warning\"}')"),
    duration: str = Field(default="2h", description="Duration of silence"),
    comment: str = Field(description="Reason for silencing"),
    created_by: str = Field(default="OpenAgentic AI", description="Who is creating this silence"),
    is_regex: bool = Field(default=False, description="Treat label values as regex patterns")
) -> str:
    """
    Create a silence matching multiple labels.

    Useful for silencing all alerts from a specific namespace, service, or during maintenance windows.
    """
    try:
        label_dict = json.loads(labels)
    except json.JSONDecodeError:
        return f"Invalid JSON for labels: {labels}"

    try:
        # Parse duration
        import re
        match = re.match(r'^(\d+)([mhdw])$', duration.lower())
        if not match:
            return f"Invalid duration format: {duration}"

        value, unit = int(match.group(1)), match.group(2)
        multipliers = {'m': 60, 'h': 3600, 'd': 86400, 'w': 604800}
        duration_seconds = value * multipliers[unit]

        now = datetime.utcnow()
        starts_at = now.isoformat() + "Z"
        ends_at = (now + timedelta(seconds=duration_seconds)).isoformat() + "Z"

        # Build matchers from labels
        matchers = []
        for name, value in label_dict.items():
            matchers.append({
                "name": name,
                "value": value,
                "isRegex": is_regex,
                "isEqual": True
            })

        result = await alertmanager_client.create_silence(
            matchers=matchers,
            starts_at=starts_at,
            ends_at=ends_at,
            created_by=created_by,
            comment=comment
        )

        silence_id = result.get("silenceID", "unknown")
        matcher_str = ", ".join(f'{k}="{v}"' for k, v in label_dict.items())

        output = [
            "=== Silence Created ===",
            f"Silence ID: {silence_id}",
            f"Matchers: {{{matcher_str}}}",
            f"Is Regex: {is_regex}",
            f"Duration: {duration}",
            f"Ends at: {ends_at}",
            f"Created by: {created_by}",
            f"Comment: {comment}"
        ]

        return "\n".join(output)

    except httpx.HTTPError as e:
        return f"HTTP error creating silence: {str(e)}"
    except Exception as e:
        logger.error(f"Error in alertmanager_silence_by_labels: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def alertmanager_get_receivers() -> str:
    """
    Get all configured notification receivers.

    Shows where alerts are being sent (email, Slack, PagerDuty, etc.).
    """
    try:
        receivers = await alertmanager_client.get_receivers()

        if not receivers:
            return "No receivers configured"

        output = [
            "=== Notification Receivers ===",
            f"Total: {len(receivers)}",
            "=" * 60,
            ""
        ]

        for receiver in receivers:
            name = receiver.get("name", "unknown")
            output.append(f"Receiver: {name}")

            # Show integrations if available
            integrations = []
            for int_type in ["emailConfigs", "slackConfigs", "pagerdutyConfigs", "webhookConfigs", "opsgenieConfigs", "victoropsConfigs"]:
                if receiver.get(int_type):
                    count = len(receiver[int_type])
                    int_name = int_type.replace("Configs", "").replace("Config", "")
                    integrations.append(f"{int_name} ({count})")

            if integrations:
                output.append(f"  Integrations: {', '.join(integrations)}")
            else:
                output.append("  Integrations: (none configured)")
            output.append("")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in alertmanager_get_receivers: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def alertmanager_status() -> str:
    """
    Get Alertmanager cluster status.

    Shows the health and configuration of the Alertmanager cluster.
    """
    try:
        status = await alertmanager_client.get_status()

        cluster = status.get("cluster", {})
        config = status.get("config", {})
        uptime = status.get("uptime", "unknown")
        version = status.get("versionInfo", {})

        output = [
            "=== Alertmanager Status ===",
            "",
            "Version Info:",
            f"  Version: {version.get('version', 'unknown')}",
            f"  Branch: {version.get('branch', 'unknown')}",
            f"  Build Date: {version.get('buildDate', 'unknown')}",
            "",
            "Cluster:",
            f"  Status: {cluster.get('status', 'unknown')}",
            f"  Peers: {len(cluster.get('peers', []))}",
            "",
            f"Uptime: {uptime}",
            "",
            "Config:",
            f"  Original: {config.get('original', '(not available)')[:500]}..."
        ]

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in alertmanager_status: {e}")
        return f"Error: {str(e)}"


@mcp.tool()
async def alertmanager_summary() -> str:
    """
    Get a quick summary of current alert status.

    Provides an overview of alerts and silences for quick assessment.
    """
    try:
        # Get active alerts
        active_alerts = await alertmanager_client.get_alerts(active=True)
        silenced_alerts = await alertmanager_client.get_alerts(active=False, silenced=True)
        silences = await alertmanager_client.get_silences()

        # Count by severity
        critical = sum(1 for a in active_alerts if a.get("labels", {}).get("severity") == "critical")
        warning = sum(1 for a in active_alerts if a.get("labels", {}).get("severity") == "warning")
        info = sum(1 for a in active_alerts if a.get("labels", {}).get("severity") == "info")

        # Count active silences
        active_silences = sum(1 for s in silences if s.get("status", {}).get("state") == "active")

        output = [
            "=== Alertmanager Summary ===",
            "",
            "Active Alerts:",
            f"  🔴 Critical: {critical}",
            f"  🟡 Warning: {warning}",
            f"  🔵 Info: {info}",
            f"  Total: {len(active_alerts)}",
            "",
            f"Silenced Alerts: {len(silenced_alerts)}",
            f"Active Silences: {active_silences}",
            ""
        ]

        if critical > 0:
            output.append("Critical Alerts:")
            for alert in [a for a in active_alerts if a.get("labels", {}).get("severity") == "critical"][:5]:
                alertname = alert.get("labels", {}).get("alertname", "Unknown")
                summary = alert.get("annotations", {}).get("summary", "No summary")
                output.append(f"  🔴 {alertname}: {summary}")

            if critical > 5:
                output.append(f"  ... and {critical - 5} more")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in alertmanager_summary: {e}")
        return f"Error: {str(e)}"


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

def main():
    """Run the MCP server"""
    logger.info(f"Starting Alertmanager MCP Server (URL: {ALERTMANAGER_URL})")
    mcp.run()


if __name__ == "__main__":
    main()
