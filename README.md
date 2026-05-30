# openagentic

**The open-source agentic platform for IT.** Build, operate, and automate your entire stack with AI agents — chat and visual flows, with your own models, MCP servers, and clouds.

> 🛠️ **Early access** — interfaces move fast. Star the repo to follow along.

## Install in one line

```bash
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash
```

That's it. You'll get an interactive wizard that walks through:
1. Pick a deploy target (Docker or Kubernetes)
2. Create your admin account
3. Point at an Ollama host
4. Optionally paste LLM provider keys (Anthropic / OpenAI / Azure / Google — all optional)
5. Review and launch

Then it spins up the stack and opens `http://localhost:8080` in your browser.

### What you get

| Pillar | Who uses it |
|---|---|
| **Chat** — multi-provider, persistent history, semantic search | CIOs, managers, anyone who wants AI with context |
| **Flows** — visual agent runbooks with 16 bundled ops MCPs | Architects, SREs, platform engineers |

Everything runs on your infrastructure, against your providers. No data leaves your box unless you point it at a cloud model.

### The 16 pre-wired MCP servers

AWS, Azure, Azure Cost, GCP, Kubernetes, Prometheus, Loki, Alertmanager, GitHub, Admin, Agent Architect, Code, Incident, Knowledge, Runbook, Web.

All disabled by default — enable what you need from the admin panel and the agent will route tool calls through them semantically (Milvus-indexed by description).

## Prerequisites

- **Docker** + **Docker Compose v2** ([install](https://docs.docker.com/get-docker/))
- **Node.js 20+** (for the setup wizard — [install](https://nodejs.org/))
- **An Ollama host** with at least one embedding model (e.g. `nomic-embed-text`) — can be local or remote
- ~8 GB RAM, ~20 GB disk for the default stack

## Manual / power-user install

Prefer to run things yourself?

```bash
git clone https://github.com/agentic-work/openagentic ~/.openagentic
cd ~/.openagentic
cp .env.example .env
# edit .env with your admin email, password, OLLAMA_HOST, etc.
docker compose up -d
open http://localhost:8080
```

For Kubernetes, point `helm/openagentic` at your cluster once the chart cleanup lands.

## Repo layout

```
install.sh               ← the one-liner entry
tools/setup/             ← Ink TUI wizard
services/                ← openagentic-{api,ui,workflows,mcp-proxy,proxy,synth,server}
services/mcps/oap-*-mcp  ← the 16 bundled MCP servers
helm/openagentic/        ← Helm chart
docker-compose.yml       ← single-node stack
```

See [`CLAUDE.md`](./CLAUDE.md) for a service-level map and conventions.

## Want managed?

[agenticwork.io](https://agenticwork.io) runs openagentic for you with
multi-tenant, SSO, audit logs, FedRAMP/HIPAA controls, and a managed
model fleet. The hosted edition uses the same chat + flows surface; the
OSS edition is what you'd self-host. Some `/api/admin/*` routes return
402 with an upgrade link — that's intentional and keeps the OSS install
free.

## Demos

Short gifs in [`./demos/`](./demos/), recorded against a live install:

- [`install-setup.gif`](./demos/install-setup.gif) — `./install.sh` Ink wizard end-to-end (deploy target → admin → providers → MCPs → review → launch)
- [`chat.gif`](./demos/chat.gif) — log in, send a message, see the streamed reply (claude haiku via the registry)
- [`flows.gif`](./demos/flows.gif) — open Flows, browse the included general templates
- [`code-mode.gif`](./demos/code-mode.gif) — Code Mode wizard → xterm terminal with Claude Code running
- [`mcp-fleet.gif`](./demos/mcp-fleet.gif) — admin MCP Fleet → **Import JSON** → paste a Claude-Desktop-format config → registered
- [`dashboard.gif`](./demos/dashboard.gif) — admin Dashboard with live counts + the enterprise-edition upsell on the analytics tabs
- [`about.gif`](./demos/about.gif) — Settings & more → About (static service versions + agenticwork.io links)

The install gif is recorded via [vhs](https://github.com/charmbracelet/vhs)
(tape at [`tests/demos/install-setup.tape`](./tests/demos/install-setup.tape));
the rest are Playwright recordings (scripts under `tests/demos-pw/`).

## Contributing

Outside contributions are welcome. The fastest path:

1. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev loop, what's
   in scope, and the conventions we follow on review.
2. Open an issue first for anything bigger than a bug fix — saves a
   round-trip on scope.
3. Run the local checklist from CONTRIBUTING.md before opening a PR.
   `main` is protected — all changes land via PR with maintainer
   approval. The only PR-time check is `oss-integrity`; everything
   else (lint, typecheck, wizard harness) runs locally.

By contributing you agree your changes are licensed under Apache-2.0.

See also [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## License

[Apache-2.0](./LICENSE) © Gnomus.ai
