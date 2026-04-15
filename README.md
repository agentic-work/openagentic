# openagentic

**Open-source agentic work platform** — build, orchestrate, and run production-grade AI agents with full control over providers, tools, and infrastructure.

> ⚠️ **Early access** — this repo is currently private while we prepare the first public release. Interfaces, docs, and setup flow are actively changing.

## Highlights

- **Multi-provider LLM routing** — Anthropic, OpenAI, Azure OpenAI, AWS Bedrock, Google, Ollama, and local models, with priority + fallback.
- **Agents + flows + code mode** — chat agents, visual flow builder, and a sandboxed IDE mode for agents that write and run code.
- **MCP-native** — first-class Model Context Protocol support, with a proxy and a set of built-in servers.
- **Built to ship** — Helm chart, Argo CD-friendly layout, per-user sandbox containers, observability hooks, pluggable auth.

## Repo layout

```
services/        # platform services (API, UI, workflows, MCP proxy, sandboxes, ...)
helm/openagentic # Helm chart (templates)
companions/      # placeholder for sibling repos at build time (SDK, OAT, etc.)
.github/         # CI workflows + PR/issue templates
```

See [`CLAUDE.md`](./CLAUDE.md) for a service-level map and local dev quickstart.

## Status

Private preview. Issues and PRs will open once the public release lands. For now, you can reach the maintainers at **support@openagentics.io**.

## License

[Apache-2.0](./LICENSE) © OpenAgentic
