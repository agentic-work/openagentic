# OpenAgentic Guide

**OpenAgentic** is an open-source, self-hosted agentic platform for IT operations. It gives you chat, visual ops **Flows**, RAG and memory, and an admin console — backed by first-party MCP servers that *actually touch* your AWS, Azure, GCP, Kubernetes, Prometheus, Loki, GitHub, and the web. It is model-agnostic (run local **Ollama** or plug in cloud providers), authenticates against a local user store, and ships **zero telemetry** — nothing about your infrastructure leaves the box. This guide takes a technical operator from a clean machine to a running, audited, production-grade deployment.

---

## Quick start

```bash
# Docker Compose — the fastest path to a running stack
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash
docker compose --profile milvus up -d
```

Then open the UI at **http://localhost:8080** and log in as the seeded admin (`admin@openagentic.local`; the generated password is written to `~/.openagentic/admin-credentials.txt`).

> **`--profile milvus` is required.** The API connects to Milvus on boot and exits if it cannot reach it — a bare `docker compose up` will crashloop the API. Both `install.sh` and the wizard always pass the flag; if you bring the stack up by hand, you must too.

Other install paths: `… | bash -s -- --helm` (Kubernetes via Helm), `… | bash -s -- --wizard` (interactive Ink TUI), or `./install.sh --env <path>` to reuse a known-good `.env`. See **[Installation](03-installation.md)** for all of them.

> **Pre-launch note.** While the repository is private the `curl … | bash` URL 404s. Clone the repo you have access to and run `./install.sh` from the checkout — the installer auto-detects a local checkout and builds locally.

---

## Contents

| # | Section | What's inside |
|---|---|---|
| 01 | **[Overview](01-overview.md)** | What OpenAgentic is, who it's for, the value proposition, the open-source boundary, and what a session looks like. |
| 02 | **[Architecture](02-architecture.md)** | The services on the `oap` network, the V2 discovery-mode chat pipeline, the SmartModelRouter, sub-agent dispatch, the Flows engine, and inter-service auth. |
| 03 | **[Installation](03-installation.md)** | The three install paths (Compose, Helm, wizard), `install.sh` modes, prerequisites, first-boot behavior, and installing from a local checkout. |
| 04 | **[Configuration](04-configuration.md)** | Every environment variable that matters — required secrets, Ollama/Milvus/RAG settings, per-MCP toggles, cloud-credential mounts, and the Helm values that mirror them. |
| 05 | **[LLM Providers & Models](05-providers-and-models.md)** | The provider adapters, the always-on Smart Router, the role/registry model, boot seeders, embeddings, and image generation — with no hardcoded model IDs. |
| 06 | **[MCP Servers](06-mcp-servers.md)** | The nine built-in MCP servers (AWS, Azure, GCP, Kubernetes, Prometheus, Loki, GitHub, Admin, Web), how each authenticates, the on/off switches, and the SSRF/namespace guardrails. |
| 07 | **[Chat & Artifacts](07-chat-and-artifacts.md)** | The chat streaming endpoint, the T1 meta-tools, `compose_visual`/`compose_app`/`render_artifact`, the sandboxed iframe model, and the human approval gate + audit trail. |
| 08 | **[Flows & Workflows](08-flows.md)** | The visual Flows canvas and engine, the 71 node types, the seeded templates, the cron scheduler, the AI Flow Builder, and the human-in-the-loop approval/input gates. |
| 09 | **[Admin Console](09-admin-console.md)** | The v3 admin portal — dashboard, Prometheus analytics, MCP Fleet, providers and model registry, the two audit surfaces, tool permissions, and prompt governance. |
| 10 | **[Security & Compliance Posture](10-security.md)** | Password/JWT/API-key handling, inter-service auth, no-weak-secret-defaults, the artifact sandbox, SSRF guards, the immutable audit chain, zero-telemetry enforcement, and the NIST 800-53 control framing. |
| 11 | **[API Reference](11-api-reference.md)** | The base URL, Swagger/OpenAPI, auth headers, chat streaming (NDJSON), the OpenAI-compatible endpoints, workflows, system config, and the admin API surface. |
| 12 | **[Operations & Troubleshooting](12-operations.md)** | Health checks, updates and rollbacks, secret rotation, the first-boot landmines and their fixes, backups, scaling, and logs. |

---

## Reading order

- **New here?** Start with **[Overview](01-overview.md)**, then **[Installation](03-installation.md)**.
- **Standing up a deployment?** **[Installation](03-installation.md)** → **[Configuration](04-configuration.md)** → **[Operations](12-operations.md)**.
- **Evaluating capability?** **[MCP Servers](06-mcp-servers.md)**, **[Chat & Artifacts](07-chat-and-artifacts.md)**, and **[Flows & Workflows](08-flows.md)**.
- **Security review?** **[Security & Compliance Posture](10-security.md)** and the [zero-telemetry proof](../zero-telemetry.md).
- **Integrating?** **[API Reference](11-api-reference.md)** and **[LLM Providers & Models](05-providers-and-models.md)**.

---

*OpenAgentic **v1.0** ("Open Field") · Open-source edition · Licensed **Apache-2.0** · © **Agenticwork™ LLC** · **Zero telemetry** — no phone-home, no beacons, ever ([proof](../zero-telemetry.md)). Local-auth single-user edition; SSO / directory integration is an enterprise concern.*
