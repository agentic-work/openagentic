

"""
MCP Proxy Service - Centralized MCP Server Management with OBO Authentication
Hosts and manages ALL MCP servers for the OpenAgentic platform
"""

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import jwt
import httpx
import time
import redis
import subprocess
import uuid
from typing import Dict, Any, Optional, List, Union
from fastapi import FastAPI, HTTPException, Depends, Request, BackgroundTasks, Cookie, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import uvicorn
from contextlib import asynccontextmanager

from prometheus_fastapi_instrumentator import Instrumentator

from mcp_manager import MCPManager, MCPServerStatus, RemoteMCPServer
from user_session_manager import get_user_session_manager
from azure_oauth import AzureOAuthService

# Configure structured logging via structlog
try:
    import structlog
    log_level = getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO)
    logging.basicConfig(
        format="%(message)s",
        stream=__import__('sys').stderr,
        level=log_level,
        force=True,
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    logger = structlog.get_logger(service="mcp-proxy")
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
except ImportError:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    logger = logging.getLogger("mcp-proxy")

# Set detailed logging for MCP interactions
logging.getLogger("mcp-manager").setLevel(logging.INFO)

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

# Configuration
TENANT_ID = os.getenv("AZURE_TENANT_ID")
CLIENT_ID = os.getenv("AZURE_CLIENT_ID")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")
PORT = int(os.getenv("PORT", "8080"))
API_BASE_URL = os.getenv("API_BASE_URL", "http://openagentic-api:8000")  # Internal API for logging

# Authentication can be disabled for local development
# Azure AD users: Validated via Azure AD token, RBAC policies apply
# Local admin users: No token = system admin role with full access
ENABLE_AUTH = os.getenv("ENABLE_AUTH", "true").lower() in ("true", "1", "yes")

# FedRAMP CM-7 / SA-15 — the MCP Inspector is a dev-only debug surface (unauthenticated
# UI + an unpinned npx fetch at runtime). It must be explicitly opted into and defaults OFF
# so production images never expose it.
ENABLE_MCP_INSPECTOR = os.getenv("ENABLE_MCP_INSPECTOR", "false").lower() in ("true", "1", "yes")


# =============================================================================
# B3 (FedRAMP P3) — fail-closed auth hardening (NIST AC-3, AC-6, IA-2, IA-5)
# =============================================================================
class BootError(RuntimeError):
    """Raised at boot when a required signing key is missing or a known weak
    placeholder. The proxy refuses to start rather than run with a forgeable
    trust root."""


def bootstrap_jwt_keys() -> Dict[str, Optional[str]]:
    """Validate the internal JWT signing key at boot — FAIL CLOSED.

    Accepts the key from any of the known env vars (new + legacy). Rejects a
    missing key, and rejects any value beginning with the `dev-secret` weak
    placeholder. Returns the resolved key material on success.
    """
    signing_key = (
        os.getenv("JWT_SIGNING_KEY")
        or os.getenv("OPENAGENTIC_JWT_KEY")
        or os.getenv("JWT_SECRET")
        or os.getenv("SIGNING_SECRET")
        or os.getenv("INTERNAL_JWT_SECRET")
    )
    if not signing_key:
        raise BootError(
            "JWT signing key required: set JWT_SIGNING_KEY (or JWT_SECRET / "
            "SIGNING_SECRET) to a strong random value. Refusing to start."
        )
    if signing_key.startswith("dev-secret"):
        raise BootError(
            "JWT signing key is a 'dev-secret' placeholder — refusing to start "
            "with a forgeable trust root. Set a strong random value."
        )
    return {
        "signing_key": signing_key,
        "aad_public_key": os.getenv("AAD_PUBLIC_KEY"),
    }


# Label MUST match the api's mintInterServiceSystemToken (util/mintInterServiceSystemToken.ts).
SYSTEM_TOKEN_LABEL = "openagentic-system-token"
SYSTEM_TOKEN_PREFIX = "oa_sys_"


def compute_system_token_suffix(secret: str) -> str:
    """Reference HMAC suffix for the `oa_sys_` inter-service token.

    Both the api (mintInterServiceSystemToken) and this proxy MUST compute it
    identically: base64url(HMAC_SHA256(secret, SYSTEM_TOKEN_LABEL)) with '='
    padding stripped (matching Node's `.digest('base64url')`).
    """
    digest = hmac.new(
        secret.encode("utf-8"), SYSTEM_TOKEN_LABEL.encode("utf-8"), hashlib.sha256
    ).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def verify_system_token(token: str) -> bool:
    """Constant-time HMAC verification of an `oa_sys_<hmac>` inter-service token.

    The api mints it as `oa_sys_` + compute_system_token_suffix(INTERNAL_SERVICE_SECRET).
    We recompute and compare_digest. The prefix alone is NEVER trusted (the
    pre-B3 bypass trusted it blindly → system-root for any `Bearer oa_sys_<anything>`).
    Returns False when the secret is unset/empty so a missing secret can never
    authenticate a system caller.
    """
    if not token or not token.startswith(SYSTEM_TOKEN_PREFIX):
        return False
    secret = os.getenv("INTERNAL_SERVICE_SECRET", "")
    if not secret:
        logger.warning("INTERNAL_SERVICE_SECRET unset — rejecting system token (fail closed)")
        return False
    expected = SYSTEM_TOKEN_PREFIX + compute_system_token_suffix(secret)
    return hmac.compare_digest(token, expected)

# =============================================================================
# MCP READ-ONLY MODE - Platform-level safety guardrail for CLOUD PROVIDERS ONLY
# =============================================================================
# When enabled, this OVERRIDES all user permissions and blocks destructive operations
# on AWS, Azure, GCP, and Kubernetes MCPs ONLY. Other MCPs (web, admin, etc.)
# are NOT affected and can perform any operation.
#
# This is a safety net to prevent accidental cloud resource deletions during development.
# Set MCP_READ_ONLY_MODE=true to enable (default: false)
# DB setting (admin console) overrides this at runtime.
MCP_READ_ONLY_MODE = os.getenv("MCP_READ_ONLY_MODE", "false").lower() in ("true", "1", "yes")
_readonly_cache_time = 0
_readonly_cache_value = MCP_READ_ONLY_MODE

async def refresh_readonly_from_db():
    """Poll the API for the DB-persisted read-only setting (every 30s)."""
    global MCP_READ_ONLY_MODE, _readonly_cache_time, _readonly_cache_value
    import time as _time
    now = _time.time()
    if now - _readonly_cache_time < 30:
        MCP_READ_ONLY_MODE = _readonly_cache_value
        return
    try:
        api_url = os.getenv("API_BASE_URL", "http://openagentic-api:8000")
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{api_url}/api/admin/tools/readonly")
            if resp.status_code == 200:
                data = resp.json()
                _readonly_cache_value = data.get("enabled", MCP_READ_ONLY_MODE)
                MCP_READ_ONLY_MODE = _readonly_cache_value
                _readonly_cache_time = now
    except Exception:
        pass  # Keep current value on error

# MCP servers affected by read-only mode (cloud infrastructure providers only)
# All other MCPs (web, openagentic, admin, etc.) are NOT restricted
READ_ONLY_AFFECTED_SERVERS = [
    "openagentic_azure",      # Azure ARM operations
    "openagentic_aws",        # AWS operations
    "openagentic_gcp",        # GCP operations
    "openagentic_kubernetes", # Kubernetes cluster operations
    "azure",          # Legacy Azure server names
    "aws",
    "gcp",
    "kubernetes",
]

# Tools and operations blocked in read-only mode
# These patterns match tool names that could cause destructive changes
BLOCKED_TOOL_PATTERNS = [
    # Destructive operations
    "delete", "remove", "destroy", "purge", "terminate",
    # Modification operations
    "create", "update", "modify", "patch", "put",
    # Infrastructure operations
    "restart", "scale", "deploy", "rollout", "drain", "cordon",
    # AWS-specific
    "DeleteStack", "TerminateInstances", "DeleteBucket", "DeleteQueue",
    # Kubernetes-specific
    "delete_pod", "delete_deployment", "delete_namespace",
    # Generic destructive actions
    "drop", "truncate", "wipe", "erase", "kill",
    # Write operations
    "send", "post", "write", "set", "assign", "grant", "revoke",
]

# HTTP methods blocked in read-only mode for ARM/REST tools
BLOCKED_METHODS = ["DELETE", "delete"]

def is_server_affected_by_read_only(server_name: str) -> bool:
    """Check if a server is affected by read-only mode."""
    server_lower = server_name.lower()
    for affected in READ_ONLY_AFFECTED_SERVERS:
        if affected.lower() in server_lower:
            return True
    return False

def is_tool_blocked_in_read_only(tool_name: str, arguments: dict, server_name: str = "") -> tuple[bool, str]:
    """
    Check if a tool call should be blocked in read-only mode.
    Only applies to cloud provider MCPs (AWS, Azure, GCP, Kubernetes).
    Returns (is_blocked, reason).
    """
    if not MCP_READ_ONLY_MODE:
        return False, ""

    # IMPORTANT: Only apply read-only mode to cloud infrastructure servers
    # Other servers (web, openagentic, admin, etc.) can do whatever they want
    if server_name and not is_server_affected_by_read_only(server_name):
        return False, ""

    tool_lower = tool_name.lower()

    # Check tool name patterns
    for pattern in BLOCKED_TOOL_PATTERNS:
        if pattern.lower() in tool_lower:
            return True, f"Tool '{tool_name}' is blocked in read-only mode on cloud servers (matches pattern: {pattern})"

    # Check for DELETE via generic cloud-REST passthroughs (still relevant for AWS/GCP/K8s)
    if tool_name in ("aws_execute", "gcp_execute", "k8s_execute"):
        method = arguments.get("method", "").upper()
        if method in BLOCKED_METHODS:
            return True, f"HTTP DELETE method is blocked in read-only mode for tool '{tool_name}'"

    # Check for action arguments that indicate destructive operations
    action = arguments.get("action", "").lower()
    operation = arguments.get("operation", "").lower()
    for arg_value in [action, operation]:
        for pattern in BLOCKED_TOOL_PATTERNS:
            if pattern.lower() in arg_value:
                return True, f"Operation '{arg_value}' is blocked in read-only mode on cloud servers"

    return False, ""

# Global instances
mcp_manager: Optional[MCPManager] = None
redis_client: Optional[redis.Redis] = None
oauth_service: Optional[AzureOAuthService] = None
inspector_process: Optional[subprocess.Popen] = None

# === HELPER FUNCTIONS ===

async def send_mcp_log_to_api(
    user_id: str,
    user_name: Optional[str],
    user_email: Optional[str],
    server_name: str,
    tool_name: str,
    method: str,
    params: dict,
    result: Optional[dict],
    error: Optional[dict],
    execution_time_ms: float,
    success: bool
) -> None:
    """Send MCP call log to API database (fire-and-forget) with full request/response data"""
    try:
        # Use internal API key for service-to-service authentication
        api_internal_key = os.environ.get('API_INTERNAL_KEY', '')  # MUST be set in env
        headers = {
            'Authorization': f'Bearer {api_internal_key}',
            'Content-Type': 'application/json'
        }

        async with httpx.AsyncClient() as client:
            log_data = {
                "user_id": user_id,
                "user_name": user_name,
                "user_email": user_email,
                "server_name": server_name,
                "tool_name": tool_name,
                "method": method,
                "params": params,
                "result": result,  # Full response data
                "error": error,
                "execution_time_ms": execution_time_ms,
                "success": success,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
            }

            await client.post(
                f"{API_BASE_URL}/api/mcp-logs",
                json=log_data,
                headers=headers,
                timeout=5.0  # Quick timeout to not block
            )
            logger.debug(f"MCP log sent to API for tool: {tool_name} by user: {user_name or user_id}")
    except Exception as e:
        # Log but don't fail the request
        logger.warning(f"Failed to send MCP log to API: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events for MCP servers"""
    global mcp_manager, redis_client, oauth_service, inspector_process

    logger.info("=== MCP PROXY STARTUP ===")

    # Log read-only mode status
    if MCP_READ_ONLY_MODE:
        logger.warning("🛡️ =========================================================")
        logger.warning("🛡️  MCP READ-ONLY MODE IS ENABLED (Cloud Providers Only)")
        logger.warning("🛡️  Destructive operations BLOCKED on: AWS, Azure, GCP, K8s")
        logger.warning("🛡️  Other MCPs (web, admin, etc.) are NOT affected")
        logger.warning("🛡️  Set MCP_READ_ONLY_MODE=false to disable")
        logger.warning("🛡️ =========================================================")
    else:
        logger.info("MCP Read-Only Mode: DISABLED (all operations allowed)")

    # Initialize Redis
    logger.info("Connecting to Redis...")
    redis_host = os.getenv("REDIS_HOST", "redis")
    redis_port = int(os.getenv("REDIS_PORT", "6379"))
    redis_password = os.getenv("REDIS_PASSWORD", None)
    redis_client = redis.Redis(
        host=redis_host,
        port=redis_port,
        password=redis_password,
        decode_responses=False
    )
    redis_client.ping()  # Test connection
    logger.info(f"✅ Redis connected at {redis_host}:{redis_port}")

    # Initialize OAuth service (only if auth is enabled)
    if ENABLE_AUTH:
        logger.info("Initializing Azure OAuth service...")
        oauth_service = AzureOAuthService(redis_client)
        logger.info("✅ OAuth service initialized")
    else:
        logger.info("⚠️ Auth disabled - skipping Azure OAuth service initialization")

    # Start MCP Inspector subprocess (dev-only, opt-in via ENABLE_MCP_INSPECTOR;
    # defaults OFF so production images never expose this unauthenticated debug surface)
    if ENABLE_MCP_INSPECTOR:
        logger.warning("⚠️ MCP Inspector ENABLED (dev-only debug surface) — do not enable in production")
        logger.info("Starting MCP Inspector UI...")
        try:
            inspector_process = subprocess.Popen(
                ["npx", "@modelcontextprotocol/inspector", "--no-open"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env={**os.environ, "PORT": "6274", "MCPP_PORT": "6277"}
            )
            logger.info(f"✅ MCP Inspector started on ports 6274/6277 (PID: {inspector_process.pid})")
        except Exception as e:
            logger.error(f"⚠️ Failed to start MCP Inspector: {e}")
            inspector_process = None
    else:
        logger.debug("MCP Inspector disabled (set ENABLE_MCP_INSPECTOR=true to enable; dev-only)")

    logger.info("Initializing MCP Manager...")
    mcp_manager = MCPManager(redis_client=redis_client)

    logger.info("Starting all MCP servers...")
    await mcp_manager.start_all()

    # Log server statuses
    statuses = mcp_manager.get_server_status()
    logger.info("=== MCP SERVER STATUS ===")
    for name, status in statuses.items():
        logger.info(f"{name}: {status['status']} (PID: {status.get('pid', 'N/A')})")

    # Start per-user Azure MCP session cleanup
    logger.info("Starting per-user Azure MCP session manager...")
    session_manager = get_user_session_manager()
    await session_manager.start_periodic_cleanup(interval_minutes=15)
    logger.info("✅ User session manager started with periodic cleanup (every 15 minutes)")

    # Background reconnect loop for failed remote MCP servers
    async def _reconnect_failed_servers():
        """Periodically attempt to reconnect any failed remote MCP servers."""
        while True:
            await asyncio.sleep(30)  # Check every 30 seconds
            if not mcp_manager:
                continue
            for name, server in mcp_manager.servers.items():
                if server.status == MCPServerStatus.FAILED and isinstance(server, RemoteMCPServer):
                    logger.info(f"[reconnect] Attempting background reconnect to {name}...")
                    try:
                        server.status = MCPServerStatus.STOPPED
                        server.last_error = None
                        await server.start()
                        if server.status == MCPServerStatus.RUNNING:
                            logger.info(f"[reconnect] ✅ {name} reconnected successfully!")
                        else:
                            logger.warning(f"[reconnect] {name} still not running after reconnect attempt")
                    except Exception as e:
                        server.status = MCPServerStatus.FAILED
                        server.last_error = str(e)
                        logger.warning(f"[reconnect] {name} reconnect failed: {e}")

    reconnect_task = asyncio.create_task(_reconnect_failed_servers())
    logger.info("✅ Background reconnect loop started (checks every 30s)")

    yield

    reconnect_task.cancel()

    logger.info("=== MCP PROXY SHUTDOWN ===")

    # Stop MCP Inspector
    if inspector_process:
        logger.info("Stopping MCP Inspector...")
        inspector_process.terminate()
        try:
            inspector_process.wait(timeout=5)
            logger.info("✅ MCP Inspector stopped")
        except subprocess.TimeoutExpired:
            logger.warning("Force killing MCP Inspector...")
            inspector_process.kill()
            inspector_process.wait()

    if mcp_manager:
        await mcp_manager.stop_all()

    # Stop user session cleanup
    logger.info("Stopping user session manager...")
    session_manager = get_user_session_manager()
    await session_manager.stop_periodic_cleanup()
    logger.info("✅ User session manager stopped")

    # Close Redis connection
    if redis_client:
        redis_client.close()
        logger.info("✅ Redis connection closed")

# FastAPI app with lifespan management
app = FastAPI(
    title="MCP Proxy Service",
    version="2.0.0",
    description="Centralized MCP Server Management with OBO Authentication",
    lifespan=lifespan
)

# SECURITY: CORS configuration from environment (v0.4.0 hardening)
# Set ALLOWED_ORIGINS env var as comma-separated list of allowed origins
# Defaults to internal services only when not specified
ALLOWED_ORIGINS_ENV = os.getenv("ALLOWED_ORIGINS", "")
if ALLOWED_ORIGINS_ENV:
    ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS_ENV.split(",") if origin.strip()]
else:
    # Default: Only allow internal Docker network services
    ALLOWED_ORIGINS = [
        "http://localhost:3000",          # Local API development
        "http://localhost:5173",          # Local UI development (Vite)
        "http://openagentic-api:8000",    # Internal API service
        "http://openagentic-ui:3000",     # Internal UI service
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Prometheus metrics instrumentation
Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)

# Mount static files for inspector UI
app.mount("/static", StaticFiles(directory="src/static"), name="static")

security = HTTPBearer(auto_error=False)

# Request/Response models
class MCPRequest(BaseModel):
    method: str
    params: Dict[str, Any] = {}
    id: str = "1"
    server: Optional[str] = None  # Target MCP server name

class MCPResponse(BaseModel):
    result: Optional[Dict[str, Any]] = None
    error: Optional[Dict[str, Any]] = None
    id: str = "1"
    server: Optional[str] = None
    execution_time: Optional[float] = None
    cache_meta: Optional[Dict[str, Any]] = None       # Cache metadata (TTL hints, freshness)
    error_envelope: Optional[Dict[str, Any]] = None  # Structured error with code/retryable/suggestion

class MCPToolCall(BaseModel):
    server: Optional[str] = None  # Target MCP server name (auto-detected if not provided)
    tool: str
    arguments: Dict[str, Any] = {}
    id: str = "1"
    meta: Optional[Dict[str, Any]] = None  # Meta info including userAccessToken for Azure/AWS OBO

class TokenExchangeError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(message)

# Authentication helpers - using same logic as API
def get_authorized_groups():
    """Get authorized groups from environment - same as API"""
    user_groups = os.getenv('AAD_AUTHORIZED_USER_GROUPS', '').split(',')
    user_groups = [g.strip() for g in user_groups if g.strip()]

    admin_groups = os.getenv('AAD_AUTHORIZED_ADMIN_GROUPS', '').split(',')
    admin_groups = [g.strip() for g in admin_groups if g.strip()]

    return user_groups, admin_groups

def is_user_authorized(user_groups, required_groups):
    """Check if user is in authorized groups - same as API"""
    if not required_groups:
        return True
    return any(group in required_groups for group in user_groups)

def is_admin_user(user_groups, admin_groups):
    """Check if user is admin - same as API"""
    return is_user_authorized(user_groups, admin_groups)

async def fetch_user_mcp_access_policies(user_groups: List[str]) -> Dict[str, str]:
    """Fetch MCP access policies for user's groups from API"""
    try:
        # Query the API for access policies for all user groups
        access_map = {}

        # Use internal API key for service-to-service authentication
        api_internal_key = os.environ.get('API_INTERNAL_KEY', '')  # MUST be set in env
        headers = {
            'Authorization': f'Bearer {api_internal_key}',
            'Content-Type': 'application/json'
        }

        async with httpx.AsyncClient() as client:
            for group_id in user_groups:
                try:
                    response = await client.get(
                        f"{API_BASE_URL}/api/admin/mcp/access-summary/{group_id}",
                        headers=headers,
                        timeout=10.0
                    )

                    if response.status_code == 200:
                        data = response.json()
                        access_summary = data.get('access_summary', [])

                        # Process access summary to build server access map
                        for item in access_summary:
                            server_id = item['server']['id']
                            server_name = item['server']['name']
                            access_type = item['access']  # 'allow' or 'deny'

                            # If we haven't seen this server yet, or if this is an allow policy
                            # (allow policies override deny policies for better UX)
                            if server_name not in access_map or access_type == 'allow':
                                access_map[server_name] = access_type

                except Exception as e:
                    logger.warning(f"Failed to fetch access policies for group {group_id}: {e}")
                    continue

        logger.info(f"Fetched MCP access policies: {access_map}")
        return access_map

    except Exception as e:
        logger.error(f"Failed to fetch MCP access policies: {e}")
        # Return empty map - default policies will be used
        return {}

def check_server_access(server_name: str, user_groups: List[str], access_policies: Dict[str, str], is_admin: bool) -> bool:
    """Check if user can access a specific MCP server"""
    # Admins can access all servers
    if is_admin:
        return True

    # Check explicit policies first
    if server_name in access_policies:
        access = access_policies[server_name]
        logger.debug(f"Explicit policy for server '{server_name}': {access}")
        return access == 'allow'

    # For admin servers, deny access for non-admin users
    # IMPORTANT: openagentic_admin and openagentic_kubernetes are admin-only servers
    admin_servers = {'admin', 'openagentic_admin', 'openagentic_kubernetes'}
    if server_name in admin_servers:
        logger.debug(f"Denying access to admin server '{server_name}' for non-admin user")
        return False

    # Default policy for other servers - allow access
    # This can be made configurable via MCPDefaultPolicy later
    logger.debug(f"Using default policy for server '{server_name}': allow")
    return True

# Per-tool access policy cache (TTL-based)
_tool_access_policies_cache: Dict[str, Any] = {}
_tool_access_policies_cache_time: float = 0
TOOL_ACCESS_CACHE_TTL = 60  # seconds

async def fetch_tool_access_policies() -> List[Dict[str, Any]]:
    """Fetch tool-level access policies from API, cached with TTL"""
    global _tool_access_policies_cache, _tool_access_policies_cache_time

    now = time.time()
    if _tool_access_policies_cache and (now - _tool_access_policies_cache_time) < TOOL_ACCESS_CACHE_TTL:
        return _tool_access_policies_cache.get('policies', [])

    api_url = os.environ.get("API_URL", "http://openagentic-api:8000")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{api_url}/api/admin/mcp-access/tools", headers={
                "Authorization": f"Bearer {os.environ.get('INTERNAL_API_KEY', '')}"
            })
            if resp.status_code == 200:
                data = resp.json()
                _tool_access_policies_cache = data
                _tool_access_policies_cache_time = now
                return data.get('policies', [])
    except Exception as e:
        logger.debug(f"Failed to fetch tool access policies: {e}")
    return []

def check_tool_access(
    tool_name: str,
    server_name: str,
    user_id: str,
    user_groups: List[str],
    is_admin: bool,
    tool_policies: List[Dict[str, Any]]
) -> tuple:
    """
    Check per-tool access. Returns (allowed: bool, reason: str, require_approval: bool).
    Resolution: user deny > group deny > user allow > group allow > wildcard > default allow.
    """
    if is_admin:
        return (True, "admin_bypass", False)

    # Filter to relevant policies for this server+tool
    relevant = [p for p in tool_policies
                if p.get('isEnabled', True) and
                p.get('serverId') == server_name and
                p.get('toolName') in (tool_name, '*')]

    if not relevant:
        return (True, "no_tool_policy", False)

    # Sort by priority (lower = higher priority)
    relevant.sort(key=lambda p: p.get('priority', 1000))

    # Check user-specific policies
    for p in relevant:
        if p.get('userId') == user_id:
            return (
                p.get('accessType') == 'allow',
                f"user_policy:{p.get('id')}",
                p.get('requireApproval', False)
            )

    # Check group policies
    for p in relevant:
        gid = p.get('azureGroupId')
        if gid and gid in user_groups:
            return (
                p.get('accessType') == 'allow',
                f"group_policy:{p.get('id')}",
                p.get('requireApproval', False)
            )

    # Check wildcard (no user/group) policies
    for p in relevant:
        if not p.get('userId') and not p.get('azureGroupId'):
            return (
                p.get('accessType') == 'allow',
                f"global_policy:{p.get('id')}",
                p.get('requireApproval', False)
            )

    return (True, "default_allow", False)

async def get_user_info(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Optional[Dict[str, Any]]:
    """
    Get user info from JWT token or return system admin for local users.

    Supports THREE authentication methods:
    1. Azure AD tokens (RS256, has 'kid') - Validated against JWKS
    2. Internal API tokens (HS256, no 'kid') - Validated against shared secret
    3. Raw API keys (not JWT) - Direct string comparison

    - Azure AD users: Token validated via JWKS, RBAC policies enforced
    - Internal API users: Token validated via shared secret, user context from claims
    - Local admin users (no token): System admin role with full access
    """
    if not credentials:
        # B3 (NIST AC-3/IA-2): FAIL CLOSED. A request with no Authorization
        # header must NEVER be granted system-admin. When auth is enabled,
        # reject with 401. Only when auth is explicitly disabled (local dev,
        # ENABLE_AUTH=false) do we fall back to a local-admin context.
        if ENABLE_AUTH:
            raise HTTPException(
                status_code=401,
                detail={"error": "missing_authorization", "message": "Authorization required"},
            )
        logger.info("No credentials + ENABLE_AUTH=false — local-dev system admin context")
        return {
            'token': None,
            'payload': {},
            'user_id': 'system-admin',
            'user_name': 'System Admin',
            'email': 'admin@local',
            'upn': None,
            'groups': ['system-admins'],
            'is_admin': True
        }

    token = credentials.credentials

    # System-level inter-service token. B3 (NIST IA-2/IA-5): the prefix alone is
    # NOT trusted — we HMAC-verify the token against INTERNAL_SERVICE_SECRET
    # (the api mints it via mintInterServiceSystemToken). A forged
    # `Bearer oa_sys_<anything>` fails verify_system_token() and falls through
    # to normal validation (and is ultimately rejected).
    if token and token.startswith(SYSTEM_TOKEN_PREFIX):
        if verify_system_token(token):
            logger.info("System inter-service token HMAC-verified — using SP credentials")
            return {
                'token': 'SYSTEM_SP_AUTH',  # Special marker for SP credential usage
                'payload': {},
                'user_id': 'system-root',
                'user_name': 'System Root',
                'email': 'system@openagentic.io',
                'upn': None,
                'groups': ['system-admins'],
                'is_admin': True
            }
        logger.warning("oa_sys_ token failed HMAC verification — rejecting (fail closed)")
        raise HTTPException(
            status_code=401,
            detail={"error": "invalid_system_token", "message": "System token verification failed"},
        )

    # Check for OpenAgentic user API key (oa_ prefix, not the oa_sys_ system key)
    # Format: oa_<base64url(randomBytes(32))>  (43-char base64url body)
    # This is used when users authenticate with API keys instead of Azure AD
    if token and token.startswith('oa_') and not token.startswith('oa_sys_'):
        logger.info("OpenAgentic user API key detected - validating against API")
        try:
            # Validate the API key by calling the OpenAgentic API's /api/auth/me endpoint
            api_internal_url = os.environ.get('API_INTERNAL_URL', 'http://openagentic-api:8000')
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{api_internal_url}/api/auth/me",
                    headers={'Authorization': f'Bearer {token}'}
                )
                if response.status_code == 200:
                    user_data = response.json()
                    logger.info(f"API key validated for user: {user_data.get('email', 'unknown')}")
                    return {
                        'token': token,  # Pass the original API key for OBO
                        'payload': {},
                        'user_id': user_data.get('userId', 'unknown'),
                        'user_name': user_data.get('name') or user_data.get('email', 'API User'),
                        'email': user_data.get('email', 'api-user@openagentic.io'),
                        'upn': None,
                        'groups': user_data.get('groups', []),
                        'is_admin': user_data.get('isAdmin', False)
                    }
                else:
                    logger.warning(f"API key validation failed: {response.status_code}")
        except Exception as e:
            logger.error(f"Failed to validate API key: {e}")
        # Fall through to try other methods if validation fails

    # Check for OpenAgentic API internal key (raw key, not JWT)
    # This is used by the openagentic-api to call MCP-proxy for LLM tool execution
    api_internal_key = os.environ.get('API_INTERNAL_KEY', '')  # MUST be set in env
    if token and token == api_internal_key:
        logger.info("OpenAgentic API internal key detected - granting service account access with SP credentials")
        return {
            'token': 'SYSTEM_SP_AUTH',  # Use SP credentials for Azure calls
            'payload': {},
            'user_id': 'api-service',
            'user_name': 'OpenAgentic API Service',
            'email': 'api@openagentic.io',
            'upn': None,
            'groups': ['service-accounts'],
            'is_admin': True
        }

    try:
        # Decode JWT header to determine token type
        unverified_header = jwt.get_unverified_header(token)
        alg = unverified_header.get('alg', 'RS256')
        kid = unverified_header.get('kid')

        logger.info(f"[JWT-DEBUG] Token header: kid={kid}, alg={alg}, typ={unverified_header.get('typ')}")

        # =================================================================
        # INTERNAL JWT (HS256) - From OpenAgentic API
        # =================================================================
        # Internal tokens are signed with HS256 and don't have a 'kid'
        # They contain user context (userId, email, isAdmin) from the API
        if alg == 'HS256' and not kid:
            logger.info("[JWT-DEBUG] Detected internal HS256 token from API")

            # Get shared secret for internal token validation
            # MUST match API's JWT_SECRET/SIGNING_SECRET
            internal_jwt_secret = os.environ.get('JWT_SECRET') or os.environ.get('SIGNING_SECRET') or os.environ.get('INTERNAL_JWT_SECRET')

            # Fail closed: with no configured secret we cannot verify the HS256
            # signature. Never decode with a placeholder/default secret, which
            # would let an attacker who knows it forge internal tokens.
            if not internal_jwt_secret:
                logger.warning(
                    "[JWT-DEBUG] No internal JWT secret configured "
                    "(JWT_SECRET/SIGNING_SECRET/INTERNAL_JWT_SECRET); "
                    "rejecting internal HS256 token"
                )
                raise HTTPException(status_code=401, detail="internal token verification unavailable")

            try:
                # Validate and decode internal token
                payload = jwt.decode(
                    token,
                    internal_jwt_secret,
                    algorithms=['HS256'],
                    options={'verify_aud': False, 'verify_iss': False}
                )

                logger.info(f"[JWT-DEBUG] Internal token validated successfully: userId={payload.get('userId')}")

                # Extract user context from internal token claims
                user_id = payload.get('userId') or payload.get('user_id') or payload.get('sub')
                user_email = payload.get('email') or payload.get('userEmail')
                user_name = payload.get('name') or payload.get('userName') or user_email
                is_admin = payload.get('isAdmin', False) or payload.get('is_admin', False)
                user_groups = payload.get('groups', [])

                # If admin flag is set, add to admin groups
                if is_admin and 'system-admins' not in user_groups:
                    user_groups = list(user_groups) + ['system-admins']

                return {
                    'token': token,
                    'payload': payload,
                    'user_id': user_id,
                    'user_name': user_name,
                    'email': user_email,
                    'upn': None,
                    'groups': user_groups,
                    'is_admin': is_admin
                }

            except jwt.ExpiredSignatureError:
                logger.warning("[JWT-DEBUG] Internal token expired")
                raise HTTPException(status_code=401, detail="Token expired")
            except jwt.InvalidTokenError as e:
                logger.error(f"[JWT-DEBUG] Internal token validation failed: {e}")
                raise HTTPException(status_code=401, detail=f"Invalid internal token: {e}")

        # =================================================================
        # AZURE AD JWT (RS256) - From browser/Azure AD
        # =================================================================
        # Azure AD tokens are signed with RS256 and have a 'kid' for key lookup
        logger.info("[JWT-DEBUG] Detected Azure AD RS256 token - validating against JWKS")

        # Get Azure AD public keys for token validation
        jwks_url = f"https://login.microsoftonline.com/{TENANT_ID}/discovery/v2.0/keys"
        async with httpx.AsyncClient() as client:
            response = await client.get(jwks_url)
            jwks = response.json()

        logger.info(f"[JWT-DEBUG] JWKS has {len(jwks.get('keys', []))} keys")
        logger.info(f"[JWT-DEBUG] JWKS key IDs: {[k.get('kid') for k in jwks.get('keys', [])]}")

        # Find the correct key
        rsa_key = {}
        for key in jwks['keys']:
            if key['kid'] == kid:
                rsa_key = {
                    'kty': key['kty'],
                    'kid': key['kid'],
                    'use': key['use'],
                    'n': key['n'],
                    'e': key['e']
                }
                logger.info(f"[JWT-DEBUG] Found matching key: kid={kid}")
                break

        if not rsa_key:
            logger.error(f"[JWT-DEBUG] Unable to find key with kid={kid} in JWKS endpoint")
            logger.error(f"[JWT-DEBUG] Token preview (first 50 chars): {token[:50]}...")
            raise HTTPException(status_code=401, detail="Unable to find appropriate key")

        # Convert to PEM format and verify token
        from jwt.algorithms import RSAAlgorithm
        public_key = RSAAlgorithm.from_jwk(rsa_key)

        # Azure AD can use different issuer formats (v1.0 vs v2.0)
        # Support both for compatibility
        valid_issuers = [
            f"https://login.microsoftonline.com/{TENANT_ID}/v2.0",  # v2.0 format
            f"https://sts.windows.net/{TENANT_ID}/",                # v1.0 format
            f"https://login.microsoftonline.com/{TENANT_ID}/"       # Alternative v1.0 format
        ]

        # First decode without validation to see the actual issuer and audience
        try:
            unverified_payload = jwt.decode(
                token,
                options={"verify_signature": False, "verify_aud": False, "verify_iss": False}
            )
            actual_issuer = unverified_payload.get('iss', 'unknown')
            actual_audience = unverified_payload.get('aud', 'unknown')
            logger.info(f"[JWT-DEBUG] Token issuer: {actual_issuer}")
            logger.info(f"[JWT-DEBUG] Token audience: {actual_audience}")
            logger.info(f"[JWT-DEBUG] Valid issuers: {valid_issuers}")
        except Exception as e:
            logger.warning(f"[JWT-DEBUG] Could not peek at token claims: {e}")
            actual_audience = 'unknown'

        # Azure AD tokens can have different audience formats for OBO flow:
        # - CLIENT_ID directly (rare)
        # - api://{CLIENT_ID} (most common for OBO - the API's application ID URI)
        # - api://{CLIENT_ID}/{scope} (with specific scope)
        # - https://management.azure.com (for Azure ARM access tokens - used in chat pipeline)
        valid_audiences = [
            CLIENT_ID,                              # Direct client ID
            f"api://{CLIENT_ID}",                   # Application ID URI (most common for OBO)
            "https://management.azure.com",         # Azure ARM access token (from chat API)
        ]
        logger.info(f"[JWT-DEBUG] Valid audiences: {valid_audiences}")

        # Try to validate with each valid issuer and audience combination
        payload = None
        last_error = None
        for issuer in valid_issuers:
            for audience in valid_audiences:
                try:
                    payload = jwt.decode(
                        token,
                        public_key,
                        algorithms=['RS256'],
                        audience=audience,
                        issuer=issuer
                    )
                    logger.info(f"[JWT-DEBUG] Token validated successfully with issuer: {issuer}, audience: {audience}")
                    break
                except jwt.InvalidIssuerError:
                    last_error = f"Issuer mismatch for {issuer}, audience {audience}"
                    continue
                except jwt.InvalidAudienceError as e:
                    last_error = f"Audience mismatch for {issuer}, audience {audience}: {str(e)}"
                    continue
                except Exception as e:
                    last_error = f"Validation failed for {issuer}, audience {audience}: {str(e)}"
                    continue
            if payload is not None:
                break  # Break outer loop if validated

        if payload is None:
            raise jwt.InvalidIssuerError(f"Token validation failed with all combinations. Actual issuer: {actual_issuer}, Actual audience: {actual_audience}, Expected issuers: {valid_issuers}, Expected audiences: {valid_audiences}. Last error: {last_error}")

        # Get user groups from token
        user_groups = payload.get('groups', [])

        # Check if user is authorized to access the system
        authorized_user_groups, authorized_admin_groups = get_authorized_groups()
        all_authorized_groups = list(set(authorized_user_groups + authorized_admin_groups))

        if all_authorized_groups and not is_user_authorized(user_groups, all_authorized_groups):
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. You must be a member of one of these groups: {', '.join(all_authorized_groups)}"
            )

        # Determine if user is admin
        is_admin = is_admin_user(user_groups, authorized_admin_groups)

        return {
            'token': token,
            'payload': payload,
            'user_id': payload.get('oid'),
            'user_name': payload.get('name') or payload.get('preferred_username'),
            'email': payload.get('email') or payload.get('preferred_username'),
            'upn': payload.get('upn'),
            'groups': user_groups,
            'is_admin': is_admin
        }

    except HTTPException:
        # Re-raise HTTP exceptions (like 403)
        raise
    except Exception as e:
        logger.error(f"Token validation error: {type(e).__name__}: {e}", exc_info=True)
        # Auth is always enabled - always raise on validation failure
        raise HTTPException(status_code=401, detail=f"Token validation failed: {str(e)}")

# OBO token exchange (for Azure MCP when user token is available)
async def exchange_token_for_azure(original_token: str, scope: str = "https://management.azure.com/.default") -> str:
    """Exchange user token for Azure resource access using OBO flow"""
    obo_url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"

    data = {
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "assertion": original_token,
        "scope": scope,
        "requested_token_use": "on_behalf_of",
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(obo_url, data=data)

            if response.status_code == 200:
                token_response = response.json()
                return token_response["access_token"]
            else:
                error_detail = response.text
                logger.error(f"OBO token exchange failed: {error_detail}")
                raise TokenExchangeError(f"Token exchange failed: {error_detail}", response.status_code)

    except httpx.RequestError as e:
        logger.error(f"Network error during token exchange: {e}")
        raise TokenExchangeError(f"Network error: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error during token exchange: {e}")
        raise TokenExchangeError(f"Unexpected error: {str(e)}")


async def require_obo_token(original_token: str, audience: str = "https://management.azure.com/.default") -> str:
    """Fail-closed OBO exchange (B3 / NIST AC-3, SC-8).

    Wraps exchange_token_for_azure and converts ANY exchange failure into a
    structured HTTPException 401 (error=obo_failed). The proxy MUST NOT fall
    back to passing the user's original AAD token to the upstream MCP — that
    would grant the upstream the user's full delegated scope. On failure the
    original token is NEVER returned and NEVER echoed in the error body.
    """
    try:
        return await exchange_token_for_azure(original_token, scope=audience)
    except TokenExchangeError as e:
        logger.warning(f"OBO exchange failed for audience {audience}: {e}")
        raise HTTPException(
            status_code=401,
            detail={"error": "obo_failed", "audience": audience},
        )


async def acquire_azure_obo_tokens(
    obo_token: str,
    audiences: Dict[str, str],
    user_name: Optional[str] = None,
    skip: Optional[set] = None,
) -> Dict[str, str]:
    """Fail-closed multi-audience OBO exchange (B3 / NIST AC-3, SC-8).

    Exchanges `obo_token` for every audience in `audiences` (a
    {token_key: scope} mapping) IN PARALLEL, skipping any token_key in `skip`.
    Returns {token_key: exchanged_token} for all requested (non-skipped)
    audiences.

    Fail-CLOSED: if ANY audience exchange fails, raises HTTPException(401,
    error=obo_failed) with the failing audience attached. The proxy MUST NOT
    silently fall back to passing the user's original AAD token to the
    upstream MCP. The original obo_token is NEVER returned and NEVER echoed in
    the error body.
    """
    skip = skip or set()
    keys = [k for k in audiences if k not in skip]
    if not keys:
        return {}

    tasks = [require_obo_token(obo_token, audience=audiences[k]) for k in keys]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    acquired: Dict[str, str] = {}
    for token_key, result in zip(keys, results):
        if isinstance(result, HTTPException):
            # require_obo_token already converted the failure into a 401 with
            # the audience attached and never leaks the original token.
            raise result
        if isinstance(result, BaseException):
            raise HTTPException(
                status_code=401,
                detail={"error": "obo_failed", "audience": audiences[token_key]},
            )
        acquired[token_key] = result

    if user_name:
        logger.info(f"[OBO] Azure tokens acquired for {user_name}: {list(acquired.keys())}")
    return acquired

# === MAIN MCP ENDPOINTS ===

@app.post("/mcp", response_model=MCPResponse)
async def proxy_mcp_request(
    mcp_request: MCPRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    user_info: Optional[Dict[str, Any]] = Depends(get_user_info)
):
    """Route MCP requests to appropriate server with comprehensive logging"""
    start_time = time.time()

    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    # Determine target server - auto-detect if not specified
    target_server = mcp_request.server

    # TEMPORARY FALLBACK: If API didn't specify server, try to auto-detect from tool name
    # This is a workaround for the API not sending serverId in tool metadata
    # TODO: Remove this once API properly includes serverId in all tool calls
    if not target_server and mcp_request.method == "tools/call":
        tool_name = mcp_request.params.get("name") if mcp_request.params else None
        if tool_name and mcp_manager:
            logger.warning(f"⚠️ API did not specify server for tool '{tool_name}' - attempting auto-detection (TEMPORARY WORKAROUND)")
            # Try to find which server has this tool by querying all servers
            from mcp_manager import MCPServerStatus
            for server_name, server in mcp_manager.servers.items():
                if server.status == MCPServerStatus.RUNNING:
                    try:
                        # Use send_request like list_all_tools() does
                        # Use unique ID to avoid response collisions
                        unique_id = f"auto-detect-{uuid.uuid4().hex[:8]}"
                        detect_request = {
                            "jsonrpc": "2.0",
                            "id": unique_id,
                            "method": "tools/list"
                        }
                        response = await server.send_request(detect_request)
                        if "result" in response and "tools" in response["result"]:
                            server_tools = [t["name"] for t in response["result"]["tools"]]
                            if tool_name in server_tools:
                                target_server = server_name
                                logger.warning(f"🔍 Auto-detected server '{server_name}' for tool '{tool_name}' - API should have provided this!")
                                break
                    except Exception as e:
                        logger.debug(f"Could not list tools for server {server_name}: {e}")
                        continue

    # CRITICAL: If no server specified at this point, the API didn't send it
    # This is an error - the API MUST specify which server to use
    # The MCP proxy should NOT guess or have hardcoded fallbacks
    if not target_server:
        tool_name = mcp_request.params.get("name") if mcp_request.params else "unknown"
        logger.error(f"❌ CRITICAL: No server specified by API for tool '{tool_name}' and auto-detection failed")
        raise HTTPException(
            status_code=400,
            detail=f"Server not specified for tool '{tool_name}'. The API must include server information in tool metadata."
        )

    logger.info(f"=== MCP REQUEST ===")
    user_name = user_info.get('user_name', 'anonymous') if user_info else 'anonymous'
    is_admin = user_info.get('is_admin', False) if user_info else False
    logger.info(f"User: {user_name} (admin: {is_admin})")
    logger.info(f"Server: {target_server}")
    logger.info(f"Method: {mcp_request.method}")
    logger.info(f"Params: {json.dumps(mcp_request.params)}")

    # =============================================================
    # READ-ONLY MODE CHECK - Blocks destructive operations at platform level
    # This check OVERRIDES user permissions - even admins are blocked
    # NOTE: Only applies to cloud infrastructure servers (AWS, Azure, GCP, K8s)
    # =============================================================
    if mcp_request.method == "tools/call" and mcp_request.params:
        tool_name = mcp_request.params.get("name", "")
        arguments = mcp_request.params.get("arguments", {})
        is_blocked, block_reason = is_tool_blocked_in_read_only(tool_name, arguments, target_server)
        if is_blocked:
            logger.warning(f"[READ-ONLY MODE] BLOCKED: {user_name} attempted {tool_name} on {target_server}. Reason: {block_reason}")
            raise HTTPException(
                status_code=403,
                detail=f"🛡️ READ-ONLY MODE: {block_reason}. Contact your administrator to disable read-only mode for destructive operations."
            )

    # RBAC: Check if user can access this server
    # IMPORTANT: openagentic_admin is the actual server name for admin tools
    admin_servers = {'admin', 'openagentic_admin', 'openagentic_kubernetes'}  # List of admin-only servers
    if target_server in admin_servers and not is_admin:
        logger.warning(f"Access denied: Non-admin user '{user_name}' attempted to access admin server '{target_server}'")
        raise HTTPException(
            status_code=403,
            detail=f"Access denied. Admin privileges required to access '{target_server}' server."
        )

    # Extract user_id (required for logging)
    user_id = user_info.get('user_id') if user_info else None

    try:
        # For MCP servers that support OBO (On-Behalf-Of), pass the user's tokens
        # Azure needs tokens for ALL API audiences to match az login parity:
        # - ARM: https://management.azure.com (VMs, Storage, Networks, Cost, etc.)
        # - Graph: https://graph.microsoft.com (Azure AD/Entra ID)
        # - Key Vault: https://vault.azure.net (Secrets, Keys, Certificates)
        # - Storage: https://storage.azure.com (Blob, File, Queue, Table)
        # - SQL: https://database.windows.net (Azure SQL with AAD)
        # - Log Analytics: https://api.loganalytics.io (Workspace queries)
        user_token = None
        azure_tokens = {}  # All Azure tokens for different audiences

        # Check if the target server supports OBO authentication
        server_supports_obo = False
        if mcp_manager and target_server in mcp_manager.servers:
            server_supports_obo = mcp_manager.servers[target_server].config.supports_obo

        if server_supports_obo and user_info and ENABLE_AUTH:
            # Check if configured for shared SP mode (bypasses user token)
            use_shared_sp = os.getenv("AZURE_MCP_USE_SHARED_SP", "false").lower() == "true"

            if not use_shared_sp and user_info.get('token') and user_info.get('token') != 'SYSTEM_SP_AUTH':
                access_token = user_info['token']
                user_name = user_info.get('user_name', 'anonymous')

                # Safety check: if token is an internal HS256 JWT, try using ID token for OBO instead
                # Internal tokens have 'source' claim like 'api-key-internal' or 'local-internal'
                payload = user_info.get('payload', {})
                is_internal_jwt = payload.get('source') and 'internal' in str(payload.get('source', ''))
                if is_internal_jwt:
                    id_token_header = request.headers.get('X-Azure-ID-Token')
                    if id_token_header:
                        # Use the ID token (which IS a valid Azure AD token) for OBO
                        access_token = id_token_header
                        logger.info(f"[OBO] Internal HS256 JWT detected, using X-Azure-ID-Token for OBO instead (source={payload.get('source')})")
                    else:
                        logger.warning(f"[OBO] Skipping OBO for {user_name} - internal HS256 JWT and no ID token, skipping OBO")

                if target_server == 'openagentic_azure' and not (is_internal_jwt and not request.headers.get('X-Azure-ID-Token')):
                    # Azure: Exchange tokens for ALL API audiences in parallel
                    # This provides full az login parity

                    # Define ALL Azure API audiences we need
                    AZURE_AUDIENCES = {
                        "userAccessToken": "https://management.azure.com/.default",      # ARM API
                        "graphAccessToken": "https://graph.microsoft.com/.default",       # Microsoft Graph
                        "keyvaultAccessToken": "https://vault.azure.net/.default",        # Key Vault
                        "storageAccessToken": "https://storage.azure.com/.default",       # Azure Storage
                        "sqlAccessToken": "https://database.windows.net/.default",        # Azure SQL
                        "logAnalyticsAccessToken": "https://api.loganalytics.io/.default", # Log Analytics
                    }

                    # Determine which token to use for OBO:
                    # - If access token already has management.azure.com audience, use it directly for ARM
                    #   and use ID token (which has app client ID audience) for OBO to other resources
                    # - If access token has api://client-id audience, use it for all OBO exchanges
                    id_token = request.headers.get('X-Azure-ID-Token')
                    obo_token = None  # Token to use for OBO exchanges

                    try:
                        parts = access_token.split('.')
                        if len(parts) >= 2:
                            payload_b64 = parts[1] + '=' * (4 - len(parts[1]) % 4)
                            payload = json.loads(base64.b64decode(payload_b64))
                            access_token_audience = payload.get('aud', '')

                            if 'management.azure.com' in access_token_audience:
                                # Access token is for ARM - use directly for ARM API
                                azure_tokens["userAccessToken"] = access_token
                                logger.info(f"[OBO] DIRECT ARM TOKEN for {user_name} (access token has ARM audience)")

                                # For OBO to other resources (Graph, KeyVault, etc), we need a token
                                # with audience = app client ID. Check if ID token is available.
                                if id_token:
                                    # Verify ID token has app audience
                                    try:
                                        id_parts = id_token.split('.')
                                        if len(id_parts) >= 2:
                                            id_payload_b64 = id_parts[1] + '=' * (4 - len(id_parts[1]) % 4)
                                            id_payload = json.loads(base64.b64decode(id_payload_b64))
                                            id_audience = id_payload.get('aud', '')
                                            if id_audience and 'management.azure.com' not in id_audience:
                                                obo_token = id_token
                                                logger.info(f"[OBO] Using ID token for OBO exchange (aud={id_audience[:50]}...)")
                                    except Exception as e:
                                        logger.warning(f"[OBO] Failed to decode ID token: {e}")
                            else:
                                # Access token has app audience - perfect for OBO
                                obo_token = access_token
                                logger.info(f"[OBO] Access token has app audience - using for all OBO exchanges")
                    except Exception as e:
                        logger.warning(f"[OBO] Failed to decode access token: {e}")
                        # Fallback: try using access token for OBO
                        obo_token = access_token

                    # Exchange for all audiences in parallel (skip ones we already have).
                    # Fail-CLOSED: any audience failure raises HTTPException(401);
                    # we NEVER fall back to passing the original AAD token through.
                    if obo_token:
                        acquired = await acquire_azure_obo_tokens(
                            obo_token,
                            AZURE_AUDIENCES,
                            user_name=user_name,
                            skip=set(azure_tokens.keys()),
                        )
                        azure_tokens.update(acquired)
                    else:
                        logger.warning(f"[OBO] No suitable token for OBO exchange - only ARM token available")

                    # Set primary user_token to ARM token for backwards compatibility.
                    user_token = azure_tokens.get("userAccessToken")

                    # Log summary
                    successful_tokens = [k for k, v in azure_tokens.items() if v]
                    logger.info(f"[OBO] Azure tokens acquired for {user_name}: {successful_tokens}")

                else:
                    # AWS and others: Use ID token for federation
                    id_token = request.headers.get('X-Azure-ID-Token')
                    if id_token:
                        user_token = id_token
                        logger.info(f"Using ID token for {target_server} (federation): {user_info.get('user_name')}")
                    else:
                        user_token = user_info['token']
                        logger.warning(f"No ID token for {target_server}, using access token")
            else:
                logger.info(f"MCP server {target_server} configured for shared SP mode - no user token passed")

        # Note: User ID injection for openagentic_openagentic removed - that MCP server was deprecated
        # Code execution now uses dedicated Code Mode (openagentic-manager + openagentic-exec)
        params_to_send = mcp_request.params

        # Route request to MCP server
        request_data = {
            "jsonrpc": "2.0",
            "id": mcp_request.id,
            "method": mcp_request.method,
            "params": params_to_send
        }

        # Get user email from user_info for workspace isolation (Openagentic, etc.)
        user_email = user_info.get('email') if user_info else None

        # Pass all Azure tokens if available
        result = await mcp_manager.route_request(
            target_server,
            request_data,
            user_token,
            user_email,
            azure_tokens=azure_tokens if azure_tokens else None
        )

        execution_time = time.time() - start_time
        execution_time_ms = execution_time * 1000

        logger.info(f"=== MCP RESPONSE ===")
        logger.info(f"Server: {target_server}")
        logger.info(f"Execution Time: {execution_time:.3f}s")
        logger.info(f"Result: {json.dumps(result)}")

        # Send log to API (background task, non-blocking) with full user info and response
        if user_id:
            tool_name = mcp_request.params.get('name', 'unknown') if mcp_request.method == 'tools/call' else mcp_request.method
            background_tasks.add_task(
                send_mcp_log_to_api,
                user_id=user_id,
                user_name=user_info.get('user_name') if user_info else None,
                user_email=user_info.get('user_email') if user_info else None,
                server_name=target_server,
                tool_name=tool_name,
                method=mcp_request.method,
                params=mcp_request.params,
                result=result.get('result'),  # Full response data
                error=None,
                execution_time_ms=execution_time_ms,
                success=True
            )

        # Generate cache metadata for tool calls
        tool_cache_meta = None
        if mcp_request.method == 'tools/call' and mcp_request.params:
            tool_name_for_cache = mcp_request.params.get('name', '')
            tool_args_for_cache = mcp_request.params.get('arguments', {})
            tool_cache_meta = get_cache_metadata(tool_name_for_cache, tool_args_for_cache)

        # Build structured error envelope if MCP returned an error
        mcp_error_envelope = None
        if result.get('error'):
            mcp_error_envelope = MCPErrorEnvelope(
                code="MCP_ERROR",
                message=result['error'].get('message', 'Unknown MCP error'),
                retryable=False,
                server=target_server,
                tool=mcp_request.params.get('name', 'unknown') if mcp_request.params else 'unknown',
                execution_time_ms=execution_time * 1000
            ).model_dump()

        return MCPResponse(
            result=result.get('result'),
            error=result.get('error'),
            id=mcp_request.id,
            server=target_server,
            execution_time=execution_time,
            cache_meta=tool_cache_meta,
            error_envelope=mcp_error_envelope
        )

    except Exception as e:
        execution_time = time.time() - start_time
        execution_time_ms = execution_time * 1000

        logger.error(f"=== MCP ERROR ===")
        logger.error(f"Server: {target_server}")
        logger.error(f"Error: {str(e)}")
        logger.error(f"Execution Time: {execution_time:.3f}s")

        # Classify error into structured envelope
        tool_name = mcp_request.params.get('name', 'unknown') if mcp_request.method == 'tools/call' else mcp_request.method
        error_envelope = classify_error(e, target_server, tool_name)
        error_envelope.execution_time_ms = execution_time_ms

        # Send error log to API (background task, non-blocking) with full user info
        if user_id:
            background_tasks.add_task(
                send_mcp_log_to_api,
                user_id=user_id,
                user_name=user_info.get('user_name') if user_info else None,
                user_email=user_info.get('user_email') if user_info else None,
                server_name=target_server,
                tool_name=tool_name,
                method=mcp_request.method,
                params=mcp_request.params,
                result=None,
                error={"code": error_envelope.code, "message": error_envelope.message},
                execution_time_ms=execution_time_ms,
                success=False
            )

        return MCPResponse(
            error={
                "code": error_envelope.code,
                "message": error_envelope.message
            },
            id=mcp_request.id,
            server=target_server,
            execution_time=execution_time,
            error_envelope=error_envelope.model_dump()
        )

@app.post("/mcp/tool", response_model=MCPResponse)
async def call_mcp_tool(
    tool_call: MCPToolCall,
    background_tasks: BackgroundTasks,
    request: Request,
    user_info: Optional[Dict[str, Any]] = Depends(get_user_info)
):
    """Call a specific tool on an MCP server"""

    # If meta.userAccessToken is provided, inject it into user_info for Azure/AWS OBO flow
    if tool_call.meta and tool_call.meta.get('userAccessToken'):
        if user_info is None:
            user_info = {}
        user_info = dict(user_info)  # Make a copy to avoid mutating the original
        user_info['token'] = tool_call.meta['userAccessToken']
        logger.info(f"[/mcp/tool] Injected userAccessToken from meta for {tool_call.server or 'auto-detected'} server")

    mcp_request = MCPRequest(
        method="tools/call",
        params={
            "name": tool_call.tool,
            "arguments": tool_call.arguments
        },
        id=tool_call.id,
        server=tool_call.server
    )

    return await proxy_mcp_request(mcp_request, background_tasks, request, user_info)

# === STATUS AND MONITORING ENDPOINTS ===

# Platform version from build args / environment
PLATFORM_VERSION = os.getenv("PLATFORM_VERSION", "1.0.0")
BUILD_TIME = os.getenv("BUILD_TIME", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
GIT_COMMIT = os.getenv("GIT_COMMIT", os.getenv("COMMIT_SHA", "unknown"))

@app.get("/version")
async def get_version():
    """Get service version information"""
    return {
        "service": "openagentic-mcp-proxy",
        "version": PLATFORM_VERSION,
        "buildTime": BUILD_TIME,
        "gitCommit": GIT_COMMIT,
        "environment": os.getenv("ENVIRONMENT", "production")
    }

@app.get("/health")
async def health_check():
    """Health check endpoint with MCP server status"""
    if not mcp_manager:
        return {"status": "unhealthy", "error": "MCP Manager not initialized", "version": PLATFORM_VERSION}

    server_statuses = mcp_manager.get_server_status()
    healthy_servers = [name for name, status in server_statuses.items() if status['status'] == 'running']

    return {
        "status": "healthy" if healthy_servers else "degraded",
        "service": "mcp-proxy",
        "version": PLATFORM_VERSION,
        "servers": {
            "total": len(server_statuses),
            "running": len(healthy_servers),
            "statuses": server_statuses
        },
        "auth_enabled": ENABLE_AUTH,
        "tenant_id": TENANT_ID,
        "read_only_mode": {
            "enabled": MCP_READ_ONLY_MODE,
            "affected_servers": READ_ONLY_AFFECTED_SERVERS if MCP_READ_ONLY_MODE else [],
            "info": "Destructive operations BLOCKED on cloud providers (AWS, Azure, GCP, K8s)" if MCP_READ_ONLY_MODE else "All operations allowed"
        }
    }

@app.get("/servers")
async def list_servers():
    """List all MCP servers and their status"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    return mcp_manager.get_server_status()

@app.post("/servers")
async def add_server(config: Dict[str, Any]):
    """
    Add a new MCP server from JSON configuration.

    Supports two formats:
    1. Flat format: {"name": "kubernetes", "command": "npx", "args": ["-y", "kubernetes-mcp-server@latest"]}
    2. Claude Desktop format: {"mcpServers": {"kubernetes": {"command": "npx", "args": ["-y", "..."]}}}
    """
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    try:
        # Validation is now done in mcp_manager.add_server() which handles both formats
        result = await mcp_manager.add_server(config)
        logger.info(f"Added new MCP server: {result.get('name', 'unknown')}")
        return {"success": True, "server": result}
    except ValueError as e:
        # Validation errors
        logger.warning(f"Invalid MCP server config: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to add MCP server: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/servers/{server_id}/start")
async def start_server(server_id: str):
    """Start an MCP server"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    try:
        await mcp_manager.start_server(server_id)
        logger.info(f"Started MCP server: {server_id}")
        return {"success": True, "message": f"Server {server_id} started"}
    except Exception as e:
        logger.error(f"Failed to start MCP server {server_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/servers/{server_id}/stop")
async def stop_server(server_id: str):
    """Stop an MCP server"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    try:
        await mcp_manager.stop_server(server_id)
        logger.info(f"Stopped MCP server: {server_id}")
        return {"success": True, "message": f"Server {server_id} stopped"}
    except Exception as e:
        logger.error(f"Failed to stop MCP server {server_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/servers/{server_id}/restart")
async def restart_server(server_id: str):
    """Restart an MCP server"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    try:
        await mcp_manager.restart_server(server_id)
        logger.info(f"Restarted MCP server: {server_id}")
        return {"success": True, "message": f"Server {server_id} restarted"}
    except Exception as e:
        logger.error(f"Failed to restart MCP server {server_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/servers/{server_id}")
async def delete_server(server_id: str):
    """Delete an MCP server"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    try:
        await mcp_manager.delete_server(server_id)
        logger.info(f"Deleted MCP server: {server_id}")
        return {"success": True, "message": f"Server {server_id} deleted"}
    except Exception as e:
        logger.error(f"Failed to delete MCP server {server_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Request model for server enable/disable
class ServerEnabledRequest(BaseModel):
    enabled: bool

@app.patch("/servers/{server_id}/enabled")
async def set_server_enabled(
    server_id: str,
    request: ServerEnabledRequest,
    user_info: Optional[Dict[str, Any]] = Depends(get_user_info)
):
    """
    Enable or disable an MCP server at runtime.

    - enabled=true: Enables the server and starts it if not running
    - enabled=false: Disables the server and stops it if running

    State is persisted to Redis so it survives restarts.
    Requires admin privileges.
    """
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    # Require admin privileges
    is_admin = user_info.get('is_admin', False) if user_info else False
    if not is_admin:
        raise HTTPException(
            status_code=403,
            detail="Admin privileges required to enable/disable MCP servers"
        )

    try:
        result = await mcp_manager.set_server_enabled(server_id, request.enabled)
        logger.info(f"Server {server_id} enabled={request.enabled} by {user_info.get('user_name', 'unknown')}")
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to set enabled state for {server_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/servers/{server_id}/enabled")
async def get_server_enabled(server_id: str):
    """Get the enabled state of a specific MCP server"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    try:
        enabled = mcp_manager.get_server_enabled(server_id)
        return {"server_id": server_id, "enabled": enabled}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.get("/servers/enabled")
async def list_servers_enabled():
    """List enabled states for all MCP servers"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    return {
        "servers": mcp_manager.list_server_enabled_states()
    }

async def _list_all_tools_impl(user_info: Optional[Dict[str, Any]] = None):
    """Internal implementation for listing all tools with RBAC filtering"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    user_name = user_info.get('user_name', 'anonymous') if user_info else 'anonymous'
    is_admin = user_info.get('is_admin', False) if user_info else False
    user_groups = user_info.get('groups', []) if user_info else []

    logger.info(f"Listing tools for user: {user_name} (admin: {is_admin}, groups: {user_groups})")

    all_tools = await mcp_manager.list_all_tools()

    # Fetch access policies for user's groups
    access_policies = await fetch_user_mcp_access_policies(user_groups)

    # Filter tools based on access policies
    filtered_tools = {}

    for server_name, tools in all_tools.items():
        # Check if user can access this server
        if check_server_access(server_name, user_groups, access_policies, is_admin):
            filtered_tools[server_name] = tools
            logger.info(f"Including {len(tools)} tools from server: {server_name}")
        else:
            logger.info(f"Filtering server '{server_name}' for user: {user_name}")

    # Apply per-tool access policies
    user_id = user_info.get('user_id', '') if user_info else ''
    tool_policies = await fetch_tool_access_policies()
    tool_filtered_count = 0

    # Flatten into a single list with server attribution + tool-level filtering
    tools_list = []
    for server_name, tools in filtered_tools.items():
        for tool in tools:
            t_name = tool.get('name', '')
            if tool_policies:
                allowed, reason, _ = check_tool_access(t_name, server_name, user_id, user_groups, is_admin, tool_policies)
                if not allowed:
                    tool_filtered_count += 1
                    logger.debug(f"Tool-level filter: {t_name} on {server_name} denied ({reason})")
                    continue
            tool_info = {
                "server": server_name,
                **tool
            }
            tools_list.append(tool_info)

    if tool_filtered_count > 0:
        logger.info(f"Tool-level policies filtered {tool_filtered_count} tools for user: {user_name}")
    logger.info(f"Found {len(tools_list)} tools across {len(filtered_tools)} servers for user: {user_name}")

    return {
        "tools": tools_list,
        "by_server": filtered_tools,
        "total_count": len(tools_list),
        "server_count": len(filtered_tools),
        "metadata": {
            "user": user_name,
            "is_admin": is_admin,
            "groups": user_groups,
            "access_policies_applied": len(access_policies),
            "total_servers_available": len(all_tools),
            "total_servers_accessible": len(filtered_tools)
        }
    }

@app.get("/tools")
async def list_all_tools(user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """List all tools from all running MCP servers"""
    return await _list_all_tools_impl(user_info)

@app.get("/v1/mcp/tools")
async def list_all_tools_v1(user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """List all tools from all running MCP servers (OpenAI-compatible endpoint)"""
    return await _list_all_tools_impl(user_info)

@app.get("/servers/{server_name}/tools")
async def list_server_tools(server_name: str, user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """List tools from a specific MCP server"""
    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    if server_name not in mcp_manager.servers:
        raise HTTPException(status_code=404, detail=f"Server {server_name} not found")

    try:
        request_data = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": {}
        }

        result = await mcp_manager.route_request(server_name, request_data)

        return {
            "server": server_name,
            "tools": result.get('result', {}).get('tools', [])
        }

    except Exception as e:
        logger.error(f"Failed to list tools from {server_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# === USER SESSION MANAGEMENT ===

class UserSessionStartRequest(BaseModel):
    user_id: str
    email: str
    access_token: str

class UserSessionStopRequest(BaseModel):
    user_id: str

@app.post("/user-sessions/start")
async def start_user_session(request: UserSessionStartRequest, user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """Start a per-user Azure MCP session with OBO authentication"""
    try:
        session_manager = get_user_session_manager()
        result = await session_manager.start_user_session(
            user_id=request.user_id,
            email=request.email,
            access_token=request.access_token
        )
        return result
    except Exception as e:
        logger.error(f"Failed to start user session for {request.user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/user-sessions/stop")
async def stop_user_session(request: UserSessionStopRequest, user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """Stop a per-user Azure MCP session"""
    try:
        session_manager = get_user_session_manager()
        success = await session_manager.stop_user_session(request.user_id)
        return {"success": success, "user_id": request.user_id}
    except Exception as e:
        logger.error(f"Failed to stop user session for {request.user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/user-sessions")
async def list_user_sessions(user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """List all active user sessions"""
    try:
        session_manager = get_user_session_manager()
        sessions = await session_manager.list_sessions()
        return {"sessions": sessions, "count": len(sessions)}
    except Exception as e:
        logger.error(f"Failed to list user sessions: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/user-sessions/{user_id}")
async def get_user_session(user_id: str, user_info: Optional[Dict[str, Any]] = Depends(get_user_info)):
    """Get a specific user's session info including their Azure MCP tools"""
    try:
        session_manager = get_user_session_manager()
        session = await session_manager.get_session(user_id)
        if not session:
            raise HTTPException(status_code=404, detail=f"No session found for user {user_id}")
        return {
            "user_id": session.user_id,
            "email": session.email,
            "created_at": session.created_at.isoformat(),
            "last_accessed": session.last_accessed_at.isoformat(),
            "is_alive": session.is_alive(),
            "tool_count": len(session.tools) if session.tools else 0,
            "tools": session.tools or [],  # Include the actual tools for LLM discovery
            "pid": session.process.pid if session.process else None
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get user session for {user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# === AZURE AD OAUTH ENDPOINTS ===

@app.get("/auth/login")
async def auth_login():
    """Initiate Azure AD OAuth login flow"""
    try:
        if not oauth_service:
            raise HTTPException(status_code=500, detail="OAuth service not initialized")

        # Generate auth URL with PKCE
        auth_data = oauth_service.generate_auth_url()

        # Redirect user to Azure AD login
        return RedirectResponse(url=auth_data["auth_url"])

    except Exception as e:
        logger.error(f"Failed to initiate login: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/auth/callback")
async def auth_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    """Handle Azure AD OAuth callback"""
    try:
        if error:
            logger.error(f"OAuth error: {error}")
            # Redirect to UI with error
            return RedirectResponse(url=f"/?error={error}")

        if not code or not state:
            raise HTTPException(status_code=400, detail="Missing code or state parameter")

        if not oauth_service:
            raise HTTPException(status_code=500, detail="OAuth service not initialized")

        # Exchange code for tokens
        tokens = oauth_service.exchange_code_for_token(code, state)

        # Extract user info from tokens
        user_info = oauth_service.extract_user_info(tokens)

        # Create session
        session_id = oauth_service.create_session(user_info)

        # Automatically start per-user Azure MCP session
        session_manager = get_user_session_manager()
        try:
            await session_manager.start_user_session(
                user_id=user_info["user_id"],
                email=user_info["email"],
                access_token=user_info["access_token"]
            )
            logger.info(f"✅ Auto-started Azure MCP session for {user_info['email']}")
        except Exception as mcp_error:
            logger.error(f"Failed to start Azure MCP session: {str(mcp_error)}")
            # Continue anyway - user can manually start session

        # Redirect to UI with session cookie
        response = RedirectResponse(url="/", status_code=302)
        response.set_cookie(
            key="mcp_session",
            value=session_id,
            httponly=True,
            max_age=86400,  # 24 hours
            samesite="lax"
        )

        return response

    except Exception as e:
        logger.error(f"OAuth callback failed: {str(e)}")
        return RedirectResponse(url=f"/?error=auth_failed")

@app.get("/auth/me")
async def auth_me(mcp_session: Optional[str] = Cookie(None)):
    """Get current user info from session"""
    try:
        if not mcp_session:
            raise HTTPException(status_code=401, detail="Not authenticated")

        if not oauth_service:
            raise HTTPException(status_code=500, detail="OAuth service not initialized")

        session_data = oauth_service.get_session(mcp_session)

        if not session_data:
            raise HTTPException(status_code=401, detail="Invalid or expired session")

        return {
            "user_id": session_data["user_id"],
            "email": session_data["email"],
            "name": session_data["name"],
            "tenant_id": session_data["tenant_id"]
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get user info: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/auth/logout")
async def auth_logout(response: Response, mcp_session: Optional[str] = Cookie(None)):
    """Logout and destroy session"""
    try:
        if mcp_session and oauth_service:
            # Stop user's Azure MCP session
            if oauth_service.get_session(mcp_session):
                session_data = oauth_service.get_session(mcp_session)
                user_id = session_data.get("user_id")

                if user_id:
                    session_manager = get_user_session_manager()
                    await session_manager.stop_user_session(user_id)
                    logger.info(f"Stopped Azure MCP session for user {user_id}")

            # Delete OAuth session
            oauth_service.delete_session(mcp_session)

        # Clear cookie
        response.delete_cookie("mcp_session")

        return {"success": True}

    except Exception as e:
        logger.error(f"Logout failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Pydantic model for manual token testing
class ManualSessionRequest(BaseModel):
    user_id: str
    email: str
    access_token: str

@app.post("/auth/manual-session")
async def create_manual_session(request: ManualSessionRequest):
    """
    Create a user session manually with an access token (for testing).
    This allows testing with tokens obtained from other sources.
    """
    try:
        session_manager = get_user_session_manager()

        # Start Azure MCP session with provided token
        result = await session_manager.start_user_session(
            user_id=request.user_id,
            email=request.email,
            access_token=request.access_token
        )

        logger.info(f"✅ Manual session created for {request.email}")

        return result

    except Exception as e:
        logger.error(f"Failed to create manual session: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# === MCP TOOL EXECUTION ===

class MCPCallRequest(BaseModel):
    server: str
    tool: str
    arguments: Dict[str, Any] = {}

# =============================================================================
# STRUCTURED ERROR ENVELOPE - Better error reporting for LLM consumption
# =============================================================================
class MCPErrorEnvelope(BaseModel):
    """Structured error response that helps LLMs understand and recover from failures"""
    code: str                          # Machine-readable error code (e.g., "AUTH_EXPIRED", "TOOL_NOT_FOUND")
    message: str                       # Human-readable error message
    retryable: bool = False            # Whether the LLM should retry this call
    suggestion: Optional[str] = None   # What the LLM should do instead
    server: Optional[str] = None       # Which MCP server failed
    tool: Optional[str] = None         # Which tool failed
    execution_time_ms: Optional[float] = None

# Error code classification for common MCP failures
def classify_error(error: Exception, server_name: str = "", tool_name: str = "") -> MCPErrorEnvelope:
    """Classify an error into a structured envelope with recovery hints"""
    err_str = str(error).lower()

    # Authentication / token errors
    if any(kw in err_str for kw in ['token', 'auth', 'unauthorized', '401', 'credential', 'forbidden', '403']):
        return MCPErrorEnvelope(
            code="AUTH_FAILED",
            message=f"Authentication failed for {server_name}: {str(error)}",
            retryable=False,
            suggestion="The user's authentication token may have expired. Ask the user to refresh the page and try again.",
            server=server_name,
            tool=tool_name
        )

    # Server not found / not running
    if any(kw in err_str for kw in ['not found', 'not running', 'stopped', '503', 'unavailable']):
        return MCPErrorEnvelope(
            code="SERVER_UNAVAILABLE",
            message=f"MCP server '{server_name}' is not available: {str(error)}",
            retryable=True,
            suggestion=f"The MCP server '{server_name}' may be restarting. Wait a moment and retry, or use a different tool.",
            server=server_name,
            tool=tool_name
        )

    # Tool not found on server
    if any(kw in err_str for kw in ['tool not found', 'unknown tool', 'no such tool', 'method not found']):
        return MCPErrorEnvelope(
            code="TOOL_NOT_FOUND",
            message=f"Tool '{tool_name}' not found on server '{server_name}'",
            retryable=False,
            suggestion=f"The tool '{tool_name}' does not exist on '{server_name}'. Check available tools and use the correct tool name.",
            server=server_name,
            tool=tool_name
        )

    # Timeout
    if any(kw in err_str for kw in ['timeout', 'timed out', 'deadline']):
        return MCPErrorEnvelope(
            code="TIMEOUT",
            message=f"Tool '{tool_name}' timed out on '{server_name}': {str(error)}",
            retryable=True,
            suggestion="The operation timed out. Try again with simpler parameters, or break the request into smaller parts.",
            server=server_name,
            tool=tool_name
        )

    # Invalid arguments
    if any(kw in err_str for kw in ['invalid', 'argument', 'parameter', 'required', 'missing', 'validation']):
        return MCPErrorEnvelope(
            code="INVALID_ARGS",
            message=f"Invalid arguments for tool '{tool_name}': {str(error)}",
            retryable=False,
            suggestion=f"Check the tool's input schema and provide all required arguments with correct types.",
            server=server_name,
            tool=tool_name
        )

    # Rate limiting
    if any(kw in err_str for kw in ['rate limit', 'throttl', '429', 'too many']):
        return MCPErrorEnvelope(
            code="RATE_LIMITED",
            message=f"Rate limited on '{server_name}': {str(error)}",
            retryable=True,
            suggestion="The service is rate-limiting requests. Wait 10-30 seconds before retrying.",
            server=server_name,
            tool=tool_name
        )

    # Read-only mode
    if 'read-only' in err_str or 'read_only' in err_str:
        return MCPErrorEnvelope(
            code="READ_ONLY",
            message=f"Operation blocked by read-only mode: {str(error)}",
            retryable=False,
            suggestion="Destructive operations are blocked on cloud providers. Only read operations (list, get, describe) are allowed.",
            server=server_name,
            tool=tool_name
        )

    # Generic / unknown error
    return MCPErrorEnvelope(
        code="INTERNAL_ERROR",
        message=str(error),
        retryable=False,
        suggestion="An unexpected error occurred. Try a different approach or ask the user for guidance.",
        server=server_name,
        tool=tool_name
    )

# =============================================================================
# CACHE METADATA - Helps LLM know when data is fresh vs stale
# =============================================================================
# Cacheable tool patterns - read operations that return stable data
CACHEABLE_TOOL_PATTERNS_PROXY = [
    "list", "get", "describe", "show", "fetch", "search", "query",
    "read", "check", "status", "info", "count", "find", "lookup",
]

# Non-cacheable patterns - mutations
NON_CACHEABLE_PATTERNS_PROXY = [
    "create", "delete", "update", "modify", "put", "post", "remove",
    "start", "stop", "restart", "deploy", "execute_command", "run",
    "write", "set", "add", "insert", "drop", "kill", "terminate",
]

# TTL hints by tool type (seconds)
CACHE_TTL_HINTS = {
    "list_subscriptions": 3600,        # Subscriptions rarely change
    "list_resource_groups": 600,       # Resource groups change occasionally
    "list_resources": 300,             # Resources change more often
    "get_subscription": 3600,
    "get_resource_group": 600,
    "status": 60,                      # Status checks should be fresh
    "search": 120,                     # Search results change moderately
    "query": 120,
    "default_read": 300,               # Default TTL for read operations
}

def get_cache_metadata(tool_name: str, arguments: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Generate cache metadata for a tool response"""
    tool_lower = tool_name.lower()

    # Check if this is a mutation (non-cacheable)
    for pattern in NON_CACHEABLE_PATTERNS_PROXY:
        if pattern in tool_lower:
            return {
                "cacheable": False,
                "reason": "mutation_operation"
            }

    # Check if this is a read operation (cacheable)
    is_read = any(pattern in tool_lower for pattern in CACHEABLE_TOOL_PATTERNS_PROXY)
    if not is_read:
        return None  # Unknown - let the consumer decide

    # Find the best TTL hint
    ttl_seconds = CACHE_TTL_HINTS.get("default_read", 300)
    for pattern, ttl in CACHE_TTL_HINTS.items():
        if pattern in tool_lower:
            ttl_seconds = ttl
            break

    return {
        "cacheable": True,
        "ttl_seconds": ttl_seconds,
        "cache_key_hint": f"{tool_name}:{hash(json.dumps(arguments, sort_keys=True)) % 2**32}",
        "freshness": "real_time"  # Just fetched
    }

# =============================================================================
# BATCH CALL ENDPOINT - Execute multiple tool calls in parallel
# =============================================================================
class BatchToolCall(BaseModel):
    """A single tool call within a batch"""
    id: str                              # Caller-assigned ID to correlate results
    server: str
    tool: str
    arguments: Dict[str, Any] = {}

class BatchCallRequest(BaseModel):
    """Request to execute multiple tool calls in parallel"""
    calls: List[BatchToolCall]           # 1-10 tool calls to execute
    fail_fast: bool = False              # If true, cancel remaining on first failure

class BatchToolResult(BaseModel):
    """Result for a single tool call within a batch"""
    id: str                              # Matches the caller-assigned ID
    server: str
    tool: str
    success: bool
    result: Optional[Any] = None
    error: Optional[MCPErrorEnvelope] = None
    execution_time_ms: float
    cache_meta: Optional[Dict[str, Any]] = None

class BatchCallResponse(BaseModel):
    """Response for a batch of tool calls"""
    results: List[BatchToolResult]
    total_execution_time_ms: float
    succeeded: int
    failed: int

@app.post("/batch-call", response_model=BatchCallResponse)
async def batch_call_tools(
    batch_request: BatchCallRequest,
    http_request: Request,
    background_tasks: BackgroundTasks,
    user_info: Optional[Dict[str, Any]] = Depends(get_user_info)
):
    """
    Execute multiple MCP tool calls in parallel within a single HTTP request.

    This reduces round-trips when the LLM needs to call multiple tools at once.
    Each call is executed independently - failures in one don't affect others
    (unless fail_fast=true).

    Max 10 calls per batch to prevent abuse.
    """
    batch_start = time.time()

    if not mcp_manager:
        raise HTTPException(status_code=503, detail="MCP Manager not initialized")

    if len(batch_request.calls) == 0:
        raise HTTPException(status_code=400, detail="Batch must contain at least 1 call")
    if len(batch_request.calls) > 10:
        raise HTTPException(status_code=400, detail="Batch limited to 10 calls maximum")

    user_name = user_info.get('user_name', 'anonymous') if user_info else 'anonymous'
    is_admin = user_info.get('is_admin', False) if user_info else False
    user_id = user_info.get('user_id') if user_info else None
    user_email = user_info.get('email') if user_info else None

    logger.info(f"[BATCH] Executing {len(batch_request.calls)} tool calls for {user_name}")

    # Pre-flight checks (RBAC, read-only) for all calls before executing any
    admin_servers = {'admin', 'openagentic_admin', 'openagentic_kubernetes'}
    for call in batch_request.calls:
        # Read-only check
        is_blocked, block_reason = is_tool_blocked_in_read_only(call.tool, call.arguments, call.server)
        if is_blocked:
            raise HTTPException(
                status_code=403,
                detail=f"READ-ONLY MODE: {block_reason}"
            )
        # Admin check
        if call.server in admin_servers and not is_admin:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. Admin privileges required for '{call.server}' server."
            )

    # Handle OBO tokens (same as /call endpoint)
    azure_tokens = {}
    user_token = None

    if user_info and user_info.get('token') and user_info.get('token') != 'SYSTEM_SP_AUTH':
        has_azure_calls = any('azure' in c.server.lower() for c in batch_request.calls)
        if has_azure_calls:
            original_token = user_info['token']
            AZURE_AUDIENCES = {
                "userAccessToken": "https://management.azure.com/.default",
                "graphAccessToken": "https://graph.microsoft.com/.default",
                "keyvaultAccessToken": "https://vault.azure.net/.default",
                "storageAccessToken": "https://storage.azure.com/.default",
                "sqlAccessToken": "https://database.windows.net/.default",
                "logAnalyticsAccessToken": "https://api.loganalytics.io/.default",
            }

            try:
                parts = original_token.split('.')
                if len(parts) >= 2:
                    payload_b64 = parts[1] + '=' * (4 - len(parts[1]) % 4)
                    payload = json.loads(base64.b64decode(payload_b64))
                    if 'management.azure.com' in payload.get('aud', ''):
                        azure_tokens["userAccessToken"] = original_token
            except Exception:
                pass

            # Fail-CLOSED: any audience failure raises HTTPException(401); we
            # NEVER fall back to passing the original AAD token through.
            acquired = await acquire_azure_obo_tokens(
                original_token,
                AZURE_AUDIENCES,
                user_name=user_name,
                skip=set(azure_tokens.keys()),
            )
            azure_tokens.update(acquired)

            user_token = azure_tokens.get("userAccessToken")
        else:
            user_token = user_info.get('token')

    # Execute all tool calls in parallel
    async def execute_single_call(call: BatchToolCall) -> BatchToolResult:
        call_start = time.time()
        try:
            request_data = {
                "jsonrpc": "2.0",
                "id": call.id,
                "method": "tools/call",
                "params": {
                    "name": call.tool,
                    "arguments": call.arguments
                }
            }

            result = await mcp_manager.route_request(
                call.server,
                request_data,
                user_token,
                user_email,
                azure_tokens=azure_tokens if azure_tokens else None
            )

            call_time_ms = (time.time() - call_start) * 1000

            if result.get('error'):
                err_msg = result['error'].get('message', 'Unknown error')
                return BatchToolResult(
                    id=call.id,
                    server=call.server,
                    tool=call.tool,
                    success=False,
                    error=MCPErrorEnvelope(
                        code="MCP_ERROR",
                        message=err_msg,
                        retryable=False,
                        server=call.server,
                        tool=call.tool,
                        execution_time_ms=call_time_ms
                    ),
                    execution_time_ms=call_time_ms,
                    cache_meta=get_cache_metadata(call.tool, call.arguments)
                )

            # Log to API (fire-and-forget)
            if user_id:
                background_tasks.add_task(
                    send_mcp_log_to_api,
                    user_id=user_id,
                    user_name=user_name,
                    user_email=user_email,
                    server_name=call.server,
                    tool_name=call.tool,
                    method="tools/call",
                    params={"name": call.tool, "arguments": call.arguments},
                    result=result.get('result'),
                    error=None,
                    execution_time_ms=call_time_ms,
                    success=True
                )

            return BatchToolResult(
                id=call.id,
                server=call.server,
                tool=call.tool,
                success=True,
                result=result.get('result'),
                execution_time_ms=call_time_ms,
                cache_meta=get_cache_metadata(call.tool, call.arguments)
            )

        except Exception as e:
            call_time_ms = (time.time() - call_start) * 1000
            error_envelope = classify_error(e, call.server, call.tool)
            error_envelope.execution_time_ms = call_time_ms

            # Log error to API
            if user_id:
                background_tasks.add_task(
                    send_mcp_log_to_api,
                    user_id=user_id,
                    user_name=user_name,
                    user_email=user_email,
                    server_name=call.server,
                    tool_name=call.tool,
                    method="tools/call",
                    params={"name": call.tool, "arguments": call.arguments},
                    result=None,
                    error={"code": error_envelope.code, "message": error_envelope.message},
                    execution_time_ms=call_time_ms,
                    success=False
                )

            return BatchToolResult(
                id=call.id,
                server=call.server,
                tool=call.tool,
                success=False,
                error=error_envelope,
                execution_time_ms=call_time_ms,
                cache_meta=get_cache_metadata(call.tool, call.arguments)
            )

    # Run all calls concurrently
    batch_results = await asyncio.gather(
        *[execute_single_call(call) for call in batch_request.calls],
        return_exceptions=False  # Exceptions are caught inside execute_single_call
    )

    total_time_ms = (time.time() - batch_start) * 1000
    succeeded = sum(1 for r in batch_results if r.success)
    failed = len(batch_results) - succeeded

    logger.info(f"[BATCH] Completed {len(batch_results)} calls in {total_time_ms:.0f}ms "
                f"({succeeded} succeeded, {failed} failed) for {user_name}")

    return BatchCallResponse(
        results=batch_results,
        total_execution_time_ms=total_time_ms,
        succeeded=succeeded,
        failed=failed
    )

@app.post("/call")
async def call_mcp_tool(
    call_request: MCPCallRequest,
    http_request: Request,
    user_info: Optional[Dict[str, Any]] = Depends(get_user_info)
):
    """
    Simple endpoint to call MCP tools directly.
    Returns structured error envelopes and cache metadata.
    """
    start_time = time.time()
    try:
        if not mcp_manager:
            raise HTTPException(status_code=503, detail="MCP Manager not initialized")

        # Refresh read-only mode from DB (cached, polls every 30s)
        await refresh_readonly_from_db()

        # Create MCP request for tools/call
        mcp_request = MCPRequest(
            server=call_request.server,
            method="tools/call",
            params={
                "name": call_request.tool,
                "arguments": call_request.arguments
            }
        )

        # Check RBAC
        user_name = user_info.get('user_name', 'anonymous') if user_info else 'anonymous'
        is_admin = user_info.get('is_admin', False) if user_info else False

        # =============================================================
        # READ-ONLY MODE CHECK - Blocks destructive operations at platform level
        # This check OVERRIDES user permissions - even admins are blocked
        # NOTE: Only applies to cloud infrastructure servers (AWS, Azure, GCP, K8s)
        # =============================================================
        is_blocked, block_reason = is_tool_blocked_in_read_only(call_request.tool, call_request.arguments, call_request.server)
        if is_blocked:
            logger.warning(f"[READ-ONLY MODE] BLOCKED: {user_name} attempted {call_request.tool} on {call_request.server}. Reason: {block_reason}")
            raise HTTPException(
                status_code=403,
                detail=f"🛡️ READ-ONLY MODE: {block_reason}. Contact your administrator to disable read-only mode for destructive operations."
            )

        # Admin-only servers
        # IMPORTANT: openagentic_admin is the actual server name for admin tools
        admin_servers = {'admin', 'openagentic_admin', 'openagentic_kubernetes'}
        if call_request.server in admin_servers and not is_admin:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. Admin privileges required to access '{call_request.server}' server."
            )

        # Per-tool access check (RBAC)
        user_id = user_info.get('user_id', '') if user_info else ''
        user_groups = user_info.get('groups', []) if user_info else []
        tool_policies = await fetch_tool_access_policies()
        if tool_policies:
            allowed, reason, require_approval = check_tool_access(
                call_request.tool, call_request.server, user_id, user_groups, is_admin, tool_policies
            )
            if not allowed:
                logger.warning(f"[TOOL-ACCESS] DENIED: {user_name} -> {call_request.tool} on {call_request.server} ({reason})")
                raise HTTPException(
                    status_code=403,
                    detail=f"Access denied to tool '{call_request.tool}' on server '{call_request.server}'. Policy: {reason}"
                )

        # Execute tool call via route_request
        request_data = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": mcp_request.method,
            "params": mcp_request.params
        }

        # CRITICAL: Pass user's tokens for OBO authentication
        # Azure needs tokens for ALL API audiences to match az login parity
        # - ARM: https://management.azure.com (VMs, Storage, Networks, Cost, etc.)
        # - Graph: https://graph.microsoft.com (Azure AD/Entra ID)
        # - Key Vault: https://vault.azure.net (Secrets, Keys, Certificates)
        # - Storage: https://storage.azure.com (Blob, File, Queue, Table)
        # - SQL: https://database.windows.net (Azure SQL with AAD)
        # - Log Analytics: https://api.loganalytics.io (Workspace queries)
        azure_tokens = {}  # All Azure tokens for different audiences
        user_token = None

        if user_info and user_info.get('token') and user_info.get('token') != 'SYSTEM_SP_AUTH':
            id_token = http_request.headers.get('X-Azure-ID-Token')

            if 'azure' in call_request.server.lower():
                original_token = user_info['token']

                # Define ALL Azure API audiences we need for full az login parity
                AZURE_AUDIENCES = {
                    "userAccessToken": "https://management.azure.com/.default",      # ARM API
                    "graphAccessToken": "https://graph.microsoft.com/.default",       # Microsoft Graph
                    "keyvaultAccessToken": "https://vault.azure.net/.default",        # Key Vault
                    "storageAccessToken": "https://storage.azure.com/.default",       # Azure Storage
                    "sqlAccessToken": "https://database.windows.net/.default",        # Azure SQL
                    "logAnalyticsAccessToken": "https://api.loganalytics.io/.default", # Log Analytics
                }

                # Check if original token already has an Azure audience
                try:
                    parts = original_token.split('.')
                    if len(parts) >= 2:
                        payload_b64 = parts[1] + '=' * (4 - len(parts[1]) % 4)
                        payload = json.loads(base64.b64decode(payload_b64))
                        token_audience = payload.get('aud', '')

                        # If token already has management.azure.com, use directly for ARM
                        if 'management.azure.com' in token_audience:
                            azure_tokens["userAccessToken"] = original_token
                            logger.info(f"[OBO] DIRECT ARM TOKEN for {user_name}")
                except Exception:
                    pass  # Will exchange below

                # Exchange for all audiences in parallel (skip ARM if already have it).
                # Fail-CLOSED: any audience failure raises HTTPException(401); we
                # NEVER fall back to passing the original AAD token through.
                acquired = await acquire_azure_obo_tokens(
                    original_token,
                    AZURE_AUDIENCES,
                    user_name=user_name,
                    skip=set(azure_tokens.keys()),
                )
                azure_tokens.update(acquired)

                # Set primary user_token to ARM token for backwards compatibility.
                user_token = azure_tokens.get("userAccessToken")

                # Log summary
                successful_tokens = [k for k, v in azure_tokens.items() if v]
                logger.info(f"[OBO] Azure tokens acquired for {user_name}: {successful_tokens}")
            elif 'aws' in call_request.server.lower():
                # AWS: Use ID token for Identity Center federation
                if id_token:
                    user_token = id_token
                    logger.info(f"[OBO] Using ID token for {call_request.server}: {user_name}")
                else:
                    user_token = user_info['token']
                    logger.warning(f"[OBO] No ID token for {call_request.server}, using access token")
            else:
                # Non-OBO servers use the access token
                user_token = user_info['token']
                logger.info(f"[OBO] Passing access token to {call_request.server}: {user_name}")
        else:
            logger.debug(f"No user token available for {call_request.server} - will use fallback credentials")

        # Get user email from user_info for workspace isolation (Openagentic, etc.)
        user_email = user_info.get('email') if user_info else None

        # Pass all Azure tokens if available, otherwise just user_token
        result = await mcp_manager.route_request(
            call_request.server,
            request_data,
            user_token,
            user_email,
            azure_tokens=azure_tokens if azure_tokens else None
        )

        execution_time_ms = (time.time() - start_time) * 1000

        # Check for MCP-level errors in the result
        if result.get('error'):
            err_msg = result['error'].get('message', 'Unknown MCP error')
            return {
                "server": call_request.server,
                "tool": call_request.tool,
                "result": result,
                "error": MCPErrorEnvelope(
                    code="MCP_ERROR",
                    message=err_msg,
                    retryable=False,
                    server=call_request.server,
                    tool=call_request.tool,
                    execution_time_ms=execution_time_ms
                ).model_dump(),
                "cache_meta": get_cache_metadata(call_request.tool, call_request.arguments),
                "execution_time_ms": execution_time_ms
            }

        return {
            "server": call_request.server,
            "tool": call_request.tool,
            "result": result,
            "_meta": get_cache_metadata(call_request.tool, call_request.arguments),
            "execution_time_ms": execution_time_ms
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Tool call failed: {str(e)}")
        error_envelope = classify_error(e, call_request.server, call_request.tool)
        return {
            "server": call_request.server,
            "tool": call_request.tool,
            "result": None,
            "error": error_envelope.model_dump(),
            "cache_meta": None,
            "execution_time_ms": None
        }

# === EMBEDDINGS PROXY ===
# Proxies to the API's /api/embeddings endpoint which uses UniversalEmbeddingService
# This supports all configured embedding providers (Azure, AWS, Ollama, Vertex AI, etc.)

class EmbeddingRequest(BaseModel):
    model: Optional[str] = None
    input: Union[str, List[str]]
    encoding_format: Optional[str] = None
    dimensions: Optional[int] = None

@app.post("/v1/embeddings")
async def create_embeddings(request: EmbeddingRequest):
    """
    Generate embeddings by proxying to API's UniversalEmbeddingService.

    This endpoint proxies to the API's /api/embeddings endpoint which uses
    the configured embedding provider (Azure, AWS, Ollama, Vertex AI, etc.)
    based on environment variables.

    No hardcoded models or providers here - all configuration comes from
    the API's UniversalEmbeddingService.
    """
    try:
        # Get API endpoint from environment (configurable)
        api_base_url = os.getenv('OPENAGENTIC_API_URL', 'http://openagentic-api:8000')
        embeddings_url = f"{api_base_url}/api/embeddings"

        async with httpx.AsyncClient(timeout=60.0) as client:
            # Build request payload
            payload = {'input': request.input}
            if request.model:
                payload['model'] = request.model
            if request.encoding_format:
                payload['encoding_format'] = request.encoding_format
            if request.dimensions:
                payload['dimensions'] = request.dimensions

            response = await client.post(
                embeddings_url,
                json=payload,
                headers={'Content-Type': 'application/json'}
            )

            if response.status_code != 200:
                logger.error(f"API embeddings error: {response.status_code} - {response.text}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Embedding generation failed: {response.text}"
                )

            return response.json()

    except HTTPException:
        raise
    except httpx.ConnectError:
        logger.error(f"Cannot connect to API embeddings endpoint at {api_base_url}/api/embeddings")
        raise HTTPException(
            status_code=503,
            detail="Embedding service unavailable - cannot connect to API"
        )
    except Exception as e:
        logger.error(f"Embeddings generation error: {type(e).__name__}: {repr(e)}")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e) or repr(e)}")

# === INSPECTOR UI ===
# Reverse proxy to MCP Inspector on localhost:6274
# Must be LAST routes - catch-all for any paths not matched by API routes above

async def proxy_to_inspector(path: str, request: Request):
    """Helper function to proxy requests to MCP Inspector"""
    try:
        # Build target URL
        target_url = f"http://localhost:6274/{path}"

        # Copy query params
        if request.url.query:
            target_url += f"?{request.url.query}"

        logger.debug(f"[INSPECTOR] Proxying {request.url.path} -> {target_url}")

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Forward the request
            response = await client.get(
                target_url,
                headers={k: v for k, v in request.headers.items() if k.lower() not in ['host']},
                follow_redirects=True
            )

            # Return response with correct headers
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.headers.get('content-type')
            )
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="MCP Inspector not available. Please wait for startup to complete.")
    except Exception as e:
        logger.error(f"Inspector proxy error for path '{path}': {e}")
        raise HTTPException(status_code=500, detail=f"Inspector proxy error: {str(e)}")

@app.get("/")
async def inspector_ui_root(request: Request):
    """Serve MCP Inspector UI root - proxy to localhost:6274"""
    return await proxy_to_inspector("", request)

@app.get("/{path:path}")
async def inspector_ui_proxy_all(path: str, request: Request):
    """
    Reverse proxy all other requests to MCP Inspector
    This catches /assets/*, /inspector/*, and all non-API routes
    """
    return await proxy_to_inspector(path, request)

if __name__ == "__main__":
    logger.info("=== STARTING MCP PROXY SERVICE ===")
    logger.info(f"Auth Enabled: {ENABLE_AUTH}")
    logger.info(f"Tenant ID: {TENANT_ID}")
    logger.info(f"Port: {PORT}")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        log_level="info"
    )