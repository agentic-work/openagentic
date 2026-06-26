"""
Sandboxed Tool Executor

Executes synthesized tools in an isolated environment with
scoped credentials and resource limits.

Security boundary
-----------------
This executor wraps synthesized (LLM-authored, HITL-approved) code in a HARDENED
subprocess. The trust boundary is the *execution environment*, NOT the static
AST scan:

  - ``CodeValidator`` (AST) is the first line — it rejects literal
    ``import subprocess`` / ``eval(`` / cross-capability imports. But a static
    scan can never be the boundary for ``exec``-ing attacker-influenced code,
    because the classic escapes route around a name-based scan
    (``__builtins__["ev"+"al"]``, ``importlib.import_module("subprocess")``,
    ``().__class__.__bases__[0].__subclasses__()``).
  - ``SANDBOX_WRAPPER`` is the REAL boundary: it ``exec``s the synthesized code
    into a namespace with LOCKED ``__builtins__`` (no eval/exec/compile/input/
    breakpoint), a guarded ``__import__`` that re-applies the runtime blocklist,
    a path-scoped ``open`` (writes confined to /tmp, host files unreadable), and
    ``resource.setrlimit`` caps on memory/CPU/processes/files.
  - The credential env is an ALLOWLIST — credentials reach the sandbox ONLY when
    EXPLICITLY injected (``register_credential(scope, env_var, value=...)``,
    ``execute(credentials=...)``, or the platform's ``env_allowlist`` of
    explicitly-set values). Host ``os.environ`` cloud credentials are NEVER
    ambient-passed through.

Ported up from the deployed ``synth-executor`` hardening (the security gate of
the synth convergence). Server-layer concerns (service-JWT, code_hash binding,
artifact scan, OTEL/Prometheus) stay in the container's server wrapper — this is
the executor sandbox hardening only.
"""

import ast
import asyncio
import contextlib
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from synth.core.types import (
    GroundableOutput,
    SynthesizedTool,
    ToolOutput,
)

# =============================================================================
# Blocked / capability / safe modules (ported from deployed synth-executor)
# =============================================================================

# Modules that are NEVER allowed (top-level package names + dotted dangerous attrs).
BLOCKED_MODULES: set[str] = {
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
CAPABILITY_MODULES: dict[str, set[str]] = {
    "http": {
        "requests", "httpx", "urllib", "aiohttp", "urllib3", "h11", "h2",
        "anyio", "sniffio", "certifi", "charset_normalizer", "idna",
    },
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

# Always allowed (safe) modules — no credentials, no network egress.
SAFE_MODULES: set[str] = {
    "math", "decimal", "fractions", "random", "statistics",
    "string", "re", "textwrap",
    "collections", "itertools", "functools", "operator",
    "dataclasses", "typing", "abc",
    "io", "base64", "hashlib", "hmac",
    "copy", "pprint",
    # Neutral stdlib the synthesized async runner / synth code routinely needs.
    "os", "sys", "asyncio", "inspect", "traceback", "warnings",
    "pathlib", "glob",
    # Ambient-safe data-format + time modules. No credentials, no network
    # egress — usable regardless of which capabilities were granted.
    "json", "orjson", "ujson",
    "datetime", "time", "calendar", "dateutil",
}


# =============================================================================
# Code Validator
# =============================================================================

# Per-module hint shown alongside the "Blocked module" error.
#
# The synth code generator (LLM) reads validator errors verbatim when choosing
# what to retry — a bare "Blocked module: subprocess" causes the model to loop on
# the same import, because it assumes it needs `subprocess.run([...])` to
# bootstrap native deps for reportlab / Pillow. Those deps are pre-installed in
# the synth-executor image, so the hint tells the model to drop the subprocess
# import. NEVER unblock subprocess globally — it's a direct sandbox-escape vector.
_BLOCKED_MODULE_HINTS: dict[str, str] = {
    "subprocess": (
        "reportlab, Pillow, pypdf, python-docx, openpyxl, pandas, numpy, "
        "matplotlib, plotly, boto3, kubernetes and other listed modules are "
        "pre-installed in this sandbox — DO NOT shell out to install them. "
        "Drop the `import subprocess` and call the library directly "
        "(e.g. `from reportlab.pdfgen import canvas`)."
    ),
    "pty": "subprocess and pty are blocked; libs are pre-installed.",
    "shlex": "subprocess and shlex are blocked; libs are pre-installed.",
    "ctypes": "ctypes is blocked — no native loading from sandboxed code.",
    "multiprocessing": "multiprocessing is blocked — sandbox runs single-process.",
    "pickle": "pickle is blocked — use json or orjson instead.",
}


def _blocked_module_error(module_name: str) -> str:
    """
    Build the validator error string for a blocked import. The bare-bones
    "Blocked module: <name>" prefix is unchanged so log-greps keep matching; a
    per-module hint is appended when available so the code-generating LLM has
    actionable feedback on retry.
    """
    top = module_name.split(".")[0]
    hint = _BLOCKED_MODULE_HINTS.get(top)
    if hint:
        return f"Blocked module: {module_name} — {hint}"
    return f"Blocked module: {module_name}"


class CodeValidator:
    """Validates synthesized Python code for security issues before execution.

    AST-based (replaces the old regex scan): catches obfuscation like
    ``__builtins__["ev"+"al"]`` that a substring scan misses by checking
    ``ast.Import`` / ``ast.ImportFrom`` against a denylist + per-capability
    allowlist, and ``ast.Call`` for dangerous builtin / attribute calls. The
    runtime wrapper (``SANDBOX_WRAPPER``) is the real boundary; this is the first
    line that keeps obvious payloads out and gives the LLM actionable errors.
    """

    def __init__(self, capabilities: list[str]):
        self.capabilities = set(capabilities)
        self.allowed_modules = self._compute_allowed_modules()

    def _compute_allowed_modules(self) -> set[str]:
        """Compute which modules are allowed based on granted capabilities."""
        allowed = SAFE_MODULES.copy()
        for cap in self.capabilities:
            if cap in CAPABILITY_MODULES:
                allowed.update(CAPABILITY_MODULES[cap])
        return allowed

    def _capability_allows(self, module: str) -> bool:
        """Capability-isolation gate for a top-level import name.

        A module may be imported iff:
          - it is in ``self.allowed_modules`` (SAFE_MODULES ∪ the modules of the
            GRANTED capabilities), OR
          - it belongs to NO capability bucket at all — neutral stdlib whose
            dangerous *calls* (os.system, os.popen, …) are policed separately at
            the ast.Call level.

        A module that lives in some capability bucket but NOT a granted one is
        denied. This closes the cross-capability import escape where a user
        granted only e.g. ``http`` could import ``boto3`` (the ``aws`` bucket).
        """
        if module in self.allowed_modules:
            return True
        # A module that lives in some capability bucket but NOT a granted one is
        # denied; one that lives in no bucket (neutral stdlib) is allowed.
        return not any(module in cap_modules for cap_modules in CAPABILITY_MODULES.values())

    def validate(self, code: str) -> tuple[bool, str | None]:
        """
        Validate code for security issues.
        Returns (is_valid, error_message).
        """
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            return False, f"Syntax error: {e}"

        for node in ast.walk(tree):
            # Imports
            if isinstance(node, ast.Import):
                for alias in node.names:
                    module = alias.name.split(".")[0]
                    if module in BLOCKED_MODULES:
                        return False, _blocked_module_error(alias.name)
                    if not self._capability_allows(module):
                        return False, f"Module not allowed: {alias.name}"

            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    module = node.module.split(".")[0]
                    if module in BLOCKED_MODULES:
                        return False, _blocked_module_error(node.module)
                    if not self._capability_allows(module):
                        return False, f"Module not allowed: {node.module}"

            # Dangerous calls
            elif isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    if node.func.id in {"exec", "eval", "compile", "__import__"}:
                        return False, f"Blocked function: {node.func.id}"
                elif isinstance(node.func, ast.Attribute):
                    attr = node.func.attr
                    if attr in {"system", "popen", "spawn", "exec"}:
                        return False, f"Blocked method: {attr}"

        return True, None


class SandboxConfig:
    """Configuration for the execution sandbox."""

    def __init__(
        self,
        timeout_seconds: int = 30,
        max_memory_mb: int = 512,
        allowed_network: bool = True,
        allowed_domains: list[str] | None = None,
        working_dir: Path | None = None,
        env_allowlist: list[str] | None = None,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.max_memory_mb = max_memory_mb
        self.allowed_network = allowed_network
        self.allowed_domains = allowed_domains or []
        self.working_dir = working_dir or Path(tempfile.gettempdir())
        self.env_allowlist = env_allowlist or []


class CredentialProvider:
    """
    Provides credentials for tool execution.

    CRITICAL: Credentials are NEVER embedded in tool code, and NEVER pulled
    ambiently from the host ``os.environ``. They are EXPLICITLY registered with a
    value (the way ``PlatformCredentialInjector`` hands them in) and injected as
    environment variables at execution time.
    """

    def __init__(self) -> None:
        # scope -> (env_var_name, value | None). value is None for legacy
        # scope→name mappings that carry NO explicit value — those inject nothing
        # (no ambient host read), they only declare which env var a scope maps to.
        self._credentials: dict[str, tuple[str, str | None]] = {}

    def register_credential(self, scope: str, env_var: str, value: str | None = None) -> None:
        """
        Register a credential for a scope.

        Args:
            scope: The auth scope (e.g., "github:read")
            env_var: Environment variable name the credential is exposed as
            value: The credential VALUE to inject. When omitted, this is a
                name-only mapping and injects NOTHING — credentials are never
                read ambiently from the host os.environ.
        """
        self._credentials[scope] = (env_var, value)

    def get_env_for_scopes(self, scopes: list[str]) -> dict[str, str]:
        """
        Get environment variables for the requested scopes.

        Returns ONLY credentials that were registered with an explicit value.
        Never reads the host ``os.environ`` — a scope mapped without a value
        injects nothing.
        """
        env: dict[str, str] = {}
        for scope in scopes:
            entry = self._credentials.get(scope)
            if entry is None:
                continue
            env_var, value = entry
            if value is not None:
                env[env_var] = value
        return env

    def has_scope(self, scope: str) -> bool:
        """Check if a scope is registered."""
        return scope in self._credentials


# =============================================================================
# Sandbox wrapper — the REAL runtime security boundary
# =============================================================================

# Top-level module names that must never be importable at RUNTIME inside the
# sandbox — the static CodeValidator denylist is only the first line; the guarded
# __import__ in the wrapper re-enforces this set so the dynamic bypasses
# (importlib.import_module, __import__('subprocess'), a subclass-graph walk that
# re-imports) all fail in the running process, not just in the AST scan.
_RUNTIME_BLOCKED_IMPORTS: set[str] = {
    "subprocess", "pty", "shlex",
    "ctypes", "cffi",
    "pickle", "marshal", "shelve",
    "multiprocessing",
    "importlib",  # the dynamic-import shim itself — synth code imports modules
                  # with a plain `import x`, never needs importlib; allowing it
                  # would re-open the runtime-import bypass.
}

# Env var NAME substrings that mark a value as a secret. Any parent-env var whose
# name contains one of these is stripped before building the child env, so even
# non-cloud host secrets (DB passwords, signing keys) never bleed in.
_SECRET_NAME_SUBSTRINGS = ("secret", "password", "token", "key", "api")

# The hardened wrapper. It is written to a temp file and run as a subprocess. It
# reads {"code","context","timeout_seconds","max_memory_mb"} from stdin, exec's
# the synthesized code into a LOCKED namespace, calls ``execute(context)`` (the
# Synth contract), and prints ``__OAT_RESULT__`` followed by the JSON result —
# preserving the SoT executor's existing result-marker contract.
SANDBOX_WRAPPER = r'''
import sys
import json
import resource
import signal
import asyncio
import inspect
import traceback
import os as _os
import builtins as _builtins
import posixpath as _pp

_RUNTIME_BLOCKED_IMPORTS = %(runtime_blocked)r


def set_limits(max_memory_mb, max_cpu_seconds):
    memory_bytes = max_memory_mb * 1024 * 1024
    # The production sandbox runs on Linux (Cloud Run), where the full rlimit set
    # is enforced. macOS/Darwin rejects some of these — RLIMIT_AS can't be lowered
    # below the process's current VM usage, and RLIMIT_NPROC is per-uid and unsafe
    # to zero — so on Darwin we skip those two (local dev) and apply the rest
    # best-effort. Linux behavior is unchanged.
    _darwin = sys.platform == "darwin"

    def _lim(res, soft, hard):
        try:
            resource.setrlimit(res, (soft, hard))
        except (ValueError, OSError):
            pass

    if not _darwin:
        _lim(resource.RLIMIT_AS, memory_bytes, memory_bytes)
    _lim(resource.RLIMIT_CPU, max_cpu_seconds, max_cpu_seconds)
    _lim(resource.RLIMIT_CORE, 0, 0)
    # No new processes — closes os.fork / native thread-spawn escape (Linux).
    if not _darwin:
        _lim(resource.RLIMIT_NPROC, 0, 0)
    _lim(resource.RLIMIT_NOFILE, 256, 256)
    # Cap total bytes written to disk at 64 MiB (runaway file generation).
    _lim(resource.RLIMIT_FSIZE, 64 * 1024 * 1024, 64 * 1024 * 1024)


def timeout_handler(signum, frame):
    raise TimeoutError("Execution timed out")


signal.signal(signal.SIGALRM, timeout_handler)

config = json.loads(sys.stdin.readline())
max_memory_mb = config.get("max_memory_mb", 512)
max_cpu_seconds = config.get("timeout_seconds", 30)
code = config.get("code", "")
context = config.get("context", {})

set_limits(max_memory_mb, max_cpu_seconds + 5)  # +5 buffer
signal.alarm(max_cpu_seconds)

# ---------------------------------------------------------------------------
# Locked execution environment — the REAL security boundary.
#   - eval/exec/compile/input/breakpoint/help removed from __builtins__
#   - __import__ wrapped to re-apply the runtime import blocklist
#   - open replaced with a path-scoped variant (writes confined to /tmp; host
#     files like /etc/passwd cannot be read)
# Everything legitimate synth code + pre-baked libs need stays available.
# ---------------------------------------------------------------------------

_WRITE_ROOTS = ("/tmp",)
_READ_ROOTS = (
    "/tmp",
    _pp.realpath(sys.prefix),
    _pp.realpath(sys.base_prefix),
    _pp.realpath(_pp.dirname(_os.__file__)),  # stdlib dir
)
_READ_FILE_ALLOW = frozenset({
    "/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf",
    "/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt",
    "/etc/localtime", "/etc/timezone", "/etc/mime.types",
    "/dev/null", "/dev/urandom", "/dev/random",
})


def _path_under(path, roots):
    rp = _pp.realpath(path)
    for root in roots:
        if rp == root or rp.startswith(root + "/"):
            return True
    return False


def _is_write_mode(mode):
    return any(c in mode for c in ("w", "a", "x", "+"))


def _coerce_fspath(file):
    # Return a str path for a path-like target, or None for fd ints / objects
    # that have no filesystem path (so they flow through unchecked). Shared by
    # the builtins.open / io.open / os.open guards.
    try:
        fspath = _os.fspath(file) if not isinstance(file, int) else None
    except TypeError:
        fspath = None
    if isinstance(fspath, bytes):
        fspath = fspath.decode("utf-8", "replace")
    return fspath


def _enforce_path_scope(fspath, writing):
    # Raise PermissionError if `fspath` is outside the allowed roots. Shared by
    # every file-open seam (builtins.open / io.open / os.open) so host files
    # like /etc/passwd cannot be reached via ANY open route — open(), io.open(),
    # pathlib.read_text() (which funnels through io.open), or os.open() raw fd.
    if fspath is None:
        return
    if writing:
        if not _path_under(fspath, _WRITE_ROOTS):
            raise PermissionError(
                "synth sandbox: writes are confined to /tmp (got %%r)" %% (fspath,)
            )
    else:
        allowed = (
            _path_under(fspath, _READ_ROOTS)
            or _pp.realpath(fspath) in _READ_FILE_ALLOW
            or fspath in _READ_FILE_ALLOW
        )
        if not allowed:
            raise PermissionError(
                "synth sandbox: reading %%r is not permitted (host filesystem "
                "is off-limits; only /tmp and library data are readable)" %% (fspath,)
            )


def _guarded_open(file, mode="r", *args, **kwargs):
    # Police real filesystem path targets only; fd ints / non-path objects flow
    # through. Reject host-file reads / writes outside /tmp.
    _enforce_path_scope(_coerce_fspath(file), _is_write_mode(mode))
    return _real_io_open(file, mode, *args, **kwargs)


def _guarded_io_open(file, mode="r", *args, **kwargs):
    # io.open is the seam pathlib.Path.open / read_text / read_bytes route
    # through (Path.open calls io.open(self, ...)). Rebinding builtins.open in
    # the locked __builtins__ dict does NOT cover io.open, so pathlib reads
    # bypassed the scope until this guard. #1183 residual d. Same path policy.
    _enforce_path_scope(_coerce_fspath(file), _is_write_mode(mode))
    return _real_io_open(file, mode, *args, **kwargs)


def _guarded_os_open(path, flags, mode=0o777, *args, **kwargs):
    # os.open is the raw-fd open route. It bypasses BOTH builtins.open and
    # io.open, so `os.open('/etc/passwd', O_RDONLY)` + os.read read host files
    # straight through until this guard. #1183 residual c. Writing flags imply
    # the write scope.
    _writing = bool(
        flags & (_os.O_WRONLY | _os.O_RDWR | _os.O_CREAT | _os.O_APPEND | _os.O_TRUNC)
    )
    _enforce_path_scope(_coerce_fspath(path), _writing)
    return _real_os_open(path, flags, mode, *args, **kwargs)


def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    top = (name or "").split(".")[0]
    if top in _RUNTIME_BLOCKED_IMPORTS:
        raise ImportError(
            "synth sandbox: import of %%r is blocked at runtime" %% (name,)
        )
    return _real_import(name, globals, locals, fromlist, level)


# Capture the ORIGINAL low-level openers before we rebind them, so the guards
# can still delegate to the real implementation. io.open is the same C object
# as the unguarded builtins.open; os.open is the raw syscall wrapper.
import io as _io
_real_io_open = _io.open
_real_os_open = _os.open
_real_import = _builtins.__import__

# Install the file-open guards on the live os/io modules. pathlib, tempfile,
# shutil, numpy, reportlab, etc. all funnel through these, so every escape
# route (os.open raw fd, io.open, pathlib.read_text) is now path-scoped — not
# just the `open(...)` name in the exec'd namespace.
_io.open = _guarded_io_open
_os.open = _guarded_os_open


# Builtins removed entirely — pure escape primitives with no legitimate use in
# synthesized tool code. Their absence makes __builtins__["ev"+"al"] raise.
_BANNED_BUILTINS = ("eval", "exec", "compile", "input", "breakpoint", "help")

_locked_builtins = {}
for _bname in dir(_builtins):
    if _bname in _BANNED_BUILTINS:
        continue
    _locked_builtins[_bname] = getattr(_builtins, _bname)
_locked_builtins["open"] = _guarded_open
_locked_builtins["__import__"] = _guarded_import

namespace = {
    "__builtins__": _locked_builtins,
    "__name__": "__main__",
    "__doc__": None,
}

result_payload = None

try:
    # compile() is removed from the locked builtins but still available to the
    # wrapper itself via the real builtins module.
    exec(_builtins.compile(code, "<synth-code>", "exec"), namespace)

    if "execute" in namespace and callable(namespace["execute"]):
        fn = namespace["execute"]
        try:
            if inspect.iscoroutinefunction(fn):
                result_payload = asyncio.run(fn(context))
            else:
                result_payload = fn(context)
        except Exception as e:
            # Mirror the SoT runner contract: errors raised INSIDE execute() are
            # surfaced as a structured result, not a wrapper failure.
            result_payload = {"error": str(e), "traceback": traceback.format_exc()}
    elif "result" in namespace:
        result_payload = namespace["result"]
    elif "output" in namespace:
        result_payload = namespace["output"]
    elif "data" in namespace:
        result_payload = namespace["data"]

except MemoryError:
    result_payload = {"error": "Memory limit exceeded", "error_type": "MemoryError"}
except TimeoutError as e:
    result_payload = {"error": str(e), "error_type": "TimeoutError"}
except Exception as e:
    result_payload = {"error": str(e), "error_type": type(e).__name__, "traceback": traceback.format_exc()}
finally:
    signal.alarm(0)

print("__OAT_RESULT__")
print(json.dumps(result_payload, default=str))
'''


class Executor:
    """
    Executes synthesized tools in a hardened sandbox.

    The executor:
    1. Validates the tool code (AST denylist + capability isolation)
    2. Sets up an isolated, allowlisted environment (no ambient host creds)
    3. Injects ONLY explicitly-provided scoped credentials
    4. Executes the code wrapped in SANDBOX_WRAPPER (locked builtins, guarded
       import, path-scoped open, resource limits) with a timeout
    5. Captures output and errors
    6. Extracts groundable content
    """

    def __init__(
        self,
        config: SandboxConfig | None = None,
        credential_provider: CredentialProvider | None = None,
        capability_registry: Any | None = None,
    ) -> None:
        self.config = config or SandboxConfig()
        self.credentials = credential_provider or CredentialProvider()
        self.capability_registry = capability_registry

    async def execute(
        self,
        tool: SynthesizedTool,
        context: dict[str, Any] | None = None,
        credentials: dict[str, str] | None = None,
    ) -> ToolOutput:
        """
        Execute a synthesized tool in a sandbox.

        Args:
            tool: The synthesized tool to execute
            context: Additional context to pass to the tool's execute(context)
            credentials: Explicit per-call credential env vars to inject. These
                are EXPLICIT — the only other credential source is the
                credential_provider's value-registered scopes. Host os.environ is
                never ambient-passed.

        Returns:
            ToolOutput with results or errors
        """
        start_time = time.time()

        try:
            # Step 1: Validate code (AST denylist + capability isolation).
            validation_error = self._validate_code(tool.code, tool.capabilities_used)
            if validation_error:
                return ToolOutput(
                    tool_id=tool.id,
                    success=False,
                    error=f"Code validation failed: {validation_error}",
                    execution_time_ms=int((time.time() - start_time) * 1000),
                )

            # Step 2: Prepare execution environment (allowlist + explicit creds).
            env = self._prepare_environment(tool.requested_scopes, credentials)

            # Step 2.5: Install required packages for capabilities.
            packages = self._get_required_packages(tool.capabilities_used)
            if packages:
                await self._install_packages(packages, env)

            # Step 3: Execute in the hardened sandbox.
            result, stdout, stderr = await self._execute_in_sandbox(
                tool.code,
                context or {},
                env,
            )

            execution_time = int((time.time() - start_time) * 1000)

            # Step 4: Extract groundable output.
            groundable = self._extract_groundable(tool, result)

            return ToolOutput(
                tool_id=tool.id,
                success=True,
                result=result,
                stdout=stdout,
                stderr=stderr,
                execution_time_ms=execution_time,
                groundable=groundable,
            )

        except TimeoutError:
            return ToolOutput(
                tool_id=tool.id,
                success=False,
                error=f"Execution timed out after {self.config.timeout_seconds}s",
                execution_time_ms=int((time.time() - start_time) * 1000),
            )
        except Exception as e:  # noqa: BLE001 — top-level executor catch-all: user-synthesized code may raise anything; surface it as a failed ToolOutput.
            return ToolOutput(
                tool_id=tool.id,
                success=False,
                error=str(e),
                execution_time_ms=int((time.time() - start_time) * 1000),
            )

    def _validate_code(self, code: str, capabilities: list[str] | None = None) -> str | None:
        """
        AST-based code validation (replaces the old regex scan). Catches
        obfuscation a substring scan misses and enforces capability isolation.

        Returns an error message if invalid, ``None`` if OK. Preserves the SoT
        contract that synthesized code defines ``async def execute(context)``.
        """
        is_valid, error = CodeValidator(capabilities or []).validate(code)
        if not is_valid:
            return error

        # SoT contract: synthesized tools expose `async def execute(context)`.
        if "async def execute" not in code:
            return "Code must define 'async def execute(context: dict)'"

        return None

    def _prepare_environment(
        self,
        scopes: list[str],
        credentials: dict[str, str] | None = None,
    ) -> dict[str, str]:
        """Prepare environment variables for execution.

        The env is an ALLOWLIST. It starts from a minimal base (PATH/HOME/TMPDIR
        + the Python runtime paths a dynamically-linked interpreter needs) — the
        host ``os.environ`` cloud credentials are NEVER ambient-passed through.
        Credentials reach the sandbox only via:
          - the ``env_allowlist`` of explicitly-set parent-env values (the
            platform sets user creds into os.environ then allowlists their keys),
          - scopes registered WITH a value on the CredentialProvider,
          - the explicit ``credentials`` per-call dict.
        Any secret-NAMED var that sneaks in is scrubbed defensively.
        """
        # Minimal base env. PATH/HOME/TMPDIR + Python paths so installed packages
        # are importable. LD_LIBRARY_PATH: required when the running interpreter
        # is dynamically linked — without it the subprocess fails to load
        # libpython*.so.
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": os.environ.get("HOME", str(self.config.working_dir)),
            "TMPDIR": str(self.config.working_dir),
        }
        for pyvar in ("PYTHONPATH", "PYTHONUSERBASE", "VIRTUAL_ENV", "LD_LIBRARY_PATH"):
            if pyvar in os.environ:
                env[pyvar] = os.environ[pyvar]

        # Explicitly allowlisted parent-env vars (the platform's explicit-cred
        # channel — it sets user creds into os.environ then passes their keys).
        for var in self.config.env_allowlist:
            if var in os.environ:
                env[var] = os.environ[var]

        # Defense-in-depth: strip any secret-NAMED var that made it into the base
        # env (e.g. via a secret-shaped PYTHON* or allowlist entry).
        for key in list(env.keys()):
            low = key.lower()
            if any(s in low for s in _SECRET_NAME_SUBSTRINGS):
                del env[key]

        # Explicit scoped credentials (value-registered scopes only).
        env.update(self.credentials.get_env_for_scopes(scopes))

        # Explicit per-call credentials.
        if credentials:
            env.update(credentials)

        return env

    def _get_required_packages(self, capabilities_used: list[str]) -> list[str]:
        """Collect pip packages required by the capabilities used."""
        if not self.capability_registry:
            return []
        packages: set[str] = set()
        for cap_name in capabilities_used:
            cap = self.capability_registry.get(cap_name)
            if cap and hasattr(cap, "packages"):
                packages.update(cap.packages)
        return sorted(packages)

    async def _install_packages(self, packages: list[str], env: dict[str, str]) -> None:
        """Install pip packages into the sandbox environment before execution."""
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "pip",
            "install",
            "-q",
            *packages,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        await asyncio.wait_for(process.communicate(), timeout=120)

    async def _execute_in_sandbox(
        self,
        code: str,
        context: dict[str, Any],
        env: dict[str, str],
    ) -> tuple[Any, str, str]:
        """
        Execute code in a hardened sandboxed subprocess.

        The synthesized ``code`` is wrapped in ``SANDBOX_WRAPPER`` (locked
        builtins, guarded import, path-scoped open, resource limits) and run as a
        subprocess. The wrapper reads {code, context, limits} from stdin and
        emits the result after the ``__OAT_RESULT__`` marker.
        """
        import json as _json

        wrapper_code = SANDBOX_WRAPPER % {
            "runtime_blocked": _RUNTIME_BLOCKED_IMPORTS,
        }

        # Write the wrapper to a temp file. Synchronous blocking I/O — offload to
        # a thread so the event loop stays responsive.
        def _write_runner_script(runner_code: str) -> str:
            with tempfile.NamedTemporaryFile(
                mode="w",
                suffix=".py",
                delete=False,
                dir=self.config.working_dir,
            ) as f:
                f.write(runner_code)
                return f.name

        script_path = await asyncio.to_thread(_write_runner_script, wrapper_code)

        config_payload = _json.dumps(
            {
                "code": code,
                "context": context,
                "timeout_seconds": self.config.timeout_seconds,
                "max_memory_mb": self.config.max_memory_mb,
            }
        )

        try:
            process = await asyncio.wait_for(
                asyncio.create_subprocess_exec(
                    sys.executable,
                    script_path,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env,
                    cwd=str(self.config.working_dir),
                ),
                timeout=self.config.timeout_seconds,
            )

            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(input=(config_payload + "\n").encode()),
                # Extra buffer over the in-sandbox alarm so the OS-level wait
                # doesn't fire before the sandbox's own SIGALRM surfaces a clean
                # TimeoutError result.
                timeout=self.config.timeout_seconds + 5,
            )

            stdout = stdout_bytes.decode("utf-8", errors="replace")
            stderr = stderr_bytes.decode("utf-8", errors="replace")

            # Extract result from stdout (preserves the __OAT_RESULT__ contract).
            result = None
            if "__OAT_RESULT__" in stdout:
                parts = stdout.split("__OAT_RESULT__")
                if len(parts) > 1:
                    result_str = parts[1].strip()
                    try:
                        result = _json.loads(result_str)
                    except (ValueError, TypeError):
                        result = result_str
                stdout = parts[0]  # Remove result marker from stdout

            return result, stdout, stderr

        finally:
            # Clean up the temp wrapper script. A missing file or permission
            # hiccup here is never actionable — we already returned the result.
            with contextlib.suppress(OSError):
                Path(script_path).unlink()

    def _extract_groundable(
        self,
        tool: SynthesizedTool,
        result: Any,
    ) -> GroundableOutput | None:
        """Extract groundable content from the result."""
        if result is None:
            return None

        import json

        if isinstance(result, dict):
            summary = tool.human_explanation
            embedding_text = f"{tool.intent}\n\n{json.dumps(result, indent=2)}"
        else:
            summary = tool.human_explanation
            embedding_text = f"{tool.intent}\n\n{result!s}"

        return GroundableOutput(
            summary=summary,
            entities=[],  # Could extract with NER
            embedding_text=embedding_text,
            metadata={
                "tool_id": tool.id,
                "intent": tool.intent,
                "capabilities": tool.capabilities_used,
            },
        )
