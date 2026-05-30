

"""
Runbook MCP Server - FastMCP Implementation

Provides tools to execute automated remediation runbooks.
This enables LLMs to perform automated incident response actions.

IMPORTANT: This MCP server is available to ADMIN users only.
"""

import os
import sys
import json
import logging
import asyncio
import subprocess
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
from pathlib import Path
import uuid
import yaml

import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

# Configure structured logging via shared observability module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-runbook-mcp')
except ImportError:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        stream=sys.stderr
    )
    logger = logging.getLogger("runbook-mcp")

# Initialize FastMCP server
mcp = FastMCP("Runbook MCP Server - Automated Remediation")

# Runbook configuration
RUNBOOK_DIR = os.getenv("RUNBOOK_DIR", "/app/runbooks")
RUNBOOK_TIMEOUT = int(os.getenv("RUNBOOK_TIMEOUT", "300"))  # 5 minutes default
KUBERNETES_NAMESPACE = os.getenv("KUBERNETES_NAMESPACE", "openagentic")

# In-memory execution history (would be replaced with persistent storage in production)
execution_history: List[Dict[str, Any]] = []

# ============================================================================
# RUNBOOK DEFINITIONS
# ============================================================================

# Built-in runbooks for common remediation actions
BUILTIN_RUNBOOKS = {
    "restart-pod": {
        "name": "restart-pod",
        "description": "Restart a Kubernetes pod by deleting it (deployment will recreate)",
        "category": "kubernetes",
        "parameters": [
            {"name": "pod_name", "description": "Name or pattern of the pod to restart", "required": True},
            {"name": "namespace", "description": "Kubernetes namespace", "required": False, "default": "default"}
        ],
        "risk_level": "medium",
        "approx_duration": "30s-2m"
    },
    "scale-deployment": {
        "name": "scale-deployment",
        "description": "Scale a Kubernetes deployment up or down",
        "category": "kubernetes",
        "parameters": [
            {"name": "deployment", "description": "Name of the deployment", "required": True},
            {"name": "replicas", "description": "Number of replicas", "required": True},
            {"name": "namespace", "description": "Kubernetes namespace", "required": False, "default": "default"}
        ],
        "risk_level": "medium",
        "approx_duration": "30s-5m"
    },
    "rollback-deployment": {
        "name": "rollback-deployment",
        "description": "Rollback a Kubernetes deployment to previous revision",
        "category": "kubernetes",
        "parameters": [
            {"name": "deployment", "description": "Name of the deployment", "required": True},
            {"name": "namespace", "description": "Kubernetes namespace", "required": False, "default": "default"},
            {"name": "revision", "description": "Specific revision to rollback to (optional)", "required": False}
        ],
        "risk_level": "high",
        "approx_duration": "1m-5m"
    },
    "clear-redis-cache": {
        "name": "clear-redis-cache",
        "description": "Clear Redis cache (specific key pattern or all)",
        "category": "cache",
        "parameters": [
            {"name": "pattern", "description": "Key pattern to clear (e.g., 'session:*')", "required": False, "default": "*"},
            {"name": "redis_host", "description": "Redis host", "required": False, "default": "redis"}
        ],
        "risk_level": "high",
        "approx_duration": "5s-30s"
    },
    "restart-service": {
        "name": "restart-service",
        "description": "Restart a service by rolling restart of its deployment",
        "category": "kubernetes",
        "parameters": [
            {"name": "service", "description": "Name of the service/deployment", "required": True},
            {"name": "namespace", "description": "Kubernetes namespace", "required": False, "default": "default"}
        ],
        "risk_level": "medium",
        "approx_duration": "1m-5m"
    },
    "drain-node": {
        "name": "drain-node",
        "description": "Drain a Kubernetes node for maintenance",
        "category": "kubernetes",
        "parameters": [
            {"name": "node", "description": "Name of the node to drain", "required": True},
            {"name": "force", "description": "Force drain even with unmanaged pods", "required": False, "default": "false"}
        ],
        "risk_level": "critical",
        "approx_duration": "5m-30m"
    },
    "check-pod-resources": {
        "name": "check-pod-resources",
        "description": "Check resource usage of pods (CPU, memory)",
        "category": "diagnostics",
        "parameters": [
            {"name": "namespace", "description": "Kubernetes namespace", "required": False, "default": "default"},
            {"name": "pod_name", "description": "Specific pod name (optional)", "required": False}
        ],
        "risk_level": "low",
        "approx_duration": "5s-15s"
    },
    "check-service-health": {
        "name": "check-service-health",
        "description": "Check health endpoints of a service",
        "category": "diagnostics",
        "parameters": [
            {"name": "service", "description": "Service name", "required": True},
            {"name": "namespace", "description": "Kubernetes namespace", "required": False, "default": "default"},
            {"name": "port", "description": "Service port", "required": False, "default": "80"},
            {"name": "path", "description": "Health check path", "required": False, "default": "/health"}
        ],
        "risk_level": "low",
        "approx_duration": "5s-10s"
    },
    "collect-diagnostics": {
        "name": "collect-diagnostics",
        "description": "Collect diagnostic information for a service (logs, events, describe)",
        "category": "diagnostics",
        "parameters": [
            {"name": "service", "description": "Service/deployment name", "required": True},
            {"name": "namespace", "description": "Kubernetes namespace", "required": False, "default": "default"},
            {"name": "log_lines", "description": "Number of log lines to collect", "required": False, "default": "100"}
        ],
        "risk_level": "low",
        "approx_duration": "10s-30s"
    },
    "apply-resource-limits": {
        "name": "apply-resource-limits",
        "description": "Update resource limits for a deployment",
        "category": "kubernetes",
        "parameters": [
            {"name": "deployment", "description": "Deployment name", "required": True},
            {"name": "namespace", "description": "Kubernetes namespace", "required": False, "default": "default"},
            {"name": "cpu_limit", "description": "CPU limit (e.g., '500m', '1')", "required": False},
            {"name": "memory_limit", "description": "Memory limit (e.g., '512Mi', '1Gi')", "required": False}
        ],
        "risk_level": "medium",
        "approx_duration": "30s-2m"
    }
}

# ============================================================================
# RUNBOOK EXECUTION ENGINE
# ============================================================================

async def execute_kubectl(command: List[str], timeout: int = 60) -> Dict[str, Any]:
    """Execute a kubectl command"""
    try:
        full_cmd = ["kubectl"] + command
        logger.info(f"Executing: {' '.join(full_cmd)}")

        proc = await asyncio.create_subprocess_exec(
            *full_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return {
                "success": False,
                "error": f"Command timed out after {timeout}s",
                "command": " ".join(full_cmd)
            }

        return {
            "success": proc.returncode == 0,
            "stdout": stdout.decode() if stdout else "",
            "stderr": stderr.decode() if stderr else "",
            "return_code": proc.returncode,
            "command": " ".join(full_cmd)
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "command": " ".join(["kubectl"] + command)
        }

async def run_builtin_runbook(runbook_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a built-in runbook"""
    runbook = BUILTIN_RUNBOOKS.get(runbook_name)
    if not runbook:
        return {"success": False, "error": f"Unknown runbook: {runbook_name}"}

    execution_id = str(uuid.uuid4())[:8]
    start_time = datetime.utcnow()

    try:
        result = {"steps": [], "success": True}

        if runbook_name == "restart-pod":
            namespace = params.get("namespace", "default")
            pod_name = params.get("pod_name")

            # Get matching pods
            get_result = await execute_kubectl([
                "get", "pods", "-n", namespace,
                "-o", "name", f"--field-selector=metadata.name={pod_name}"
            ])

            if not get_result["success"]:
                # Try pattern matching
                get_result = await execute_kubectl([
                    "get", "pods", "-n", namespace,
                    "-o", "name"
                ])

            pods = [p.strip() for p in get_result.get("stdout", "").split("\n") if pod_name in p]

            if not pods:
                result["steps"].append({"action": "find_pods", "result": "No matching pods found"})
                result["success"] = False
            else:
                for pod in pods[:3]:  # Limit to 3 pods
                    delete_result = await execute_kubectl([
                        "delete", pod, "-n", namespace
                    ])
                    result["steps"].append({
                        "action": f"delete {pod}",
                        "success": delete_result["success"],
                        "output": delete_result.get("stdout", delete_result.get("error", ""))
                    })
                    if not delete_result["success"]:
                        result["success"] = False

        elif runbook_name == "scale-deployment":
            namespace = params.get("namespace", "default")
            deployment = params.get("deployment")
            replicas = params.get("replicas")

            scale_result = await execute_kubectl([
                "scale", "deployment", deployment,
                "-n", namespace,
                f"--replicas={replicas}"
            ])

            result["steps"].append({
                "action": f"scale {deployment} to {replicas}",
                "success": scale_result["success"],
                "output": scale_result.get("stdout", scale_result.get("error", ""))
            })
            result["success"] = scale_result["success"]

        elif runbook_name == "rollback-deployment":
            namespace = params.get("namespace", "default")
            deployment = params.get("deployment")
            revision = params.get("revision")

            cmd = ["rollout", "undo", f"deployment/{deployment}", "-n", namespace]
            if revision:
                cmd.append(f"--to-revision={revision}")

            rollback_result = await execute_kubectl(cmd)

            result["steps"].append({
                "action": f"rollback {deployment}",
                "success": rollback_result["success"],
                "output": rollback_result.get("stdout", rollback_result.get("error", ""))
            })
            result["success"] = rollback_result["success"]

        elif runbook_name == "restart-service":
            namespace = params.get("namespace", "default")
            service = params.get("service")

            restart_result = await execute_kubectl([
                "rollout", "restart", f"deployment/{service}", "-n", namespace
            ])

            result["steps"].append({
                "action": f"rollout restart {service}",
                "success": restart_result["success"],
                "output": restart_result.get("stdout", restart_result.get("error", ""))
            })
            result["success"] = restart_result["success"]

        elif runbook_name == "check-pod-resources":
            namespace = params.get("namespace", "default")
            pod_name = params.get("pod_name")

            cmd = ["top", "pods", "-n", namespace]
            if pod_name:
                cmd.extend(["--selector", f"app={pod_name}"])

            top_result = await execute_kubectl(cmd)

            result["steps"].append({
                "action": "get resource usage",
                "success": top_result["success"],
                "output": top_result.get("stdout", top_result.get("error", ""))
            })
            result["success"] = top_result["success"]

        elif runbook_name == "check-service-health":
            namespace = params.get("namespace", "default")
            service = params.get("service")
            port = params.get("port", "80")
            path = params.get("path", "/health")

            # Get service cluster IP
            svc_result = await execute_kubectl([
                "get", "svc", service, "-n", namespace,
                "-o", "jsonpath={.spec.clusterIP}"
            ])

            if svc_result["success"] and svc_result["stdout"]:
                cluster_ip = svc_result["stdout"].strip()
                # Use curl to check health
                health_cmd = ["run", "health-check", "--rm", "-i", "--restart=Never",
                             "--image=curlimages/curl:latest", "--",
                             "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                             f"http://{cluster_ip}:{port}{path}"]

                health_result = await execute_kubectl(health_cmd, timeout=30)
                result["steps"].append({
                    "action": f"health check {service}",
                    "success": health_result.get("stdout", "").strip() == "200",
                    "output": f"HTTP {health_result.get('stdout', 'N/A')}"
                })
            else:
                result["steps"].append({
                    "action": f"get service {service}",
                    "success": False,
                    "output": svc_result.get("error", "Service not found")
                })
                result["success"] = False

        elif runbook_name == "collect-diagnostics":
            namespace = params.get("namespace", "default")
            service = params.get("service")
            log_lines = params.get("log_lines", "100")

            # Get deployment description
            desc_result = await execute_kubectl([
                "describe", f"deployment/{service}", "-n", namespace
            ])
            result["steps"].append({
                "action": "describe deployment",
                "success": desc_result["success"],
                "output": desc_result.get("stdout", "")[:2000]  # Truncate
            })

            # Get recent events
            events_result = await execute_kubectl([
                "get", "events", "-n", namespace,
                "--field-selector", f"involvedObject.name={service}",
                "--sort-by=.lastTimestamp"
            ])
            result["steps"].append({
                "action": "get events",
                "success": events_result["success"],
                "output": events_result.get("stdout", "")[:1000]
            })

            # Get logs
            logs_result = await execute_kubectl([
                "logs", f"deployment/{service}", "-n", namespace,
                f"--tail={log_lines}"
            ])
            result["steps"].append({
                "action": "get logs",
                "success": logs_result["success"],
                "output": logs_result.get("stdout", "")[:3000]
            })

        else:
            result["success"] = False
            result["error"] = f"Runbook '{runbook_name}' execution not implemented"

        return result

    except Exception as e:
        logger.error(f"Error executing runbook {runbook_name}: {e}")
        return {"success": False, "error": str(e)}

    finally:
        # Record execution
        end_time = datetime.utcnow()
        execution_history.append({
            "id": execution_id,
            "runbook": runbook_name,
            "params": params,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "duration_seconds": (end_time - start_time).total_seconds(),
            "success": result.get("success", False)
        })

        # Keep only last 100 executions
        while len(execution_history) > 100:
            execution_history.pop(0)

# ============================================================================
# TOOL DEFINITIONS
# ============================================================================

@mcp.tool()
async def runbook_list() -> str:
    """
    List all available runbooks.

    Shows built-in runbooks for common remediation actions.
    Each runbook has a category, risk level, and required parameters.
    """
    try:
        output = [
            "=== Available Runbooks ===",
            ""
        ]

        # Group by category
        by_category: Dict[str, List] = {}
        for name, rb in BUILTIN_RUNBOOKS.items():
            cat = rb.get("category", "other")
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append((name, rb))

        for category in sorted(by_category.keys()):
            output.append(f"\n{category.upper()}:")
            output.append("-" * 40)

            for name, rb in sorted(by_category[category]):
                risk_icon = {"low": "🟢", "medium": "🟡", "high": "🟠", "critical": "🔴"}.get(rb["risk_level"], "⚪")
                output.append(f"\n{risk_icon} {name}")
                output.append(f"   {rb['description']}")
                output.append(f"   Risk: {rb['risk_level']} | Duration: ~{rb['approx_duration']}")

                required_params = [p for p in rb["parameters"] if p.get("required")]
                if required_params:
                    param_str = ", ".join(p["name"] for p in required_params)
                    output.append(f"   Required: {param_str}")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in runbook_list: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def runbook_describe(
    runbook: str = Field(description="Name of the runbook to describe")
) -> str:
    """
    Get detailed information about a runbook.

    Shows all parameters, their descriptions, and example usage.
    """
    try:
        rb = BUILTIN_RUNBOOKS.get(runbook)
        if not rb:
            available = ", ".join(BUILTIN_RUNBOOKS.keys())
            return f"Runbook '{runbook}' not found.\nAvailable runbooks: {available}"

        risk_icon = {"low": "🟢", "medium": "🟡", "high": "🟠", "critical": "🔴"}.get(rb["risk_level"], "⚪")

        output = [
            f"=== Runbook: {runbook} ===",
            "",
            f"Description: {rb['description']}",
            f"Category: {rb['category']}",
            f"Risk Level: {risk_icon} {rb['risk_level']}",
            f"Approx Duration: {rb['approx_duration']}",
            "",
            "Parameters:",
        ]

        for param in rb["parameters"]:
            required = "(required)" if param.get("required") else "(optional)"
            default = f" [default: {param['default']}]" if param.get("default") else ""
            output.append(f"  - {param['name']} {required}{default}")
            output.append(f"      {param['description']}")

        # Add example
        output.append("")
        output.append("Example usage:")
        example_params = {}
        for param in rb["parameters"]:
            if param.get("required"):
                example_params[param["name"]] = f"<{param['name']}>"
            elif param.get("default"):
                example_params[param["name"]] = param["default"]

        output.append(f"  runbook_execute(runbook=\"{runbook}\", params='{json.dumps(example_params)}')")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in runbook_describe: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def runbook_execute(
    runbook: str = Field(description="Name of the runbook to execute"),
    params: str = Field(description="Parameters as JSON object (e.g., '{\"pod_name\": \"nginx\", \"namespace\": \"default\"}')")
) -> str:
    """
    Execute a runbook with the given parameters.

    WARNING: This will perform real actions on your infrastructure.
    Review the runbook description and parameters before executing.
    """
    try:
        rb = BUILTIN_RUNBOOKS.get(runbook)
        if not rb:
            return f"Runbook '{runbook}' not found"

        try:
            param_dict = json.loads(params)
        except json.JSONDecodeError:
            return f"Invalid JSON for params: {params}"

        # Validate required parameters
        for p in rb["parameters"]:
            if p.get("required") and p["name"] not in param_dict:
                return f"Missing required parameter: {p['name']}"

        # Add defaults
        for p in rb["parameters"]:
            if p["name"] not in param_dict and p.get("default"):
                param_dict[p["name"]] = p["default"]

        risk_icon = {"low": "🟢", "medium": "🟡", "high": "🟠", "critical": "🔴"}.get(rb["risk_level"], "⚪")

        output = [
            f"=== Executing Runbook: {runbook} ===",
            f"Risk Level: {risk_icon} {rb['risk_level']}",
            f"Parameters: {json.dumps(param_dict)}",
            "",
            "Execution Log:",
            "-" * 40
        ]

        # Execute the runbook
        result = await run_builtin_runbook(runbook, param_dict)

        # Format results
        for step in result.get("steps", []):
            status = "✅" if step.get("success") else "❌"
            output.append(f"\n{status} {step.get('action', 'unknown action')}")
            if step.get("output"):
                # Truncate long output
                step_output = step["output"][:1000]
                if len(step["output"]) > 1000:
                    step_output += "... (truncated)"
                output.append(step_output)

        output.append("")
        output.append("-" * 40)

        if result.get("success"):
            output.append("✅ Runbook completed successfully")
        else:
            output.append(f"❌ Runbook failed: {result.get('error', 'Unknown error')}")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in runbook_execute: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def runbook_history(
    limit: int = Field(default=10, description="Number of recent executions to show")
) -> str:
    """
    Get history of runbook executions.

    Shows recent runbook executions with their status and duration.
    """
    try:
        if not execution_history:
            return "No runbook executions recorded"

        output = [
            "=== Runbook Execution History ===",
            f"Showing last {min(limit, len(execution_history))} executions",
            "=" * 60,
            ""
        ]

        for exec_record in reversed(execution_history[-limit:]):
            status = "✅" if exec_record["success"] else "❌"
            output.append(f"{status} {exec_record['runbook']}")
            output.append(f"   ID: {exec_record['id']}")
            output.append(f"   Time: {exec_record['start_time']}")
            output.append(f"   Duration: {exec_record['duration_seconds']:.1f}s")
            output.append(f"   Params: {json.dumps(exec_record['params'])}")
            output.append("")

        return "\n".join(output)

    except Exception as e:
        logger.error(f"Error in runbook_history: {e}")
        return f"Error: {str(e)}"

@mcp.tool()
async def runbook_quick_restart(
    service: str = Field(description="Service/deployment name to restart"),
    namespace: str = Field(default="openagentic", description="Kubernetes namespace")
) -> str:
    """
    Quick helper to restart a service (rolling restart).

    This is a convenience wrapper around the restart-service runbook.
    """
    return await runbook_execute(
        runbook="restart-service",
        params=json.dumps({"service": service, "namespace": namespace})
    )

@mcp.tool()
async def runbook_quick_scale(
    deployment: str = Field(description="Deployment name to scale"),
    replicas: int = Field(description="Number of replicas"),
    namespace: str = Field(default="openagentic", description="Kubernetes namespace")
) -> str:
    """
    Quick helper to scale a deployment.

    This is a convenience wrapper around the scale-deployment runbook.
    """
    return await runbook_execute(
        runbook="scale-deployment",
        params=json.dumps({"deployment": deployment, "replicas": replicas, "namespace": namespace})
    )

@mcp.tool()
async def runbook_quick_diagnostics(
    service: str = Field(description="Service/deployment name to diagnose"),
    namespace: str = Field(default="openagentic", description="Kubernetes namespace")
) -> str:
    """
    Quick helper to collect diagnostics for a service.

    Collects deployment info, events, and logs for troubleshooting.
    """
    return await runbook_execute(
        runbook="collect-diagnostics",
        params=json.dumps({"service": service, "namespace": namespace})
    )

# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

def main():
    """Run the MCP server"""
    logger.info(f"Starting Runbook MCP Server (Runbook dir: {RUNBOOK_DIR})")
    mcp.run()

if __name__ == "__main__":
    main()
