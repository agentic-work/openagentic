# Proprietary and confidential. Unauthorized copying prohibited.

"""
Workflow MCP Tools - Manage workflows from chat/code mode via MCP

These tools are available to all authenticated users (not admin-only)
and proxy through to the OpenAgentic API's workflow endpoints.
"""

import os
import json
import logging
import httpx
from typing import Any, Dict, List, Optional

from .server import mcp

logger = logging.getLogger("admin-mcp.workflow-tools")

# API base URL - resolves to the openagentic-api service inside k8s
API_BASE = os.getenv("API_BASE_URL", "http://openagentic-api:8000")

async def _api_call(
    method: str,
    path: str,
    body: Optional[Dict] = None,
    params: Optional[Dict] = None,
    timeout: float = 30.0,
) -> Dict[str, Any]:
    """Make an internal API call to the workflow endpoints."""
    url = f"{API_BASE}/api/workflows{path}"
    headers = {"Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.request(
            method=method,
            url=url,
            json=body,
            params=params,
            headers=headers,
        )

        if response.status_code >= 400:
            error_data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {"error": response.text}
            return {"success": False, "error": error_data.get("error", response.text), "status": response.status_code}

        return {"success": True, "data": response.json(), "status": response.status_code}

# ============================================================================
# READ OPERATIONS
# ============================================================================

@mcp.tool(description="List the user's workflows with status and stats. Returns workflow names, node counts, execution counts, and status. Use to discover available workflows before operating on them.")
async def workflow_list(
    limit: int = 20,
    category: Optional[str] = None,
    search: Optional[str] = None,
) -> Dict[str, Any]:
    """List user's workflows."""
    params: Dict[str, Any] = {"limit": limit}
    if category:
        params["category"] = category
    if search:
        params["search"] = search

    result = await _api_call("GET", "", params=params)
    if not result["success"]:
        return result

    workflows = result["data"].get("workflows", [])
    return {
        "success": True,
        "count": len(workflows),
        "workflows": [
            {
                "id": w["id"],
                "name": w["name"],
                "description": w.get("description", ""),
                "status": w.get("status", "draft"),
                "node_count": len(w.get("nodes", [])),
                "execution_count": w.get("executionCount", 0),
                "created_at": w.get("created_at"),
            }
            for w in workflows
        ],
    }

@mcp.tool(description="Get a workflow's full definition by ID, including all nodes, edges, and configuration. Use after workflow_list to inspect a specific workflow.")
async def workflow_get(workflow_id: str) -> Dict[str, Any]:
    """Get workflow definition by ID."""
    result = await _api_call("GET", f"/{workflow_id}")
    if not result["success"]:
        return result
    return {"success": True, "workflow": result["data"].get("workflow", result["data"])}

@mcp.tool(description="List recent executions for a workflow. Shows execution status, duration, timestamps, and error info.")
async def workflow_execution_list(
    workflow_id: str,
    limit: int = 10,
) -> Dict[str, Any]:
    """List recent executions."""
    result = await _api_call("GET", f"/{workflow_id}/executions", params={"limit": limit})
    if not result["success"]:
        return result
    return {"success": True, "executions": result["data"].get("executions", [])}

@mcp.tool(description="Get detailed execution info including per-node I/O, logs, and timing. Use to debug a specific execution run.")
async def workflow_execution_get(
    workflow_id: str,
    execution_id: str,
) -> Dict[str, Any]:
    """Get execution detail with per-node I/O."""
    result = await _api_call("GET", f"/{workflow_id}/executions/{execution_id}")
    if not result["success"]:
        return result
    return {"success": True, **result["data"]}

# ============================================================================
# WRITE OPERATIONS
# ============================================================================

@mcp.tool(description="Create a new workflow from a JSON definition containing nodes and edges. Each node has: id, type (trigger/llm_completion/code/http_request/condition/etc.), position {x,y}, and data {label, ...config}. Edges connect nodes: {id, source, target}.")
async def workflow_create(
    name: str,
    definition: Dict[str, Any],
    description: str = "",
    tags: Optional[List[str]] = None,
    category: Optional[str] = None,
) -> Dict[str, Any]:
    """Create workflow from JSON definition."""
    body: Dict[str, Any] = {
        "name": name,
        "description": description,
        "definition": definition,
    }
    if tags:
        body["tags"] = tags
    if category:
        body["category"] = category

    result = await _api_call("POST", "", body=body)
    if not result["success"]:
        return result

    workflow = result["data"].get("workflow", result["data"])
    return {
        "success": True,
        "workflow_id": workflow.get("id"),
        "name": workflow.get("name"),
        "message": f"Workflow '{name}' created successfully with {len(definition.get('nodes', []))} nodes.",
    }

@mcp.tool(description="Create a workflow from a natural language description. Describe what the workflow should do and the AI will generate the node graph. Example: 'Monitor an S3 bucket for new CSV files, parse them, classify content with Claude, and send a Slack notification with the summary.'")
async def workflow_create_from_description(
    description: str,
    name: Optional[str] = None,
) -> Dict[str, Any]:
    """AI generates workflow definition from natural language description."""
    # Parse the description into a workflow structure
    # This is a simplified version - the full AI generation happens via the existing
    # AIFlowBuilder/useAIFlowChat hook on the frontend. For MCP, we create a
    # reasonable skeleton and let the user refine it.

    workflow_name = name or f"AI Flow: {description[:50]}"

    # Create a basic workflow with a trigger and an LLM node
    definition = {
        "nodes": [
            {
                "id": "trigger-1",
                "type": "trigger",
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": "Start",
                    "triggerType": "manual",
                    "icon": "Zap",
                    "color": "#ff9800",
                },
            },
            {
                "id": "llm-1",
                "type": "openagentic_llm",
                "position": {"x": 300, "y": 0},
                "data": {
                    "label": "AI Processing",
                    "prompt": description,
                    "temperature": 0.7,
                    "maxTokens": 2000,
                    "icon": "Brain",
                    "color": "#7c4dff",
                },
            },
        ],
        "edges": [
            {
                "id": "e-1",
                "source": "trigger-1",
                "target": "llm-1",
                "animated": True,
            },
        ],
    }

    body = {
        "name": workflow_name,
        "description": description,
        "definition": definition,
        "tags": ["ai-generated"],
    }

    result = await _api_call("POST", "", body=body)
    if not result["success"]:
        return result

    workflow = result["data"].get("workflow", result["data"])
    return {
        "success": True,
        "workflow_id": workflow.get("id"),
        "name": workflow.get("name"),
        "message": f"Workflow '{workflow_name}' created from description. Open it in Flows mode to refine the node graph.",
        "tip": "Use the AI Builder in Flows mode for more sophisticated workflow generation with multi-node graphs.",
    }

@mcp.tool(description="Update an existing workflow's definition, name, description, or configuration. Pass only the fields you want to change.")
async def workflow_update(
    workflow_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    definition: Optional[Dict[str, Any]] = None,
    tags: Optional[List[str]] = None,
    status: Optional[str] = None,
) -> Dict[str, Any]:
    """Update workflow definition/config."""
    body: Dict[str, Any] = {}
    if name is not None:
        body["name"] = name
    if description is not None:
        body["description"] = description
    if definition is not None:
        body["definition"] = definition
    if tags is not None:
        body["tags"] = tags
    if status is not None:
        body["status"] = status

    if not body:
        return {"success": False, "error": "No fields to update"}

    result = await _api_call("PUT", f"/{workflow_id}", body=body)
    if not result["success"]:
        return result

    return {"success": True, "message": f"Workflow updated successfully."}

@mcp.tool(description="Execute a saved workflow by ID. Triggers the workflow engine and returns the execution ID. Pass optional input data for the trigger node.")
async def workflow_execute(
    workflow_id: str,
    input_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Trigger workflow execution."""
    body = {"input": input_data or {}}
    result = await _api_call("POST", f"/{workflow_id}/execute", body=body, timeout=120.0)
    if not result["success"]:
        return result

    return {
        "success": True,
        "message": "Workflow execution started.",
        "execution_id": result["data"].get("executionId") or result["data"].get("execution", {}).get("id"),
    }

@mcp.tool(description="Execute a published workflow by name. Searches for the workflow, then executes it. Returns the execution results. Use this when you know the workflow name but not the ID.")
async def workflow_execute_by_name(
    workflow_name: str,
    input_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Find a workflow by name and execute it."""
    # Step 1: Search for the workflow by name
    search_result = await _api_call("GET", "", params={"search": workflow_name, "limit": 5})
    if not search_result["success"]:
        return search_result

    workflows = search_result["data"].get("workflows", [])
    if not workflows:
        return {"success": False, "error": f"No workflow found matching '{workflow_name}'"}

    # Find exact match first, then fall back to first result
    matched = None
    for w in workflows:
        if w.get("name", "").lower() == workflow_name.lower():
            matched = w
            break
    if not matched:
        matched = workflows[0]

    workflow_id = matched["id"]
    logger.info(f"Resolved workflow name '{workflow_name}' to ID '{workflow_id}' ('{matched.get('name')}')")

    # Step 2: Execute it
    body = {"input": input_data or {}}
    result = await _api_call("POST", f"/{workflow_id}/execute", body=body, timeout=120.0)
    if not result["success"]:
        return result

    return {
        "success": True,
        "message": f"Workflow '{matched.get('name')}' execution started.",
        "workflow_id": workflow_id,
        "workflow_name": matched.get("name"),
        "execution_id": result["data"].get("executionId") or result["data"].get("execution", {}).get("id"),
    }

@mcp.tool(description="Check the status of a workflow execution by execution ID. Returns status, duration, node results, and any errors. Does not require the workflow ID.")
async def workflow_status(
    execution_id: str,
) -> Dict[str, Any]:
    """Check execution status by execution ID (no workflow ID needed)."""
    # Use the global executions endpoint that doesn't require workflow_id
    url = f"{API_BASE}/api/workflows/executions"
    headers = {"Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url, params={"limit": 50}, headers=headers)

        if response.status_code >= 400:
            # Fall back: try to find the execution in recent executions
            return {"success": False, "error": f"Failed to query executions (HTTP {response.status_code})"}

        data = response.json()
        executions = data.get("executions", [])

        # Find the matching execution
        for ex in executions:
            if ex.get("id") == execution_id:
                node_outputs = ex.get("node_outputs", {})
                completed_nodes = sum(
                    1 for n in node_outputs.values()
                    if isinstance(n, dict) and n.get("status") in ("completed", "success")
                )
                failed_nodes = sum(
                    1 for n in node_outputs.values()
                    if isinstance(n, dict) and n.get("status") in ("failed", "error")
                )

                return {
                    "success": True,
                    "execution_id": execution_id,
                    "status": ex.get("status", "unknown"),
                    "workflow_id": ex.get("workflow_id"),
                    "started_at": ex.get("started_at") or ex.get("created_at"),
                    "completed_at": ex.get("completed_at"),
                    "duration_ms": ex.get("execution_time_ms"),
                    "total_nodes": len(node_outputs),
                    "completed_nodes": completed_nodes,
                    "failed_nodes": failed_nodes,
                    "errors": [
                        {"node": nid, "error": nd.get("error", "")}
                        for nid, nd in node_outputs.items()
                        if isinstance(nd, dict) and nd.get("status") in ("failed", "error")
                    ],
                }

        return {"success": False, "error": f"Execution '{execution_id}' not found in recent executions"}

@mcp.tool(description="Delete a workflow (soft delete). The workflow can be restored by an admin.")
async def workflow_delete(workflow_id: str) -> Dict[str, Any]:
    """Soft delete a workflow."""
    result = await _api_call("DELETE", f"/{workflow_id}")
    if not result["success"]:
        return result
    return {"success": True, "message": "Workflow deleted."}

# ============================================================================
# ADVANCED OPERATIONS
# ============================================================================

@mcp.tool(description="Duplicate an existing workflow, creating a copy with '(Copy)' appended to the name. Useful for creating variations of a working workflow.")
async def workflow_duplicate(workflow_id: str) -> Dict[str, Any]:
    """Clone an existing workflow."""
    result = await _api_call("POST", f"/{workflow_id}/duplicate")
    if not result["success"]:
        return result

    workflow = result["data"].get("workflow", result["data"])
    return {
        "success": True,
        "workflow_id": workflow.get("id"),
        "name": workflow.get("name"),
        "message": "Workflow duplicated successfully.",
    }

@mcp.tool(description="Test a workflow definition without saving it to the database. Useful for dry runs and validation before committing changes.")
async def workflow_test(
    definition: Dict[str, Any],
    input_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Test workflow without saving (dry run)."""
    body = {
        "nodes": definition.get("nodes", []),
        "edges": definition.get("edges", []),
        "input": input_data or {},
    }
    result = await _api_call("POST", "/test", body=body, timeout=120.0)
    if not result["success"]:
        return result
    return {"success": True, "message": "Workflow test completed.", "result": result["data"]}
