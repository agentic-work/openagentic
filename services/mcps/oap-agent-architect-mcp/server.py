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
Agent Architect MCP Server - Natural language agent/workflow creation

This MCP server provides tools for browsing agent templates and available
MCP tools. It is intended to target the native OpenAgentic workflow engine.

STATUS (2026-04-11 v0.6.3): DEGRADED / PARTIAL
  The previous versions of this server emitted code targeting external
  orchestration frameworks (CrewAI, LangGraph). Those services have been
  removed. The code-gen and deployment surface area is stubbed out pending
  a native-workflow-engine re-implementation.

Functional tools:
  - list_agent_templates      (browse templates)
  - get_agent_template        (get one template)
  - list_available_tools      (browse MCP tool catalog)

Stubbed (raise NotImplementedError):
  - create_agent_from_template
  - design_custom_agent
  - generate_agent_code
  - deploy_agent
  - get_framework_status
"""

import os
import json
import logging
from typing import Optional, Any, Dict, List

from fastmcp import FastMCP
from pydantic import BaseModel, Field

# =============================================================================
# LOGGING
# =============================================================================

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-agent-architect-mcp')
except ImportError:
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("oap-agent-architect-mcp")


# =============================================================================
# MODELS
# =============================================================================

class AgentRole(BaseModel):
    """Definition of an agent role in a multi-agent system."""
    name: str = Field(..., description="Name of the agent role")
    description: str = Field(..., description="What this agent does")
    goal: str = Field(..., description="The agent's primary goal")
    backstory: Optional[str] = Field(None, description="Background context for the agent")
    tools: List[str] = Field(default_factory=list, description="MCP tools available to this agent")


class WorkflowStep(BaseModel):
    """Definition of a workflow step."""
    name: str = Field(..., description="Name of the step")
    description: str = Field(..., description="What this step does")
    agent: Optional[str] = Field(None, description="Agent responsible for this step")
    inputs: List[str] = Field(default_factory=list, description="Required inputs")
    outputs: List[str] = Field(default_factory=list, description="Expected outputs")
    next_steps: List[str] = Field(default_factory=list, description="Possible next steps")
    condition: Optional[str] = Field(None, description="Condition for conditional routing")


class AgentSpec(BaseModel):
    """Complete specification for an agent or multi-agent system."""
    name: str = Field(..., description="Name of the agent/workflow")
    description: str = Field(..., description="What this agent does")
    roles: List[AgentRole] = Field(default_factory=list, description="Agent roles (for multi-agent)")
    steps: List[WorkflowStep] = Field(default_factory=list, description="Workflow steps")
    tools: List[str] = Field(default_factory=list, description="MCP tools to include")
    state_schema: Dict[str, Any] = Field(default_factory=dict, description="State schema for the workflow")


# =============================================================================
# AGENT TEMPLATES
# =============================================================================

AGENT_TEMPLATES = {
    "research": {
        "name": "Research Agent",
        "description": "An agent that researches topics by searching the web and synthesizing information",
        "roles": [
            {
                "name": "researcher",
                "description": "Searches for information on the web",
                "goal": "Find relevant and accurate information on the given topic",
                "tools": ["web_search", "web_fetch"]
            },
            {
                "name": "analyzer",
                "description": "Analyzes and synthesizes gathered information",
                "goal": "Create clear, accurate summaries from research data",
                "tools": []
            }
        ],
        "steps": [
            {"name": "analyze_request", "description": "Parse the research request", "agent": "analyzer", "next_steps": ["search"]},
            {"name": "search", "description": "Search for relevant information", "agent": "researcher", "next_steps": ["synthesize"]},
            {"name": "synthesize", "description": "Create final summary", "agent": "analyzer", "next_steps": []}
        ],
        "tools": ["web_search", "web_fetch"]
    },
    "aiops": {
        "name": "AIOps Agent",
        "description": "An agent for cloud infrastructure monitoring and incident response",
        "roles": [
            {
                "name": "monitor",
                "description": "Monitors infrastructure for issues",
                "goal": "Detect and alert on infrastructure problems",
                "tools": ["prometheus_query", "kubernetes_get_pods"]
            },
            {
                "name": "investigator",
                "description": "Investigates alerts and determines root cause",
                "goal": "Identify the root cause of infrastructure issues",
                "tools": ["prometheus_query", "kubernetes_get_logs", "kubernetes_describe"]
            },
            {
                "name": "responder",
                "description": "Takes remediation actions",
                "goal": "Resolve infrastructure issues with minimal downtime",
                "tools": ["kubernetes_scale", "kubernetes_restart"]
            }
        ],
        "steps": [
            {"name": "triage", "description": "Assess the alert severity", "agent": "monitor", "next_steps": ["investigate"]},
            {"name": "investigate", "description": "Determine root cause", "agent": "investigator", "next_steps": ["remediate", "escalate"]},
            {"name": "remediate", "description": "Apply automated fix", "agent": "responder", "next_steps": ["verify"]},
            {"name": "escalate", "description": "Alert human operators", "agent": "monitor", "next_steps": []},
            {"name": "verify", "description": "Verify the fix worked", "agent": "monitor", "next_steps": []}
        ],
        "tools": ["prometheus_query", "kubernetes_get_pods", "kubernetes_get_logs", "kubernetes_describe", "kubernetes_scale", "kubernetes_restart"]
    },
    "code_assistant": {
        "name": "Code Assistant",
        "description": "An agent that helps with code analysis, review, and generation",
        "roles": [
            {
                "name": "analyst",
                "description": "Analyzes code structure and patterns",
                "goal": "Understand code architecture and identify issues",
                "tools": ["openagentic_read_file", "openagentic_search"]
            },
            {
                "name": "generator",
                "description": "Generates and modifies code",
                "goal": "Write clean, efficient, and maintainable code",
                "tools": ["openagentic_write_file", "openagentic_execute"]
            },
            {
                "name": "reviewer",
                "description": "Reviews code for quality and best practices",
                "goal": "Ensure code quality and adherence to standards",
                "tools": ["openagentic_read_file"]
            }
        ],
        "steps": [
            {"name": "understand", "description": "Understand the request", "agent": "analyst", "next_steps": ["plan"]},
            {"name": "plan", "description": "Plan the implementation", "agent": "analyst", "next_steps": ["implement"]},
            {"name": "implement", "description": "Generate or modify code", "agent": "generator", "next_steps": ["review"]},
            {"name": "review", "description": "Review the changes", "agent": "reviewer", "next_steps": ["refine", "complete"]},
            {"name": "refine", "description": "Make improvements", "agent": "generator", "next_steps": ["review"]},
            {"name": "complete", "description": "Finalize the work", "agent": "analyst", "next_steps": []}
        ],
        "tools": ["openagentic_read_file", "openagentic_write_file", "openagentic_search", "openagentic_execute"]
    },
    "data_pipeline": {
        "name": "Data Pipeline Agent",
        "description": "An agent that orchestrates data processing workflows",
        "roles": [
            {
                "name": "extractor",
                "description": "Extracts data from various sources",
                "goal": "Reliably extract data from configured sources",
                "tools": ["web_fetch", "openagentic_execute"]
            },
            {
                "name": "transformer",
                "description": "Transforms and cleans data",
                "goal": "Clean and transform data for analysis",
                "tools": ["openagentic_execute"]
            },
            {
                "name": "loader",
                "description": "Loads data to destinations",
                "goal": "Load processed data to target systems",
                "tools": ["openagentic_execute"]
            }
        ],
        "steps": [
            {"name": "extract", "description": "Extract data from sources", "agent": "extractor", "next_steps": ["transform"]},
            {"name": "transform", "description": "Transform the data", "agent": "transformer", "next_steps": ["validate"]},
            {"name": "validate", "description": "Validate data quality", "agent": "transformer", "next_steps": ["load", "retry_extract"]},
            {"name": "retry_extract", "description": "Retry failed extraction", "agent": "extractor", "next_steps": ["transform"]},
            {"name": "load", "description": "Load to destination", "agent": "loader", "next_steps": []}
        ],
        "tools": ["web_fetch", "openagentic_execute"]
    }
}


# =============================================================================
# MCP SERVER
# =============================================================================

mcp = FastMCP("Agent Architect MCP")


@mcp.tool()
async def list_agent_templates() -> str:
    """
    List available agent templates for quick starts.

    Returns a list of pre-built agent configurations that can be used
    as starting points for custom agents.
    """
    templates = []
    for key, template in AGENT_TEMPLATES.items():
        templates.append({
            "id": key,
            "name": template["name"],
            "description": template["description"],
            "roles": [r["name"] for r in template.get("roles", [])],
            "tools": template.get("tools", [])
        })

    return json.dumps({"templates": templates}, indent=2)


@mcp.tool()
async def get_agent_template(template_id: str) -> str:
    """
    Get full details of an agent template.

    Args:
        template_id: The ID of the template (e.g., 'research', 'aiops', 'code_assistant')

    Returns the complete template specification.
    """
    if template_id not in AGENT_TEMPLATES:
        return json.dumps({"error": f"Template '{template_id}' not found. Use list_agent_templates to see available templates."})

    return json.dumps({"template": AGENT_TEMPLATES[template_id]}, indent=2)


@mcp.tool()
async def create_agent_from_template(
    template_id: str,
    name: Optional[str] = None,
    additional_tools: Optional[str] = None
) -> str:
    """
    Create an agent configuration from a template.

    STATUS: Not implemented. Native workflow engine code-gen is TBD.
    Use list_agent_templates / get_agent_template to browse templates
    and hand-author workflow definitions in the UI for now.
    """
    raise NotImplementedError(
        "Native workflow engine code-gen TBD — external framework code-gen removed 2026-04-11 v0.6.3"
    )


@mcp.tool()
async def design_custom_agent(
    description: str,
    tools: Optional[str] = None
) -> str:
    """
    Design a custom agent from a natural language description.

    STATUS: Not implemented. Native workflow engine code-gen is TBD.
    """
    raise NotImplementedError(
        "Native workflow engine code-gen TBD — external framework code-gen removed 2026-04-11 v0.6.3"
    )


@mcp.tool()
async def generate_agent_code(
    spec_json: str
) -> str:
    """
    Generate deployable code from an agent specification.

    STATUS: Not implemented. Native workflow engine code-gen is TBD.
    """
    raise NotImplementedError(
        "Native workflow engine code-gen TBD — external framework code-gen removed 2026-04-11 v0.6.3"
    )


@mcp.tool()
async def deploy_agent(
    spec_json: str
) -> str:
    """
    Deploy an agent to the native workflow engine.

    STATUS: Not implemented. Native workflow engine deployment is TBD.
    """
    raise NotImplementedError(
        "Native workflow engine deployment TBD — external framework deployment removed 2026-04-11 v0.6.3"
    )


@mcp.tool()
async def list_available_tools() -> str:
    """
    List all available MCP tools that can be used in agent workflows.

    Returns a categorized list of tools available via the MCP Proxy.
    """
    # This would normally query the MCP Proxy for available tools
    # For now, return a static list of common tools
    tools = {
        "web": [
            {"name": "web_search", "description": "Search the web for information"},
            {"name": "web_fetch", "description": "Fetch content from a URL"}
        ],
        "kubernetes": [
            {"name": "kubernetes_get_pods", "description": "List pods in a namespace"},
            {"name": "kubernetes_get_logs", "description": "Get logs from a pod"},
            {"name": "kubernetes_describe", "description": "Describe a Kubernetes resource"},
            {"name": "kubernetes_scale", "description": "Scale a deployment"},
            {"name": "kubernetes_restart", "description": "Restart a deployment"}
        ],
        "monitoring": [
            {"name": "prometheus_query", "description": "Query Prometheus metrics"},
            {"name": "prometheus_alerts", "description": "List active alerts"}
        ],
        "code": [
            {"name": "openagentic_read_file", "description": "Read a file from workspace"},
            {"name": "openagentic_write_file", "description": "Write a file to workspace"},
            {"name": "openagentic_search", "description": "Search for patterns in code"},
            {"name": "openagentic_execute", "description": "Execute a command in workspace"}
        ],
        "cloud": [
            {"name": "azure_list_resources", "description": "List Azure resources"},
            {"name": "aws_list_resources", "description": "List AWS resources"},
            {"name": "gcp_list_resources", "description": "List GCP resources"}
        ]
    }

    return json.dumps({"tools": tools}, indent=2)


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    mcp.run()
