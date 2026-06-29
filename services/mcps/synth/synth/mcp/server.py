"""
Synth MCP Server

Exposes Synth tool synthesis and execution as MCP tools over stdio.
Run with: python -m synth.mcp.server  (or: uvx synth-mcp)

SECURITY / HITL CONTRACT
------------------------
Synth's core promise is "mandatory human-in-the-loop, no bypass": an LLM
authors single-use Python and a human reviews it *before* it runs. Over a
non-interactive stdio MCP transport there is no terminal to prompt on, so this
server enforces the gate with a deliberate **two-call protocol** instead of
silently executing model-authored code:

  1. ``synth_synthesize`` — generates the code + self-graded risk and returns
     them. It is read-only: it NEVER executes the synthesized tool. The host
     (e.g. Claude Code) and the human can inspect the code and risk first.
  2. ``synth_execute`` — runs a previously-synthesized tool in the hardened
     sandbox, and ONLY when called with ``approve=true``. Without explicit
     approval it returns the pending approval request and does nothing. This
     tool is annotated as destructive (``readOnlyHint=false``,
     ``destructiveHint=true``) so MCP hosts present it for human approval.

There is no auto-approve path. Synthesis cannot trigger execution.
"""

import asyncio
import json
import os
import sys
from typing import Any

from synth import __version__
from synth.capabilities import load_builtin_capabilities
from synth.core.executor import CredentialProvider, Executor, SandboxConfig
from synth.core.llm import create_llm_client
from synth.core.registry import CapabilityRegistry
from synth.core.synthesizer import Synthesizer
from synth.core.types import SynthesizedTool

# Default to the fully local/air-gapped path: Ollama on localhost. No internal
# hosts, no managed defaults — operators opt into a remote provider explicitly
# via SYNTH_PROVIDER / SYNTH_BASE_URL.
DEFAULT_PROVIDER = "ollama"
DEFAULT_BASE_URL = "http://localhost:11434"


class MCPServer:
    """MCP Server for Synth (stdio JSON-RPC)."""

    def __init__(
        self,
        provider: str = DEFAULT_PROVIDER,
        base_url: str | None = None,
        model: str = "",
        region: str = "us-east-1",
        api_key: str | None = None,
    ):
        self.provider = provider
        self.base_url = base_url
        self.model = model
        self.region = region
        self.api_key = api_key
        self.registry: CapabilityRegistry | None = None
        self.llm_client = None
        # Tools synthesized in this session, awaiting an explicit approved
        # execute call. Keyed by tool id. This is the HITL hand-off buffer:
        # synthesize fills it, execute drains it.
        self._pending_tools: dict[str, SynthesizedTool] = {}

    async def initialize(self):
        """Initialize Synth components."""
        self.registry = load_builtin_capabilities()

        # Build kwargs based on provider
        kwargs: dict[str, Any] = {}
        if self.model:
            kwargs["model"] = self.model
        if self.provider == "bedrock":
            kwargs["region"] = self.region
        elif self.provider in ("ollama", "openai", "anthropic", "agenticwork"):
            if self.base_url:
                kwargs["base_url"] = self.base_url
            if self.api_key:
                kwargs["api_key"] = self.api_key
        elif self.base_url:
            kwargs["base_url"] = self.base_url

        self.llm_client = create_llm_client(
            provider=self.provider,
            **kwargs,
        )

    def get_tools(self) -> list[dict]:
        """Return MCP tool definitions."""
        return [
            {
                "name": "synth_synthesize",
                "description": """Synthesize (but do NOT run) a one-shot Python tool from natural-language intent.

Use this when you need to perform a task that no dedicated tool covers. Synth
analyzes the intent, generates Python code, and self-grades its risk. It
returns the code + risk WITHOUT executing anything — this call is read-only.

To actually run the synthesized tool you must make a SECOND, explicit call to
`synth_execute` with the returned `tool_id` and `approve=true`, AFTER a human
has reviewed the code and risk. There is no auto-execute.

Examples of intent:
- "fetch the current bitcoin price from coingecko"
- "get my unread github notifications"
- "parse this CSV and return summary stats"

Returns: tool_id, code, risk_level, risk_reasoning, explanation, capabilities,
and scopes. Pass tool_id to synth_execute to run it.""",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "intent": {
                            "type": "string",
                            "description": "Natural language description of what you want to do",
                        },
                        "capabilities": {
                            "type": "string",
                            "description": "Comma-separated capabilities to use (optional). Options: http, filesystem, shell, github, slack, json, datetime, data",
                        },
                    },
                    "required": ["intent"],
                },
                "annotations": {
                    "title": "Synthesize one-shot tool (no execution)",
                    "readOnlyHint": True,
                    "destructiveHint": False,
                    "idempotentHint": False,
                    "openWorldHint": True,
                },
            },
            {
                "name": "synth_execute",
                "description": """Execute a previously synthesized tool in the hardened sandbox — DESTRUCTIVE.

This runs LLM-authored Python and may read or mutate real systems using
scoped, injected credentials. It is gated by mandatory human-in-the-loop
approval and will ONLY run when called with `approve=true`.

Flow:
1. Call `synth_synthesize` to get a `tool_id` + the code + risk.
2. A human reviews the code and risk.
3. Call `synth_execute` with that `tool_id` and `approve=true`.

If `approve` is omitted or false, this returns the pending approval request
and executes NOTHING.""",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tool_id": {
                            "type": "string",
                            "description": "The id returned by a prior synth_synthesize call",
                        },
                        "approve": {
                            "type": "boolean",
                            "description": "Must be true to execute. Set only after a human has reviewed the synthesized code and risk.",
                            "default": False,
                        },
                        "context": {
                            "type": "object",
                            "description": "Optional runtime inputs passed to the synthesized tool's `execute(context)`. Use this to supply arguments to a parameterized tool (e.g. {\"a\": 2, \"b\": 3}). Defaults to an empty object.",
                            "default": {},
                        },
                    },
                    "required": ["tool_id"],
                },
                "annotations": {
                    "title": "Execute synthesized tool (human-approved)",
                    "readOnlyHint": False,
                    "destructiveHint": True,
                    "idempotentHint": False,
                    "openWorldHint": True,
                },
            },
            {
                "name": "synth_list_capabilities",
                "description": "List available Synth capabilities that can be used for tool synthesis.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                },
                "annotations": {
                    "title": "List capabilities",
                    "readOnlyHint": True,
                    "destructiveHint": False,
                    "idempotentHint": True,
                    "openWorldHint": False,
                },
            },
        ]

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Execute an MCP tool call."""
        if name == "synth_synthesize":
            return await self._synthesize(arguments)
        if name == "synth_execute":
            return await self._execute(arguments)
        if name == "synth_list_capabilities":
            return await self._list_capabilities()
        return {"error": f"Unknown tool: {name}"}

    async def _synthesize(self, args: dict[str, Any]) -> dict[str, Any]:
        """Synthesize a tool from intent. NEVER executes — that is synth_execute's job."""
        intent = args.get("intent", "")
        capabilities = args.get("capabilities")

        if not intent:
            return {"error": "Intent is required"}

        cap_filter = None
        if capabilities:
            cap_filter = [c.strip() for c in capabilities.split(",")]

        synthesizer = Synthesizer(
            llm_client=self.llm_client,
            capability_registry=self.registry,
        )

        try:
            tool = await synthesizer.synthesize(intent, allowed_capabilities=cap_filter)
        except Exception as e:  # noqa: BLE001 — surface any synth error as a structured MCP error response.
            return {"error": f"Synthesis failed: {e!s}"}

        if tool is None:
            return {"result": "Existing tools can handle this intent - no synthesis needed"}

        # Stash for a subsequent approved execute call. Synthesis NEVER executes.
        self._pending_tools[tool.id] = tool

        return {
            "tool_id": tool.id,
            "intent": tool.intent,
            "code": tool.code,
            "risk_level": tool.risk_level.value,
            "risk_reasoning": tool.risk_reasoning,
            "explanation": tool.human_explanation,
            "capabilities_used": tool.capabilities_used,
            "requested_scopes": tool.requested_scopes,
            "executed": False,
            "next_step": (
                "Review the code and risk. To run it, call synth_execute with "
                f"tool_id='{tool.id}' and approve=true (human approval required)."
            ),
        }

    async def _execute(self, args: dict[str, Any]) -> dict[str, Any]:
        """Execute a previously synthesized tool — only with explicit approval."""
        tool_id = args.get("tool_id", "")
        approve = args.get("approve", False)
        # Optional runtime inputs for the synthesized `execute(context)`. Coerce a
        # null/missing value to an empty dict so parameterized tools get a real
        # mapping rather than None.
        context = args.get("context") or {}

        if not tool_id:
            return {"error": "tool_id is required (from a prior synth_synthesize call)"}

        tool = self._pending_tools.get(tool_id)
        if tool is None:
            return {
                "error": (
                    f"Unknown or expired tool_id '{tool_id}'. Call synth_synthesize "
                    "first, then pass the returned tool_id here."
                )
            }

        # The HITL gate: no approval, no execution.
        if approve is not True:
            return {
                "approval_required": True,
                "executed": False,
                "tool_id": tool.id,
                "intent": tool.intent,
                "code": tool.code,
                "risk_level": tool.risk_level.value,
                "risk_reasoning": tool.risk_reasoning,
                "explanation": tool.human_explanation,
                "capabilities_used": tool.capabilities_used,
                "requested_scopes": tool.requested_scopes,
                "message": (
                    "Execution requires explicit human approval. Re-call synth_execute "
                    "with approve=true ONLY after a human has reviewed this code and risk."
                ),
            }

        try:
            creds = CredentialProvider()
            executor = Executor(
                config=SandboxConfig(timeout_seconds=60),
                credential_provider=creds,
                capability_registry=self.registry,
            )
            output = await executor.execute(tool, context=context)
        except Exception as e:  # noqa: BLE001 — surface any execution error into the MCP result payload.
            return {
                "tool_id": tool.id,
                "executed": True,
                "execution": {"success": False, "error": f"Execution failed: {e!s}"},
            }

        # One-shot: a tool is consumed once executed.
        self._pending_tools.pop(tool_id, None)

        execution: dict[str, Any] = {
            "success": output.success,
            "result": output.result,
            "error": output.error,
            "execution_time_ms": output.execution_time_ms,
        }
        if output.stdout:
            execution["stdout"] = output.stdout
        if output.stderr:
            execution["stderr"] = output.stderr

        return {"tool_id": tool.id, "executed": True, "execution": execution}

    async def _list_capabilities(self) -> dict[str, Any]:
        """List available capabilities."""
        caps = []
        for cap in self.registry.get_all():
            caps.append(
                {
                    "name": cap.name,
                    "description": cap.description.split("\n")[0],
                    "auth_type": cap.auth.type.value if cap.auth else "none",
                }
            )
        return {"capabilities": caps}

    async def handle_message(self, message: dict) -> dict:
        """Handle an MCP JSON-RPC message."""
        method = message.get("method", "")
        params = message.get("params", {})
        msg_id = message.get("id")

        if method == "initialize":
            await self.initialize()
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "serverInfo": {
                        "name": "synth",
                        "version": __version__,
                    },
                    "capabilities": {
                        "tools": {},
                    },
                },
            }

        if method == "notifications/initialized":
            return None  # No response for notifications

        if method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "tools": self.get_tools(),
                },
            }

        if method == "tools/call":
            tool_name = params.get("name", "")
            tool_args = params.get("arguments", {})
            result = await self.call_tool(tool_name, tool_args)
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(result, indent=2, default=str),
                        }
                    ],
                },
            }

        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "error": {
                "code": -32601,
                "message": f"Method not found: {method}",
            },
        }

    async def run(self):
        """Run the MCP server over stdio."""
        while True:
            try:
                line = await asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline)
                if not line:
                    break

                message = json.loads(line)
                response = await self.handle_message(message)

                if response is not None:
                    sys.stdout.write(json.dumps(response) + "\n")
                    sys.stdout.flush()

            except json.JSONDecodeError:
                continue
            except Exception as e:  # noqa: BLE001 — JSON-RPC top-level handler must convert any error to a structured error response.
                error_response = {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {
                        "code": -32603,
                        "message": str(e),
                    },
                }
                sys.stdout.write(json.dumps(error_response) + "\n")
                sys.stdout.flush()


def main():
    """Entry point for MCP server."""
    provider = os.environ.get("SYNTH_PROVIDER", DEFAULT_PROVIDER)
    model = os.environ.get("SYNTH_MODEL", "")
    base_url = os.environ.get("SYNTH_BASE_URL", DEFAULT_BASE_URL)
    api_key = os.environ.get("SYNTH_API_KEY", "")
    region = os.environ.get("AWS_REGION", "us-east-1")

    server = MCPServer(
        provider=provider,
        base_url=base_url,
        model=model,
        region=region,
        api_key=api_key,
    )
    asyncio.run(server.run())


if __name__ == "__main__":
    main()
