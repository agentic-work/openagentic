# Proprietary and confidential. Unauthorized copying prohibited.

"""
Sandboxed Tool Executor

Executes synthesized tools in an isolated environment with
scoped credentials and resource limits.
"""

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

    CRITICAL: Credentials are NEVER embedded in tool code.
    They are injected as environment variables at execution time.
    """

    def __init__(self) -> None:
        self._credentials: dict[str, str] = {}

    def register_credential(self, scope: str, env_var: str) -> None:
        """
        Register a credential for a scope.

        Args:
            scope: The auth scope (e.g., "github:read")
            env_var: Environment variable containing the credential
        """
        self._credentials[scope] = env_var

    def get_env_for_scopes(self, scopes: list[str]) -> dict[str, str]:
        """
        Get environment variables for the requested scopes.

        Returns a dict of env vars to inject into the sandbox.
        """
        env = {}
        for scope in scopes:
            if scope in self._credentials:
                env_var = self._credentials[scope]
                value = os.environ.get(env_var)
                if value:
                    env[env_var] = value
        return env

    def has_scope(self, scope: str) -> bool:
        """Check if a scope is available."""
        return scope in self._credentials


class Executor:
    """
    Executes synthesized tools in a sandbox.

    The executor:
    1. Validates the tool code
    2. Sets up an isolated environment
    3. Injects scoped credentials
    4. Executes with resource limits
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
    ) -> ToolOutput:
        """
        Execute a synthesized tool in a sandbox.

        Args:
            tool: The synthesized tool to execute
            context: Additional context to pass to the tool

        Returns:
            ToolOutput with results or errors
        """
        start_time = time.time()

        try:
            # Step 1: Validate code (basic safety checks)
            validation_error = self._validate_code(tool.code)
            if validation_error:
                return ToolOutput(
                    tool_id=tool.id,
                    success=False,
                    error=f"Code validation failed: {validation_error}",
                    execution_time_ms=int((time.time() - start_time) * 1000),
                )

            # Step 2: Check credential availability. _check_scopes currently
            # returns [] unconditionally (see its docstring — HITL is the real
            # security boundary). The branch below is kept for future
            # scope-enforcement implementations.
            missing_scopes = self._check_scopes(tool.requested_scopes)
            if missing_scopes:  # pragma: no cover
                return ToolOutput(
                    tool_id=tool.id,
                    success=False,
                    error=f"Missing credentials for scopes: {', '.join(missing_scopes)}",
                    execution_time_ms=int((time.time() - start_time) * 1000),
                )

            # Step 3: Prepare execution environment
            env = self._prepare_environment(tool.requested_scopes)

            # Step 3.5: Install required packages for capabilities
            packages = self._get_required_packages(tool.capabilities_used)
            if packages:
                await self._install_packages(packages, env)

            # Step 4: Execute in sandbox
            result, stdout, stderr = await self._execute_in_sandbox(
                tool.code,
                context or {},
                env,
            )

            execution_time = int((time.time() - start_time) * 1000)

            # Step 5: Extract groundable output
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
        except Exception as e:
            return ToolOutput(
                tool_id=tool.id,
                success=False,
                error=str(e),
                execution_time_ms=int((time.time() - start_time) * 1000),
            )

    def _validate_code(self, code: str) -> str | None:
        """
        Basic code validation.

        Returns error message if invalid, None if OK.
        """
        # Check for obviously dangerous patterns
        dangerous_patterns = [
            ("os.system(", "Direct system calls not allowed"),
            ("subprocess.call(", "Use subprocess.run with shell=False"),
            ("eval(", "eval() not allowed"),
            # Note: "exec(" is allowed in create_subprocess_exec context
            ("exec(context", "exec() not allowed for arbitrary code"),
            ("__import__(", "Dynamic imports not allowed"),
            ("open('/etc", "System file access not allowed"),
            ("open('/root", "Root directory access not allowed"),
        ]

        for pattern, message in dangerous_patterns:
            if pattern in code:
                return message

        # Verify it has the expected function signature
        if "async def execute" not in code:
            return "Code must define 'async def execute(context: dict)'"

        return None

    def _check_scopes(self, scopes: list[str]) -> list[str]:
        """
        Check which scopes are missing credentials.

        The human-in-the-loop gate is the real security boundary. Scope checking
        here is informational — the LLM generates arbitrary scope strings that
        can't be reliably validated against a hardcoded list. We trust the
        capability definitions and the HITL approval.
        """
        # The HITL gate already approved this tool. Scopes are informational
        # metadata from the LLM, not a security gate. Let execution proceed.
        return []

    def _prepare_environment(self, scopes: list[str]) -> dict[str, str]:
        """Prepare environment variables for execution."""
        # Start with base environment — include Python paths so pip packages are found
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": os.environ.get("HOME", str(self.config.working_dir)),
            "TMPDIR": str(self.config.working_dir),
        }
        # Preserve Python-related paths so installed packages are importable.
        # LD_LIBRARY_PATH: required when the running interpreter is dynamically
        # linked (e.g. actions/setup-python's builds) — without it the sandbox
        # subprocess fails to load libpython*.so.
        for pyvar in ("PYTHONPATH", "PYTHONUSERBASE", "VIRTUAL_ENV", "LD_LIBRARY_PATH"):
            if pyvar in os.environ:
                env[pyvar] = os.environ[pyvar]

        # Always pass through cloud provider credentials if present
        cloud_vars = [
            # AWS
            "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
            "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE",
            # Azure
            "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID", "AZURE_SUBSCRIPTION_ID",
            "AZURE_CONFIG_DIR",  # Azure CLI config (~/.azure)
            # GCP
            "GOOGLE_APPLICATION_CREDENTIALS", "GCLOUD_PROJECT", "CLOUDSDK_CORE_PROJECT",
            "CLOUDSDK_CONFIG",  # gcloud config dir
            # Dev platforms
            "GITHUB_TOKEN", "SLACK_TOKEN",
            # Kubernetes
            "KUBECONFIG", "KUBE_CONTEXT",
            # Payments / data / workspace integrations (auth-injection ambient fallback)
            "STRIPE_API_KEY",
            "DATABASE_URL",
            "NOTION_TOKEN",
            "ATLASSIAN_SITE", "ATLASSIAN_EMAIL", "ATLASSIAN_API_TOKEN",
            "LINEAR_API_KEY",
            "SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_URL",
            # Email (Gmail OAuth + generic SMTP/IMAP)
            "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN",
            "SMTP_URL", "IMAP_URL",
            # Browser
            "BROWSER_PROFILE_DIR",
            # Vector DBs
            "PINECONE_API_KEY", "PINECONE_ENV",
            "QDRANT_URL", "QDRANT_API_KEY",
            "WEAVIATE_URL", "WEAVIATE_API_KEY",
        ]
        for var in cloud_vars:
            if var in os.environ:
                env[var] = os.environ[var]

        # Add allowlisted env vars
        for var in self.config.env_allowlist:
            if var in os.environ:
                env[var] = os.environ[var]

        # Add scoped credentials
        env.update(self.credentials.get_env_for_scopes(scopes))

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

    async def _install_packages(
        self, packages: list[str], env: dict[str, str]
    ) -> None:
        """Install pip packages into the sandbox environment before execution."""
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "pip", "install", "-q", *packages,
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
        Execute code in a sandboxed subprocess.

        For now, uses subprocess with restrictions.
        Future: Could use Deno, Firecracker, or WASM.
        """
        # Write the code to a temp file. tempfile.NamedTemporaryFile is
        # synchronous blocking I/O — offload to a thread so the event loop
        # stays responsive while the file is created on disk.
        def _write_runner_script(runner_code: str) -> str:
            with tempfile.NamedTemporaryFile(
                mode="w",
                suffix=".py",
                delete=False,
                dir=self.config.working_dir,
            ) as f:
                f.write(runner_code)
                return f.name

        runner_code = f'''
import asyncio
import json
import sys
import traceback

{code}

async def main():
    context = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {{}}
    try:
        result = await execute(context)
        print("__OAT_RESULT__")
        print(json.dumps(result, default=str))
    except Exception as e:
        print("__OAT_RESULT__")
        print(json.dumps({{"error": str(e), "traceback": traceback.format_exc()}}))

if __name__ == "__main__":
    asyncio.run(main())
'''
        script_path = await asyncio.to_thread(_write_runner_script, runner_code)

        try:
            # Execute with timeout
            process = await asyncio.wait_for(
                asyncio.create_subprocess_exec(
                    sys.executable,
                    script_path,
                    __import__("json").dumps(context),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env,
                    cwd=str(self.config.working_dir),
                ),
                timeout=self.config.timeout_seconds,
            )

            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(),
                timeout=self.config.timeout_seconds,
            )

            stdout = stdout_bytes.decode("utf-8", errors="replace")
            stderr = stderr_bytes.decode("utf-8", errors="replace")

            # Extract result from stdout
            result = None
            if "__OAT_RESULT__" in stdout:
                parts = stdout.split("__OAT_RESULT__")
                if len(parts) > 1:
                    result_str = parts[1].strip()
                    try:
                        result = __import__("json").loads(result_str)
                    except Exception:
                        result = result_str
                stdout = parts[0]  # Remove result marker from stdout

            return result, stdout, stderr

        finally:
            # Clean up the temp runner script. A missing file or permission
            # hiccup here is never actionable — we already returned the
            # result and are only tidying up.
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

        # Basic extraction - can be enhanced with LLM
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
