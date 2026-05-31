<div align="center">

# ⌥ openagentic

### The open-source, self-hosted alternative to the $1B AI-SRE — your data never leaves.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-FF5722.svg)](./LICENSE)
[![Zero telemetry](https://img.shields.io/badge/telemetry-zero-18130C.svg)](./docs/zero-telemetry.md)
[![Self-hosted](https://img.shields.io/badge/self--hosted-docker%20%7C%20helm-FF5722.svg)](#quickstart)

</div>

---

<div align="center">

![Incident root-cause analysis, end to end](./demos/incident-rca.gif)

*Alert fires → openagentic queries Prometheus + Loki + kubectl **in parallel** → root-cause narrative **with the evidence** → proposes a fix behind a **human approval gate** → you click Approve → it executes → an **immutable audit-log** entry. 60 seconds, on your laptop, your own Ollama, nothing leaving the box.*

</div>

---

## Why

Every credible AI-SRE today is closed SaaS that wants to **ingest your infra logs** to do its job. If you run a DORA-regulated bank, anything touching PHI, a government system, or anything under EU/NIS2, you are often *legally forbidden* from shipping those logs to someone else's model — and you're watching the observability bill climb at the same time.

openagentic is the wedge nobody else ships self-hostable: a **full ops platform** — chat + visual ops **Flows** + **RAG/memory** + **admin dashboards** — whose **14 MCPs actually touch** AWS, Kubernetes, Prometheus, and Loki. The open point tools (HolmesGPT, k8sgpt, kagent) have no UI, no Flows, no RAG. The cross-domain agents (Cleric, Resolve.ai, the cloud-vendor agents) are closed SaaS that ingest your data.

This is one `docker compose up` box you can **fork, audit, and run on your own hardware**. Model-agnostic. **Zero telemetry.** Your data never leaves.

> **For:** the platform / SRE lead at a sovereignty-bound org who wants an AI ops platform they can self-host, audit, and trust — and who is done with both the compliance risk and the bill-shock of SaaS.

## Quickstart

**Docker Compose** — single-node, the quick path. Probes Ollama on `localhost:11434`, pulls the embed + chat model if missing, generates random admin / postgres / JWT creds, brings the stack up, and opens your browser auto-logged-in:

```bash
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash
```

**Kubernetes (Helm)** — same one-liner, `--helm`. Runs `helm upgrade --install openagentic ./helm/openagentic` into the `openagentic` namespace:

```bash
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash -s -- --helm
```

Want a careful walk-through (provider keys, MCP picks)? Add `--wizard` — an Ink TUI that writes a `.env` you can commit and re-use on the next box with `./install.sh --env path/to/.env`.

<details>
<summary><b>Prerequisites + manual install</b></summary>

- **Docker** + **Docker Compose v2** ([install](https://docs.docker.com/get-docker/)) — or **Helm + kubectl** for the k8s path
- **Node.js 20+** (only the wizard needs it — skip if you use `--env`)
- **An Ollama host** with at least one embedding model — local or remote. The quick path auto-pulls `nomic-embed-text` + a default chat model if Ollama is on `localhost:11434`
- ~8 GB RAM, ~20 GB disk for the default stack

```bash
git clone https://github.com/agentic-work/openagentic ~/.openagentic
cd ~/.openagentic
cp .env.example .env          # admin email/password, OLLAMA_HOST, optional provider keys
docker compose up -d          # wait ~90s for openagentic-api to go healthy
open http://localhost:8080
```

The Helm chart lives at [`helm/openagentic/`](./helm/openagentic/) for the manual k8s path.

</details>

## What's inside

- **Chat** — multi-provider, persistent history, semantic search over your past conversations and uploaded docs.
- **Ops Flows** — visual agent runbooks. Drag-drop nodes, branching, tool calls, RAG — the whole loop, on a canvas.
- **RAG + memory** — Milvus-backed knowledge and per-user memory that survives across sessions.
- **Admin dashboards** — live Prometheus-driven analytics on usage, cost, and model behavior. In-box, never phoned home.
- **14 first-party MCP servers** — and they *do things*:

  | Cloud | Ops | Knowledge / Meta |
  |---|---|---|
  | AWS · Azure · GCP | Kubernetes · Prometheus · Loki · Alertmanager | Web · Knowledge (RAG) · GitHub |
  | | Incident · Runbook | Admin · Agent Architect |

  All disabled by default. The agent routes calls **semantically** (Milvus-indexed by description), so you can have all 14 active and it still picks the right one. Paste any Claude-Desktop-format JSON config into the admin panel and `mcp-proxy` installs + indexes your own MCPs too.

- **Bring your own model** — Ollama for free local inference, or plug in Anthropic / OpenAI / Azure OpenAI / Vertex AI keys.

### The trust moat

This is infra-level, not prompt-level:

- **Human approval on every write.** The agent investigates and *recommends*; nothing that mutates your infra runs until you click Approve.
- **Immutable audit log.** Every action — proposed and executed — lands in an append-only record.
- **Scoped egress proxy.** Tool calls leave through a controlled, auditable path.

The honest answer to *"what if the AI deletes our prod DB?"* is: it doesn't get to. It investigates, recommends, and waits for a human. We don't promise autonomous auto-healing — we promise control.

## Self-host, forever free

The OSS core is **clean, complete, and free forever**. No paywalls, no locked admin screens, no 402 walls, no "demo mode" flags, no usage caps, no calling home. Everything that ships is yours — Apache-2.0 means fork it, rebrand it, run it on prem, ship it to your customers.

### Backed by Agenticwork™

openagentic is built and maintained by **Agenticwork™ LLC**. If you want the commercial edition — advanced chargeback & monitoring, integrations, rate-limit tiers, network- and webhook-security hardening, managed DLP policy, and support with an SLA — there's an **enterprise edition & support** at **[agenticwork.io](https://agenticwork.io)**. Entirely optional. The self-hosted edition here is complete and stays that way.

## Links

- **[openagentics.io](https://openagentics.io)** — docs, releases, changelog.
- **[agenticwork.io](https://agenticwork.io)** — enterprise edition & support.
- **[Zero-telemetry proof](./docs/zero-telemetry.md)** — what we checked, and how to verify it yourself.
- **[`CLAUDE.md`](./CLAUDE.md)** — the service-level architecture map.

## Contributing

Outside contributions welcome — the project is much better with more eyes on it.

1. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev loop and review conventions.
2. Open an issue first for anything bigger than a bug fix.
3. Run the local checklist before opening a PR. `main` is protected — changes land via PR with maintainer approval. The only PR-time CI is `oss-integrity`; lint, typecheck, and the wizard harness run locally.

By contributing you agree your changes are licensed under Apache-2.0. See also [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## License

[Apache-2.0](./LICENSE) © Agenticwork™ LLC
