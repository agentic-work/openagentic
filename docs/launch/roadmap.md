# openagentic roadmap

A public, living view of where the project is headed. Dates are
intentionally absent — this is a direction document, not a commitment
calendar. Things move; the order is the signal.

The bar for everything below is the same as everything that already
ships: **runs on your box, your models, your creds, nothing phones home,
every write stays behind a human approval gate with an immutable audit
trail.** We don't ship autonomy we wouldn't run against our own prod.

---

## Now — shipping today

These are in `main` and work on a fresh `docker compose up -d`:

- **Chat** — multi-provider, persistent history, semantic search over
  past conversations and uploaded docs (RAG + memory).
- **Flows** — visual agent runbooks: drag-drop nodes, branching, tool
  calls, RAG, the whole thing.
- **9 first-party MCP servers** — AWS, Azure, GCP, Kubernetes,
  Prometheus, Loki, GitHub, admin, web. All disabled by default; semantically
  routed (Milvus-indexed) so all 9 can be active at once.
- **Bring-your-own everything** — any Ollama / Anthropic / OpenAI / Azure
  OpenAI / Vertex model; any Claude-Desktop-format MCP config pasted into
  the admin panel.
- **The trust moat** — human approval on every write, immutable local
  audit log, scoped egress proxy for tool calls. Infra-level, not
  prompt-level.
- **Two deploy paths** — single-node docker-compose (wired through the
  install wizard) and a Helm chart for Kubernetes.

The hero loop already works end-to-end: an alert fires, the agent
queries Prometheus + Loki + kubectl **in parallel**, writes a root-cause
narrative **with the evidence**, proposes a fix behind an **approval
gate**, and on Approve executes it and writes an **audit-log entry** —
all on your laptop, against your own Ollama, with zero data leaving the
box.

## Next — what we're building

Focused on making the ops loop above faster to adopt and broader in
reach. Roughly in priority order:

- **Three ops Flow templates, shipped in the box** — opinionated
  starting points so you're not staring at a blank canvas:
  1. *Alert triage* — alert in → parallel Prometheus + Loki + kubectl →
     root-cause narrative with evidence → approval-gated remediation.
  2. *Deploy / rollout watch* — correlate a rollout with error-rate and
     latency, recommend (not auto-execute) a rollback behind approval.
  3. *Cost / capacity sweep* — read-only walk of cluster + cloud usage
     into a summarized report.
- **More read-first data-source MCPs** — extend the fleet outward to
  where teams already keep their signals:
  - **Grafana** (dashboards / annotations, read)
  - **Datadog** (metrics + logs, **read-only**)
  - **Elasticsearch / OpenSearch** (log + event search)
  - **PagerDuty** (incident context + on-call, read)

  New write-capable surfaces land behind the same approval gate as
  everything else; read connectors stay read-only by design.
- **MCP gallery** — a browsable, one-click-enable catalog inside the
  admin panel for both the first-party fleet and pasted third-party
  configs, with the semantic-routing index built automatically on add.

## Later — directional

Bigger bets we're committed to in spirit but not yet scheduling:

- **Managed-cloud convenience** — optional, never required. The
  self-hosted edition stays complete and free. This is purely a "I don't
  want to run the box myself" door, not a capability gate.
- **Deeper governance for regulated teams** — richer approval policies,
  signed / exportable audit trails, finer-grained scoping of what an
  agent may touch. Built so a DORA / PHI / gov / NIS2 operator can audit
  and fork it.
- **Broader Flow + MCP ecosystem** — community-contributed templates and
  connectors, with the same trust posture as the first-party fleet.

We are deliberately **not** promising autonomous auto-healing. The honest
answer to "what if the AI deletes prod?" is: it investigates,
recommends, and writes only what a human approved — and every write is in
the audit log.

---

## Free OSS core vs. the commercial edition

To be precise about the line, because we'd rather over-disclose than
surprise anyone:

**The OSS core (this repo, Apache-2.0) is complete and free forever.**
Everything documented above under *Now* — and the bulk of *Next* — lives
here, fully working, no strings. No paywalls, no locked admin screens, no
402 walls, no "demo mode" flag, no usage caps, no calling home. Fork it,
rebrand it, run it on prem, ship it to your own customers. That's the
license and that's the intent.

**Agenticwork™ ([agenticwork.io](https://agenticwork.io)) is a separate,
entirely optional commercial edition + support offering** — for teams
that would rather buy hardened, supported, managed capabilities than
operate and extend the box themselves. Think advanced
monitoring/reporting, multi-tenant chargeback, integration and
network/webhook-security policy consoles, managed DLP policy packs,
rate-limit tiers, SLAs and support. It funds the open core; it never
gates it. If a feature is in this repo, it stays in this repo.

The relationship is the familiar open-core split (n8n, GitLab CE↔EE): the
free edition is genuinely the product, and the commercial edition is for
people whose constraints make "buy it managed and supported" the better
trade than "run and own it yourself."

---

*This roadmap reflects current direction and will change. Open an issue
if there's something here you want pulled forward — outside eyes on
priorities are welcome.*

Apache-2.0 © Agenticwork™ LLC
