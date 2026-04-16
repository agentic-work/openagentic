# Proprietary and confidential. Unauthorized copying prohibited.

"""
OpenAgentic OpenAgentic MCP Server - Code Execution Proxy

This MCP server provides tools for executing code through the OpenAgentic Manager.
It enables the LLM to:
- Create isolated code execution sessions per user
- Execute code (Python, Go, Bash, etc.) in sandboxed environments
- Run shell commands safely
- Write files to the user's workspace
- Read execution output in real-time

The manager handles:
- PTY-based terminal sessions
- Per-user workspaces with isolation
- Session lifecycle management
- RBAC through user context

Architecture:
  LLM -> MCP Proxy -> This MCP -> OpenAgentic Manager -> PTY Session -> Ollama

SECURITY NOTES:
  - RBAC is enforced via API access check (no bypass, DEV_API_KEY removed)
  - Each user gets isolated workspace under /workspaces/{userId}
  - TODO: Network isolation - Code execution currently has full network access.
    For production, consider:
    1. Running openagentic-manager on openagentic-internal network (no internet)
    2. Using Landlock/seccomp for syscall filtering
    3. Implementing egress firewall rules per workspace
    4. Adding rate limiting on code execution
"""

import os
import sys
import json
import logging
import httpx
from typing import Optional, Dict, Any, List
from enum import Enum

from fastmcp import FastMCP

# =============================================================================
# LOGGING
# =============================================================================

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))
sys.path.insert(0, '/app/shared')
try:
    from observability import configure_logging
    logger = configure_logging('oap-openagentic-mcp')
except ImportError:
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("oap-openagentic-mcp")

# =============================================================================
# CONFIGURATION
# =============================================================================

# OpenAgentic Manager endpoint
# Docker Compose: http://openagentic-manager:3050
# Kubernetes: http://openagentic-openagentic-manager:3050
MANAGER_URL = os.environ.get("OPENAGENTIC_MANAGER_URL", "http://openagentic-manager:3050")

# OpenAgentic API for RBAC checks
# Docker Compose: http://openagentic-api:8000
# Kubernetes: http://openagentic-api:8000
API_URL = os.environ.get("OPENAGENTIC_API_URL", "http://openagentic-api:8000")

# Service-to-service authentication key (required for RBAC checks)
# This is NOT a bypass - it authenticates the MCP server to the API
SERVICE_AUTH_KEY = os.environ.get("MCP_SERVICE_AUTH_KEY", "")

# HTTP client with reasonable timeouts
# Code execution can take time, so we use longer timeouts
http_client = httpx.Client(timeout=httpx.Timeout(120.0, connect=10.0))

# Cache for RBAC results (user_id -> (has_access, timestamp))
# Cache expires after 5 minutes
_rbac_cache: Dict[str, tuple] = {}
RBAC_CACHE_TTL = 300  # 5 minutes

# =============================================================================
# TYPES
# =============================================================================

class Language(str, Enum):
    PYTHON = "python"
    JAVASCRIPT = "javascript"
    TYPESCRIPT = "typescript"
    GO = "go"
    BASH = "bash"
    SHELL = "shell"
    SQL = "sql"
    RUST = "rust"

# Language to file extension mapping
LANG_EXTENSIONS = {
    "python": ".py",
    "javascript": ".js",
    "typescript": ".ts",
    "go": ".go",
    "bash": ".sh",
    "shell": ".sh",
    "sql": ".sql",
    "rust": ".rs",
}

# Language to run command mapping
LANG_RUN_COMMANDS = {
    "python": "python3",
    "javascript": "node",
    "typescript": "npx ts-node",
    "go": "go run",
    "bash": "bash",
    "shell": "sh",
    "rust": "rustc -o /tmp/a.out && /tmp/a.out",
}

# =============================================================================
# INITIALIZE MCP SERVER
# =============================================================================

mcp = FastMCP("openagentic-mcp")

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def check_user_access(user_id: str) -> bool:
    """
    Check if a user has access to OpenAgentic via RBAC.

    This calls the OpenAgentic API to verify the user has the openagentic permission.
    Results are cached for 5 minutes to reduce API calls.

    The user_id is injected by the API from the authenticated chat user's session,
    ensuring the LLM operates with the correct user's permissions.

    SECURITY: This function ALWAYS checks with the API. There is no bypass mode.

    Args:
        user_id: The user ID to check access for (injected by API from chat session)

    Returns:
        bool: True if user has access, False otherwise
    """
    import time

    # Validate user_id
    if not user_id or user_id == "default":
        logger.warning(f"[RBAC] Invalid user_id: {user_id} - denying access")
        return False

    # Check cache first
    if user_id in _rbac_cache:
        has_access, timestamp = _rbac_cache[user_id]
        if time.time() - timestamp < RBAC_CACHE_TTL:
            logger.debug(f"[RBAC] Cache hit for user {user_id}: {has_access}")
            return has_access

    # Check with API using service auth key for service-to-service authentication
    try:
        headers = {
            "X-Service-Auth": SERVICE_AUTH_KEY,
            "X-Service-Name": "oap-openagentic-mcp"
        }

        response = http_client.get(
            f"{API_URL}/api/code/access-check",
            params={"userId": user_id},
            headers=headers,
            timeout=httpx.Timeout(10.0, connect=5.0)
        )

        if response.status_code == 200:
            data = response.json()
            has_access = data.get("hasAccess", False)
            _rbac_cache[user_id] = (has_access, time.time())
            logger.info(f"[RBAC] User {user_id} access check: {has_access}")
            return has_access
        elif response.status_code == 403:
            _rbac_cache[user_id] = (False, time.time())
            logger.warning(f"[RBAC] User {user_id} denied access (403)")
            return False
        else:
            # On error, default to deny for security
            logger.error(f"[RBAC] Access check failed for {user_id}: {response.status_code}")
            return False

    except httpx.HTTPError as e:
        logger.error(f"[RBAC] Access check error for {user_id}: {e}")
        # In case of network error, check if we have a cached value (even if expired)
        if user_id in _rbac_cache:
            has_access, _ = _rbac_cache[user_id]
            logger.warning(f"[RBAC] Using expired cache for {user_id}: {has_access}")
            return has_access
        # Default deny if no cache and API unavailable
        return False


def require_access(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Check user access and return error dict if denied.

    The user_id is injected by the API from the authenticated chat user's session.
    This ensures the LLM operates with the user's permissions and workspace.

    Returns:
        None if access granted, error dict if denied
    """
    # Check user's OpenAgentic access via the API
    # The API injects the actual chat user's ID into tool arguments
    if not check_user_access(user_id):
        return {
            "success": False,
            "error": "Access denied. You do not have permission to use OpenAgentic. Contact your administrator.",
            "output": "",
            "access_denied": True
        }
    return None


def get_or_create_session(user_id: str, model: Optional[str] = None) -> Dict[str, Any]:
    """Get existing session or create a new one for the user."""
    try:
        response = http_client.post(
            f"{MANAGER_URL}/sessions",
            json={"userId": user_id, "model": model}
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as e:
        logger.error(f"Failed to get/create session: {e}")
        raise

def send_message_to_session(session_id: str, message: str) -> str:
    """Send a message/command to the session and get the response."""
    try:
        response = http_client.post(
            f"{MANAGER_URL}/sessions/{session_id}/messages",
            json={"message": message},
            timeout=httpx.Timeout(180.0, connect=10.0)  # Long timeout for execution
        )
        response.raise_for_status()
        return response.json().get("response", "")
    except httpx.HTTPError as e:
        logger.error(f"Failed to send message: {e}")
        raise


def direct_write_file(user_id: str, filepath: str, content: str) -> Dict[str, Any]:
    """Write file directly to workspace (bypasses CLI)."""
    try:
        response = http_client.post(
            f"{MANAGER_URL}/direct/write",
            json={"userId": user_id, "filepath": filepath, "content": content},
            timeout=httpx.Timeout(30.0, connect=10.0)
        )
        return response.json()
    except httpx.HTTPError as e:
        logger.error(f"Direct write failed: {e}")
        return {"success": False, "error": str(e)}


def direct_read_file(user_id: str, filepath: str) -> Dict[str, Any]:
    """Read file directly from workspace (bypasses CLI)."""
    try:
        response = http_client.post(
            f"{MANAGER_URL}/direct/read",
            json={"userId": user_id, "filepath": filepath},
            timeout=httpx.Timeout(30.0, connect=10.0)
        )
        return response.json()
    except httpx.HTTPError as e:
        logger.error(f"Direct read failed: {e}")
        return {"success": False, "error": str(e), "content": ""}


def direct_list_files(user_id: str, directory: str = ".", recursive: bool = False) -> Dict[str, Any]:
    """List files directly from workspace (bypasses CLI)."""
    try:
        response = http_client.post(
            f"{MANAGER_URL}/direct/list",
            json={"userId": user_id, "directory": directory, "recursive": recursive},
            timeout=httpx.Timeout(30.0, connect=10.0)
        )
        return response.json()
    except httpx.HTTPError as e:
        logger.error(f"Direct list failed: {e}")
        return {"success": False, "error": str(e), "files": []}


def direct_exec_command(user_id: str, command: str, timeout: int = 60000) -> Dict[str, Any]:
    """Execute command directly in workspace (bypasses CLI)."""
    try:
        response = http_client.post(
            f"{MANAGER_URL}/direct/exec",
            json={"userId": user_id, "command": command, "timeout": timeout},
            timeout=httpx.Timeout(max(timeout / 1000 + 10, 120), connect=10.0)
        )
        return response.json()
    except httpx.HTTPError as e:
        logger.error(f"Direct exec failed: {e}")
        return {"success": False, "error": str(e), "stdout": "", "stderr": "", "exitCode": 1}

# =============================================================================
# TOOLS
# =============================================================================

@mcp.tool()
def execute_code(
    code: Optional[str] = None,
    language: str = "python",
    user_id: str = "default",
    filename: Optional[str] = None,
    working_directory: Optional[str] = None,
    timeout_seconds: int = 60,
    cmd: Optional[str] = None,
    source: Optional[str] = None,
    script: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None  # Injected by MCP proxy, ignored here
) -> Dict[str, Any]:
    """
    Execute code in the user's workspace. COPY THESE EXAMPLES EXACTLY:

    PYTHON EXAMPLE (use this format):
    execute_code(code="print('Hello World')", language="python")

    PYTHON WITH CALCULATION:
    execute_code(code="import math\\nresult = math.factorial(10)\\nprint(f'Factorial: {result}')", language="python")

    BASH EXAMPLE:
    execute_code(code="echo 'Hello' && ls -la", language="bash")

    JAVASCRIPT EXAMPLE:
    execute_code(code="console.log('Hello from JS')", language="javascript")

    IMPORTANT RULES:
    - Pass code as a STRING in the 'code' parameter
    - Use \\n for newlines in multi-line code
    - Supported languages: python, javascript, typescript, go, bash, shell, rust

    Alternative parameter names accepted: cmd, source, script (all work the same as 'code')

    Args:
        code: The source code string to execute. THIS IS REQUIRED.
        language: python, javascript, typescript, go, bash, shell, rust (default: python)
        user_id: User identifier (injected automatically)
        filename: Optional filename (auto-generated if not provided)
        timeout_seconds: Max execution time in seconds (default: 60)
        cmd: Alias for 'code' parameter
        source: Alias for 'code' parameter
        script: Alias for 'code' parameter

    Returns:
        success: bool, stdout: string, stderr: string, exitCode: int, filename: string
    """
    # Use userEmail from meta if available (injected by MCP proxy from auth)
    effective_user_id = user_id
    if meta and meta.get('userEmail'):
        effective_user_id = meta['userEmail']
        logger.info(f"[OpenAgenticMCP] execute_code using userEmail: {effective_user_id}")

    # RBAC check - user must have openagentic access
    access_denied = require_access(effective_user_id)
    if access_denied:
        return access_denied

    # Handle alternative parameter names for compatibility with different LLMs
    actual_code = code or cmd or source or script

    # If cmd is a list (some LLMs send bash-style commands), extract code
    if isinstance(actual_code, list):
        # Try to extract code from bash heredoc pattern
        cmd_str = " ".join(str(c) for c in actual_code)
        if "<<" in cmd_str and ("PY" in cmd_str or "EOF" in cmd_str):
            # Extract code from heredoc
            import re
            match = re.search(r"<<\s*['\"]?(\w+)['\"]?\s*\n?(.*?)\n?\1", cmd_str, re.DOTALL)
            if match:
                actual_code = match.group(2).strip()
            else:
                # Just use the whole thing as code
                actual_code = cmd_str
        else:
            actual_code = cmd_str

    if not actual_code or not str(actual_code).strip():
        return {
            "success": False,
            "error": "Code is required. Pass code as: code=\"your_code_here\"",
            "stdout": "",
            "stderr": "",
            "exitCode": 1
        }

    # Ensure actual_code is a string
    actual_code = str(actual_code)

    lang = language.lower()
    if lang not in LANG_EXTENSIONS:
        return {
            "success": False,
            "error": f"Unsupported language: {language}. Supported: {list(LANG_EXTENSIONS.keys())}",
            "stdout": "",
            "stderr": "",
            "exitCode": 1
        }

    # Generate filename if not provided
    if not filename:
        import time
        timestamp = int(time.time())
        filename = f"code_{timestamp}{LANG_EXTENSIONS[lang]}"

    # Write the code file using direct method
    write_result = direct_write_file(effective_user_id, filename, actual_code)
    if not write_result.get("success"):
        return {
            "success": False,
            "error": f"Failed to write code file: {write_result.get('error', 'unknown')}",
            "stdout": "",
            "stderr": "",
            "exitCode": 1
        }

    # Build the execution command
    run_cmd = LANG_RUN_COMMANDS.get(lang, "python3")
    if lang == "go":
        exec_command = f"{run_cmd} {filename}"
    elif lang == "rust":
        exec_command = f"rustc {filename} -o /tmp/rustbin && /tmp/rustbin"
    else:
        exec_command = f"{run_cmd} {filename}"

    # Execute the code using direct method
    exec_result = direct_exec_command(effective_user_id, exec_command, timeout_seconds * 1000)

    logger.info(f"[OpenAgenticMCP] Executed {lang} code for user {effective_user_id}: {filename}")

    return {
        "success": exec_result.get("success", False),
        "stdout": exec_result.get("stdout", ""),
        "stderr": exec_result.get("stderr", ""),
        "exitCode": exec_result.get("exitCode", 1),
        "filename": filename,
        "language": lang,
        "filepath": write_result.get("filepath", "")
    }


@mcp.tool()
def run_shell_command(
    command: str,
    user_id: str = "default",
    working_directory: Optional[str] = None,
    timeout_seconds: int = 60,
    meta: Optional[Dict[str, Any]] = None  # Injected by MCP proxy with userEmail
) -> Dict[str, Any]:
    """
    Execute a shell command in the user's workspace.

    Runs commands directly in the user's workspace directory with proper isolation.
    If the user has an active Code Mode session, commands run inside their pod.

    Args:
        command: The shell command to execute (REQUIRED)
        user_id: User identifier for session isolation (auto-detected from auth)
        working_directory: Optional directory to run command in (relative to workspace)
        timeout_seconds: Maximum execution time

    Returns:
        Dict with:
        - success: bool
        - stdout: Standard output
        - stderr: Standard error
        - exitCode: Exit code
        - error: Error message if failed

    Example:
        run_shell_command(command="ls -la")
        run_shell_command(command="python3 script.py")
    """
    # Use userEmail from meta if available (injected by MCP proxy from auth)
    effective_user_id = user_id
    if meta and meta.get('userEmail'):
        effective_user_id = meta['userEmail']
        logger.info(f"[OpenAgenticMCP] Using userEmail from meta: {effective_user_id}")

    # RBAC check - user must have openagentic access
    access_denied = require_access(effective_user_id)
    if access_denied:
        return access_denied

    if not command or not command.strip():
        return {
            "success": False,
            "error": "Command is required",
            "stdout": "",
            "stderr": "",
            "exitCode": 1
        }

    # Prepend cd if working directory specified
    full_command = command
    if working_directory:
        full_command = f"cd {working_directory} && {command}"

    # Use direct exec (routes to user's pod in K8s mode)
    result = direct_exec_command(effective_user_id, full_command, timeout_seconds * 1000)

    if result.get("success"):
        logger.info(f"[OpenAgenticMCP] Executed command for user {effective_user_id}: {command[:50]}...")

    return result


@mcp.tool()
def write_file(
    filepath: str,
    content: str,
    user_id: str = "default",
    meta: Optional[Dict[str, Any]] = None  # Injected by MCP proxy, ignored here
) -> Dict[str, Any]:
    """
    Write content to a file in the user's workspace.

    Creates the file and any necessary parent directories.

    Args:
        filepath: Path to the file (relative to workspace or absolute)
        content: Content to write to the file
        user_id: User identifier for session isolation

    Returns:
        Dict with:
        - success: bool
        - filepath: The file that was created
        - error: Error message if failed

    Example:
        write_file(
            filepath="main.py",
            content='print("Hello")',
            user_id="user123"
        )
    """
    # Use userEmail from meta if available (injected by MCP proxy from auth)
    effective_user_id = user_id
    if meta and meta.get('userEmail'):
        effective_user_id = meta['userEmail']
        logger.info(f"[OpenAgenticMCP] write_file using userEmail: {effective_user_id}")

    # RBAC check - user must have openagentic access
    access_denied = require_access(effective_user_id)
    if access_denied:
        return access_denied

    if not filepath:
        return {"success": False, "error": "filepath is required"}
    if content is None:
        return {"success": False, "error": "content is required"}

    # Use direct file write (bypasses CLI for reliability)
    result = direct_write_file(effective_user_id, filepath, content)

    if result.get("success"):
        logger.info(f"[OpenAgenticMCP] Wrote file {filepath} for user {effective_user_id}")

    return result


@mcp.tool()
def read_file(
    filepath: str,
    user_id: str = "default",
    meta: Optional[Dict[str, Any]] = None  # Injected by MCP proxy, ignored here
) -> Dict[str, Any]:
    """
    Read content from a file in the user's workspace.

    Args:
        filepath: Path to the file to read
        user_id: User identifier for session isolation

    Returns:
        Dict with:
        - success: bool
        - content: File contents
        - error: Error message if failed
    """
    # Use userEmail from meta if available (injected by MCP proxy from auth)
    effective_user_id = user_id
    if meta and meta.get('userEmail'):
        effective_user_id = meta['userEmail']
        logger.info(f"[OpenAgenticMCP] read_file using userEmail: {effective_user_id}")

    # RBAC check - user must have openagentic access
    access_denied = require_access(effective_user_id)
    if access_denied:
        return {**access_denied, "content": ""}

    if not filepath:
        return {"success": False, "error": "filepath is required", "content": ""}

    # Use direct file read (bypasses CLI for reliability)
    return direct_read_file(effective_user_id, filepath)


@mcp.tool()
def list_files(
    directory: str = ".",
    user_id: str = "default",
    recursive: bool = False,
    meta: Optional[Dict[str, Any]] = None  # Injected by MCP proxy, ignored here
) -> Dict[str, Any]:
    """
    List files in a directory in the user's workspace.

    Args:
        directory: Directory to list (default: current directory)
        user_id: User identifier for session isolation
        recursive: If true, list recursively

    Returns:
        Dict with:
        - success: bool
        - files: List of files/directories
        - error: Error message if failed
    """
    # Use userEmail from meta if available (injected by MCP proxy from auth)
    effective_user_id = user_id
    if meta and meta.get('userEmail'):
        effective_user_id = meta['userEmail']
        logger.info(f"[OpenAgenticMCP] list_files using userEmail: {effective_user_id}")

    # RBAC check - user must have openagentic access
    access_denied = require_access(effective_user_id)
    if access_denied:
        return {**access_denied, "files": []}

    # Use direct list files (bypasses CLI for reliability)
    return direct_list_files(effective_user_id, directory, recursive)


@mcp.tool()
def get_session_info(user_id: str = "default", meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Get information about the user's OpenAgentic session.

    Args:
        user_id: User identifier

    Returns:
        Dict with session information including:
        - session_id: Session identifier
        - status: running, stopped, etc.
        - workspace_path: Path to user's workspace
    """
    # Use userEmail from meta if available (injected by MCP proxy from auth)
    effective_user_id = user_id
    if meta and meta.get('userEmail'):
        effective_user_id = meta['userEmail']
        logger.info(f"[OpenAgenticMCP] get_session_info using userEmail: {effective_user_id}")

    # RBAC check - user must have openagentic access
    access_denied = require_access(effective_user_id)
    if access_denied:
        return access_denied

    try:
        session_info = get_or_create_session(effective_user_id)
        return {
            "success": True,
            "session": session_info
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@mcp.tool()
def stop_session(user_id: str, session_id: Optional[str] = None, meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Stop a user's OpenAgentic session.

    Args:
        user_id: User identifier
        session_id: Optional specific session ID to stop

    Returns:
        Dict with success status
    """
    # RBAC check - user must have openagentic access
    access_denied = require_access(user_id)
    if access_denied:
        return access_denied

    try:
        if not session_id:
            # Get the user's session first
            session_info = get_or_create_session(user_id)
            session_id = session_info.get("sessionId") or session_info.get("session", {}).get("id")

        if not session_id:
            return {"success": False, "error": "No session found for user"}

        response = http_client.delete(f"{MANAGER_URL}/sessions/{session_id}")
        response.raise_for_status()

        logger.info(f"[OpenAgenticMCP] Stopped session {session_id} for user {user_id}")

        return {
            "success": True,
            "session_id": session_id,
            "status": "stopped"
        }

    except Exception as e:
        logger.error(f"[OpenAgenticMCP] Stop session failed: {e}")
        return {"success": False, "error": str(e)}


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    logger.info("[OpenAgenticMCP] Starting OpenAgentic OpenAgentic MCP Server...")
    logger.info(f"[OpenAgenticMCP] Manager URL: {MANAGER_URL}")
    mcp.run()
