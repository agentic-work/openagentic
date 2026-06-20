<div align="center">

# ⌥ openagentic

### The open, self-hosted AI-SRE you run yourself — multi-cloud + Kubernetes + observability in one box, where every action is approval-gated and audit-logged, and your data and models never leave your network.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-FF5722.svg)](./LICENSE)
[![Zero telemetry](https://img.shields.io/badge/telemetry-zero-18130C.svg)](./docs/zero-telemetry.md)
[![Self-hosted](https://img.shields.io/badge/self--hosted-docker%20%7C%20helm-FF5722.svg)](#quickstart)

</div>

---

<div align="center">

![Chat with ops MCPs, end to end](./demos/chat.gif)

*Alert fires → openagentic queries Prometheus + Loki + kubectl **in parallel** → root-cause narrative **with the evidence** → proposes a fix behind a **human approval gate** → you click Approve → it executes → an **immutable audit-log** entry. 60 seconds, on your laptop, your own Ollama, nothing leaving the box.*

</div>

---

## Why not just Claude Code + a few MCP servers?

You *can* point a coding agent at a handful of ops MCP servers — but that gives you a single operator at a CLI with no controls. openagentic is the governed, multi-operator version of that idea, built for running real infrastructure:

- **Governance, at the infrastructure layer.** A **human-approval gate** sits on *every mutating tool call* — the agent investigates and recommends, but nothing that changes your infra runs until a human clicks Approve. Every tool call, proposed and executed, lands in an **immutable, hash-chained audit log**. This is enforced at the one seam every tool call passes through, so it can't be prompted around.
- **Repeatable incident runbooks as visual Flows.** Incident response shouldn't be ad-hoc prompting. **incident-triage**, **cost-anomaly**, and **failed-deploy RCA** ship as ready-to-run Flow templates, pre-wired to the Prometheus / Loki / Kubernetes / AWS MCPs.
- **A multi-operator web console, not a single CLI.** A shared platform with local accounts, an admin console, per-tool permissions, and the audit log a team can review together — rather than one terminal on one laptop.
- **Zero-egress, air-gappable self-hosting.** One `docker compose up` (or Helm) box you can **fork, audit, and run on your own hardware**. Local Ollama for inference, **zero telemetry**, no phone-home. Your data and your models never leave your network.

> **For:** the platform / SRE lead at a sovereignty-bound org who wants an AI ops platform they can self-host, audit, and trust — and who is done with both the compliance risk and the bill-shock of SaaS.

## Why

Every credible AI-SRE today is closed SaaS that wants to **ingest your infra logs** to do its job. If you run a DORA-regulated bank, anything touching PHI, a government system, or anything under EU/NIS2, you are often *legally forbidden* from shipping those logs to someone else's model — and you're watching the observability bill climb at the same time.

openagentic is the wedge nobody else ships self-hostable: an ops platform whose **MCPs actually touch** AWS, Azure, GCP, Kubernetes, Prometheus, and Loki, with governance built in. The open point tools (HolmesGPT, k8sgpt, kagent) have no approval gate, no Flows, no console. The cross-domain agents (Cleric, Resolve.ai, the cloud-vendor agents) are closed SaaS that ingest your data.

This is one box you can **fork, audit, and run on your own hardware**. Model-agnostic. **Zero telemetry.** Your data never leaves.

## Quickstart

**Docker Compose** — single-node, the quick path. Probes Ollama on `localhost:11434`, pulls the embed + chat model if missing, generates random admin / postgres / JWT creds, brings the stack up, and opens your browser auto-logged-in:

```bash
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash
```

> The `curl | bash` one-liners below are the **public-launch** install path. While the repo is still private, that URL 404s and prebuilt public images aren't published yet — clone the repo (see *Prerequisites + manual install*) and run `./install.sh` from the checkout instead.

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
git clone git@github.com:agentic-work/openagentic.git ~/.openagentic   # SSH — repo is private until launch
cd ~/.openagentic
cp .env.example .env          # set POSTGRES_PASSWORD (required), admin email/password, OLLAMA_HOST, optional provider keys
docker compose --profile milvus up -d   # the milvus profile (etcd/minio/milvus) is required for semantic tool search
open http://localhost:8080
```

> **The `milvus` profile is required.** etcd/minio/milvus are gated behind `--profile milvus`, and the API connects to Milvus on boot — it exits if it can't reach it — so always bring the stack up with `--profile milvus`. Until prebuilt public images are published, the first run **builds** every service image from source (a cold, multi-GB build), and images are amd64-only today.

The Helm chart lives at [`helm/openagentic/`](./helm/openagentic/) for the manual k8s path.

</details>

## What's inside

- **9 first-party MCP servers** — and they *do things*:

  | Cloud | Ops | Knowledge / Meta |
  |---|---|---|
  | AWS · Azure · GCP | Kubernetes · Prometheus · Loki | Web · GitHub · Admin |

  These are the MCPs the proxy actually wires (`mcp_manager.initialize_servers`). All disabled by default. The agent routes calls **semantically** (Milvus-indexed by description), so you can have all of them active and it still picks the right one. Paste any Claude-Desktop-format JSON config into the admin panel and `mcp-proxy` installs + indexes your own MCPs too.

- **Ops Flow templates** — **incident-triage**, **cost-anomaly**, and **failed-deploy RCA** ship as ready-to-run visual runbooks, pre-wired to the Prometheus / Loki / Kubernetes / AWS MCPs. Drag-drop nodes, branching, tool calls — the whole loop, on a canvas.

- **Governed by default.** Human approval on every mutating tool call, an immutable hash-chained audit log of everything proposed and executed, a scoped/SSRF-guarded egress path, and sandboxed artifact rendering — all enforced at the infrastructure layer, not the prompt. See the [Security & Compliance posture](./docs/guide/10-security.md) for the full model.

- **Bring your own models** — Ollama for free local inference, or plug in Anthropic / OpenAI / Azure OpenAI / AWS Bedrock / Google Vertex AI keys. Nothing is hardcoded; your models never leave your network unless you choose a hosted provider.

- **Also includes** — multi-provider chat with persistent history; Milvus-backed RAG + per-user memory; and live Prometheus-driven admin dashboards for usage, cost, and model behavior. All in-box, never phoned home.

## Self-host, forever free

The OSS core is **clean, complete, and free forever**. No paywalls, no locked admin screens, no 402 walls, no "demo mode" flags, no usage caps, no calling home. Everything that ships is yours — Apache-2.0 means fork it, rebrand it, run it on prem, ship it to your customers.

### Backed by Agenticwork™

openagentic is built and maintained by **Agenticwork™ LLC**. If you want the commercial edition — advanced chargeback & monitoring, integrations, rate-limit tiers, network- and webhook-security hardening, managed DLP policy, and support with an SLA — there's an **enterprise edition & support** at **[agenticwork.io](https://agenticwork.io)**. Entirely optional. The self-hosted edition here is complete and stays that way.

## Links

- **[openagentics.io](https://openagentics.io)** — docs, releases, changelog.
- **[agenticwork.io](https://agenticwork.io)** — enterprise edition & support.
- **[Zero-telemetry proof](./docs/zero-telemetry.md)** — what we checked, and how to verify it yourself.
- **[Architecture guide](./docs/guide/02-architecture.md)** — the service topology + request/data flow.

## Contributing

Outside contributions welcome — the project is much better with more eyes on it.

1. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev loop and review conventions.
2. Open an issue first for anything bigger than a bug fix.
3. Run the local checklist before opening a PR. `main` is protected — changes land via PR with maintainer approval. The only PR-time CI is `oss-integrity`; lint, typecheck, and the wizard harness run locally.

By contributing you agree your changes are licensed under Apache-2.0. See also [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## License

[Apache-2.0](./LICENSE) © Agenticwork™ LLC
