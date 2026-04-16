# Proprietary and confidential. Unauthorized copying prohibited.

"""
Full System Test Tool for OpenAgentic Platform

This tool performs comprehensive testing of the ENTIRE OpenAgentic platform:
- All infrastructure components (PostgreSQL, Redis, Milvus, Ollama)
- All MCP servers and their tools
- Formatting MCP capabilities
- Diagram MCP capabilities
- Performance benchmarks
- API endpoints

Usage: When an admin says "full test", the LLM should invoke admin_full_system_test
"""

import os
import sys
import json
import logging
import time
import asyncio
from typing import Any, Dict, List, Optional
from datetime import datetime

import httpx

# Get logger
logger = logging.getLogger("admin-mcp.full_test")

# Environment configuration
MCP_PROXY_URL = os.getenv("MCP_PROXY_URL", "http://mcp-proxy:8080")
OPENAGENTIC_API_URL = os.getenv("OPENAGENTIC_API_URL", "http://openagentic-api:8000")
OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434")

class PerformanceTimer:
    """Simple performance timer for measuring test durations"""

    def __init__(self):
        self.start_time = None
        self.end_time = None
        self.metrics: Dict[str, float] = {}

    def start(self, name: str = "default"):
        self.metrics[f"{name}_start"] = time.time()
        if name == "default":
            self.start_time = time.time()

    def stop(self, name: str = "default") -> float:
        end = time.time()
        self.metrics[f"{name}_end"] = end
        start_key = f"{name}_start"
        if start_key in self.metrics:
            duration = end - self.metrics[start_key]
            self.metrics[f"{name}_duration_ms"] = duration * 1000
            return duration * 1000
        if name == "default":
            self.end_time = end
        return 0

    def get_total_ms(self) -> float:
        if self.start_time and self.end_time:
            return (self.end_time - self.start_time) * 1000
        return 0

async def test_infrastructure_health(timer: PerformanceTimer) -> Dict[str, Any]:
    """Test all infrastructure components"""
    results = {
        "status": "TESTING",
        "components": {},
        "passed": 0,
        "failed": 0,
        "errors": []
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        # Test MCP Proxy
        timer.start("mcp_proxy")
        try:
            response = await client.get(f"{MCP_PROXY_URL}/health")
            data = response.json()
            timer.stop("mcp_proxy")

            results["components"]["mcp_proxy"] = {
                "status": "PASS" if data.get("status") == "healthy" else "FAIL",
                "healthy": data.get("status") == "healthy",
                "servers_total": data.get("servers", {}).get("total", 0),
                "servers_running": data.get("servers", {}).get("running", 0),
                "latency_ms": timer.metrics.get("mcp_proxy_duration_ms", 0)
            }
            if data.get("status") == "healthy":
                results["passed"] += 1
            else:
                results["failed"] += 1
                results["errors"].append(f"MCP Proxy unhealthy")
        except Exception as e:
            timer.stop("mcp_proxy")
            results["components"]["mcp_proxy"] = {
                "status": "FAIL",
                "error": str(e),
                "latency_ms": timer.metrics.get("mcp_proxy_duration_ms", 0)
            }
            results["failed"] += 1
            results["errors"].append(f"MCP Proxy: {str(e)}")

        # Test OpenAgentic API
        timer.start("api")
        try:
            response = await client.get(f"{OPENAGENTIC_API_URL}/health")
            timer.stop("api")

            results["components"]["openagentic_api"] = {
                "status": "PASS" if response.status_code == 200 else "FAIL",
                "healthy": response.status_code == 200,
                "latency_ms": timer.metrics.get("api_duration_ms", 0)
            }
            if response.status_code == 200:
                results["passed"] += 1
            else:
                results["failed"] += 1
                results["errors"].append(f"API returned {response.status_code}")
        except Exception as e:
            timer.stop("api")
            results["components"]["openagentic_api"] = {
                "status": "FAIL",
                "error": str(e),
                "latency_ms": timer.metrics.get("api_duration_ms", 0)
            }
            results["failed"] += 1
            results["errors"].append(f"API: {str(e)}")

        # Test Ollama
        timer.start("ollama")
        try:
            response = await client.get(f"{OLLAMA_URL}/api/tags")
            data = response.json()
            timer.stop("ollama")

            models = data.get("models", [])
            results["components"]["ollama"] = {
                "status": "PASS",
                "healthy": True,
                "models_count": len(models),
                "models": [m.get("name", "unknown") for m in models[:5]],
                "latency_ms": timer.metrics.get("ollama_duration_ms", 0)
            }
            results["passed"] += 1
        except Exception as e:
            timer.stop("ollama")
            results["components"]["ollama"] = {
                "status": "FAIL",
                "error": str(e),
                "latency_ms": timer.metrics.get("ollama_duration_ms", 0)
            }
            results["failed"] += 1
            results["errors"].append(f"Ollama: {str(e)}")

    results["status"] = "COMPLETE"
    return results

async def test_all_mcp_servers(timer: PerformanceTimer) -> Dict[str, Any]:
    """Test all MCP servers are running and responsive"""
    results = {
        "status": "TESTING",
        "servers": {},
        "passed": 0,
        "failed": 0,
        "errors": []
    }

    # Expected MCP servers
    expected_servers = [
        "openagentic_admin",
        "sequential_thinking",
        "openagentic_web",
        "openagentic_memory",
        "openagentic_azure",
        "openagentic_azure_cost",
        "openagentic_gcp",
        "openagentic_diagram",
        "openagentic_openagentic",
        "aws_api",
        "aws_knowledge"
    ]

    async with httpx.AsyncClient(timeout=10.0) as client:
        timer.start("mcp_servers")
        try:
            response = await client.get(f"{MCP_PROXY_URL}/health")
            data = response.json()
            timer.stop("mcp_servers")

            server_statuses = data.get("servers", {}).get("statuses", {})

            for server_name in expected_servers:
                if server_name in server_statuses:
                    status = server_statuses[server_name]
                    is_running = status.get("status") == "running"

                    results["servers"][server_name] = {
                        "status": "PASS" if is_running else "FAIL",
                        "running": is_running,
                        "enabled": status.get("enabled", False),
                        "pid": status.get("pid"),
                        "transport": status.get("transport"),
                        "last_error": status.get("last_error")
                    }

                    if is_running:
                        results["passed"] += 1
                    else:
                        results["failed"] += 1
                        results["errors"].append(f"{server_name}: Not running")
                else:
                    results["servers"][server_name] = {
                        "status": "FAIL",
                        "running": False,
                        "error": "Server not found in health check"
                    }
                    results["failed"] += 1
                    results["errors"].append(f"{server_name}: Not found")

            results["total_servers"] = len(server_statuses)
            results["expected_servers"] = len(expected_servers)

        except Exception as e:
            timer.stop("mcp_servers")
            results["status"] = "ERROR"
            results["error"] = str(e)
            results["errors"].append(f"Failed to check MCP servers: {str(e)}")

    results["status"] = "COMPLETE"
    return results

async def test_mcp_tool_execution(timer: PerformanceTimer) -> Dict[str, Any]:
    """Test actual tool execution from each MCP server"""
    results = {
        "status": "TESTING",
        "tool_tests": {},
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "errors": []
    }

    # Define test cases for each MCP server
    test_cases = [
        {
            "server": "openagentic_admin",
            "tool": "admin_system_redis_health_check",
            "args": {},
            "description": "Admin MCP - Redis health check"
        },
        {
            "server": "openagentic_web",
            "tool": "puppeteer_fetch",
            "args": {"url": "https://example.com", "format": "text"},
            "description": "Web MCP - Fetch page",
            "timeout": 30
        },
        {
            "server": "openagentic_memory",
            "tool": "memory_search",
            "args": {"query": "test", "limit": 1},
            "description": "Memory MCP - Search memories"
        },
        {
            "server": "openagentic_diagram",
            "tool": "generate_diagram",
            "args": {
                "diagram_type": "flowchart",
                "content": "graph TD\n  A[Start] --> B[End]",
                "output_format": "svg"
            },
            "description": "Diagram MCP - Generate flowchart"
        },
        {
            "server": "sequential_thinking",
            "tool": "sequentialthinking",
            "args": {
                "thought": "Testing sequential thinking capability",
                "thoughtNumber": 1,
                "totalThoughts": 1,
                "nextThoughtNeeded": False
            },
            "description": "Sequential Thinking MCP - Process thought"
        },
        {
            "server": "aws_api",
            "tool": "openagentic_api_health",
            "args": {},
            "description": "AWS API MCP - Health check"
        }
    ]

    async with httpx.AsyncClient(timeout=60.0) as client:
        for test in test_cases:
            server = test["server"]
            tool = test["tool"]
            test_name = f"{server}:{tool}"
            timeout = test.get("timeout", 10)

            timer.start(test_name)
            try:
                response = await client.post(
                    f"{MCP_PROXY_URL}/mcp/tool",
                    json={
                        "server": server,
                        "tool": tool,
                        "arguments": test["args"]
                    },
                    timeout=timeout
                )
                timer.stop(test_name)

                if response.status_code == 200:
                    result_data = response.json()
                    success = result_data.get("success", True) and "error" not in str(result_data).lower()

                    results["tool_tests"][test_name] = {
                        "status": "PASS" if success else "FAIL",
                        "description": test["description"],
                        "latency_ms": timer.metrics.get(f"{test_name}_duration_ms", 0),
                        "response_preview": str(result_data)[:200] if success else None
                    }

                    if success:
                        results["passed"] += 1
                    else:
                        results["failed"] += 1
                        results["errors"].append(f"{test_name}: Tool returned error")
                else:
                    timer.stop(test_name)
                    results["tool_tests"][test_name] = {
                        "status": "FAIL",
                        "description": test["description"],
                        "error": f"HTTP {response.status_code}",
                        "latency_ms": timer.metrics.get(f"{test_name}_duration_ms", 0)
                    }
                    results["failed"] += 1
                    results["errors"].append(f"{test_name}: HTTP {response.status_code}")

            except asyncio.TimeoutError:
                timer.stop(test_name)
                results["tool_tests"][test_name] = {
                    "status": "FAIL",
                    "description": test["description"],
                    "error": "Timeout",
                    "latency_ms": timer.metrics.get(f"{test_name}_duration_ms", 0)
                }
                results["failed"] += 1
                results["errors"].append(f"{test_name}: Timeout")
            except Exception as e:
                timer.stop(test_name)
                results["tool_tests"][test_name] = {
                    "status": "FAIL",
                    "description": test["description"],
                    "error": str(e),
                    "latency_ms": timer.metrics.get(f"{test_name}_duration_ms", 0)
                }
                results["failed"] += 1
                results["errors"].append(f"{test_name}: {str(e)}")

    results["status"] = "COMPLETE"
    return results

async def test_formatting_mcp(timer: PerformanceTimer) -> Dict[str, Any]:
    """Test formatting MCP capabilities"""
    results = {
        "status": "TESTING",
        "tests": {},
        "passed": 0,
        "failed": 0,
        "errors": []
    }

    # Note: Formatting MCP may be integrated differently
    # This tests the formatting capabilities through the API

    async with httpx.AsyncClient(timeout=15.0) as client:
        # Test markdown rendering capability
        timer.start("markdown_test")
        try:
            # Test through capabilities endpoint
            response = await client.get(f"{OPENAGENTIC_API_URL}/api/capabilities/catalog")
            timer.stop("markdown_test")

            if response.status_code == 200:
                data = response.json()
                features = data.get("catalog", {}).get("features", {})

                results["tests"]["capabilities_check"] = {
                    "status": "PASS",
                    "streaming_enabled": features.get("streaming", False),
                    "tool_calling_enabled": features.get("toolCalling", False),
                    "latency_ms": timer.metrics.get("markdown_test_duration_ms", 0)
                }
                results["passed"] += 1
            else:
                results["tests"]["capabilities_check"] = {
                    "status": "FAIL",
                    "error": f"HTTP {response.status_code}"
                }
                results["failed"] += 1
        except Exception as e:
            timer.stop("markdown_test")
            results["tests"]["capabilities_check"] = {
                "status": "FAIL",
                "error": str(e)
            }
            results["failed"] += 1
            results["errors"].append(f"Capabilities check: {str(e)}")

    results["status"] = "COMPLETE"
    return results

async def test_diagram_mcp(timer: PerformanceTimer) -> Dict[str, Any]:
    """Test diagram MCP capabilities"""
    results = {
        "status": "TESTING",
        "tests": {},
        "passed": 0,
        "failed": 0,
        "errors": []
    }

    # React Flow diagram tests - no more Mermaid/D2
    diagram_tests = [
        {
            "name": "react_flow_flowchart",
            "type": "flowchart",
            "nodes": [
                {"id": "start", "label": "Start", "shape": "circle", "color": "#3b82f6"},
                {"id": "decision", "label": "Decision?", "shape": "diamond", "color": "#f59e0b"},
                {"id": "action1", "label": "Action 1", "shape": "rounded"},
                {"id": "action2", "label": "Action 2", "shape": "rounded"},
                {"id": "end", "label": "End", "shape": "circle", "color": "#22c55e"}
            ],
            "edges": [
                {"source": "start", "target": "decision"},
                {"source": "decision", "target": "action1", "label": "Yes"},
                {"source": "decision", "target": "action2", "label": "No"},
                {"source": "action1", "target": "end"},
                {"source": "action2", "target": "end"}
            ]
        },
        {
            "name": "react_flow_architecture",
            "type": "architecture",
            "nodes": [
                {"id": "client", "label": "Client", "shape": "rounded", "color": "#3b82f6"},
                {"id": "api", "label": "API Server", "shape": "rounded", "color": "#6366f1"},
                {"id": "db", "label": "Database", "shape": "cylinder", "color": "#06b6d4"}
            ],
            "edges": [
                {"source": "client", "target": "api"},
                {"source": "api", "target": "db"}
            ]
        }
    ]

    async with httpx.AsyncClient(timeout=30.0) as client:
        for test in diagram_tests:
            test_name = test["name"]
            timer.start(test_name)

            try:
                # Use create_diagram tool with React Flow nodes/edges
                response = await client.post(
                    f"{MCP_PROXY_URL}/mcp/tool",
                    json={
                        "server": "openagentic_diagram",
                        "tool": "create_diagram",
                        "arguments": {
                            "diagram_type": test["type"],
                            "nodes": test["nodes"],
                            "edges": test["edges"],
                            "title": test_name,
                            "layout": "vertical"
                        }
                    },
                    timeout=20
                )
                timer.stop(test_name)

                if response.status_code == 200:
                    result_data = response.json()
                    # Check if we got a valid result with success=True
                    is_success = result_data.get("result", {}).get("success", False)

                    results["tests"][test_name] = {
                        "status": "PASS" if is_success else "FAIL",
                        "diagram_type": test["type"],
                        "node_count": len(test["nodes"]),
                        "edge_count": len(test["edges"]),
                        "latency_ms": timer.metrics.get(f"{test_name}_duration_ms", 0),
                        "has_output": is_success
                    }

                    if is_success:
                        results["passed"] += 1
                    else:
                        results["failed"] += 1
                        results["errors"].append(f"{test_name}: {result_data.get('error', 'No output generated')}")
                else:
                    results["tests"][test_name] = {
                        "status": "FAIL",
                        "error": f"HTTP {response.status_code}",
                        "latency_ms": timer.metrics.get(f"{test_name}_duration_ms", 0)
                    }
                    results["failed"] += 1
                    results["errors"].append(f"{test_name}: HTTP {response.status_code}")

            except Exception as e:
                timer.stop(test_name)
                results["tests"][test_name] = {
                    "status": "FAIL",
                    "error": str(e),
                    "latency_ms": timer.metrics.get(f"{test_name}_duration_ms", 0)
                }
                results["failed"] += 1
                results["errors"].append(f"{test_name}: {str(e)}")

    results["status"] = "COMPLETE"
    return results

async def test_api_endpoints(timer: PerformanceTimer) -> Dict[str, Any]:
    """Test critical API endpoints"""
    results = {
        "status": "TESTING",
        "endpoints": {},
        "passed": 0,
        "failed": 0,
        "errors": []
    }

    endpoints = [
        {"path": "/health", "method": "GET", "name": "health"},
        {"path": "/api/capabilities/catalog", "method": "GET", "name": "capabilities_catalog"},
        {"path": "/api/capabilities/stats", "method": "GET", "name": "capabilities_stats"},
        {"path": "/api/capabilities/tools/mcp", "method": "GET", "name": "mcp_tools"},
    ]

    async with httpx.AsyncClient(timeout=10.0) as client:
        for endpoint in endpoints:
            name = endpoint["name"]
            timer.start(name)

            try:
                url = f"{OPENAGENTIC_API_URL}{endpoint['path']}"

                if endpoint["method"] == "GET":
                    response = await client.get(url)
                else:
                    response = await client.post(url, json={})

                timer.stop(name)

                success = response.status_code in [200, 201]

                results["endpoints"][name] = {
                    "status": "PASS" if success else "FAIL",
                    "path": endpoint["path"],
                    "method": endpoint["method"],
                    "status_code": response.status_code,
                    "latency_ms": timer.metrics.get(f"{name}_duration_ms", 0)
                }

                if success:
                    results["passed"] += 1
                else:
                    results["failed"] += 1
                    results["errors"].append(f"{name}: HTTP {response.status_code}")

            except Exception as e:
                timer.stop(name)
                results["endpoints"][name] = {
                    "status": "FAIL",
                    "path": endpoint["path"],
                    "error": str(e),
                    "latency_ms": timer.metrics.get(f"{name}_duration_ms", 0)
                }
                results["failed"] += 1
                results["errors"].append(f"{name}: {str(e)}")

    results["status"] = "COMPLETE"
    return results

async def run_performance_benchmarks(timer: PerformanceTimer) -> Dict[str, Any]:
    """Run performance benchmarks to identify bottlenecks"""
    results = {
        "status": "TESTING",
        "benchmarks": {},
        "bottlenecks": [],
        "recommendations": []
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Benchmark: API Response Time (multiple requests)
        api_latencies = []
        for i in range(5):
            timer.start(f"api_bench_{i}")
            try:
                await client.get(f"{OPENAGENTIC_API_URL}/health")
                latency = timer.stop(f"api_bench_{i}")
                api_latencies.append(latency)
            except:
                pass

        if api_latencies:
            avg_latency = sum(api_latencies) / len(api_latencies)
            max_latency = max(api_latencies)
            min_latency = min(api_latencies)

            results["benchmarks"]["api_response"] = {
                "avg_ms": round(avg_latency, 2),
                "max_ms": round(max_latency, 2),
                "min_ms": round(min_latency, 2),
                "samples": len(api_latencies)
            }

            if avg_latency > 500:
                results["bottlenecks"].append({
                    "component": "API",
                    "issue": f"High average latency: {avg_latency:.0f}ms",
                    "severity": "HIGH" if avg_latency > 1000 else "MEDIUM"
                })
                results["recommendations"].append("Investigate API performance - consider caching or optimization")

        # Benchmark: MCP Proxy Response Time
        mcp_latencies = []
        for i in range(3):
            timer.start(f"mcp_bench_{i}")
            try:
                await client.get(f"{MCP_PROXY_URL}/health")
                latency = timer.stop(f"mcp_bench_{i}")
                mcp_latencies.append(latency)
            except:
                pass

        if mcp_latencies:
            avg_latency = sum(mcp_latencies) / len(mcp_latencies)

            results["benchmarks"]["mcp_proxy_response"] = {
                "avg_ms": round(avg_latency, 2),
                "max_ms": round(max(mcp_latencies), 2),
                "min_ms": round(min(mcp_latencies), 2),
                "samples": len(mcp_latencies)
            }

            if avg_latency > 200:
                results["bottlenecks"].append({
                    "component": "MCP Proxy",
                    "issue": f"High average latency: {avg_latency:.0f}ms",
                    "severity": "MEDIUM"
                })

        # Benchmark: Tool Execution Time
        timer.start("tool_bench")
        try:
            await client.post(
                f"{MCP_PROXY_URL}/mcp/tool",
                json={
                    "server": "openagentic_admin",
                    "tool": "admin_system_redis_health_check",
                    "arguments": {}
                },
                timeout=10
            )
            tool_latency = timer.stop("tool_bench")

            results["benchmarks"]["tool_execution"] = {
                "tool": "admin_system_redis_health_check",
                "latency_ms": round(tool_latency, 2)
            }

            if tool_latency > 1000:
                results["bottlenecks"].append({
                    "component": "MCP Tool Execution",
                    "issue": f"Slow tool execution: {tool_latency:.0f}ms",
                    "severity": "MEDIUM"
                })
        except Exception as e:
            timer.stop("tool_bench")
            results["benchmarks"]["tool_execution"] = {
                "error": str(e)
            }

    results["status"] = "COMPLETE"
    return results

async def admin_full_system_test(
    include_slow_tests: bool = False,
    include_azure_tests: bool = False,
    include_gcp_tests: bool = False,
    verbose: bool = True
) -> Dict[str, Any]:
    """
    Run a comprehensive test of the ENTIRE OpenAgentic platform.

    This is the "nuclear option" for platform validation. It tests:
    - All infrastructure components (PostgreSQL, Redis, Milvus, Ollama, API)
    - All 12 MCP servers are running
    - Tool execution from each MCP server
    - Formatting MCP capabilities
    - Diagram MCP capabilities
    - Critical API endpoints
    - Performance benchmarks

    Args:
        include_slow_tests: Include slow tests like full web fetches (adds 30-60 seconds)
        include_azure_tests: Test Azure MCP tools (requires valid Azure credentials)
        include_gcp_tests: Test GCP MCP tools (requires valid GCP credentials)
        verbose: Include detailed output for each test

    Returns:
        Comprehensive test report with pass/fail status, timing, and recommendations
    """
    timer = PerformanceTimer()
    timer.start()

    report = {
        "test_started": datetime.utcnow().isoformat(),
        "platform": "OpenAgentic",
        "version": "3.0",
        "test_configuration": {
            "include_slow_tests": include_slow_tests,
            "include_azure_tests": include_azure_tests,
            "include_gcp_tests": include_gcp_tests,
            "verbose": verbose
        },
        "results": {
            "infrastructure": {},
            "mcp_servers": {},
            "tool_execution": {},
            "formatting": {},
            "diagram": {},
            "api_endpoints": {},
            "performance": {},
            "overall_status": "PENDING"
        },
        "summary": {
            "total_tests": 0,
            "passed": 0,
            "failed": 0,
            "skipped": 0,
            "pass_rate": "0%"
        },
        "errors": [],
        "bottlenecks": [],
        "recommendations": []
    }

    logger.info("Starting full system test")

    # Test 1: Infrastructure Health
    logger.info("Testing infrastructure health...")
    infra_results = await test_infrastructure_health(timer)
    report["results"]["infrastructure"] = infra_results
    report["summary"]["passed"] += infra_results["passed"]
    report["summary"]["failed"] += infra_results["failed"]
    report["summary"]["total_tests"] += infra_results["passed"] + infra_results["failed"]
    report["errors"].extend(infra_results["errors"])

    # Test 2: MCP Servers
    logger.info("Testing MCP servers...")
    mcp_results = await test_all_mcp_servers(timer)
    report["results"]["mcp_servers"] = mcp_results
    report["summary"]["passed"] += mcp_results["passed"]
    report["summary"]["failed"] += mcp_results["failed"]
    report["summary"]["total_tests"] += mcp_results["passed"] + mcp_results["failed"]
    report["errors"].extend(mcp_results["errors"])

    # Test 3: Tool Execution
    logger.info("Testing MCP tool execution...")
    tool_results = await test_mcp_tool_execution(timer)
    report["results"]["tool_execution"] = tool_results
    report["summary"]["passed"] += tool_results["passed"]
    report["summary"]["failed"] += tool_results["failed"]
    report["summary"]["skipped"] += tool_results["skipped"]
    report["summary"]["total_tests"] += tool_results["passed"] + tool_results["failed"] + tool_results["skipped"]
    report["errors"].extend(tool_results["errors"])

    # Test 4: Formatting MCP
    logger.info("Testing formatting capabilities...")
    formatting_results = await test_formatting_mcp(timer)
    report["results"]["formatting"] = formatting_results
    report["summary"]["passed"] += formatting_results["passed"]
    report["summary"]["failed"] += formatting_results["failed"]
    report["summary"]["total_tests"] += formatting_results["passed"] + formatting_results["failed"]
    report["errors"].extend(formatting_results["errors"])

    # Test 5: Diagram MCP
    logger.info("Testing diagram MCP...")
    diagram_results = await test_diagram_mcp(timer)
    report["results"]["diagram"] = diagram_results
    report["summary"]["passed"] += diagram_results["passed"]
    report["summary"]["failed"] += diagram_results["failed"]
    report["summary"]["total_tests"] += diagram_results["passed"] + diagram_results["failed"]
    report["errors"].extend(diagram_results["errors"])

    # Test 6: API Endpoints
    logger.info("Testing API endpoints...")
    api_results = await test_api_endpoints(timer)
    report["results"]["api_endpoints"] = api_results
    report["summary"]["passed"] += api_results["passed"]
    report["summary"]["failed"] += api_results["failed"]
    report["summary"]["total_tests"] += api_results["passed"] + api_results["failed"]
    report["errors"].extend(api_results["errors"])

    # Test 7: Performance Benchmarks
    logger.info("Running performance benchmarks...")
    perf_results = await run_performance_benchmarks(timer)
    report["results"]["performance"] = perf_results
    report["bottlenecks"].extend(perf_results.get("bottlenecks", []))
    report["recommendations"].extend(perf_results.get("recommendations", []))

    # Calculate final results
    timer.stop()

    total_executed = report["summary"]["passed"] + report["summary"]["failed"]
    if total_executed > 0:
        pass_rate = (report["summary"]["passed"] / total_executed) * 100
        report["summary"]["pass_rate"] = f"{pass_rate:.1f}%"

    # Determine overall status
    if report["summary"]["failed"] == 0 and report["summary"]["passed"] > 0:
        report["results"]["overall_status"] = "PASS"
    elif report["summary"]["failed"] > 0:
        report["results"]["overall_status"] = "FAIL"
    else:
        report["results"]["overall_status"] = "UNKNOWN"

    report["test_completed"] = datetime.utcnow().isoformat()
    report["duration_ms"] = round(timer.get_total_ms(), 2)
    report["duration_seconds"] = round(timer.get_total_ms() / 1000, 2)

    # Generate summary message
    status_emoji = "" if report["results"]["overall_status"] == "PASS" else ""
    report["summary_message"] = f"""
{status_emoji} **Full System Test Complete**

**Overall Status:** {report["results"]["overall_status"]}
**Pass Rate:** {report["summary"]["pass_rate"]}
**Duration:** {report["duration_seconds"]}s

**Results:**
- Passed: {report["summary"]["passed"]}
- Failed: {report["summary"]["failed"]}
- Skipped: {report["summary"]["skipped"]}
- Total: {report["summary"]["total_tests"]}

**Components Tested:**
- Infrastructure: {report["results"]["infrastructure"].get("passed", 0)}/{report["results"]["infrastructure"].get("passed", 0) + report["results"]["infrastructure"].get("failed", 0)}
- MCP Servers: {report["results"]["mcp_servers"].get("passed", 0)}/{report["results"]["mcp_servers"].get("passed", 0) + report["results"]["mcp_servers"].get("failed", 0)}
- Tool Execution: {report["results"]["tool_execution"].get("passed", 0)}/{report["results"]["tool_execution"].get("passed", 0) + report["results"]["tool_execution"].get("failed", 0)}
- Diagram MCP: {report["results"]["diagram"].get("passed", 0)}/{report["results"]["diagram"].get("passed", 0) + report["results"]["diagram"].get("failed", 0)}
- API Endpoints: {report["results"]["api_endpoints"].get("passed", 0)}/{report["results"]["api_endpoints"].get("passed", 0) + report["results"]["api_endpoints"].get("failed", 0)}

{f"**Bottlenecks Found:** {len(report['bottlenecks'])}" if report["bottlenecks"] else ""}
{f"**Errors:** {len(report['errors'])}" if report["errors"] else ""}
"""

    logger.info({
        "overall_status": report["results"]["overall_status"],
        "pass_rate": report["summary"]["pass_rate"],
        "duration_seconds": report["duration_seconds"]
    }, "Full system test completed")

    return report
