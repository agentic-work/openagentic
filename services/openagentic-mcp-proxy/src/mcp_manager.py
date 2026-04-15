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
MCP Manager - Handles all MCP server instances and routing
"""

import asyncio
import json
import logging
import os
import subprocess
import signal
import httpx
import uuid
import redis
from typing import Dict, Any, Optional, List, Union
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger("mcp-manager")

# Redis key prefix for MCP server enabled states
REDIS_MCP_ENABLED_PREFIX = "mcp:server:enabled:"

class MCPServerStatus(Enum):
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    FAILED = "failed"

@dataclass
class MCPServerConfig:
    name: str
    command: List[str]
    env: Dict[str, str]
    transport: str = "stdio"
    enabled: bool = True
    supports_obo: bool = False  # Whether this server supports per-request OBO tokens


@dataclass
class RemoteMCPServerConfig:
    """Configuration for remote MCP servers accessed via HTTP/SSE"""
    name: str
    url: str  # Base URL of the remote MCP server (e.g., http://oap-azure-mcp:8081)
    transport: str = "sse"
    enabled: bool = True
    supports_obo: bool = False
    health_path: str = "/health"
    mcp_path: str = "/mcp"  # SSE endpoint for MCP protocol
    timeout: float = float(os.getenv("MCP_REMOTE_TIMEOUT", "60"))


class RemoteMCPServer:
    """MCP Server that connects to a remote service via HTTP/SSE"""

    def __init__(self, config: RemoteMCPServerConfig):
        self.config = config
        self.status = MCPServerStatus.STOPPED
        self.last_error: Optional[str] = None
        self._initialized = False
        self._cached_tools: Optional[List[Dict[str, Any]]] = None

    async def start(self):
        """Connect to the remote MCP server"""
        if self.status == MCPServerStatus.RUNNING:
            return

        try:
            self.status = MCPServerStatus.STARTING
            logger.info(f"Connecting to remote MCP server: {self.config.name} at {self.config.url}")

            # Health check with a fresh client
            try:
                health_url = f"{self.config.url}{self.config.health_path}"
                async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                    response = await client.get(health_url)
                if response.status_code != 200:
                    raise RuntimeError(f"Health check failed: {response.status_code}")
                logger.info(f"Remote MCP server {self.config.name} health check passed")
            except httpx.RequestError as e:
                raise RuntimeError(f"Cannot reach remote server: {e}")

            # Initialize MCP protocol
            try:
                init_request = {
                    "jsonrpc": "2.0",
                    "id": 0,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {
                            "name": "mcp-proxy",
                            "version": "1.0.0"
                        }
                    }
                }
                init_response = await self.send_request(init_request)
                if "error" in init_response:
                    logger.warning(f"Remote MCP server {self.config.name} initialization returned error: {init_response['error']}")
                else:
                    logger.info(f"Remote MCP server {self.config.name} initialized successfully")
                    self._initialized = True
            except Exception as e:
                logger.warning(f"Failed to initialize remote MCP server {self.config.name}: {e}")

            self.status = MCPServerStatus.RUNNING
            logger.info(f"Remote MCP server {self.config.name} connected successfully")

            # Eagerly load tools right after connecting (avoids timeout issues
            # when tools/list is called later from list_all_tools)
            if self._initialized:
                try:
                    tools_request = {
                        "jsonrpc": "2.0",
                        "id": f"eager-tools-{self.config.name}",
                        "method": "tools/list"
                    }
                    tools_response = await self.send_request(tools_request)
                    if "result" in tools_response and "tools" in tools_response["result"]:
                        self._cached_tools = tools_response["result"]["tools"]
                        logger.info(f"Remote MCP server {self.config.name} eagerly loaded {len(self._cached_tools)} tools")
                    else:
                        logger.warning(f"Remote MCP server {self.config.name} tools/list returned no tools")
                except Exception as e:
                    logger.warning(f"Failed to eagerly load tools from {self.config.name}: {e}")

        except Exception as e:
            self.last_error = str(e)
            self.status = MCPServerStatus.FAILED
            logger.error(f"Failed to connect to remote MCP server {self.config.name}: {e}")

    async def stop(self):
        """Disconnect from the remote MCP server"""
        self.status = MCPServerStatus.STOPPED
        self._initialized = False
        logger.info(f"Disconnected from remote MCP server: {self.config.name}")

    async def send_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Send MCP request to remote server via HTTP POST.
        Uses a fresh httpx client per request to avoid stale connection pool issues.
        """
        if self.status not in (MCPServerStatus.RUNNING, MCPServerStatus.STARTING):
            raise RuntimeError(f"Remote MCP server {self.config.name} is not connected")

        request_id = request.get("id")
        logger.info(f"[{self.config.name}] REMOTE REQUEST: {json.dumps(request)}")

        mcp_url = f"{self.config.url}{self.config.mcp_path}"

        # Use a fresh client per request to avoid stale connection pool issues
        # (remote servers may close idle connections before httpx notices)
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                response = await client.post(
                    mcp_url,
                    json=request,
                    headers={"Content-Type": "application/json"}
                )

            if response.status_code != 200:
                raise RuntimeError(f"HTTP error: {response.status_code} - {response.text}")

            result = response.json()
            logger.info(f"[{self.config.name}] REMOTE RESPONSE: {json.dumps(result)}")
            return result

        except httpx.RequestError as e:
            logger.error(f"Error communicating with remote MCP server {self.config.name}: {e}")
            self.status = MCPServerStatus.FAILED
            self.last_error = str(e)
            raise
        except Exception as e:
            logger.error(f"Error processing response from remote MCP server {self.config.name}: {e}")
            raise


class MCPServer:
    def __init__(self, config: MCPServerConfig):
        self.config = config
        self.process: Optional[subprocess.Popen] = None
        self.status = MCPServerStatus.STOPPED
        self.last_error: Optional[str] = None

    async def start(self):
        """Start the MCP server process"""
        if self.status == MCPServerStatus.RUNNING:
            return

        try:
            self.status = MCPServerStatus.STARTING
            logger.info(f"Starting MCP server: {self.config.name}")

            # FedRAMP SC-4: Filtered environment - only pass minimal base + server-specific vars
            # Prevents leaking secrets (DB passwords, API keys, etc.) to child MCP processes
            _ALLOWED_BASE_ENV = (
                'PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TZ',
                'PYTHONPATH', 'NODE_PATH', 'NODE_ENV', 'LOG_LEVEL',
            )
            env = {k: v for k, v in os.environ.items() if k in _ALLOWED_BASE_ENV}
            env.update(self.config.env)  # Server-specific vars from config override base

            self.process = subprocess.Popen(
                self.config.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                text=True,
                bufsize=0  # Unbuffered for real-time communication
            )

            # Give it a moment to start
            await asyncio.sleep(1)

            if self.process.poll() is None:
                self.status = MCPServerStatus.RUNNING
                logger.info(f"MCP server {self.config.name} started successfully (PID: {self.process.pid})")

                # Forward subprocess stderr to parent logger so tool call logs are visible
                self._stderr_task = asyncio.create_task(self._forward_stderr())

                # Initialize the MCP server (required by MCP protocol)
                try:
                    init_request = {
                        "jsonrpc": "2.0",
                        "id": 0,
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {},
                            "clientInfo": {
                                "name": "mcp-proxy",
                                "version": "1.0.0"
                            }
                        }
                    }
                    init_response = await self.send_request(init_request)
                    if "error" in init_response:
                        logger.warning(f"MCP server {self.config.name} initialization returned error: {init_response['error']}")
                    else:
                        logger.info(f"MCP server {self.config.name} initialized successfully")
                except Exception as e:
                    logger.warning(f"Failed to initialize MCP server {self.config.name}: {e}")
            else:
                stderr = self.process.stderr.read() if self.process.stderr else "No error output"
                self.last_error = f"Process exited immediately: {stderr}"
                self.status = MCPServerStatus.FAILED
                logger.error(f"MCP server {self.config.name} failed to start: {self.last_error}")

        except Exception as e:
            self.last_error = str(e)
            self.status = MCPServerStatus.FAILED
            logger.error(f"Failed to start MCP server {self.config.name}: {e}")

    async def _forward_stderr(self):
        """Forward subprocess stderr to parent logger so MCP server logs are visible in kubectl"""
        try:
            while self.process and self.process.poll() is None:
                line = await asyncio.to_thread(self.process.stderr.readline)
                if line:
                    logger.info(f"[{self.config.name}] {line.rstrip()}")
                else:
                    break
        except Exception:
            pass

    async def stop(self):
        """Stop the MCP server process"""
        if self.process and self.process.poll() is None:
            logger.info(f"Stopping MCP server: {self.config.name}")
            self.process.terminate()
            try:
                await asyncio.wait_for(asyncio.to_thread(self.process.wait), timeout=5.0)
            except asyncio.TimeoutError:
                logger.warning(f"Force killing MCP server: {self.config.name}")
                self.process.kill()
            self.status = MCPServerStatus.STOPPED

    async def send_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Send MCP request to server"""
        if self.status != MCPServerStatus.RUNNING or not self.process:
            raise RuntimeError(f"MCP server {self.config.name} is not running")

        try:
            # Log the request
            request_id = request.get("id")
            logger.info(f"[{self.config.name}] REQUEST: {json.dumps(request)}")

            # Send request as JSON-RPC over stdin
            request_str = json.dumps(request) + "\n"
            self.process.stdin.write(request_str)
            self.process.stdin.flush()

            # Read response from stdout - keep reading until we get matching ID
            # This handles cases where stale responses might be in the buffer
            max_attempts = 10
            for attempt in range(max_attempts):
                response_str = self.process.stdout.readline()
                if not response_str.strip():
                    raise RuntimeError("Empty response from MCP server")

                response = json.loads(response_str.strip())

                # Check if response ID matches request ID
                response_id = response.get("id")

                # Normalize ID types for comparison (string "1" vs int 1)
                request_id_normalized = str(request_id) if request_id is not None else None
                response_id_normalized = str(response_id) if response_id is not None else None

                if request_id_normalized == response_id_normalized:
                    # Log the response
                    logger.info(f"[{self.config.name}] RESPONSE: {json.dumps(response)}")
                    return response
                else:
                    # Stale response from a different request - skip it
                    logger.warning(f"[{self.config.name}] Skipping stale response (expected id={request_id}, got id={response_id})")
                    continue

            raise RuntimeError(f"Failed to get matching response after {max_attempts} attempts")

        except Exception as e:
            logger.error(f"Error communicating with MCP server {self.config.name}: {e}")
            # Check if process is still alive
            if self.process.poll() is not None:
                self.status = MCPServerStatus.FAILED
                stderr = self.process.stderr.read() if self.process.stderr else "No error output"
                self.last_error = f"Process died: {stderr}"
            raise

class MCPManager:
    def __init__(self, redis_client: Optional[redis.Redis] = None):
        self.servers: Dict[str, Union[MCPServer, RemoteMCPServer]] = {}
        self.redis_client = redis_client
        self.initialize_servers()

        # Load runtime enabled states from Redis (overrides build-time config)
        if self.redis_client:
            self._load_enabled_states_from_redis()

    def initialize_servers(self):
        """Initialize all MCP server configurations"""

        # ==========================================
        # Official Azure MCP (azmcp) - REMOVED
        # Using only oap-azure-mcp (custom FastMCP with OBO)
        # ==========================================
        logger.info("Official Azure MCP (azmcp) disabled - using oap-azure-mcp only")

        # OpenAgentic Admin MCP Server - System administration tools (PostgreSQL, Redis, Milvus, health)
        # IMPORTANT: This server is ONLY for admin users - access enforced by proxy
        openagentic_admin_url = os.getenv("OpenAgentic_ADMIN_MCP_URL", "")
        if openagentic_admin_url and not os.getenv("OpenAgentic_ADMIN_MCP_DISABLED", "false").lower() == "true":
            self.servers["openagentic_admin"] = RemoteMCPServer(RemoteMCPServerConfig(
                name="openagentic_admin",
                url=openagentic_admin_url,
                mcp_path="/mcp",  # Uses http_transport's POST /mcp endpoint
            ))
            logger.info(f"OpenAgentic Admin MCP server configured as REMOTE at {openagentic_admin_url} (ADMIN USERS ONLY)")

        # OpenAgentic Kubernetes MCP Server - Kubernetes cluster administration
        # IMPORTANT: This server is ONLY for admin users - access is enforced by proxy
        # CRITICAL: The OpenAgentic deployment namespace is READ-ONLY for safety
        if not os.getenv("OpenAgentic_KUBERNETES_MCP_DISABLED", "false").lower() == "true":
            openagentic_kubernetes_env = {
                # Protected namespace - the namespace where OpenAgentic runs (read-only)
                "OPENAGENTIC_NAMESPACE": os.getenv("OPENAGENTIC_NAMESPACE", "openagentic"),
                # Kubernetes config is auto-detected (in-cluster or kubeconfig)
                "LOG_LEVEL": "info",
                # CRITICAL: Pass K8s service discovery vars for in-cluster auth.
                # load_incluster_config() reads these to find the API server.
                # The FedRAMP env filter (SC-4) strips them — re-inject here.
                "KUBERNETES_SERVICE_HOST": os.getenv("KUBERNETES_SERVICE_HOST", ""),
                "KUBERNETES_SERVICE_PORT": os.getenv("KUBERNETES_SERVICE_PORT", ""),
                "KUBERNETES_SERVICE_PORT_HTTPS": os.getenv("KUBERNETES_SERVICE_PORT_HTTPS", ""),
            }

            self.servers["openagentic_kubernetes"] = MCPServer(MCPServerConfig(
                name="openagentic_kubernetes",
                command=["fastmcp", "run", "-t", "stdio", "/app/mcp-servers/oap-kubernetes-mcp/server.py"],
                env=openagentic_kubernetes_env
            ))
            logger.info("OpenAgentic Kubernetes MCP server configured (Python/FastMCP - K8s Admin - ADMIN USERS ONLY)")

        # AWC Formatting MCP Server - DISABLED
        # Redundant - formatting should be handled via system prompts, not a separate MCP
        # The LLM should use its native markdown capabilities rather than needing an MCP for formatting
        # if not os.getenv("AWC_FORMATTING_MCP_DISABLED", "false").lower() == "true":
        #     awc_formatting_env = {
        #         "LOG_LEVEL": "info"
        #     }
        #
        #     self.servers["awc_formatting"] = MCPServer(MCPServerConfig(
        #         name="awc_formatting",
        #         command=["node", "/app/mcp-servers/awc-formatting-mcp/dist/index.js"],
        #         env=awc_formatting_env
        #     ))
        #     logger.info("AWC Formatting MCP server configured (Chat UI formatting)")

        # Sequential Thinking MCP Server
        if not os.getenv("SEQUENTIAL_THINKING_MCP_DISABLED", "false").lower() == "true":
            self.servers["sequential_thinking"] = MCPServer(MCPServerConfig(
                name="sequential_thinking",
                command=["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
                env={}
            ))

        # Fetch MCP Server - REPLACED by oap-web-mcp
        # The standard fetch MCP was unreliable. Use openagentic_web instead for web browsing.
        # if not os.getenv("FETCH_MCP_DISABLED", "false").lower() == "true":
        #     self.servers["fetch"] = MCPServer(MCPServerConfig(
        #         name="fetch",
        #         command=["uvx", "mcp-server-fetch", "--ignore-robots-txt"],
        #         env={}
        #     ))
        logger.info("Standard fetch MCP disabled - using openagentic_web MCP instead")

        # OpenAgentic Web MCP Server - Intelligent web browsing and research
        # Features: DuckDuckGo search, page fetching, fact verification, knowledge storage
        if not os.getenv("OpenAgentic_WEB_MCP_DISABLED", "false").lower() == "true":
            openagentic_web_env = {
                "LOG_LEVEL": "info",
                "REQUEST_TIMEOUT": os.getenv("OpenAgentic_WEB_REQUEST_TIMEOUT", "30"),
                "MEMORY_MCP_URL": os.getenv("MEMORY_MCP_URL", "http://mcp-proxy:3100"),
            }

            self.servers["openagentic_web"] = MCPServer(MCPServerConfig(
                name="openagentic_web",
                command=["python", "/app/mcp-servers/oap-web-mcp/server.py"],
                env=openagentic_web_env
            ))
            logger.info("OpenAgentic Web MCP server configured (Intelligent web browsing and research)")

        # OpenAgentic Memory MCP Server - REMOVED
        # Redundant: pipeline memory.stage.ts already does automatic Milvus semantic search
        # The LLM calling memory tools manually wastes tokens when the pipeline already injects
        # relevant memories into the context automatically.

        # REMOVED: Old azure_cost Node.js server - deprecated in favor of openagentic_azure cost tools

        # OpenAgentic Azure MCP Server - Platform-level FastMCP with direct user token auth
        # Consolidated: Includes both ARM operations AND Cost Management tools
        # This is our custom Azure MCP with:
        # - On-Behalf-Of (OBO) authentication flow
        # - Universal ARM API execution
        # - Focused set of Azure tools for platform-wide use
        if not os.getenv("OpenAgentic_AZURE_MCP_DISABLED", "false").lower() == "true":
            # OBO Flow: User token is scoped for Main App (AZURE_CLIENT_ID)
            # Main App uses its credentials to exchange that token for Azure Management token
            # This is standard OAuth 2.0 On-Behalf-Of flow
            openagentic_azure_env = {
                "AZURE_TENANT_ID": os.getenv("AZURE_TENANT_ID", ""),
                # Fallback credentials when NO user token - uses shared service principal
                "AZURE_CLIENT_ID": os.getenv("AZURE_CLIENT_ID", ""),
                "AZURE_CLIENT_SECRET": os.getenv("AZURE_CLIENT_SECRET", ""),
                "AZURE_SUBSCRIPTION_ID": os.getenv("AZURE_SUBSCRIPTION_ID", ""),
                # OBO credentials - MUST be Main App credentials (not Azure MCP SP)
                # because user token is scoped for Main App's Application ID URI
                "AWC_AZURE_OBO_CLIENT_ID": os.getenv("AZURE_CLIENT_ID", ""),
                "AWC_AZURE_OBO_CLIENT_SECRET": os.getenv("AZURE_CLIENT_SECRET", ""),
                "LOG_LEVEL": "info"
            }

            # OpenAgentic Azure MCP - can run locally (stdio) or as remote container (HTTP)
            openagentic_azure_remote_url = os.getenv("OpenAgentic_AZURE_MCP_URL", "")
            if openagentic_azure_remote_url:
                # Remote mode - connect via HTTP
                self.servers["openagentic_azure"] = RemoteMCPServer(RemoteMCPServerConfig(
                    name="openagentic_azure",
                    url=openagentic_azure_remote_url,
                    supports_obo=True
                ))
                logger.info(f"OpenAgentic Azure MCP server configured as REMOTE at {openagentic_azure_remote_url}")
            else:
                # Local mode - spawn subprocess
                self.servers["openagentic_azure"] = MCPServer(MCPServerConfig(
                    name="openagentic_azure",
                    command=["fastmcp", "run", "-t", "stdio", "/app/mcp-servers/oap-azure-mcp/src/server.py"],
                    env=openagentic_azure_env,
                    supports_obo=True  # This server supports OBO token injection
                ))
                logger.info("OpenAgentic Azure MCP server configured (ARM + Cost tools consolidated)")

        # REMOVED: openagentic_azure_cost - Cost tools consolidated into openagentic_azure above

        # OpenAgentic GCP MCP Server - Google Cloud Platform management via Service Account
        # Uses service account authentication (no OBO - GCP SSO not used)
        if not os.getenv("OpenAgentic_GCP_MCP_DISABLED", "false").lower() == "true":
            openagentic_gcp_env = {
                "GCP_PROJECT_ID": os.getenv("GCP_PROJECT_ID", ""),
                "GCP_CREDENTIALS_JSON": os.getenv("GCP_CREDENTIALS_JSON", ""),
                "GCP_CREDENTIALS_FILE": os.getenv("GCP_CREDENTIALS_FILE", ""),
                "GCP_REGION": os.getenv("GCP_REGION", "us-central1"),
                "LOG_LEVEL": "info"
            }

            self.servers["openagentic_gcp"] = MCPServer(MCPServerConfig(
                name="openagentic_gcp",
                command=["fastmcp", "run", "-t", "stdio", "/app/mcp-servers/oap-gcp-mcp/src/server.py"],
                env=openagentic_gcp_env,
                supports_obo=False  # GCP uses service account auth, not OBO
            ))
            logger.info("OpenAgentic GCP MCP server configured (Platform-level GCP management)")

        # OpenAgentic AWS MCP Server - AWS Operations with Azure AD OBO via OIDC Federation
        # Uses Azure AD ID token → AWS STS AssumeRoleWithWebIdentity → temporary credentials
        if not os.getenv("OpenAgentic_AWS_MCP_DISABLED", "false").lower() == "true":
            openagentic_aws_env = {
                "AWS_REGION": os.getenv("AWS_REGION", ""),
                # AWS OIDC Federation configuration for OBO (Azure AD → STS)
                "AWS_OBO_ROLE_ARN": os.getenv("AWS_OBO_ROLE_ARN", ""),  # IAM role to assume via web identity
                "AWS_ACCOUNT_ID": os.getenv("AWS_ACCOUNT_ID", ""),  # Fallback for constructing role ARN
                # AWS Identity Center configuration (legacy - kept for backwards compat)
                "AWS_IC_INSTANCE_ARN": os.getenv("AWS_IC_INSTANCE_ARN", ""),
                "AWS_IC_APPLICATION_ARN": os.getenv("AWS_IC_APPLICATION_ARN", ""),
                # Fallback credentials when NO user token (or OBO fails with fallback enabled)
                "AWS_ACCESS_KEY_ID": os.getenv("AWS_ACCESS_KEY_ID", ""),
                "AWS_SECRET_ACCESS_KEY": os.getenv("AWS_SECRET_ACCESS_KEY", ""),
                "AWS_OBO_FALLBACK_TO_SERVICE": os.getenv("AWS_OBO_FALLBACK_TO_SERVICE", "false"),
                # Redis for credential caching
                "REDIS_HOST": os.getenv("REDIS_HOST", "redis"),
                "REDIS_PORT": os.getenv("REDIS_PORT", "6379"),
                "REDIS_PASSWORD": os.getenv("REDIS_PASSWORD", ""),
                "LOG_LEVEL": "info"
            }

            # OpenAgentic AWS MCP - can run locally (stdio) or as remote container (HTTP)
            openagentic_aws_remote_url = os.getenv("OpenAgentic_AWS_MCP_URL", "")
            if openagentic_aws_remote_url:
                # Remote mode - connect via HTTP
                self.servers["openagentic_aws"] = RemoteMCPServer(RemoteMCPServerConfig(
                    name="openagentic_aws",
                    url=openagentic_aws_remote_url,
                    supports_obo=True
                ))
                logger.info(f"OpenAgentic AWS MCP server configured as REMOTE at {openagentic_aws_remote_url}")
            else:
                # Local mode - spawn subprocess
                self.servers["openagentic_aws"] = MCPServer(MCPServerConfig(
                    name="openagentic_aws",
                    command=["fastmcp", "run", "-t", "stdio", "/app/mcp-servers/oap-aws-mcp/server.py"],
                    env=openagentic_aws_env,
                    supports_obo=True  # This server supports OBO token injection (Azure AD → AWS IC)
                ))
                logger.info("OpenAgentic AWS MCP server configured (AWS via Azure AD OBO + Identity Center)")

        # VMware MCP Server (if enabled) - VMware infrastructure management
        vmware_env = {
            "VMWARE_HOST": os.getenv("VMWARE_HOST", ""),
            "VMWARE_USERNAME": os.getenv("VMWARE_USERNAME", ""),
            "VMWARE_PASSWORD": os.getenv("VMWARE_PASSWORD", ""),
            "LOG_LEVEL": "info"
        }

        if not os.getenv("VMWARE_MCP_DISABLED", "true").lower() == "true":
            self.servers["vmware"] = MCPServer(MCPServerConfig(
                name="vmware",
                command=["node", "/app/mcp-servers/vmware-mcp-server/dist/index.js"],
                env=vmware_env
            ))

        # OpenAgentic Prometheus MCP Server - Platform-level metrics querying and visualization
        # Provides tools to query Prometheus metrics, alerts, targets, and rules
        # Check both env var names for backwards compatibility
        prometheus_disabled = os.getenv("PROMETHEUS_MCP_DISABLED", os.getenv("OpenAgentic_PROMETHEUS_MCP_DISABLED", "false")).lower() == "true"
        if not prometheus_disabled:
            openagentic_prometheus_env = {
                "PROMETHEUS_URL": os.getenv("PROMETHEUS_URL", "http://prometheus:9090"),
                "LOG_LEVEL": "info"
            }

            self.servers["openagentic_prometheus"] = MCPServer(MCPServerConfig(
                name="openagentic_prometheus",
                command=["fastmcp", "run", "-t", "stdio", "/app/mcp-servers/oap-prometheus-mcp/server.py"],
                env=openagentic_prometheus_env
            ))
            logger.info("OpenAgentic Prometheus MCP server configured (Platform-level monitoring - ADMIN USERS ONLY)")

        # OpenAgentic Loki MCP Server - Log aggregation queries via Loki/Promtail
        # Provides tools to query logs, search errors, tail logs, and analyze log patterns
        loki_disabled = os.getenv("LOKI_MCP_DISABLED", os.getenv("OpenAgentic_LOKI_MCP_DISABLED", "false")).lower() == "true"
        if not loki_disabled:
            openagentic_loki_env = {
                "LOKI_URL": os.getenv("LOKI_URL", "http://loki:3100"),
                "LOG_LEVEL": "info"
            }

            self.servers["openagentic_loki"] = MCPServer(MCPServerConfig(
                name="openagentic_loki",
                command=["fastmcp", "run", "-t", "stdio", "/app/mcp-servers/oap-loki-mcp/server.py"],
                env=openagentic_loki_env
            ))
            logger.info("OpenAgentic Loki MCP server configured (Log aggregation queries - ADMIN USERS ONLY)")

        # OpenAgentic Alertmanager MCP Server - Alert management and silencing
        # Provides tools to manage alerts, create silences, and view alert groups
        alertmanager_disabled = os.getenv("ALERTMANAGER_MCP_DISABLED", os.getenv("OpenAgentic_ALERTMANAGER_MCP_DISABLED", "false")).lower() == "true"
        if not alertmanager_disabled:
            openagentic_alertmanager_env = {
                "ALERTMANAGER_URL": os.getenv("ALERTMANAGER_URL", "http://alertmanager:9093"),
                "LOG_LEVEL": "info"
            }

            self.servers["openagentic_alertmanager"] = MCPServer(MCPServerConfig(
                name="openagentic_alertmanager",
                command=["fastmcp", "run", "-t", "stdio", "/app/mcp-servers/oap-alertmanager-mcp/server.py"],
                env=openagentic_alertmanager_env
            ))
            logger.info("OpenAgentic Alertmanager MCP server configured (Alert management - ADMIN USERS ONLY)")

        # REMOVED: OpenAgentic Runbook MCP Server — redundant, kubernetes MCP handles remediation
        logger.info("OpenAgentic Runbook MCP server REMOVED — redundant")

        # REMOVED: OpenAgentic Incident MCP Server — redundant
        logger.info("OpenAgentic Incident MCP server REMOVED — redundant")

        # REMOVED: OpenAgentic Flowise MCP Server - Flowise integration removed from platform

        # REMOVED: OpenAgentic Agent Architect MCP Server — agent management is handled by
        # the API and openagentic-proxy service, not MCP tools
        logger.info("OpenAgentic Agent Architect MCP server REMOVED — openagentic-proxy is source of truth")

        # OpenAgentic GitHub MCP Server - GitHub operations with per-user OAuth tokens
        # Custom FastMCP wrapper that accepts per-user tokens via meta.githubToken
        # User's GitHub OAuth token is injected by MCP Proxy from database
        if not os.getenv("OpenAgentic_GITHUB_MCP_DISABLED", "false").lower() == "true":
            openagentic_github_env = {
                # GitHub Enterprise Server support (optional)
                "GITHUB_HOST": os.getenv("GITHUB_HOST", ""),
                "GITHUB_API_URL": os.getenv("GITHUB_API_URL", "https://api.github.com"),
                "LOG_LEVEL": "info"
            }

            # Use our FastMCP wrapper that supports per-request token injection
            self.servers["openagentic_github"] = MCPServer(MCPServerConfig(
                name="openagentic_github",
                command=["fastmcp", "run", "-t", "stdio", "/app/mcp-servers/oap-github-mcp/server.py"],
                env=openagentic_github_env,
                supports_obo=True  # Uses per-user GitHub OAuth tokens via meta.githubToken
            ))
            logger.info("OpenAgentic GitHub MCP server configured (GitHub operations with per-user OAuth)")

        # n8n MCP removed - functionality deprecated

        # OpenAgentic Diagram MCP Server - DISABLED
        # The LLM now renders diagrams inline using React Flow, Venn, and DataChart components
        # in the chat UI. This avoids duplicate rendering (both inline AND MCP tool call).
        # Re-enable by setting OpenAgentic_DIAGRAM_MCP_DISABLED=false
        # if not os.getenv("OpenAgentic_DIAGRAM_MCP_DISABLED", "true").lower() == "true":
        #     openagentic_diagram_env = {
        #         "LOG_LEVEL": "info"
        #     }
        #
        #     self.servers["openagentic_diagram"] = MCPServer(MCPServerConfig(
        #         name="openagentic_diagram",
        #         command=["fastmcp", "run", "-t", "stdio", "/app/mcp-servers/oap-diagram-mcp/server.py"],
        #         env=openagentic_diagram_env,
        #         supports_obo=False  # Diagrams don't need user context
        #     ))
        #     logger.info("OpenAgentic Diagram MCP server configured (React Flow + DrawIO diagram generation)")
        logger.info("OpenAgentic Diagram MCP disabled - LLM renders diagrams inline via React Flow/Venn/DataChart")

        # OpenAgentic Draw.io MCP - DEPRECATED: Merged into openagentic_diagram MCP
        # The openagentic_diagram MCP now handles both React Flow and DrawIO formats

        # REMOVED: OpenAgentic OpenAgentic MCP Server
        # OpenAgentic functionality moved to dedicated Code Mode (openagentic-manager + openagentic-exec)
        # Code execution no longer goes through MCP proxy in chat mode

        # OpenAgentic ServiceNow MCP Server - REMOVED
        # ServiceNow integration removed from v0.4.0
        # If needed in future, will be re-implemented with proper OBO flow

        # AWS MCP Servers (if enabled)
        # AWS Knowledge MCP Server - Remote AWS-hosted service for docs, APIs, best practices
        # Provides guidance on how to use AWS APIs - complements our openagentic_aws MCP
        if not os.getenv("AWS_KNOWLEDGE_MCP_DISABLED", "false").lower() == "true":
            self.servers["aws_knowledge"] = MCPServer(MCPServerConfig(
                name="aws_knowledge",
                command=["uvx", "fastmcp", "run", "https://knowledge-mcp.global.api.aws"],
                env={"AWS_REGION": os.getenv("AWS_REGION", "")}
            ))
            logger.info("AWS Knowledge MCP server configured (AWS docs and best practices)")

        # OpenAgentic Knowledge MCP Server - Tool guidance and documentation for all OpenAgentic MCPs
        # This is our "meta-MCP" that teaches LLMs how to use other MCP tools correctly
        # Provides: suggest_tools_for_task, get_tool_examples, search_tool_documentation
        if not os.getenv("OpenAgentic_KNOWLEDGE_MCP_DISABLED", "false").lower() == "true":
            openagentic_knowledge_env = {
                "LOG_LEVEL": "info"
            }

            self.servers["openagentic_knowledge"] = MCPServer(MCPServerConfig(
                name="openagentic_knowledge",
                command=["fastmcp", "run", "-t", "stdio", "/app/mcp-servers/oap-knowledge-mcp/server.py"],
                env=openagentic_knowledge_env,
                supports_obo=False  # Knowledge queries don't need user context
            ))
            logger.info("OpenAgentic Knowledge MCP server configured (Tool guidance and documentation for LLMs)")

        logger.info(f"Initialized {len(self.servers)} MCP servers")

    async def start_all(self):
        """Start all enabled MCP servers"""
        logger.info("Starting all MCP servers...")

        for name, server in self.servers.items():
            if server.config.enabled:
                await server.start()
            else:
                logger.info(f"Skipping disabled MCP server: {name}")

    async def stop_all(self):
        """Stop all MCP servers"""
        logger.info("Stopping all MCP servers...")

        for server in self.servers.values():
            await server.stop()

    async def route_request(
        self,
        server_name: str,
        request: Dict[str, Any],
        user_token: Optional[str] = None,
        user_email: Optional[str] = None,
        azure_tokens: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """Route MCP request to specific server with optional user context (OBO tokens)

        Args:
            server_name: Target MCP server name
            request: MCP JSON-RPC request
            user_token: Primary user access token (ARM for Azure, access token for others)
            user_email: User email for workspace isolation
            azure_tokens: Dict of ALL Azure tokens for different audiences:
                - userAccessToken: ARM API (management.azure.com)
                - graphAccessToken: Microsoft Graph (graph.microsoft.com)
                - keyvaultAccessToken: Key Vault (vault.azure.net)
                - storageAccessToken: Azure Storage (storage.azure.com)
                - sqlAccessToken: Azure SQL (database.windows.net)
                - logAnalyticsAccessToken: Log Analytics (api.loganalytics.io)
        """

        # Handle MCP servers (stdio)
        if server_name not in self.servers:
            raise ValueError(f"Unknown MCP server: {server_name}")

        server = self.servers[server_name]

        # Auto-reconnect failed remote servers on tool call (lazy retry)
        if server.status == MCPServerStatus.FAILED and isinstance(server, RemoteMCPServer):
            logger.info(f"Attempting lazy reconnect to failed remote server: {server_name}")
            try:
                server.status = MCPServerStatus.STOPPED
                server.last_error = None
                await server.start()
                if server.status == MCPServerStatus.RUNNING:
                    logger.info(f"Lazy reconnect to {server_name} succeeded!")
                else:
                    raise RuntimeError(f"Reconnect attempt left server in status: {server.status.value}")
            except Exception as e:
                server.status = MCPServerStatus.FAILED
                server.last_error = str(e)
                logger.warning(f"Lazy reconnect to {server_name} failed: {e}")

        if server.status != MCPServerStatus.RUNNING:
            raise RuntimeError(f"MCP server {server_name} is not running (status: {server.status.value})")

        # Inject user context into request params for authentication
        # The MCP server can extract this from meta.userAccessToken, meta.graphAccessToken, etc.
        # NOTE: FastMCP 2.0+ doesn't allow parameters starting with underscore, so we use "meta" not "_meta"
        # IMPORTANT: Only inject meta for servers that actually need user context:
        # - openagentic_azure: needs OBO tokens for ARM, Graph, KeyVault, Storage APIs
        # - openagentic_aws: needs OBO token for AWS API calls
        # - openagentic_openagentic: needs userEmail for session isolation
        # - openagentic_github: needs GitHub PAT for GitHub API calls
        # Do NOT inject for: openagentic_web, openagentic_memory, openagentic_diagram, etc. (causes FastMCP validation errors)
        SERVERS_NEEDING_USER_CONTEXT = {"openagentic_azure", "openagentic_aws", "openagentic_openagentic", "openagentic_gcp", "openagentic_github"}

        if request.get("method") == "tools/call" and server_name in SERVERS_NEEDING_USER_CONTEXT:
            # Check if we have any user context to inject
            has_user_context = user_token or user_email or azure_tokens

            if has_user_context:
                if "params" not in request:
                    request["params"] = {}
                # FIX: Check if arguments is missing OR is None
                if "arguments" not in request["params"] or request["params"]["arguments"] is None:
                    request["params"]["arguments"] = {}
                # FIX: Check if meta is missing OR is None
                if "meta" not in request["params"]["arguments"] or request["params"]["arguments"]["meta"] is None:
                    request["params"]["arguments"]["meta"] = {}

                meta = request["params"]["arguments"]["meta"]

                # For Azure servers, inject ALL available tokens for full API parity
                if server_name == "openagentic_azure" and azure_tokens:
                    for token_key, token_value in azure_tokens.items():
                        if token_value:
                            meta[token_key] = token_value
                    token_keys = [k for k, v in azure_tokens.items() if v]
                    logger.info(f"Injected Azure tokens into {server_name}: {token_keys}")
                elif user_token:
                    # Fallback: inject primary user token for backwards compatibility
                    meta["userAccessToken"] = user_token
                    logger.debug(f"Injected user access token into request for {server_name}")

                # Inject user email for workspace lookup (Openagentic, etc.)
                # This allows workspace isolation even without OBO token
                if user_email:
                    meta["userEmail"] = user_email
                    logger.debug(f"Injected user email into request for {server_name}: {user_email}")

        return await server.send_request(request)


    def get_server_status(self) -> Dict[str, Any]:
        """Get status of all MCP servers"""
        status = {}

        # Add all MCP servers (stdio processes)
        for name, server in self.servers.items():
            status[name] = {
                "status": server.status.value,
                "enabled": server.config.enabled,
                "last_error": server.last_error,
                "transport": "remote" if isinstance(server, RemoteMCPServer) else "stdio",
                "pid": server.process.pid if hasattr(server, 'process') and server.process else None
            }
        return status

    async def add_server(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Add a new MCP server dynamically from configuration.

        Supports two formats:
        1. Flat format: {"name": "kubernetes", "command": "npx", "args": ["-y", "kubernetes-mcp-server@latest"]}
        2. Claude Desktop format: {"mcpServers": {"kubernetes": {"command": "npx", "args": ["-y", "..."]}}}
        """
        # Check if this is Claude Desktop format (has mcpServers wrapper)
        if "mcpServers" in config:
            # Extract the first server from mcpServers
            mcp_servers = config["mcpServers"]
            if not mcp_servers:
                raise ValueError("mcpServers object is empty")

            # Get the first (and usually only) server
            server_name = list(mcp_servers.keys())[0]
            server_config = mcp_servers[server_name]

            # Merge extracted config
            config = {
                "name": server_name,
                **server_config
            }

        # Validate required fields
        name = config.get("name")
        command = config.get("command")

        if not name:
            raise ValueError("Server configuration must include 'name'")
        if not command:
            raise ValueError("Server configuration must include 'command'")

        # Check if server already exists
        if name in self.servers:
            raise ValueError(f"Server '{name}' already exists. Use restart or remove first.")

        # Build command list
        args = config.get("args", [])
        if isinstance(command, str):
            # Command is a string, combine with args
            command_list = [command] + args
        elif isinstance(command, list):
            # Command is already a list
            command_list = command
        else:
            raise ValueError("'command' must be a string or list")

        # Get optional configuration
        env = config.get("env", {})
        transport = config.get("transport", "stdio")
        enabled = config.get("enabled", True)
        supports_obo = config.get("supports_obo", False)

        # Create the server configuration
        server_config = MCPServerConfig(
            name=name,
            command=command_list,
            env=env,
            transport=transport,
            enabled=enabled,
            supports_obo=supports_obo
        )

        # Create and add the server
        server = MCPServer(server_config)
        self.servers[name] = server

        logger.info(f"Added MCP server: {name} with command: {command_list}")

        # Auto-start if enabled
        if enabled:
            await server.start()

        return {
            "name": name,
            "status": server.status.value,
            "command": command_list,
            "enabled": enabled,
            "transport": transport
        }

    async def start_server(self, server_id: str) -> None:
        """Start a specific MCP server by ID"""
        if server_id not in self.servers:
            raise ValueError(f"Unknown server: {server_id}")

        server = self.servers[server_id]
        await server.start()
        logger.info(f"Started server: {server_id}")

    async def stop_server(self, server_id: str) -> None:
        """Stop a specific MCP server by ID"""
        if server_id not in self.servers:
            raise ValueError(f"Unknown server: {server_id}")

        server = self.servers[server_id]
        await server.stop()
        logger.info(f"Stopped server: {server_id}")

    async def remove_server(self, server_id: str) -> None:
        """Remove a server from management (stops it first if running)"""
        if server_id not in self.servers:
            raise ValueError(f"Unknown server: {server_id}")

        server = self.servers[server_id]

        # Stop the server if running
        if server.status == MCPServerStatus.RUNNING:
            await server.stop()

        # Remove from servers dict
        del self.servers[server_id]
        logger.info(f"Removed server: {server_id}")

    async def delete_server(self, server_id: str) -> None:
        """Alias for remove_server - delete a server from management"""
        await self.remove_server(server_id)

    async def restart_server(self, server_id: str) -> None:
        """Restart a specific MCP server by ID"""
        if server_id not in self.servers:
            raise ValueError(f"Unknown server: {server_id}")

        server = self.servers[server_id]
        await server.stop()
        await server.start()
        logger.info(f"Restarted server: {server_id}")

    async def list_all_tools(self) -> Dict[str, List[Dict[str, Any]]]:
        """List tools from all running MCP servers"""
        all_tools = {}

        # Get MCP server tools via stdio or HTTP
        for name, server in self.servers.items():
            if server.status == MCPServerStatus.RUNNING:
                try:
                    # For remote servers with eagerly cached tools, use the cache
                    if isinstance(server, RemoteMCPServer) and server._cached_tools is not None:
                        all_tools[name] = server._cached_tools
                        logger.info(f"Loaded {len(server._cached_tools)} tools from {name} (cached)")
                        continue

                    # MCP spec: params is optional for tools/list
                    # Try without params first (some servers like mcp-server-fetch reject empty params)
                    # Use unique ID to avoid response collisions
                    unique_id = f"list-tools-{name}-{uuid.uuid4().hex[:8]}"
                    request = {
                        "jsonrpc": "2.0",
                        "id": unique_id,
                        "method": "tools/list"
                    }
                    response = await server.send_request(request)

                    # If error -32602 (Invalid params), retry with empty params object
                    if "error" in response and response["error"].get("code") == -32602:
                        logger.info(f"[{name}] Retrying tools/list with empty params object")
                        unique_id = f"list-tools-retry-{name}-{uuid.uuid4().hex[:8]}"
                        request["id"] = unique_id
                        request["params"] = {}
                        response = await server.send_request(request)

                    if "result" in response and "tools" in response["result"]:
                        all_tools[name] = response["result"]["tools"]
                        logger.info(f"Loaded {len(response['result']['tools'])} tools from {name}")
                    else:
                        all_tools[name] = []

                except Exception as e:
                    logger.error(f"Failed to list tools from {name}: {e}")
                    all_tools[name] = []

        return all_tools

    def _load_enabled_states_from_redis(self):
        """Load runtime enabled states from Redis (overrides build-time config)"""
        if not self.redis_client:
            return

        try:
            for server_name in self.servers:
                redis_key = f"{REDIS_MCP_ENABLED_PREFIX}{server_name}"
                value = self.redis_client.get(redis_key)
                if value is not None:
                    # Value stored as b'true' or b'false'
                    enabled = value.decode('utf-8').lower() == 'true'
                    self.servers[server_name].config.enabled = enabled
                    logger.info(f"[Redis] Loaded enabled state for {server_name}: {enabled}")
        except Exception as e:
            logger.error(f"Failed to load enabled states from Redis: {e}")

    def _save_enabled_state_to_redis(self, server_name: str, enabled: bool):
        """Save server enabled state to Redis for persistence"""
        if not self.redis_client:
            logger.warning(f"Redis not available, enabled state for {server_name} not persisted")
            return False

        try:
            redis_key = f"{REDIS_MCP_ENABLED_PREFIX}{server_name}"
            self.redis_client.set(redis_key, str(enabled).lower())
            logger.info(f"[Redis] Saved enabled state for {server_name}: {enabled}")
            return True
        except Exception as e:
            logger.error(f"Failed to save enabled state to Redis for {server_name}: {e}")
            return False

    async def set_server_enabled(self, server_id: str, enabled: bool) -> Dict[str, Any]:
        """
        Enable or disable an MCP server at runtime.

        - When enabled=True: Sets config.enabled=True and starts the server if not running
        - When enabled=False: Sets config.enabled=False and stops the server if running

        State is persisted to Redis so it survives restarts.
        """
        if server_id not in self.servers:
            raise ValueError(f"Unknown server: {server_id}")

        server = self.servers[server_id]
        previous_state = server.config.enabled

        # Update the enabled state
        server.config.enabled = enabled

        # Persist to Redis
        persisted = self._save_enabled_state_to_redis(server_id, enabled)

        # Start or stop based on new state
        action_taken = None
        if enabled and server.status != MCPServerStatus.RUNNING:
            # Enable and start
            await server.start()
            action_taken = "started"
            logger.info(f"Server {server_id} enabled and started")
        elif not enabled and server.status == MCPServerStatus.RUNNING:
            # Disable and stop
            await server.stop()
            action_taken = "stopped"
            logger.info(f"Server {server_id} disabled and stopped")
        else:
            action_taken = "no_change"
            logger.info(f"Server {server_id} enabled={enabled}, no process change needed")

        return {
            "server_id": server_id,
            "enabled": enabled,
            "previous_enabled": previous_state,
            "status": server.status.value,
            "action": action_taken,
            "persisted_to_redis": persisted
        }

    def get_server_enabled(self, server_id: str) -> bool:
        """Get the enabled state of a specific server"""
        if server_id not in self.servers:
            raise ValueError(f"Unknown server: {server_id}")
        return self.servers[server_id].config.enabled

    def list_server_enabled_states(self) -> Dict[str, bool]:
        """List enabled state for all servers"""
        return {name: server.config.enabled for name, server in self.servers.items()}