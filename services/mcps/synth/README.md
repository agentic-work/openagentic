<p align="center">
  <img src="https://storage.googleapis.com/agenticwork-cdn/synth/synth-banner.png" alt="Synth — On-demand Agent Tooling" />
</p>

<p align="center">
  <strong>Code synthesis for agents. HITL-gated. Auth-injected.</strong>
</p>

<p align="center">
  <a href="https://github.com/agentic-work/synth/actions"><img src="https://img.shields.io/github/actions/workflow/status/agentic-work/synth/ci.yml?style=flat-square&label=CI" alt="CI" /></a>
  <img src="https://img.shields.io/badge/python-3.11%2B-blue?style=flat-square" alt="Python 3.11+" />
</p>

<p align="center">
  <a href="https://synth.agenticwork.io">Website</a> &bull;
  <a href="https://synth.agenticwork.io">Docs</a> &bull;
  <a href="https://agenticwork.io">AgenticWork Platform</a> &bull;
  <a href="https://github.com/agentic-work/synth/discussions">Discussions</a>
</p>

---

## What is Synth?

**Synth turns natural-language intent into bespoke, single-use Python code.** The LLM writes the tool you need for the request you made, grades its own risk, and hands it off for your review. Approved tools run in a sandbox with the exact credentials the declared scopes require — and nothing else. Tools are discarded after execution; no schema debt, no registry bloat.

Three pillars:

1. **Code synthesis** — one-shot Python tools generated per request, then thrown away.
2. **HITL required** — a mandatory human-in-the-loop approval gate for every tool. No bypass flag exists.
3. **Auth injection** — scoped credentials are plumbed into the sandbox at execution time from environment variables the capability declares. The LLM never sees your tokens; the human reviewer sees which scopes will be granted.

---

## See it in action

One command, three APIs, one second. AWS Cost Explorer + IAM audit + GitHub repos queried **in parallel** via `asyncio.gather`, formatted into a unified ASCII dashboard. Sensitive data automatically redacted with `--redact`.

<p align="center">
  <img src="https://storage.googleapis.com/agenticwork-cdn/synth/demo-1-executive-dashboard.gif" alt="Synth synthesizing a parallel multi-API executive dashboard with AWS costs, IAM audit, and GitHub repos" />
</p>

---

## Install

Synth requires **Python 3.11 or newer**. `pipx` is recommended so the CLI lives in its own isolated environment.

### Linux

```bash
# 1. Ensure Python 3.11+ is present
sudo apt install -y python3.11 python3.11-venv python3-pip   # Debian/Ubuntu
# — or —
sudo dnf install -y python3.11                               # Fedora/RHEL

# 2. Recommended: pipx for isolated install
python3 -m pip install --user pipx
python3 -m pipx ensurepath

# 3. Install Synth from source
git clone https://github.com/agentic-work/synth.git
cd synth
pipx install -e .
# — or, without pipx —
pip install --user -e .
```

### macOS

```bash
# 1. Ensure Python 3.11+ is present (Homebrew)
brew install python@3.12 pipx
pipx ensurepath

# 2. Install Synth from source
git clone https://github.com/agentic-work/synth.git
cd synth
pipx install -e .
```

Restart your shell (or `source ~/.bashrc` / `source ~/.zshrc`) so `synth` is on `PATH`, then verify:

```bash
synth version
synth caps      # list built-in capabilities
```

## Quick start

Pick a provider and go:


```bash
# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...
synth tool "list all S3 buckets in my AWS account" --provider anthropic

# AWS Bedrock (uses ambient IAM credentials)
synth tool "get my AWS bill for this month" --provider bedrock

# Ollama (local or remote, fully air-gapped)
synth tool "check disk usage" --provider ollama --base-url http://localhost:11434 --model qwen2.5:32b

# AgenticWork Platform
export AGENTICWORK_API_KEY=your-key
synth tool "list all S3 buckets in my AWS account"

# Dry run — see the synthesized code without executing
synth tool "get my AWS bill for this month" --dry-run
```

Scope what the LLM can access with `-c`:

```bash
synth tool "get AWS costs and post summary to Slack" -c aws -c slack
synth tool "find stale GitHub repos" -c github
synth tool "fetch the weather for NYC" -c http
```

Redact secrets from output:

```bash
synth tool "list IAM users with access keys" -c aws --redact
```

---

## Use as an MCP server

Synth ships an MCP server (stdio transport) so MCP hosts like Claude Code can
synthesize and run one-shot tools. **Synthesis never auto-executes code** — see
the HITL flow below.

<!-- mcp-name: io.github.agentic-work/synth -->

Add it to your host's `mcpServers` config:

```json
{
  "mcpServers": {
    "synth": {
      "command": "python",
      "args": ["-m", "synth.mcp.server"],
      "env": {
        "SYNTH_PROVIDER": "ollama",
        "SYNTH_BASE_URL": "http://localhost:11434"
      }
    }
  }
}
```

(Or `"command": "uvx", "args": ["synth-mcp"]` once published.)

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `SYNTH_PROVIDER` | `ollama` | LLM backend: `ollama`, `bedrock`, `anthropic`, `agenticwork`, `openai` |
| `SYNTH_BASE_URL` | `http://localhost:11434` | LLM base URL (defaults to a local Ollama) |
| `SYNTH_MODEL` | provider default | Model id for synthesis |
| `SYNTH_API_KEY` | — | Provider API key (secret), when the backend needs one |
| `AWS_REGION` | `us-east-1` | Region for the `bedrock` provider |

### Tools

| Tool | Effect | Annotation |
|---|---|---|
| `synth_synthesize` | Generate code + self-graded risk from intent. **Does not execute.** | read-only |
| `synth_execute` | Run a synthesized tool in the sandbox — **only with `approve=true`**. | destructive |
| `synth_list_capabilities` | List available capabilities for synthesis. | read-only |

### HITL flow over MCP

A non-interactive stdio server has no terminal to prompt on, so the human gate
is enforced as a deliberate **two-call protocol** — the server never silently
runs LLM-authored code:

1. `synth_synthesize` returns the code + risk (read-only; nothing runs).
2. A human reviews the code and risk.
3. `synth_execute` runs it **only** when called with `approve=true`; otherwise
   it returns the pending approval request and executes nothing. `synth_execute`
   is annotated destructive so MCP hosts surface it for approval.

---

## How it works

```
Intent → Capabilities → LLM Synthesis → Human Approval → Sandbox Execution → Discard
```

1. **You describe what you want** in natural language
2. **Synth resolves capabilities** — which APIs, services, and credentials are available
3. **The LLM writes an async Python function** tailored to your request, using only the capabilities you've enabled
4. **You review everything** — the code, risk level, explanation, requested scopes — then approve or deny
5. **Approved tools execute in a sandbox** with scoped credentials and a timeout
6. **Tools are discarded after use** — no schema debt, no zombie tools, no tool registry bloat

The human-in-the-loop gate is mandatory and cannot be bypassed. Every synthesized tool is reviewed before execution.

---

## Python library

```python
import asyncio
from synth import CapabilityRegistry, Synthesizer, Executor, HITLGate
from synth.core.llm import create_llm_client
from synth.hitl.gate import CLIApprovalHandler

async def main():
    registry = CapabilityRegistry()
    registry.register_builtin("http", "github", "aws")

    client = create_llm_client("anthropic", api_key="your-key")
    synthesizer = Synthesizer(llm_client=client, capability_registry=registry)
    tool = await synthesizer.synthesize("get my AWS costs for the last 7 days by service")

    gate = HITLGate(handler=CLIApprovalHandler())
    decision = await gate.submit_for_approval(tool)

    if decision.approved:
        output = await Executor().execute(tool)
        print(output.result)

asyncio.run(main())
```

---

## Supported LLM providers

| Provider | Config | Notes |
|----------|--------|-------|
| **AgenticWork** (default) | `--provider agenticwork` | Platform model router, `AGENTICWORK_API_KEY` |
| **AWS Bedrock** | `--provider bedrock` | Claude on AWS, uses IAM credentials |
| **Google Vertex AI** | `--provider vertex --project-id my-project` | Gemini on GCP, uses ADC. `pip install -e '.[vertex]'` |
| **Ollama** | `--provider ollama --base-url http://host:11434` | Local/self-hosted, any GGUF model |
| **Anthropic** | `--provider anthropic` | Claude models, `ANTHROPIC_API_KEY` |
| **OpenAI-compatible** | `--provider openai --base-url https://your-api.com` | vLLM, LocalAI, Azure OpenAI, etc. |

---

## Built-in capabilities

| Capability | What it provides | Auth |
|-----------|-----------------|------|
| `http` | HTTP requests to any API (httpx) | none / bearer |
| `github` | GitHub REST API — repos, issues, PRs, notifications | `GITHUB_TOKEN` |
| `slack` | Slack Web API — messages, channels, users | `SLACK_TOKEN` |
| `stripe` | Stripe API — customers, charges, subscriptions, invoices, refunds | `STRIPE_API_KEY` |
| `postgres` | Postgres / Supabase / Neon / RDS — SQL + introspection | `DATABASE_URL` |
| `notion` | Notion API — pages, databases, blocks, comments | `NOTION_TOKEN` |
| `atlassian` | Jira + Confluence — issues, JQL, pages, spaces | `ATLASSIAN_SITE`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN` |
| `linear` | Linear GraphQL — issues, cycles, projects | `LINEAR_API_KEY` |
| `kubernetes` | kubectl-equivalent across KUBECONFIG contexts | ambient `KUBECONFIG` |
| `browser` | Playwright/Chromium — no-API long tail | ambient `BROWSER_PROFILE_DIR` |
| `sentry` | Issues, events, releases, performance | `SENTRY_AUTH_TOKEN` |
| `email` | Gmail (OAuth) or generic SMTP/IMAP | Google OAuth / `SMTP_URL`, `IMAP_URL` |
| `vector` | Pinecone / Qdrant / Weaviate / pgvector | backend-specific |
| `aws` | AWS via boto3 — S3, EC2, Lambda, Cost Explorer, CloudWatch | ambient IAM |
| `gcp` | Google Cloud — Storage, BigQuery, Compute, Billing | ambient ADC |
| `azure` | Azure — Blob Storage, Cosmos DB, Key Vault, Functions | ambient az |
| `filesystem` | Read/write local files (pathlib) | none |
| `shell` | Run shell commands (async subprocess) | none |
| `json` | Parse/transform JSON | none |
| `datetime` | Date/time with timezone support | none |
| `data` | Sort, filter, group, aggregate | none |

Every capability declares its own HITL risk annotations — the operations the reviewer should scrutinise (e.g. "any POST that moves money" for `stripe`, "DDL permanently alters schema" for `postgres`). Run `synth caps show <name>` to see them.

Add your own for internal APIs, databases, or any service:

```yaml
capabilities:
  - name: myapi
    description: Access the internal Acme API for order management
    auth:
      type: bearer
      token_env_var: ACME_API_TOKEN
    allowed_domains:
      - api.acme.internal
```

---

## Example workflows

```bash
synth tool "show my open PRs with failing CI" -c github
synth tool "get AWS spending for the last 30 days by service" -c aws
synth tool "list all GCS buckets and their sizes" -c gcp
synth tool "post deploy summary to #engineering" -c slack
synth tool "refund the last failed payment for customer cus_XXXXX" -c stripe
synth tool "count users who signed up this month" -c postgres
synth tool "create a release-notes page from the last 10 merged PRs" -c github -c notion
```

---

## Use in OpenClaw

Synth ships as an [OpenClaw](https://openclaw.ai) skill — so inside any chat running on OpenClaw (Telegram, Slack, Discord, the web console) you can say *"use synth to …"* and the host agent will dispatch. Approval still happens via OpenClaw's human-in-the-loop UI; credentials stay in OpenClaw's config and never appear in chat.

**Install the skill** (skill definition lives at `integrations/openclaw/synth/SKILL.md` in this repo):

```bash
# 1. Install the synth CLI first (see the Install section above)
synth version     # confirm it's on PATH — OpenClaw shells out to this binary

# 2. Register the skill with OpenClaw
mkdir -p ~/.openclaw/skills
ln -s "$(pwd)/integrations/openclaw/synth" ~/.openclaw/skills/synth

# 3. Tell OpenClaw which credentials synth may use
#    (edit ~/.openclaw/config.yaml)
skills:
  entries:
    synth:
      env:
        AGENTICWORK_API_KEY: "agw-..."      # or ANTHROPIC_API_KEY, BEDROCK via IAM, etc.
        GITHUB_TOKEN:        "ghp_..."
        AWS_ACCESS_KEY_ID:   "..."
        AWS_SECRET_ACCESS_KEY: "..."
        # …add only the scopes you want synth to be able to request

# 4. Restart OpenClaw and verify
openclaw skills list | grep synth
```

**Talk to it in chat:**

```
you › can you synth a tool that lists all my S3 buckets with their creation dates?
agent › synth tool "list all S3 buckets with creation date" -c aws
        [approval request appears in OpenClaw — one click to run]
        → 14 buckets, oldest 2019-06-22, newest 2026-04-12
```

The host agent picks the right `-c` scopes; the user only sees the approval card and the result. See [`integrations/openclaw/synth/SKILL.md`](integrations/openclaw/synth/SKILL.md) for the full skill spec, including when-to-use / when-not-to-use guidance the host agent follows.

---

## Use with the AgenticWork Platform

Synth is the open-source engine behind the [AgenticWork Platform](https://agenticwork.io). Running Synth against AgenticWork is the quickest path to a full no-infrastructure setup — no API key management, no sandbox to provision.

```bash
export AGENTICWORK_API_KEY=agw-...                 # from https://agenticwork.io
synth tool "list all my S3 buckets" -c aws         # default provider is 'agenticwork'
```

The platform layers on top of the CLI:

- **One-click OAuth** — connect GitHub, AWS, GCP, Azure, Slack, Jira through your browser
- **Credential vault** — encrypted, scoped, auto-rotated tokens
- **Web approval UI** — review and approve tools with one click
- **Server-side sandbox** — isolated container execution on managed infra
- **Team access controls** — role-based permissions across your org
- **Audit log** — every synthesis, approval, and execution is recorded

When you run `synth` with `AGENTICWORK_API_KEY` set, credentials for any `-c` scope are pulled from the platform's vault instead of your local env, and the approval gate surfaces in the AgenticWork web UI instead of your terminal — including on shared team workflows.

<p align="center">
  <a href="https://agenticwork.io"><strong>Try the AgenticWork Platform →</strong></a>
</p>

---

## Contributing

```bash
git clone https://github.com/agentic-work/synth.git
cd synth
pip install -e ".[dev]"

pytest                                    # Run tests
mypy synth/ --ignore-missing-imports      # Type check
ruff check synth/                         # Lint
```

All three must pass. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

[Apache License 2.0](LICENSE) — Copyright 2026 Agenticwork™ LLC.

---

<p align="center">
  <strong>Synth</strong> — Code synthesis with HITL approval and auth injection<br />
  <sub>Part of <a href="https://agenticwork.io">AgenticWork</a></sub>
</p>
