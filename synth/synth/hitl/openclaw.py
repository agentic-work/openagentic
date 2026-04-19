# Proprietary and confidential. Unauthorized copying prohibited.

"""
OpenClaw Approval Handler

Routes HITL approvals through OpenClaw's gateway when synth runs inside an
OpenClaw Skill. Renders as inline chat buttons (Telegram/Slack) or text
fallback (dashboard) automatically — the gateway owns that rendering.

Shells out to the locally-installed `openclaw` CLI (`openclaw gateway call`)
to avoid re-implementing OpenClaw's WebSocket preauth handshake in Python.
Node + openclaw must be on PATH when this handler is active.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import time

from synth.core.types import ApprovalDecision, ApprovalRequest, RiskLevel
from synth.hitl.gate import ApprovalHandler

_JSON_BLOB_RE = re.compile(r"(\{[\s\S]*\}|\[[\s\S]*\])\s*\Z")

# How severity maps from synth risk levels to OpenClaw's three-tier severity.
_RISK_TO_SEVERITY = {
    RiskLevel.LOW: "info",
    RiskLevel.MEDIUM: "warning",
    RiskLevel.HIGH: "warning",
    RiskLevel.CRITICAL: "critical",
}

# plugin.approval.request schema: title 1-80 chars, description 1-256.
_TITLE_MAX = 80
_DESCRIPTION_MAX = 256


def is_openclaw_available() -> bool:
    """True when the openclaw CLI is on PATH (cheap check, no network call)."""
    return shutil.which("openclaw") is not None  # pragma: no branch


def should_use_openclaw_handler() -> bool:
    """
    Decide whether to route approvals through OpenClaw.

    Active when EITHER:
    - OPENCLAW_GATEWAY_URL is set in the env (explicit opt-in), OR
    - stdin is not a TTY AND the openclaw CLI is on PATH (implicit: we're
      running inside a skill subprocess under a live gateway).
    """
    if os.environ.get("OPENCLAW_GATEWAY_URL"):
        return True
    import sys
    return not sys.stdin.isatty() and is_openclaw_available()


class OpenClawApprovalHandler(ApprovalHandler):
    """
    Approval handler that posts to OpenClaw's gateway.

    Flow:
      1. plugin.approval.request  → get approval id
      2. Chat channel renders button; user taps approve/deny
      3. plugin.approval.waitDecision (long-poll) → decision
      4. Map decision (allow-once | allow-always | deny) to ApprovalDecision

    Uses the `openclaw gateway call` CLI as the transport bridge.
    """

    def __init__(
        self,
        plugin_id: str = "synth",
        request_timeout_ms: int = 300_000,
        openclaw_cmd: str = "openclaw",
        poll_interval_s: float = 3.0,
        wait_call_timeout_s: int = 30,
    ) -> None:
        self.plugin_id = plugin_id
        self.request_timeout_ms = request_timeout_ms
        self.openclaw_cmd = openclaw_cmd
        self.poll_interval_s = poll_interval_s
        self.wait_call_timeout_s = wait_call_timeout_s

    async def request_approval(self, request: ApprovalRequest) -> ApprovalDecision:
        start = time.time()
        tool = request.tool

        title = self._truncate(f"Synth: {tool.intent}", _TITLE_MAX)
        description = self._truncate(tool.human_explanation, _DESCRIPTION_MAX)
        severity = _RISK_TO_SEVERITY.get(tool.risk_level, "warning")

        params = {
            "pluginId": self.plugin_id,
            "title": title,
            "description": description,
            "severity": severity,
            "toolName": f"synth.tool.{tool.id}",
            "toolCallId": tool.id,
            "timeoutMs": self.request_timeout_ms,
            "twoPhase": True,
        }

        try:
            registered = await self._gateway_call("plugin.approval.request", params)
        except OpenClawGatewayError as exc:
            return self._deny(
                reason=f"OpenClaw gateway unreachable: {exc}",
                start=start,
            )

        approval_id = registered.get("id") if isinstance(registered, dict) else None
        if not approval_id:
            return self._deny(
                reason=f"OpenClaw gateway returned no approval id: {registered}",
                start=start,
            )
        # Emit the approval id to stderr so callers (e2e tests, observability
        # tooling, humans tailing logs) can correlate this approval with the
        # one that lands in the OpenClaw dashboard. Single tagged line,
        # machine-parseable: `[openclaw] approval_id=<id>`.
        import sys as _sys
        print(f"[openclaw] approval_id={approval_id}", file=_sys.stderr, flush=True)

        # Gateway's plugin.approval.waitDecision returns a snapshot (doesn't
        # long-poll), so we poll until the decision is set or the overall
        # request timeout expires. Each poll spawns a fresh `openclaw gateway
        # call` subprocess which runs the full preauth handshake — give it
        # 30s of headroom and tolerate transient errors (don't fail-closed
        # on a single slow poll).
        deadline = start + (self.request_timeout_ms / 1000.0)
        decision_value: str | None = None
        while time.time() < deadline:
            try:
                resolved = await self._gateway_call(
                    "plugin.approval.waitDecision",
                    {"id": approval_id},
                    timeout_s=self.wait_call_timeout_s,
                )
                decision_value = resolved.get("decision") if isinstance(resolved, dict) else None
                if decision_value is not None:
                    break
            except OpenClawGatewayError:
                # Transient poll failure — retry after interval. We only bail
                # when the overall request deadline expires.
                pass
            await asyncio.sleep(self.poll_interval_s)

        approved = decision_value in ("allow-once", "allow-always")

        return ApprovalDecision(
            approved=approved,
            reason="" if approved else f"OpenClaw decision: {decision_value or 'unknown'}",
            decision_time_ms=int((time.time() - start) * 1000),
        )

    def format_for_display(self, request: ApprovalRequest) -> str:
        """Plain-text representation surfaced in case OpenClaw asks for it."""
        tool = request.tool
        lines = [
            f"INTENT: {tool.intent}",
            f"EXPLANATION: {tool.human_explanation}",
            f"RISK: {tool.risk_level.value} — {tool.risk_reasoning}",
            f"CAPABILITIES: {', '.join(tool.capabilities_used) or 'none'}",
            f"SCOPES: {', '.join(tool.requested_scopes) or 'none'}",
        ]
        return "\n".join(lines)

    @staticmethod
    def _truncate(text: str, limit: int) -> str:
        text = text.strip() or "(no description)"
        if len(text) <= limit:
            return text
        return text[: limit - 1].rstrip() + "…"

    @staticmethod
    def _deny(reason: str, start: float) -> ApprovalDecision:
        return ApprovalDecision(
            approved=False,
            reason=reason,
            decision_time_ms=int((time.time() - start) * 1000),
        )

    async def _gateway_call(
        self,
        method: str,
        params: dict,
        timeout_s: int = 30,
    ) -> dict:
        """
        Invoke `openclaw gateway call <method> --json --params <json>` and
        parse the JSON response. Raises OpenClawGatewayError on failure.
        """
        cmd = [
            self.openclaw_cmd,
            "gateway",
            "call",
            method,
            "--json",
            "--timeout",
            str(timeout_s * 1000),
            "--params",
            json.dumps(params),
        ]
        # stdin=DEVNULL — the `openclaw gateway call` CLI must never wait
        # on us for interactive input. Inheriting a TTY stdin from the
        # synth parent caused the approval.request subprocess to hang
        # indefinitely waiting for an auth prompt in some openclaw versions.
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(), timeout=timeout_s + 5
            )
        except TimeoutError as exc:
            proc.kill()
            raise OpenClawGatewayError(f"gateway call '{method}' timed out") from exc

        stdout = stdout_bytes.decode("utf-8", errors="replace")
        stderr = stderr_bytes.decode("utf-8", errors="replace")

        if proc.returncode != 0:
            raise OpenClawGatewayError(
                f"gateway call '{method}' exit={proc.returncode}: {stderr.strip()[-300:] or stdout.strip()[-300:]}"
            )

        match = _JSON_BLOB_RE.search(stdout.strip())
        if not match:
            raise OpenClawGatewayError(
                f"gateway call '{method}' produced no JSON; stdout={stdout[-300:]!r}"
            )

        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError as exc:
            raise OpenClawGatewayError(
                f"gateway call '{method}' JSON parse failed: {exc}"
            ) from exc


class OpenClawGatewayError(RuntimeError):
    """Raised when an openclaw gateway call fails for any reason."""
