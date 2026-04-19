# Proprietary and confidential. Unauthorized copying prohibited.

"""
Synth CLI - Tool Synthesis Framework

Command-line interface for synthesizing and executing one-shot tools.
"""

import asyncio
import os
import sys
from typing import Any

import typer
from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table

from synth import __version__
from synth.capabilities import load_builtin_capabilities
from synth.core.executor import CredentialProvider, Executor, SandboxConfig
from synth.core.synthesizer import Synthesizer
from synth.core.types import RiskLevel
from synth.hitl.gate import ApprovalDecision, ApprovalHandler, ApprovalRequest, HITLGate
from synth.hitl.openclaw import OpenClawApprovalHandler, should_use_openclaw_handler

app = typer.Typer(
    name="synth",
    help="Synth - Code synthesis for LLMs with mandatory HITL approval and capability-scoped auth injection.",
    no_args_is_help=True,
)

console = Console()


class RichApprovalHandler(ApprovalHandler):
    """Rich-based approval handler with nice formatting."""

    def __init__(self, auto_view_code: bool = False) -> None:
        self.auto_view_code = auto_view_code

    async def request_approval(self, request: ApprovalRequest) -> ApprovalDecision:
        """Request approval via Rich CLI."""
        console.print()
        console.print(self.format_for_display(request))
        console.print()

        # Show code if requested
        if self.auto_view_code:
            self._show_code(request)

        while True:
            response = console.input("[bold]Approve? [y/n/v(iew code)]: [/]").strip().lower()

            if response == "y":
                return ApprovalDecision(approved=True)
            elif response == "n":
                reason = console.input("[dim]Reason (optional): [/]").strip()
                return ApprovalDecision(approved=False, reason=reason)
            elif response == "v":
                self._show_code(request)
            else:
                console.print("[yellow]Enter 'y' (yes), 'n' (no), or 'v' (view code)[/]")

    def _show_code(self, request: ApprovalRequest) -> None:
        """Display the synthesized code."""
        console.print()
        console.print(Panel(
            Syntax(request.tool.code, "python", theme="monokai", line_numbers=True),
            title="[bold]Synthesized Code[/]",
            border_style="blue",
        ))
        console.print()

    def format_for_display(self, request: ApprovalRequest) -> Panel:
        """Format as Rich Panel."""
        tool = request.tool
        risk_color = self._get_risk_color(tool.risk_level)

        content = f"""[bold]INTENT:[/] {tool.intent}

[bold]EXPLANATION:[/] {tool.human_explanation}

[bold]RISK LEVEL:[/] [{risk_color}]{tool.risk_level.value}[/{risk_color}]
[bold]RISK REASONING:[/] {tool.risk_reasoning}

[bold]CAPABILITIES:[/] {', '.join(tool.capabilities_used) or 'none'}
[bold]AUTH SCOPES:[/] {', '.join(tool.requested_scopes) or 'none'}"""

        if request.existing_tools_considered:
            content += f"\n\n[dim]Existing tools considered: {', '.join(request.existing_tools_considered)}[/]"
            content += f"\n[dim]Why new tool: {request.why_new_tool_needed}[/]"

        return Panel(
            content,
            title=f"[bold]Synth Tool Approval Request [{risk_color}]{tool.risk_level.value}[/{risk_color}][/]",
            border_style=risk_color,
        )

    def _get_risk_color(self, risk: RiskLevel) -> str:
        """Get color for risk level."""
        return {
            RiskLevel.LOW: "green",
            RiskLevel.MEDIUM: "yellow",
            RiskLevel.HIGH: "red",
            RiskLevel.CRITICAL: "bold red",
        }.get(risk, "white")


def get_llm_client(
    provider: str = "openagentic",
    base_url: str | None = None,
    model: str | None = None,
    region: str | None = None,
    project_id: str | None = None,
):
    """Get an LLM client based on provider selection."""
    from synth.core.llm import create_llm_client

    kwargs: dict[str, Any] = {}

    if provider == "anthropic":
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            console.print("[red]Error: ANTHROPIC_API_KEY not set[/]")
            console.print("[dim]Set it with: export ANTHROPIC_API_KEY=your-key[/]")
            raise typer.Exit(1)
        kwargs["api_key"] = api_key
        if base_url:
            kwargs["base_url"] = base_url

    elif provider == "bedrock":
        if region:
            kwargs["region"] = region

    elif provider == "vertex":
        if region:
            kwargs["region"] = region
        if project_id:
            kwargs["project_id"] = project_id

    elif provider == "ollama":
        kwargs["base_url"] = base_url or os.environ.get("OLLAMA_HOST", "http://localhost:11434")

    elif provider == "openagentic":
        kwargs["base_url"] = base_url or os.environ.get(
            "OPENAGENTIC_API_URL", "https://chat-dev.openagentic.io"
        )
        api_key = os.environ.get("OPENAGENTIC_API_KEY")
        if api_key:
            kwargs["api_key"] = api_key

    elif provider == "openai":
        if not base_url:
            console.print("[red]Error: --base-url required for openai provider[/]")
            raise typer.Exit(1)
        kwargs["base_url"] = base_url
        api_key = os.environ.get("OPENAI_API_KEY")
        if api_key:
            kwargs["api_key"] = api_key

    if model:
        kwargs["model"] = model

    try:
        return create_llm_client(provider, **kwargs)
    except Exception as e:
        console.print(f"[red]Error creating LLM client: {e}[/]")
        raise typer.Exit(1) from e


def setup_credentials() -> CredentialProvider:
    """Set up credential provider from environment."""
    creds = CredentialProvider()

    # Register common credential mappings
    credential_mappings = {
        "github:read": "GITHUB_TOKEN",
        "github:write": "GITHUB_TOKEN",
        "github:repo:read": "GITHUB_TOKEN",
        "github:repo:write": "GITHUB_TOKEN",
        "github:issues:read": "GITHUB_TOKEN",
        "github:issues:write": "GITHUB_TOKEN",
        "github:pull_requests:read": "GITHUB_TOKEN",
        "github:pull_requests:write": "GITHUB_TOKEN",
        "github:user:read": "GITHUB_TOKEN",
        "github:notifications:read": "GITHUB_TOKEN",
        "slack:read": "SLACK_TOKEN",
        "slack:write": "SLACK_TOKEN",
        "slack:channels:read": "SLACK_TOKEN",
        "slack:chat:write": "SLACK_TOKEN",
        "stripe:customers:read": "STRIPE_API_KEY",
        "stripe:customers:write": "STRIPE_API_KEY",
        "stripe:charges:read": "STRIPE_API_KEY",
        "stripe:charges:write": "STRIPE_API_KEY",
        "stripe:payment_intents:read": "STRIPE_API_KEY",
        "stripe:payment_intents:write": "STRIPE_API_KEY",
        "stripe:subscriptions:read": "STRIPE_API_KEY",
        "stripe:subscriptions:write": "STRIPE_API_KEY",
        "stripe:invoices:read": "STRIPE_API_KEY",
        "stripe:invoices:write": "STRIPE_API_KEY",
        "stripe:refunds:write": "STRIPE_API_KEY",
        "stripe:checkout:write": "STRIPE_API_KEY",
        "postgres:query:read": "DATABASE_URL",
        "postgres:query:write": "DATABASE_URL",
        "postgres:ddl:write": "DATABASE_URL",
        "notion:pages:read": "NOTION_TOKEN",
        "notion:pages:write": "NOTION_TOKEN",
        "notion:databases:read": "NOTION_TOKEN",
        "notion:databases:write": "NOTION_TOKEN",
        "notion:blocks:read": "NOTION_TOKEN",
        "notion:blocks:write": "NOTION_TOKEN",
        "notion:comments:read": "NOTION_TOKEN",
        "notion:comments:write": "NOTION_TOKEN",
        "notion:users:read": "NOTION_TOKEN",
        # Atlassian — token is primary; site+email also flow ambiently via executor cloud_vars
        "jira:issues:read": "ATLASSIAN_API_TOKEN",
        "jira:issues:write": "ATLASSIAN_API_TOKEN",
        "jira:projects:read": "ATLASSIAN_API_TOKEN",
        "jira:transitions:write": "ATLASSIAN_API_TOKEN",
        "confluence:pages:read": "ATLASSIAN_API_TOKEN",
        "confluence:pages:write": "ATLASSIAN_API_TOKEN",
        "confluence:spaces:read": "ATLASSIAN_API_TOKEN",
        # Linear
        "linear:issues:read": "LINEAR_API_KEY",
        "linear:issues:write": "LINEAR_API_KEY",
        "linear:projects:read": "LINEAR_API_KEY",
        "linear:projects:write": "LINEAR_API_KEY",
        "linear:teams:read": "LINEAR_API_KEY",
        "linear:cycles:read": "LINEAR_API_KEY",
        "linear:comments:write": "LINEAR_API_KEY",
        # Sentry
        "sentry:issues:read": "SENTRY_AUTH_TOKEN",
        "sentry:issues:write": "SENTRY_AUTH_TOKEN",
        "sentry:events:read": "SENTRY_AUTH_TOKEN",
        "sentry:releases:read": "SENTRY_AUTH_TOKEN",
        "sentry:releases:write": "SENTRY_AUTH_TOKEN",
        "sentry:projects:read": "SENTRY_AUTH_TOKEN",
        # Vector DBs — register per backend; LLM picks one
        "vector:read": "PINECONE_API_KEY",
        "vector:write": "PINECONE_API_KEY",
        "vector:admin": "PINECONE_API_KEY",
        # Kubernetes uses ambient KUBECONFIG (executor cloud_vars); no mapping needed
        # Browser uses ambient BROWSER_PROFILE_DIR; no mapping needed
        # Email covers Gmail OAuth + SMTP/IMAP — all flow ambiently via executor cloud_vars
        "http:get": None,  # No creds needed
        "http:post": None,
        "http:put": None,
        "http:delete": None,
    }

    for scope, env_var in credential_mappings.items():
        if env_var:
            creds.register_credential(scope, env_var)

    return creds


@app.command()
def tool(
    intent: str = typer.Argument(..., help="Natural language description of what you want to do"),
    capabilities: list[str] = typer.Option(  # noqa: B008  (Typer requires call-in-default)
        [],
        "--capabilities", "-c",
        help="Capabilities to use (repeatable, e.g. -c aws -c github)",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Only show synthesized code, don't execute",
    ),
    show_code: bool = typer.Option(
        False,
        "--show-code",
        help="Automatically show code before approval prompt",
    ),
    provider: str = typer.Option(
        "openagentic",
        "--provider", "-p",
        help="LLM provider: openagentic, anthropic, bedrock, vertex, ollama, openai",
    ),
    base_url: str = typer.Option(
        None,
        "--base-url",
        help="Base URL for the LLM API (e.g., http://hal:11434 for Ollama)",
    ),
    model: str = typer.Option(
        None,
        "--model", "-m",
        help="Model to use for synthesis (default depends on provider)",
    ),
    region: str = typer.Option(
        None,
        "--region",
        help="Cloud region (for bedrock/vertex providers)",
    ),
    project_id: str = typer.Option(
        None,
        "--project-id",
        help="GCP project ID (for vertex provider)",
    ),
    redact: bool = typer.Option(
        False,
        "--redact",
        help="Redact sensitive data (AWS keys, IPs, tokens) from output",
    ),
    hitl_mode: str = typer.Option(
        "auto",
        "--hitl-mode",
        help="HITL approval handler: auto (default), cli (Rich prompt), openclaw (route through OpenClaw gateway)",
    ),
) -> None:
    """
    Synthesize and execute a one-shot tool from natural language intent.

    Examples:
        # OpenAgentic Platform (default)
        synth tool "list all S3 buckets"

        # AWS Bedrock (uses IAM credentials)
        synth tool "get my AWS bill" --provider bedrock

        # Google Vertex AI (uses ADC)
        synth tool "list GCS buckets" --provider vertex --project-id my-project

        # Ollama (local or remote)
        synth tool "check disk usage" --provider ollama --base-url http://hal:11434 --model qwen2.5:32b

        # Anthropic
        synth tool "find open GitHub issues" --provider anthropic

        # Dry run (see code without executing)
        synth tool "fetch weather data" --dry-run
    """
    asyncio.run(_synth_async(  # pragma: no cover
        intent, capabilities, dry_run, show_code, provider, base_url, model, region, project_id, redact, hitl_mode,
    ))


async def _synth_async(
    intent: str,
    capabilities: list[str],
    dry_run: bool,
    show_code: bool,
    provider: str,
    base_url: str | None,
    model: str | None,
    region: str | None = None,
    project_id: str | None = None,
    redact: bool = False,
    hitl_mode: str = "auto",
) -> None:
    """Async implementation of synth command."""
    console.print(Panel(f"[bold blue]Synthesizing tool for:[/] {intent}"))

    # Step 1: Load capabilities
    with console.status("[bold green]Loading capabilities..."):
        registry = load_builtin_capabilities()

    # Build capability filter — support both -c aws -c github and -c aws,github
    cap_filter: list[str] | None = None
    if capabilities:
        cap_filter = []
        for c in capabilities:
            cap_filter.extend(x.strip() for x in c.split(","))
        console.print(f"[dim]Using capabilities: {', '.join(cap_filter)}[/]")

    # Step 2: Get LLM client
    try:
        llm = get_llm_client(
            provider=provider, base_url=base_url, model=model,
            region=region, project_id=project_id,
        )
        console.print(f"[dim]Using provider: {provider}, model: {llm.model}[/]")
    except typer.Exit:
        return

    # Step 3: Create synthesizer
    synthesizer = Synthesizer(
        llm_client=llm,
        capability_registry=registry,
    )

    # Step 4: Synthesize
    console.print()
    with console.status(f"[bold green]Synthesizing tool with {provider}..."):
        try:
            tool = await synthesizer.synthesize(
                intent,
                allowed_capabilities=cap_filter,
            )
        except Exception as e:
            console.print(f"[red]Synthesis failed: {e}[/]")
            raise typer.Exit(1) from e

    if tool is None:
        console.print("[yellow]Existing tools can handle this intent - no synthesis needed[/]")
        return

    console.print(f"[green]Tool synthesized![/] ID: [dim]{tool.id}[/]")

    # Dry run - just show the tool
    if dry_run:
        console.print()
        console.print(Panel(
            Syntax(tool.code, "python", theme="monokai", line_numbers=True),
            title="[bold]Synthesized Code (dry run)[/]",
            border_style="blue",
        ))
        console.print()
        console.print(f"[bold]Risk Level:[/] {tool.risk_level.value}")
        console.print(f"[bold]Explanation:[/] {tool.human_explanation}")
        return

    # Step 5: HITL Approval — pick handler based on explicit flag or auto-detection.
    if hitl_mode == "openclaw":
        handler: ApprovalHandler = OpenClawApprovalHandler()
        console.print("[dim]Using OpenClaw approval handler (chat-button flow)[/]")
    elif hitl_mode == "cli":
        handler = RichApprovalHandler(auto_view_code=show_code)
    else:  # auto
        if should_use_openclaw_handler():
            handler = OpenClawApprovalHandler()
            console.print("[dim]Auto-detected OpenClaw — routing approval through gateway[/]")
        else:
            handler = RichApprovalHandler(auto_view_code=show_code)
    gate = HITLGate(handler=handler)

    decision = await gate.submit_for_approval(tool)

    if not decision.approved:
        console.print()
        console.print("[yellow]Tool execution denied.[/]")
        if decision.reason:
            console.print(f"[dim]Reason: {decision.reason}[/]")
        return

    # Step 6: Install sandbox dependencies and execute
    # Collect packages from requested capabilities
    requested_caps = cap_filter or registry.get_names()
    packages_needed: set[str] = set()
    for cap_name in requested_caps:
        cap = registry.get(cap_name)
        if cap and hasattr(cap, "packages"):
            packages_needed.update(cap.packages)

    if packages_needed:
        console.print(f"[dim]Installing sandbox deps: {', '.join(sorted(packages_needed))}[/]")
        with console.status("[bold green]Installing dependencies..."):
            # Package names originate from the YAML capability registry shipped
            # with synth — no user-controlled input. `sys.executable` is a
            # full absolute path. No shell interpolation. shell=False by default.
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "pip", "install", "-q",
                "--break-system-packages", *sorted(packages_needed),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate()

    console.print()
    with console.status("[bold green]Executing tool in sandbox..."):
        creds = setup_credentials()
        executor = Executor(
            config=SandboxConfig(timeout_seconds=60),
            credential_provider=creds,
            capability_registry=registry,
        )
        output = await executor.execute(tool)

    # Step 7: Apply redaction if requested
    redactor = None
    if redact:
        from synth.core.redaction import Redactor
        redactor = Redactor()
        output.result = redactor.redact_any(output.result)
        if output.stdout:
            output.stdout = redactor.redact(output.stdout)
        if output.stderr:
            output.stderr = redactor.redact(output.stderr)
        if output.error:
            output.error = redactor.redact(output.error)

    # Step 8: Show results
    console.print()
    if output.success:
        redact_note = ""
        if redactor and redactor.redaction_count > 0:
            redact_note = f"\n[dim yellow]🔒 {redactor.redaction_count} sensitive value(s) redacted[/]"

        console.print(Panel(
            f"[green]Execution successful![/]\n\n"
            f"[bold]Result:[/]\n{_format_result(output.result)}\n\n"
            f"[dim]Execution time: {output.execution_time_ms}ms[/]"
            f"{redact_note}",
            title="[bold green]Tool Output[/]",
            border_style="green",
        ))

        if output.stdout:
            console.print()
            console.print("[dim]stdout:[/]")
            console.print(output.stdout)
        if output.stderr:
            console.print()
            console.print("[dim]stderr:[/]")
            console.print(output.stderr)
    else:
        console.print(Panel(
            f"[red]Execution failed![/]\n\n"
            f"[bold]Error:[/] {output.error}\n\n"
            f"[dim]Execution time: {output.execution_time_ms}ms[/]",
            title="[bold red]Tool Error[/]",
            border_style="red",
        ))

        if output.stderr:
            console.print()
            console.print("[dim]stderr:[/]")
            console.print(output.stderr)


def _format_result(result) -> str:
    """Format result for display."""
    if result is None:
        return "[dim]No result[/]"

    import json
    try:
        if isinstance(result, (dict, list)):
            return json.dumps(result, indent=2, default=str)
        return str(result)
    except Exception:
        return str(result)


@app.command()
def caps(
    action: str = typer.Argument(
        "list",
        help="Action: list, show <name>",
    ),
    name: str = typer.Argument(None, help="Capability name for 'show'"),
) -> None:
    """
    Manage capabilities.

    Examples:
        synth caps list
        synth caps show github
    """
    registry = load_builtin_capabilities()

    if action == "list":
        table = Table(title="Available Capabilities")
        table.add_column("Name", style="cyan")
        table.add_column("Auth", style="yellow")
        table.add_column("Description", style="dim")

        for cap in registry.get_all():
            auth_str = cap.auth.type.value if cap.auth else "none"
            desc = cap.description.split("\n")[0][:50]
            table.add_row(cap.name, auth_str, desc)

        console.print(table)

    elif action == "show" and name:
        cap = registry.get(name)
        if not cap:
            console.print(f"[red]Capability '{name}' not found[/]")
            raise typer.Exit(1)

        content = f"""[bold]Name:[/] {cap.name}

[bold]Description:[/]
{cap.description}

[bold]Auth Type:[/] {cap.auth.type.value if cap.auth else 'none'}"""

        if cap.auth and cap.auth.scopes:
            content += f"\n[bold]Scopes:[/] {', '.join(cap.auth.scopes)}"
        if cap.auth and cap.auth.token_env_var:
            content += f"\n[bold]Token Env Var:[/] {cap.auth.token_env_var}"
        if cap.allowed_domains:
            content += f"\n[bold]Allowed Domains:[/] {', '.join(cap.allowed_domains)}"
        if cap.sdk_import:
            content += f"\n[bold]SDK Import:[/] {cap.sdk_import}"
        if cap.hitl_risks:
            content += "\n\n[bold]HITL risks:[/]"
            for risk in cap.hitl_risks:
                content += f"\n  • {risk}"

        console.print(Panel(content, title=f"[bold]Capability: {name}[/]"))

    else:
        console.print("[red]Unknown action. Use: list, show <name>[/]")


@app.command()
def history(
    limit: int = typer.Option(10, "--limit", "-n", help="Number of entries to show"),
) -> None:
    """
    View execution history.

    Examples:
        synth history
        synth history --limit 5
    """
    console.print("[yellow]Execution history not yet implemented[/]")
    console.print("[dim]History will be stored in ~/.synth/history.json[/]")


@app.command()
def version() -> None:
    """Show Synth version."""
    console.print(f"[bold]Synth[/] v{__version__}")
    console.print("[dim]Code synthesis with HITL approval and auth injection[/]")


def main() -> None:
    """Entry point."""
    app()


if __name__ == "__main__":
    main()
