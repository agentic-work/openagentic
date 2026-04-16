# Proprietary and confidential. Unauthorized copying prohibited.

"""
Shared HTTP Transport for MCP Servers with Full Observability

This module provides HTTP server capabilities for MCP servers, enabling them to be
deployed as standalone containers that the mcp-proxy can control remotely.

When MCP_HTTP_MODE=true, the MCP server runs as an HTTP server with:
- GET  /health  - Health check endpoint
- GET  /metrics - Prometheus metrics endpoint
- POST /mcp     - MCP JSON-RPC endpoint

Observability Features:
- OpenTelemetry (OTEL) distributed tracing - exports to OTEL_EXPORTER_OTLP_ENDPOINT
- Prometheus metrics - exposes /metrics endpoint for scraping
- Structured JSON logging - for Loki log aggregation
"""

import os
import sys
import json
import asyncio
import time
import logging
from typing import Any, Dict, Optional, Callable
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse

# =============================================================================
# STRUCTURED LOGGING FOR LOKI
# =============================================================================

try:
    import structlog
    from pythonjsonlogger import jsonlogger

    # Configure structured JSON logging
    def configure_json_logging(service_name: str):
        """Configure structured JSON logging for Loki ingestion."""
        # Setup JSON formatter for log aggregation
        class CustomJsonFormatter(jsonlogger.JsonFormatter):
            def add_fields(self, log_record, record, message_dict):
                super().add_fields(log_record, record, message_dict)
                log_record['timestamp'] = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())
                log_record['service'] = service_name
                log_record['level'] = record.levelname.lower()

        # Apply JSON formatter to root logger
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(CustomJsonFormatter(
            '%(timestamp)s %(level)s %(name)s %(message)s'
        ))

        # Configure root logger - respect LOG_LEVEL env var
        log_level_name = os.environ.get("LOG_LEVEL", "info").upper()
        log_level = getattr(logging, log_level_name, logging.INFO)
        root_logger = logging.getLogger()
        root_logger.handlers = []
        root_logger.addHandler(handler)
        root_logger.setLevel(log_level)

        return logging.getLogger(service_name)

    JSON_LOGGING_AVAILABLE = True

except ImportError:
    JSON_LOGGING_AVAILABLE = False

    def configure_json_logging(service_name: str):
        """Fallback logging configuration."""
        log_level_name = os.environ.get("LOG_LEVEL", "info").upper()
        log_level = getattr(logging, log_level_name, logging.INFO)
        logging.basicConfig(
            level=log_level,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        return logging.getLogger(service_name)

# =============================================================================
# OPENTELEMETRY TRACING
# =============================================================================

try:
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource, SERVICE_NAME
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

    OTEL_AVAILABLE = True

    def configure_otel(service_name: str) -> Optional[trace.Tracer]:
        """Configure OpenTelemetry tracing."""
        otlp_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")

        if not otlp_endpoint:
            logging.getLogger(service_name).info(
                "OTEL_EXPORTER_OTLP_ENDPOINT not set, tracing disabled"
            )
            return None

        # Configure resource attributes
        resource = Resource.create({
            SERVICE_NAME: service_name,
            "service.namespace": os.getenv("OTEL_SERVICE_NAMESPACE", "openagentic"),
            "deployment.environment": os.getenv("OTEL_DEPLOYMENT_ENVIRONMENT", "production"),
        })

        # Create and configure tracer provider
        provider = TracerProvider(resource=resource)
        processor = BatchSpanProcessor(OTLPSpanExporter(endpoint=otlp_endpoint))
        provider.add_span_processor(processor)
        trace.set_tracer_provider(provider)

        # Instrument HTTP clients
        HTTPXClientInstrumentor().instrument()

        logging.getLogger(service_name).info(
            f"OTEL tracing configured, exporting to {otlp_endpoint}",
            extra={"otel_endpoint": otlp_endpoint}
        )

        return trace.get_tracer(service_name)

except ImportError:
    OTEL_AVAILABLE = False

    def configure_otel(service_name: str):
        """Fallback when OTEL is not available."""
        logging.getLogger(service_name).warning(
            "OpenTelemetry packages not installed, tracing disabled"
        )
        return None

# =============================================================================
# PROMETHEUS METRICS
# =============================================================================

try:
    from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST

    PROMETHEUS_AVAILABLE = True

    # Define metrics
    MCP_REQUESTS_TOTAL = Counter(
        'mcp_requests_total',
        'Total number of MCP requests',
        ['server', 'method', 'status']
    )

    MCP_REQUEST_DURATION = Histogram(
        'mcp_request_duration_seconds',
        'MCP request duration in seconds',
        ['server', 'method'],
        buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
    )

    MCP_TOOL_CALLS_TOTAL = Counter(
        'mcp_tool_calls_total',
        'Total number of MCP tool calls',
        ['server', 'tool', 'status']
    )

    MCP_TOOL_DURATION = Histogram(
        'mcp_tool_duration_seconds',
        'MCP tool execution duration in seconds',
        ['server', 'tool'],
        buckets=[0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0]
    )

    MCP_SERVER_INFO = Gauge(
        'mcp_server_info',
        'MCP server information',
        ['server', 'version', 'status']
    )

    MCP_TOOLS_AVAILABLE = Gauge(
        'mcp_tools_available',
        'Number of tools available',
        ['server']
    )

except ImportError:
    PROMETHEUS_AVAILABLE = False
    MCP_REQUESTS_TOTAL = None
    MCP_REQUEST_DURATION = None
    MCP_TOOL_CALLS_TOTAL = None
    MCP_TOOL_DURATION = None
    MCP_SERVER_INFO = None
    MCP_TOOLS_AVAILABLE = None

# =============================================================================
# HTTP TRANSPORT
# =============================================================================

logger = logging.getLogger("mcp-http-transport")

class MCPHTTPServer:
    """
    HTTP server wrapper for FastMCP servers with full observability.

    Provides HTTP endpoints that translate HTTP requests to MCP protocol
    and route them to the underlying FastMCP server.

    Features:
    - /health endpoint for Kubernetes probes
    - /metrics endpoint for Prometheus scraping
    - /mcp endpoint for MCP JSON-RPC protocol
    - OpenTelemetry distributed tracing
    - Structured JSON logging for Loki
    """

    def __init__(
        self,
        name: str,
        mcp_server: Any,  # FastMCP instance
        port: int = 8081,
        version: str = "1.0.0",
        health_check: Optional[Callable[[], Dict[str, Any]]] = None
    ):
        """
        Initialize the HTTP server wrapper.

        Args:
            name: Server name (for logging and metrics)
            mcp_server: FastMCP instance to wrap
            port: HTTP port to listen on
            version: Server version for metrics
            health_check: Optional custom health check function
        """
        self.name = name
        self.mcp = mcp_server
        self.port = port
        self.version = version
        self.health_check = health_check or self._default_health_check
        self._initialized = False
        self._start_time = time.time()

        # Configure logging
        self.logger = configure_json_logging(name)

        # Configure OTEL tracing
        self.tracer = configure_otel(name)

        # Create FastAPI app
        self.app = FastAPI(
            title=f"{name} MCP Server",
            description=f"HTTP interface for {name} MCP Server",
            version=version,
            lifespan=self._lifespan
        )

        # Instrument FastAPI with OTEL if available
        if OTEL_AVAILABLE and self.tracer:
            FastAPIInstrumentor.instrument_app(self.app)

        # Register routes
        self._setup_routes()

    @asynccontextmanager
    async def _lifespan(self, app: FastAPI):
        """FastAPI lifespan context manager."""
        self.logger.info(
            f"Starting {self.name} HTTP Server",
            extra={
                "port": self.port,
                "version": self.version,
                "otel_enabled": OTEL_AVAILABLE and self.tracer is not None,
                "prometheus_enabled": PROMETHEUS_AVAILABLE,
                "json_logging_enabled": JSON_LOGGING_AVAILABLE
            }
        )

        # Initialize the MCP server's lifespan if it has one
        if hasattr(self.mcp, '_lifespan_handler') and self.mcp._lifespan_handler:
            async with self.mcp._lifespan_handler(self.mcp):
                self._initialized = True
                self._update_metrics()
                yield
        else:
            self._initialized = True
            self._update_metrics()
            yield

        self.logger.info(f"Shutting down {self.name} HTTP Server")

    def _update_metrics(self):
        """Update Prometheus metrics."""
        if PROMETHEUS_AVAILABLE:
            MCP_SERVER_INFO.labels(
                server=self.name,
                version=self.version,
                status="running" if self._initialized else "initializing"
            ).set(1)

            # Update tools count (deferred to avoid event loop issues during startup)
            # Tools count will be updated on first /tools request instead

    def _setup_routes(self):
        """Setup HTTP routes."""

        @self.app.get("/health")
        async def health():
            """Health check endpoint for Kubernetes probes."""
            result = self.health_check()
            status_code = 200 if result.get("healthy", True) else 503

            self.logger.debug(
                "Health check",
                extra={"healthy": result.get("healthy"), "status_code": status_code}
            )

            return JSONResponse(content=result, status_code=status_code)

        @self.app.get("/metrics")
        async def metrics():
            """Prometheus metrics endpoint."""
            if not PROMETHEUS_AVAILABLE:
                return PlainTextResponse(
                    content="# Prometheus client not installed\n",
                    media_type="text/plain"
                )

            return Response(
                content=generate_latest(),
                media_type=CONTENT_TYPE_LATEST
            )

        @self.app.post("/mcp")
        async def mcp_endpoint(request: Request):
            """
            MCP JSON-RPC endpoint.

            Receives MCP protocol messages as JSON-RPC and routes them
            to the FastMCP server.
            """
            start_time = time.time()
            method = "unknown"

            try:
                # Parse the JSON-RPC request
                body = await request.json()
                method = body.get("method", "unknown")

                # Verbose logging of all MCP requests
                if method == "tools/call":
                    params = body.get("params", {})
                    tool_name = params.get("name", "?")
                    tool_args = params.get("arguments", {})
                    args_str = json.dumps(tool_args, default=str)
                    if len(args_str) > 2000:
                        args_str = args_str[:2000] + f"...(truncated, {len(args_str)} chars)"
                    self.logger.info(
                        f"MCP tool/call REQUEST: {tool_name}",
                        extra={"method": method, "request_id": body.get("id"), "tool": tool_name, "tool_args": args_str}
                    )
                else:
                    self.logger.info(
                        f"MCP request received: {method}",
                        extra={"method": method, "request_id": body.get("id")}
                    )

                # Handle the MCP message with tracing
                if self.tracer:
                    with self.tracer.start_as_current_span(f"mcp.{method}") as span:
                        span.set_attribute("mcp.method", method)
                        span.set_attribute("mcp.server", self.name)
                        response = await self._handle_mcp_message(body)
                else:
                    response = await self._handle_mcp_message(body)

                # Record metrics
                duration = time.time() - start_time
                if PROMETHEUS_AVAILABLE:
                    MCP_REQUESTS_TOTAL.labels(
                        server=self.name,
                        method=method,
                        status="success"
                    ).inc()
                    MCP_REQUEST_DURATION.labels(
                        server=self.name,
                        method=method
                    ).observe(duration)

                self.logger.info(
                    f"MCP request completed: {method} in {round(duration * 1000)}ms",
                    extra={
                        "method": method,
                        "duration_ms": round(duration * 1000, 2),
                        "request_id": body.get("id")
                    }
                )

                return JSONResponse(content=response)

            except json.JSONDecodeError as e:
                if PROMETHEUS_AVAILABLE:
                    MCP_REQUESTS_TOTAL.labels(
                        server=self.name,
                        method=method,
                        status="parse_error"
                    ).inc()

                self.logger.error(
                    "MCP parse error",
                    extra={"error": str(e)}
                )

                return JSONResponse(
                    content={
                        "jsonrpc": "2.0",
                        "error": {
                            "code": -32700,
                            "message": f"Parse error: {str(e)}"
                        },
                        "id": None
                    },
                    status_code=400
                )
            except Exception as e:
                if PROMETHEUS_AVAILABLE:
                    MCP_REQUESTS_TOTAL.labels(
                        server=self.name,
                        method=method,
                        status="error"
                    ).inc()

                self.logger.error(
                    "MCP internal error",
                    extra={"error": str(e), "method": method},
                    exc_info=True
                )

                return JSONResponse(
                    content={
                        "jsonrpc": "2.0",
                        "error": {
                            "code": -32603,
                            "message": f"Internal error: {str(e)}"
                        },
                        "id": body.get("id") if isinstance(body, dict) else None
                    },
                    status_code=500
                )

        @self.app.get("/tools")
        async def list_tools():
            """List available MCP tools."""
            try:
                tools = await self._get_tools()
                return JSONResponse(content={"tools": tools})
            except Exception as e:
                self.logger.error(f"Error listing tools: {e}")
                return JSONResponse(
                    content={"error": str(e)},
                    status_code=500
                )

    async def _handle_mcp_message(self, message: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle an MCP JSON-RPC message.

        Routes the message to the appropriate FastMCP handler based on the method.
        """
        method = message.get("method", "")
        params = message.get("params", {})
        msg_id = message.get("id")

        try:
            if method == "initialize":
                # MCP initialization handshake
                return {
                    "jsonrpc": "2.0",
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {
                            "tools": {"listChanged": True},
                            "resources": {},
                            "prompts": {},
                            "logging": {}
                        },
                        "serverInfo": {
                            "name": self.name,
                            "version": self.version
                        }
                    },
                    "id": msg_id
                }

            elif method == "initialized":
                # Client acknowledgment - no response needed
                return {"jsonrpc": "2.0", "result": {}, "id": msg_id}

            elif method == "tools/list":
                # List available tools
                tools = await self._get_tools()

                # Update metrics
                if PROMETHEUS_AVAILABLE:
                    MCP_TOOLS_AVAILABLE.labels(server=self.name).set(len(tools))

                return {
                    "jsonrpc": "2.0",
                    "result": {"tools": tools},
                    "id": msg_id
                }

            elif method == "tools/call":
                # Execute a tool
                tool_name = params.get("name", "")
                tool_args = params.get("arguments", {})

                # Extract user context from meta for structured logging
                meta = tool_args.get("meta", {}) if isinstance(tool_args, dict) else {}
                user_email = meta.get("user_email", meta.get("userEmail", "unknown"))
                user_name = meta.get("user_name", meta.get("userName", "unknown"))

                start_time = time.time()

                try:
                    # Find and execute the tool
                    if self.tracer:
                        with self.tracer.start_as_current_span(f"tool.{tool_name}") as span:
                            span.set_attribute("mcp.tool.name", tool_name)
                            result = await self._call_tool(tool_name, tool_args)
                    else:
                        result = await self._call_tool(tool_name, tool_args)

                    duration = time.time() - start_time
                    is_error = not result.get("success", True) if isinstance(result, dict) else False

                    # Record metrics
                    if PROMETHEUS_AVAILABLE:
                        MCP_TOOL_CALLS_TOTAL.labels(
                            server=self.name,
                            tool=tool_name,
                            status="error" if is_error else "success"
                        ).inc()
                        MCP_TOOL_DURATION.labels(
                            server=self.name,
                            tool=tool_name
                        ).observe(duration)

                    # Verbose tool result logging
                    result_str = json.dumps(result, default=str)
                    if len(result_str) > 3000:
                        result_preview = result_str[:3000] + f"...(truncated, {len(result_str)} chars)"
                    else:
                        result_preview = result_str
                    self.logger.info(
                        f"Tool executed: {tool_name} by {user_email} ({'OK' if not is_error else 'ERROR'}) in {round(duration * 1000)}ms",
                        extra={
                            "tool": tool_name,
                            "user_email": user_email,
                            "user_name": user_name,
                            "duration_ms": round(duration * 1000, 2),
                            "success": not is_error,
                            "result_preview": result_preview
                        }
                    )

                    return {
                        "jsonrpc": "2.0",
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": json.dumps(result, indent=2, default=str)
                                }
                            ],
                            "isError": is_error
                        },
                        "id": msg_id
                    }

                except Exception as e:
                    duration = time.time() - start_time

                    if PROMETHEUS_AVAILABLE:
                        MCP_TOOL_CALLS_TOTAL.labels(
                            server=self.name,
                            tool=tool_name,
                            status="exception"
                        ).inc()
                        MCP_TOOL_DURATION.labels(
                            server=self.name,
                            tool=tool_name
                        ).observe(duration)

                    self.logger.error(
                        f"Tool execution failed: {tool_name} by {user_email}",
                        extra={
                            "tool": tool_name,
                            "user_email": user_email,
                            "user_name": user_name,
                            "error": str(e),
                            "duration_ms": round(duration * 1000, 2)
                        }
                    )

                    return {
                        "jsonrpc": "2.0",
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": json.dumps({
                                        "success": False,
                                        "error": str(e)
                                    })
                                }
                            ],
                            "isError": True
                        },
                        "id": msg_id
                    }

            elif method == "ping":
                return {"jsonrpc": "2.0", "result": {}, "id": msg_id}

            else:
                return {
                    "jsonrpc": "2.0",
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {method}"
                    },
                    "id": msg_id
                }

        except Exception as e:
            self.logger.error(f"Error handling MCP message: {e}", exc_info=True)
            return {
                "jsonrpc": "2.0",
                "error": {
                    "code": -32603,
                    "message": str(e)
                },
                "id": msg_id
            }

    async def _get_tools(self) -> list:
        """Get the list of tools from the FastMCP server."""
        tools = []

        # FastMCP 2.x: use public list_tools() method directly
        if hasattr(self.mcp, 'list_tools') and callable(self.mcp.list_tools):
            import asyncio
            result = self.mcp.list_tools()
            tool_list = (await result) if asyncio.iscoroutine(result) else result
            for tool in tool_list:
                tools.append({
                    "name": tool.name,
                    "description": tool.description or "",
                    "inputSchema": tool.inputSchema if hasattr(tool, 'inputSchema') else {}
                })
        # FastMCP 1.x fallback: internal tool manager
        elif hasattr(self.mcp, '_tool_manager'):
            tool_manager = self.mcp._tool_manager
            if hasattr(tool_manager, 'list_tools'):
                import asyncio
                result = tool_manager.list_tools()
                tool_list = (await result) if asyncio.iscoroutine(result) else result
                for tool in tool_list:
                    tools.append({
                        "name": tool.name,
                        "description": tool.description or "",
                        "inputSchema": tool.inputSchema if hasattr(tool, 'inputSchema') else {}
                    })
        elif hasattr(self.mcp, '_tools'):
            # Direct access to tools dict
            for name, tool in self.mcp._tools.items():
                tools.append({
                    "name": name,
                    "description": getattr(tool, 'description', '') or '',
                    "inputSchema": getattr(tool, 'inputSchema', {}) or {}
                })

        return tools

    async def _call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        """Execute a tool by name with the given arguments."""
        # FastMCP 2.x: use public call_tool() method directly
        if hasattr(self.mcp, 'call_tool') and callable(self.mcp.call_tool):
            result = await self.mcp.call_tool(name, arguments)
            # Parse the result content
            if hasattr(result, 'content') and result.content:
                content = result.content[0]
                if hasattr(content, 'text'):
                    try:
                        return json.loads(content.text)
                    except:
                        return {"result": content.text}
            return result
        # FastMCP 1.x fallback: internal tool manager
        elif hasattr(self.mcp, '_tool_manager'):
            tool_manager = self.mcp._tool_manager
            if hasattr(tool_manager, 'call_tool'):
                result = await tool_manager.call_tool(name, arguments)
                if hasattr(result, 'content') and result.content:
                    content = result.content[0]
                    if hasattr(content, 'text'):
                        try:
                            return json.loads(content.text)
                        except:
                            return {"result": content.text}
                return result
        elif hasattr(self.mcp, '_tools'):
            # Direct access to tools dict
            if name in self.mcp._tools:
                tool_func = self.mcp._tools[name]
                if asyncio.iscoroutinefunction(tool_func):
                    return await tool_func(**arguments)
                else:
                    return tool_func(**arguments)

        raise ValueError(f"Tool not found: {name}")

    def _default_health_check(self) -> Dict[str, Any]:
        """Default health check implementation."""
        uptime = time.time() - self._start_time
        return {
            "healthy": self._initialized,
            "server": self.name,
            "version": self.version,
            "status": "running" if self._initialized else "initializing",
            "uptime_seconds": round(uptime, 2),
            "observability": {
                "otel": OTEL_AVAILABLE and self.tracer is not None,
                "prometheus": PROMETHEUS_AVAILABLE,
                "json_logging": JSON_LOGGING_AVAILABLE
            }
        }

    def run(self):
        """Run the HTTP server."""
        uvicorn.run(
            self.app,
            host="0.0.0.0",
            port=self.port,
            log_level="info"
        )

def run_with_http_support(
    mcp_server: Any,
    name: str,
    version: str = "1.0.0",
    default_port: int = 8081,
    health_check: Optional[Callable[[], Dict[str, Any]]] = None
):
    """
    Run an MCP server with optional HTTP mode support.

    When MCP_HTTP_MODE=true, runs as an HTTP server with full observability.
    Otherwise, runs in stdio mode (default FastMCP behavior).

    Args:
        mcp_server: FastMCP instance
        name: Server name
        version: Server version
        default_port: Default HTTP port (can be overridden by MCP_SERVER_PORT env var)
        health_check: Optional custom health check function
    """
    # Configure logging based on mode
    log_format = os.getenv("LOG_FORMAT", "").lower()
    if log_format == "json":
        configure_json_logging(name)

    logger = logging.getLogger(name)

    http_mode = os.getenv("MCP_HTTP_MODE", "").lower() in ("true", "1", "yes")
    port = int(os.getenv("MCP_SERVER_PORT", str(default_port)))

    if http_mode:
        logger.info(
            f"Starting {name} in HTTP mode",
            extra={"port": port, "version": version}
        )
        http_server = MCPHTTPServer(
            name=name,
            mcp_server=mcp_server,
            port=port,
            version=version,
            health_check=health_check
        )
        http_server.run()
    else:
        logger.info(f"Starting {name} in stdio mode")
        mcp_server.run()
