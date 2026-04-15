# Agent Architect MCP Server

Natural language agent/workflow creation for OpenAgentic.

## Overview

The Agent Architect MCP server enables users to create AI agents and workflows using natural language descriptions. It acts as a "meta-agent" that helps design and deploy agents without requiring knowledge of the underlying workflow syntax.

## Orchestration

All agents and workflows compile to the native OpenAgentic workflow engine
(`openagentic-workflows`). Nodes include `agent_spawn`, `agent_pool`,
`agent_supervisor`, `mcp_tool`, `llm_completion`, `condition`, `loop`,
`human_approval`, and more — see `WorkflowCompiler` for the full list.

## Available Tools

### `list_agent_templates`
List pre-built agent templates for quick starts.

```
Templates:
- research: Research Agent - Web search and synthesis
- aiops: AIOps Agent - Infrastructure monitoring and response
- code_assistant: Code Assistant - Code analysis, review, generation
- data_pipeline: Data Pipeline Agent - ETL workflows
```

### `get_agent_template`
Get full details of a specific template.

### `create_agent_from_template`
Create an agent configuration from a template with optional customizations.

```json
{
  "template_id": "research",
  "name": "My Research Bot",
  "additional_tools": "memory_store,diagram_generate"
}
```

### `design_custom_agent`
Design a custom agent from natural language description.

```json
{
  "description": "Create an agent that monitors Kubernetes pods and automatically restarts failed ones",
  "tools": "kubernetes_get_pods,kubernetes_restart,prometheus_query"
}
```

### `generate_agent_code`
Generate a deployable workflow definition from an agent specification.

### `deploy_agent`
Deploy an agent directly to the native workflow engine.

### `list_available_tools`
List all MCP tools that can be used in agent workflows.

### `get_framework_status`
Check the health status of the workflow engine.

## Example Usage

### Chat Mode
```
User: "Create a research agent that can search the web and summarize findings"

OpenAgentic: I'll use the Agent Architect to create this for you.
[Calls create_agent_from_template with template_id="research"]

Here's your Research Agent configuration:
- 2 roles: Researcher (web search) and Analyzer (synthesis)
- 3 workflow steps: analyze_request -> search -> synthesize
- Tools: web_search, web_fetch

Would you like me to:
1. Deploy this now?
2. Generate the workflow JSON for manual review?
3. Customize the roles or workflow?
```

## Environment Variables

```bash
WORKFLOWS_URL=http://openagentic-workflows:3000
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Chat/Code Mode UI                        │
│              "Create a research agent..."                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      MCP Proxy                               │
│              Routes to Agent Architect MCP                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Agent Architect MCP                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │  Templates  │ │  Designer   │ │  Deployer   │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │ openagentic-      │
                    │ workflows (native)│
                    └───────────────────┘
```

## Running Locally

```bash
cd services/mcps/oap-agent-architect-mcp
pip install -r requirements.txt
python server.py
```

## Running via MCP Proxy

The Agent Architect MCP is registered in the MCP Proxy configuration:

```yaml
# config/mcp_servers.yaml
servers:
  - name: agent-architect
    command: python
    args: ["/app/mcps/oap-agent-architect-mcp/server.py"]
    env:
      WORKFLOWS_URL: "http://openagentic-workflows:3000"
```
