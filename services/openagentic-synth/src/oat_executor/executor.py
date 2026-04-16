# Proprietary and confidential. Unauthorized copying prohibited.

"""
Secure Code Executor

Runs Python code in isolated subprocesses with resource limits.
No shell access, restricted filesystem, limited memory/CPU.
"""

import os
import sys
import ast
import json
import asyncio
import tempfile
import resource
import signal
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Set
from concurrent.futures import ProcessPoolExecutor

from .logging_config import get_logger

logger = get_logger("secure-executor")

# =============================================================================
# Blocked Operations - Security Restrictions
# =============================================================================

# Modules that are NEVER allowed
BLOCKED_MODULES: Set[str] = {
    # OS/System access
    "os.system", "os.popen", "os.spawn", "os.exec",
    "subprocess", "pty", "shlex",

    # Code execution
    "exec", "eval", "compile", "__import__",

    # File system manipulation (beyond /tmp)
    "shutil.rmtree", "shutil.move",

    # Network listeners
    "socket.bind", "socket.listen",

    # Dangerous stdlib
    "ctypes", "cffi", "pickle", "marshal", "shelve",

    # Process control
    "multiprocessing", "threading.Thread",

    # System info leakage
    "platform", "getpass",
}

# Modules allowed per capability.
# IMPORTANT: list TOP-LEVEL package names only. The validator splits dotted
# imports on '.' and takes the first segment, so "google.cloud" must be listed
# as "google" not "google.cloud" — otherwise `from google.cloud import storage`
# is rejected because the AST shows top-level module "google".
CAPABILITY_MODULES: Dict[str, Set[str]] = {
    "http": {"requests", "httpx", "urllib", "aiohttp", "urllib3", "h11", "h2", "anyio", "sniffio", "certifi", "charset_normalizer", "idna"},
    "json": {"json", "orjson", "ujson"},
    "datetime": {"datetime", "time", "calendar", "dateutil"},
    "aws": {"boto3", "botocore", "s3transfer", "jmespath"},
    "azure": {"azure", "msal", "msrest", "msrestazure"},
    "gcp": {"google", "googleapiclient", "google_auth_httplib2", "googleapis_common_protos", "proto", "grpc"},
    "github": {"github", "PyGithub"},
    "kubernetes": {"kubernetes", "yaml"},
    "crypto": {"cryptography", "jwt", "pyjwt"},
    "templating": {"jinja2", "markupsafe"},
    "visualization": {"matplotlib", "seaborn", "plotly"},
    "data_science": {"numpy", "pandas", "scipy", "sklearn"},
    "file_processing": {
        "docx", "python-docx", "pypdf", "PyPDF2", "pdf2image",
        "reportlab", "PIL", "pillow", "Pillow",
        "openpyxl", "xlsxwriter",
        "csv", "xml", "html", "bs4", "beautifulsoup4", "lxml",
        "chardet", "tabulate", "pandas",
        "zipfile", "tarfile", "gzip",
        "shutil",  # For file operations within /tmp
        "pathlib", "glob", "os.path",
    },
}

# Always allowed (safe) modules
SAFE_MODULES: Set[str] = {
    "math", "decimal", "fractions", "random", "statistics",
    "string", "re", "textwrap",
    "collections", "itertools", "functools", "operator",
    "dataclasses", "typing", "abc",
    "io", "base64", "hashlib", "hmac",
    "copy", "pprint",
}

# =============================================================================
# Code Validator
# =============================================================================

class CodeValidator:
    """Validates Python code for security issues before execution."""

    def __init__(self, capabilities: List[str]):
        self.capabilities = set(capabilities)
        self.allowed_modules = self._compute_allowed_modules()

    def _compute_allowed_modules(self) -> Set[str]:
        """Compute which modules are allowed based on capabilities."""
        allowed = SAFE_MODULES.copy()
        for cap in self.capabilities:
            if cap in CAPABILITY_MODULES:
                allowed.update(CAPABILITY_MODULES[cap])
        return allowed

    def validate(self, code: str) -> tuple[bool, Optional[str]]:
        """
        Validate code for security issues.
        Returns (is_valid, error_message).
        """
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            return False, f"Syntax error: {e}"

        for node in ast.walk(tree):
            # Check imports
            if isinstance(node, ast.Import):
                for alias in node.names:
                    module = alias.name.split('.')[0]
                    if module in BLOCKED_MODULES:
                        return False, f"Blocked module: {alias.name}"

            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    module = node.module.split('.')[0]
                    if module in BLOCKED_MODULES:
                        return False, f"Blocked module: {node.module}"
                    # Check if module is allowed
                    if module not in self.allowed_modules and module not in SAFE_MODULES:
                        # Check capability modules
                        allowed = False
                        for cap_modules in CAPABILITY_MODULES.values():
                            if module in cap_modules:
                                allowed = True
                                break
                        if not allowed:
                            return False, f"Module not allowed: {node.module}"

            # Check dangerous calls
            elif isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    if node.func.id in {"exec", "eval", "compile", "__import__"}:
                        return False, f"Blocked function: {node.func.id}"

                elif isinstance(node.func, ast.Attribute):
                    attr = node.func.attr
                    if attr in {"system", "popen", "spawn", "exec"}:
                        return False, f"Blocked method: {attr}"

            # Check file operations outside /tmp
            elif isinstance(node, ast.Str):
                # Look for suspicious path patterns
                if node.s.startswith("/") and not node.s.startswith("/tmp"):
                    # Could be a file path - warn but don't block
                    pass

        return True, None

# =============================================================================
# Execution Result
# =============================================================================

@dataclass
class ExecutionResult:
    """Result of code execution."""

    success: bool
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    error_type: Optional[str] = None
    exit_code: Optional[int] = None
    memory_used_bytes: Optional[int] = None
    cpu_time_seconds: Optional[float] = None

# =============================================================================
# Sandbox Wrapper Script
# =============================================================================

SANDBOX_WRAPPER = '''
import sys
import json
import resource
import signal

# Set resource limits
def set_limits(max_memory_mb, max_cpu_seconds):
    # Memory limit (bytes)
    memory_bytes = max_memory_mb * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))

    # CPU time limit (seconds)
    resource.setrlimit(resource.RLIMIT_CPU, (max_cpu_seconds, max_cpu_seconds))

    # No core dumps
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    # Limit number of processes
    resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))

    # Limit open files
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))

# Timeout handler
def timeout_handler(signum, frame):
    raise TimeoutError("Execution timed out")

signal.signal(signal.SIGALRM, timeout_handler)

# Read configuration from stdin
config = json.loads(sys.stdin.readline())
max_memory_mb = config.get("max_memory_mb", 256)
max_cpu_seconds = config.get("timeout_seconds", 30)
code = config.get("code", "")

# Set limits
set_limits(max_memory_mb, max_cpu_seconds + 5)  # +5 buffer
signal.alarm(max_cpu_seconds)

# Set up minimal namespace
namespace = {
    "__builtins__": __builtins__,
    "__name__": "__main__",
    "__doc__": None,
}

# Execute the code
result = {"success": False, "result": None, "error": None}

try:
    exec(compile(code, "<oat-code>", "exec"), namespace)

    # If the code defines an async execute() function (OAT/Synth pattern), call it
    if "execute" in namespace and callable(namespace["execute"]):
        import asyncio
        import inspect
        fn = namespace["execute"]
        if inspect.iscoroutinefunction(fn):
            call_result = asyncio.run(fn({}))
        else:
            call_result = fn({})
        if call_result is not None:
            result["result"] = call_result
    # Otherwise look for a result variable
    elif "result" in namespace:
        result["result"] = namespace["result"]
    elif "output" in namespace:
        result["result"] = namespace["output"]
    elif "data" in namespace:
        result["result"] = namespace["data"]

    result["success"] = True

except MemoryError:
    result["error"] = "Memory limit exceeded"
    result["error_type"] = "MemoryError"

except TimeoutError as e:
    result["error"] = str(e)
    result["error_type"] = "TimeoutError"

except Exception as e:
    result["error"] = str(e)
    result["error_type"] = type(e).__name__

finally:
    signal.alarm(0)  # Cancel alarm

# Output result as JSON
print("__OAT_RESULT__" + json.dumps(result))
'''

# =============================================================================
# Secure Executor
# =============================================================================

class SecureExecutor:
    """
    Executes Python code in isolated subprocesses.

    Security measures:
    - Resource limits (memory, CPU)
    - No shell access
    - Restricted filesystem (/tmp only)
    - Validated code before execution
    - Isolated process per execution
    """

    def __init__(
        self,
        max_concurrent: int = 5,
        default_timeout: int = 30,
        default_memory_mb: int = 256,
    ):
        self.max_concurrent = max_concurrent
        self.default_timeout = default_timeout
        self.default_memory_mb = default_memory_mb
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._active = 0

    @property
    def active_count(self) -> int:
        return self._active

    async def execute(
        self,
        code: str,
        execution_id: str,
        timeout_seconds: Optional[int] = None,
        max_memory_mb: Optional[int] = None,
        credentials: Optional[Dict[str, str]] = None,
        capabilities: Optional[List[str]] = None,
    ) -> ExecutionResult:
        """
        Execute Python code securely.

        Args:
            code: Python code to execute
            execution_id: Unique ID for tracking
            timeout_seconds: Max execution time
            max_memory_mb: Max memory in MB
            credentials: Environment variables to inject
            capabilities: Allowed module categories

        Returns:
            ExecutionResult with stdout, stderr, result, or error
        """

        timeout = timeout_seconds or self.default_timeout
        memory = max_memory_mb or self.default_memory_mb
        caps = capabilities or ["http", "json", "datetime"]

        # Validate code first
        validator = CodeValidator(caps)
        is_valid, error = validator.validate(code)
        if not is_valid:
            logger.warning(
                "oat_code_validation_failed",
                execution_id=execution_id,
                error=error,
            )
            return ExecutionResult(
                success=False,
                error=f"Code validation failed: {error}",
                error_type="ValidationError",
            )

        # Acquire semaphore (limit concurrent executions)
        async with self._semaphore:
            self._active += 1
            try:
                return await self._execute_subprocess(
                    code=code,
                    execution_id=execution_id,
                    timeout=timeout,
                    max_memory_mb=memory,
                    credentials=credentials,
                )
            finally:
                self._active -= 1

    async def _execute_subprocess(
        self,
        code: str,
        execution_id: str,
        timeout: int,
        max_memory_mb: int,
        credentials: Optional[Dict[str, str]],
    ) -> ExecutionResult:
        """Run code in an isolated subprocess."""

        # Create temp directory for this execution
        with tempfile.TemporaryDirectory(prefix=f"oat_{execution_id}_") as tmpdir:
            # Write wrapper script
            wrapper_path = Path(tmpdir) / "wrapper.py"
            wrapper_path.write_text(SANDBOX_WRAPPER)

            # Prepare environment
            env = os.environ.copy()
            # Clear sensitive vars
            for key in list(env.keys()):
                if any(s in key.lower() for s in ["secret", "password", "token", "key", "api"]):
                    del env[key]

            # Inject credentials
            if credentials:
                env.update(credentials)

            # Restrict temp directory
            env["TMPDIR"] = tmpdir
            env["HOME"] = tmpdir
            env["OAT_EXECUTION_ID"] = execution_id
            # GAP-#284: matplotlib + numpy false-positive on tmpdir-as-source-tree.
            # numpy's startup checks if cwd matches its source layout and refuses
            # to import if it does — tmpdir paths apparently look enough like a
            # numpy source tree to trip the check. Set an explicit MPLCONFIGDIR
            # under tmpdir so matplotlib doesn't fall back to /home/$USER/.config
            # (which doesn't exist in distroless), and run the subprocess from
            # /tmp instead of tmpdir so numpy's check passes.
            env["MPLCONFIGDIR"] = str(Path(tmpdir) / "mplcache")
            os.makedirs(env["MPLCONFIGDIR"], exist_ok=True)

            # Prepare config
            config = {
                "code": code,
                "timeout_seconds": timeout,
                "max_memory_mb": max_memory_mb,
            }

            try:
                # Start subprocess
                process = await asyncio.create_subprocess_exec(
                    sys.executable,
                    str(wrapper_path),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env,
                    # GAP-#284: cwd=/tmp not tmpdir — numpy refuses to import
                    # from a path that looks like its source tree. tmpdir is
                    # still TMPDIR/HOME/MPLCONFIGDIR so per-execution scoping
                    # for file IO and matplotlib state is preserved.
                    cwd="/tmp",
                    # No shell!
                )

                # Send config via stdin
                stdin_data = json.dumps(config) + "\n"

                # Wait for completion with timeout
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(input=stdin_data.encode()),
                    timeout=timeout + 5,  # Extra buffer for startup
                )

                stdout_str = stdout.decode("utf-8", errors="replace")
                stderr_str = stderr.decode("utf-8", errors="replace")

                # Parse result from stdout
                result_data = None
                output_lines = []
                for line in stdout_str.split("\n"):
                    if line.startswith("__OAT_RESULT__"):
                        try:
                            result_data = json.loads(line[14:])
                        except json.JSONDecodeError:
                            pass
                    else:
                        output_lines.append(line)

                stdout_clean = "\n".join(output_lines).strip()

                if result_data:
                    return ExecutionResult(
                        success=result_data.get("success", False),
                        stdout=stdout_clean if stdout_clean else None,
                        stderr=stderr_str if stderr_str else None,
                        result=result_data.get("result"),
                        error=result_data.get("error"),
                        error_type=result_data.get("error_type"),
                        exit_code=process.returncode,
                    )
                else:
                    return ExecutionResult(
                        success=process.returncode == 0,
                        stdout=stdout_clean if stdout_clean else None,
                        stderr=stderr_str if stderr_str else None,
                        exit_code=process.returncode,
                        error="No result returned" if process.returncode != 0 else None,
                    )

            except asyncio.TimeoutError:
                # Kill the process if it's still running
                if process.returncode is None:
                    process.kill()
                    await process.wait()

                return ExecutionResult(
                    success=False,
                    error=f"Execution timed out after {timeout} seconds",
                    error_type="TimeoutError",
                    exit_code=-9,
                )

            except Exception as e:
                logger.error(
                    "oat_subprocess_error",
                    execution_id=execution_id,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                return ExecutionResult(
                    success=False,
                    error=str(e),
                    error_type=type(e).__name__,
                )

    async def shutdown(self):
        """Gracefully shutdown the executor."""
        # Wait for active executions to complete
        while self._active > 0:
            logger.info("openagentic_synth_waiting_for_shutdown", active=self._active)
            await asyncio.sleep(1)
