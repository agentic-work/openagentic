<div align="center">

# ⌥ openagentic

**The open, self-hosted AI ops platform you run yourself.** Multi-cloud, Kubernetes, and observability MCPs in one box — every action is approval-gated and audit-logged, and your data and models never leave your network.

[![CI](https://github.com/agentic-work/openagentic/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agentic-work/openagentic/actions/workflows/ci.yml)
[![OSS Sanity](https://github.com/agentic-work/openagentic/actions/workflows/oss-integrity.yml/badge.svg?branch=main)](https://github.com/agentic-work/openagentic/actions/workflows/oss-integrity.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-FF5722.svg)](./LICENSE)
[![Zero telemetry](https://img.shields.io/badge/telemetry-zero-18130C.svg)](./docs/zero-telemetry.md)
[![Self-hosted](https://img.shields.io/badge/self--hosted-docker%20%7C%20helm-FF5722.svg)](#quickstart)

</div>

---

## What you get

- **9 first-party MCP servers that actually do things** — AWS, Azure, GCP, Kubernetes, Prometheus, Loki, Web, GitHub, and Admin. All disabled by default; the agent routes tool calls semantically, so you can enable them all and it still picks the right one. Paste any Claude-Desktop-format JSON into the admin console to add your own.
- **A human-approval gate on mutating tool calls.** The agent investigates and recommends; changes to your infra wait for you to click Approve.
- **An append-only, hash-chained audit log** of every tool call proposed and executed, enforced at the application layer (the single seam all tool calls pass through). DB-level row-level-security and audit-immutability triggers ship as part of the hardened-deployment migration path.
- **Ops Flow templates** — incident-triage, cost-anomaly, and failed-deploy RCA as ready-to-run visual runbooks, pre-wired to the Prometheus / Loki / Kubernetes / AWS MCPs.
- **A self-hosted web console** — local admin account, per-tool permissions, multi-provider chat with history, RAG, per-user memory, and live Prometheus admin dashboards.
- **Bring your own models** — Ollama for free local inference, or plug in Anthropic / OpenAI / Azure OpenAI / AWS Bedrock / Google Vertex AI keys. No model IDs hardcoded.
- **Zero telemetry, no phone-home.** Apache-2.0 — fork it, audit it, run it on your own hardware.

> The OSS edition is single-operator and local-auth. Multi-user SSO and team RBAC are in the Enterprise edition at [agenticwork.io](https://agenticwork.io).

## Quickstart

**Docker Compose** — single-node. The installer probes Ollama on `localhost:11434`, pulls the embed + chat model if missing, generates random admin / postgres / JWT creds, brings the stack up (pgvector-only by default — no Milvus), and opens your browser auto-logged-in:

```bash
curl -sSL https://install.openagentics.io | bash
```

### Windows

In **Windows Terminal / PowerShell** (Docker Desktop + Node 20+ required):

```powershell
irm https://install.openagentics.io/install.ps1 | iex
```

Same flow as the bash installer: it fetches the pull-only compose bundle into `%USERPROFILE%\.openagentic`, runs the Ink TUI wizard, then brings the Compose stack up.

### From source

To run from a checkout (local development, or to audit before you run), clone and point the installer at it:

```bash
git clone https://github.com/agentic-work/openagentic.git ~/.openagentic
cd ~/.openagentic
./install.sh
```

**Kubernetes (Helm)** — run the same installer with `--helm`. It runs `helm upgrade --install openagentic ./helm/openagentic` into the `openagentic` namespace:

```bash
./install.sh --helm
```

Want a guided walk-through (provider keys, MCP picks)? Add `--wizard` — an Ink TUI that writes a reusable `.env`.

### Install options

`install.sh` accepts flags to bootstrap a cloud LLM provider at install time instead of (or alongside) local Ollama:

| Flag | Provider |
|------|----------|
| `--vertex` | Google Vertex AI (ADC by default, or `--vertex-key KEY`) |
| `--bedrock` | AWS Bedrock (`--aws-key` / `--aws-secret`, `--bedrock-model`) |
| `--openai` | OpenAI (`--openai-key`, `--openai-model`) |
| `--aif` | Azure AI Foundry (`--aif-endpoint` / `--aif-deployment` + key or Entra app) |
| `--huggingface` | Hugging Face Inference Endpoint / TGI (OpenAI-compatible) |

Run `./install.sh --help` for the full flag list and per-provider auth options.

<details>
<summary><b>Manual install</b></summary>

Requires **Docker + Docker Compose v2** (or **Helm + kubectl** for the k8s path), **Node 20+** for the wizard, and an **Ollama host** with at least one embedding model. ~8 GB RAM, ~20 GB disk for the default stack.

```bash
git clone git@github.com:agentic-work/openagentic.git ~/.openagentic
cd ~/.openagentic
cp .env.example .env             # set POSTGRES_PASSWORD (required), admin email/password, OLLAMA_HOST, optional provider keys
docker compose --profile ui up -d   # default: pgvector-only + web UI
open http://localhost:8080
```

Want it **headless** (no UI container — drive everything from the terminal with the [`oa`](tools/oa) CLI)? Drop the `ui` profile; the API is published on the host:

```bash
docker compose up -d             # API only, no UI container
oa login --instance http://localhost:8080
oa chat "which pods are crashlooping and why?"
```

The default is pgvector-only — Postgres + `pgvector` backs both RAG and semantic tool search. Milvus is optional, for large-scale embedding / RAG workloads:

```bash
MILVUS_ENABLED=true docker compose --profile milvus up -d
```

Published GHCR `:latest` images are multi-arch (linux/amd64 + linux/arm64). Until public images are published, the first local-checkout run builds every service image from source (a cold, multi-GB build).

</details>

## Architecture

See the [architecture guide](./docs/guide/02-architecture.md) for the service topology and how a chat turn flows through the system.

## Contributing

Outside contributions welcome. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev loop, open an issue first for anything bigger than a bug fix, and run the local checklist before opening a PR. `main` is protected — changes land via PR with maintainer approval. By contributing you agree your changes are licensed under Apache-2.0. See also [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## License

[Apache-2.0](./LICENSE) © Agenticwork™ LLC. See [`NOTICE`](./NOTICE) and [`TRADEMARK.md`](./TRADEMARK.md).
