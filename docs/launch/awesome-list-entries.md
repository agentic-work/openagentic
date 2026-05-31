# Awesome-list entries (staged, ready to PR)

Each entry below is a one-line submission to an external `awesome-*` list. Match
the target list's exact Markdown format and alphabetical ordering when you open
the PR. Repo URL is always `https://github.com/agentic-work/openagentic`.
License is **Apache-2.0** (confirmed in `LICENSE`). Self-hosted, zero-telemetry,
model-agnostic. Do not paste secrets or internal hostnames into any submission.

---

## awesome-selfhosted

**Belongs in:** the `### Automation` section (self-hosted automation / AI-ops
platforms). If a maintainer prefers, `### Monitoring` is the fallback.

awesome-selfhosted format is:
`- [Name](url) - Description. ([Demo](...), [Source Code](...)) \`License\` \`Language\``

```markdown
- [OpenAgentic](https://github.com/agentic-work/openagentic) - Self-hosted, zero-telemetry AIOps platform: chat + visual ops flows + RAG/memory + admin dashboards, with 14 bundled MCPs that actually touch AWS, Kubernetes, Prometheus, Loki and GitHub. Every write goes behind a human-approval gate with an immutable audit log. `Apache-2.0` `TypeScript`
```

---

## awesome-ai-agents

**Belongs in:** the open-source / self-hostable "Agents" or "Frameworks &
Platforms" section (whichever the target fork uses — many `awesome-ai-agents`
lists split **Closed-source** vs **Open-source**; this goes under Open-source).

Typical format: `- **[Name](url)** - Description.`

```markdown
- **[OpenAgentic](https://github.com/agentic-work/openagentic)** - Open-source, self-hosted agentic ops platform you can `docker compose up` on your own hardware. Bring your own model (Ollama, Anthropic, OpenAI, Azure, Vertex); 14 built-in MCP tools for AWS/K8s/Prometheus/Loki/GitHub; human-approval gates + immutable audit log on every write. Apache-2.0, no phone-home.
```

---

## awesome-ai-sre

**Belongs in:** the "Open Source" / "Self-hosted Tools" section (as opposed to
the Commercial / SaaS AI-SRE listings).

Typical format: `- [Name](url) - Description.`

```markdown
- [OpenAgentic](https://github.com/agentic-work/openagentic) - The open-source, self-hosted alternative to the closed SaaS AI-SRE — your data never leaves the box. An alert fires and it queries Prometheus, Loki and kubectl in parallel, returns a root-cause narrative with the evidence, and proposes a fix behind a human-approval gate before it ever executes. Apache-2.0, zero telemetry.
```

---

## awesome-mcp-servers

**Belongs in:** the "Aggregators" / "Frameworks" section (OpenAgentic ships a
fleet of MCP servers plus an MCP proxy, rather than being a single server). If
the target list has no aggregator bucket, file under "Cloud Platforms".

awesome-mcp-servers commonly prefixes entries with emoji legend tags for
language and scope, e.g. `- [name](url) 🎖️ 🏷️ ☁️ - Description.`
(🎖️ official-grade / 📇 TypeScript / ☁️ cloud service). Drop the emoji if the
target fork doesn't use them.

```markdown
- [OpenAgentic](https://github.com/agentic-work/openagentic) 📇 ☁️ - Self-hosted bundle of 14 MCP servers (AWS, Azure, GCP, Kubernetes, Prometheus, Loki, Alertmanager, GitHub, and more) plus an MCP proxy and full chat/flows/RAG UI. Scoped egress proxy, human-approval write gates, Apache-2.0.
```

---

### Notes for whoever opens these PRs

- All four descriptions are deliberately consistent on the wedge: **self-hosted,
  zero-telemetry, model-agnostic, full ops platform** with **human-approval +
  immutable audit log** as the trust moat. Do not promise autonomous
  auto-healing — the honest framing is investigate + recommend + human-approved
  writes.
- Keep the license tag as `Apache-2.0` everywhere; it matches `LICENSE`/`NOTICE`.
- Trim each description to the host list's length norm if a maintainer asks;
  the lead clause (positioning) is the load-bearing part — keep it.
- Attribution on the PR is **agentic-work**. No AI co-author trailers.
