# openagentic

Open-source agentic work platform.

## What this repo is

The OSS upstream of the OpenAgentic platform — services for building, orchestrating, and running production-grade AI agents with full control over providers, tools, and infrastructure.

**Status:** private while we cut the first public release. A lot of work is still in flight on the internal upstream.

## Services

| Service | Purpose |
|---|---|
| `services/openagentic-api` | Platform API: chat, flows, providers, RAG, admin |
| `services/openagentic-ui` | React UI (chat, flows, admin, code mode) |
| `services/openagentic-workflows` | Workflow engine (Flowise-derived) |
| `services/openagentic-mcp-proxy` | MCP server proxy |
| `services/openagentic-manager` | Sandboxed dev-environment orchestration |
| `services/openagentic-exec` | Per-user exec container (VSCode + tools) |
| `services/openagentic-server` | Openagentic CLI bridge |
| `services/openagentic-proxy` | Egress proxy for agent tool calls |
| `services/openagentic-synth` | OAT (tool-synthesis framework) runner |
| `services/mcps/*` | Built-in MCP servers (aws, azure, admin, ...) |
| `services/sdk` | Workspace package for shared SDK usage |
| `services/shared` | Cross-service types / utilities |
| `services/ollama` | Local Ollama bring-your-own-models config |

Top-level `helm/openagentic` is the platform Helm chart (templates only — env-specific values live in downstream deployment repos, not here).

## Local dev

Most services use pnpm workspaces. From the repo root:

```bash
pnpm install
pnpm -r build
pnpm -r dev  # services each have their own dev scripts
```

Individual services have their own `README.md` / `CLAUDE.md` for deeper context.

## Sync model

This repo receives synced source from the internal upstream. **Do not edit `services/**` with the expectation of it surviving a sync — edits need to land upstream first. When the platform is fully open-sourced, this repo becomes the source of truth and the internal upstream goes away.**

## Conventions

- No hardcoded model IDs in source outside of provider adapters + seeders (see `services/openagentic-api/src/services/llm-providers/`).
- No hardcoded deployment / tenant / registry strings. Everything environment-specific flows via env vars or Helm values.
- No secrets in code or in this repo. The `.githooks/pre-commit` script blocks known secret patterns.
- Prefer editing existing files over creating new ones.
