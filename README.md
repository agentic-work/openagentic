# openagentic

**Self-hosted AIOps. Your models, your tools, your infra.**

Chat and visual flows wired into the stuff you actually run — AWS, Azure,
GCP, Kubernetes, Prometheus, Loki, Alertmanager, GitHub. Bring your own
LLM (Ollama, Anthropic, OpenAI, Azure, Vertex). Nothing leaves the box
unless you point it at a cloud model.

If you're an SRE/platform engineer who's been waiting for an agentic
ops platform you can `docker compose up -d` on your own hardware and
hack on — this is for you. Fork it, change it, ship it. Apache-2.0.

---

## Install in one line

```bash
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash
```

That's the **quick path** — probes Ollama on `localhost:11434`, pulls the
embed + chat model if missing, generates random admin / postgres / JWT
creds, brings the stack up, and opens your browser auto-logged-in.

Want a careful walk-through (provider keys, MCP picks, Helm)?

```bash
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash -s -- --wizard
```

The wizard is an Ink TUI that writes a `.env` you can commit + re-use
on the next box with `./install.sh --env path/to/.env`.

## What you get

- **Chat** — multi-provider, persistent history, semantic search over
  your previous conversations and uploaded docs
- **Flows** — visual agent runbooks. Drag-drop nodes, branching, tool
  calls, RAG, the whole bit
- **15 first-party MCP servers** out of the box (see below)
- **Bring-your-own LLM** — Ollama for free local, or plug in Anthropic /
  OpenAI / Azure OpenAI / Vertex AI keys
- **Bring-your-own MCPs** — paste any Claude-Desktop-format JSON config
  into the admin panel and `mcp-proxy` installs + indexes it, after
  which the agent can semantically route to its tools
- **All on your box** — docker-compose for single-node, Helm chart for
  k8s. No phone-home, no telemetry, no usage caps

## The 15 bundled MCPs

| Cloud | Ops | Knowledge / Meta |
|---|---|---|
| AWS, Azure, Azure Cost, GCP | Kubernetes, Prometheus, Loki, Alertmanager | Web, Knowledge (RAG), GitHub |
| | Incident, Runbook | Admin, Agent Architect |

All disabled by default — enable what you need from the admin panel.
The agent routes calls semantically (Milvus-indexed by description), so
you can have all 15 active and it'll still pick the right one.

## Prerequisites

- **Docker** + **Docker Compose v2** ([install](https://docs.docker.com/get-docker/))
- **Node.js 20+** (only the wizard needs it — skip if you use `--env`)
- **An Ollama host** with at least one embedding model — local or remote.
  The quick path will auto-pull `nomic-embed-text` + a default chat model
  for you if Ollama is on `localhost:11434`
- ~8 GB RAM, ~20 GB disk for the default stack

## Manual install (if you don't like curl-pipe-bash)

```bash
git clone https://github.com/agentic-work/openagentic ~/.openagentic
cd ~/.openagentic
cp .env.example .env
# edit .env — admin email/password, OLLAMA_HOST, optional provider keys
docker compose up -d
# wait ~90s for openagentic-api to go healthy
open http://localhost:8080
```

For Kubernetes: the Helm chart lives at `helm/openagentic/`. The
docker-compose path is what's wired through the install wizard today;
Helm is a power-user path until the wizard support lands.

## Repo layout

```
install.sh               ← one-liner entry
tools/setup/             ← Ink TUI wizard
services/openagentic-api ← Fastify API (chat, flows, providers, RAG, admin)
services/openagentic-ui  ← React UI
services/openagentic-workflows  ← Flowise-derived workflow engine
services/openagentic-mcp-proxy  ← MCP server proxy (spawns built-ins)
services/mcps/oap-*-mcp  ← the 15 bundled MCP servers
helm/openagentic/        ← Helm chart
docker-compose.yml       ← single-node stack
```

See [`CLAUDE.md`](./CLAUDE.md) for the service-level map.

## Want to take this and run with it?

That's the whole point. Fork it, slap your own brand on it, run it on
prem, sell it to your customers — Apache-2.0 means you can. The OSS
edition is the complete chat + flows + MCP routing surface. There are
no time bombs, no feature flags that flip you back to "demo mode",
no calling home.

Some `/api/admin/*` routes return **402 Payment Required** with a link
to [agenticwork.io](https://agenticwork.io) — chargeback dashboards,
DLP rules, multi-tenant SSO, audit logs, FedRAMP/HIPAA controls. That
keeps the OSS install free and lets us fund continued development.
Everything else is yours.

## Want managed?

- **[agenticwork.io](https://agenticwork.io)** — the hosted edition.
  Multi-tenant, SSO/SAML, audit logs, managed model fleet, FedRAMP/HIPAA.
  Same chat + flows surface as OSS; we run it for you.
- **[openagentics.io](https://openagentics.io)** — community, docs,
  releases, the changelog.

## Demos

Short gifs in [`./demos/`](./demos/), recorded against a live install:

- [`install-setup.gif`](./demos/install-setup.gif) — `./install.sh` end-to-end
- [`chat.gif`](./demos/chat.gif) — log in, send a message, streamed reply
- [`flows.gif`](./demos/flows.gif) — open Flows, browse the bundled templates
- [`code-mode.gif`](./demos/code-mode.gif) — Code Mode → xterm terminal with Claude Code
- [`mcp-fleet.gif`](./demos/mcp-fleet.gif) — admin → MCP Fleet → paste a JSON config → registered
- [`dashboard.gif`](./demos/dashboard.gif) — admin dashboard with live counts
- [`about.gif`](./demos/about.gif) — Settings → About

## Contributing

Outside contributions welcome — the project is much better with more
eyes on it.

1. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev loop and
   the conventions we follow on review.
2. Open an issue first for anything bigger than a bug fix.
3. Run the local checklist from CONTRIBUTING.md before opening a PR.
   `main` is protected — all changes land via PR with maintainer
   approval. The only PR-time CI is `oss-integrity`; everything else
   (lint, typecheck, wizard harness) runs locally.

By contributing you agree your changes are licensed under Apache-2.0.

See also [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## License

[Apache-2.0](./LICENSE) © Gnomus.ai
