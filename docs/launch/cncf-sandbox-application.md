# CNCF Sandbox Application — openagentic

> Draft for submission to the CNCF Sandbox via the TOC's project onboarding process.
> Answers the standard Sandbox application prompts. Working draft — not yet submitted.

---

## Project name

**openagentic**

## Project description (what it is)

openagentic is a self-hosted, zero-telemetry, model-agnostic platform for building and
running production AI agents that operate real cloud-native infrastructure. It is a full
operations platform — chat, a visual ops Flow builder, RAG/memory, and admin dashboards —
backed by 14 bundled Model Context Protocol (MCP) servers that actually touch AWS,
Kubernetes, Prometheus, Loki, Alertmanager, GitHub, and more.

The canonical use case is AI-assisted operations and incident response. An alert fires;
openagentic queries Prometheus, Loki, and `kubectl` **in parallel**; produces a root-cause
narrative *with the supporting evidence*; and proposes a remediation **behind a human
approval gate**. An operator clicks Approve, the action executes, and an immutable audit-log
entry is written. The entire loop runs on the operator's own laptop or cluster, against
their own model endpoint (e.g. a local Ollama), with **zero data leaving the box**.

openagentic is the open-source, self-hosted alternative to the closed-SaaS AI-SRE products
that require you to ship your infrastructure logs and metrics to a vendor. Here, your data
never leaves your boundary.

## The problem it solves

Platform and SRE teams in sovereignty-bound organizations — DORA-regulated banks,
PHI/healthcare, government, EU/NIS2 — are increasingly forbidden from sending infrastructure
telemetry to a third-party SaaS AI. The existing options force a bad trade:

- **Closed cross-domain AI-SRE SaaS** (the well-funded incumbents) deliver an integrated
  experience but ingest your logs and metrics into their cloud. That is a non-starter under
  data-sovereignty rules.
- **Open-source point tools** (k8sgpt, HolmesGPT, kagent, Robusta) are self-hostable and
  Kubernetes-native, but each is scoped to a slice of the problem. None ship an integrated
  UI, a visual Flow builder, RAG/memory, multi-cloud reach, and a write-approval + audit
  trust layer as one platform.

openagentic fills that gap: the **integrated, self-hostable platform** that combines the
cross-domain reach of the SaaS incumbents with the data-sovereignty posture of the OSS point
tools — installable with one `docker compose up` (or a Helm chart), forkable, and auditable.

## How it relates to CNCF and cloud-native

openagentic is cloud-native by construction and integrates directly with the CNCF ecosystem:

- **Kubernetes-native.** Ships a Helm chart (`helm/openagentic`) for in-cluster deployment.
  A bundled Kubernetes MCP drives `kubectl`-equivalent operations through the approval +
  audit layer.
- **Built on the observability stack the community already runs.** First-class MCPs for
  **Prometheus**, **Loki**, and **Alertmanager** — openagentic reasons over the same metrics
  and logs your existing cloud-native observability stack already produces.
- **OpenTelemetry-aware.** Optional OTel/OTLP tracing of agent and LLM activity, **off by
  default**, and when enabled it exports only to the operator's own collector — never to a
  vendor.
- **Model Context Protocol (MCP) as the tool layer.** Capabilities are exposed as MCP
  servers (14 bundled: aws, azure, gcp, kubernetes, prometheus, loki, alertmanager, github,
  admin, agent-architect, incident, knowledge, runbook, web), an emerging open standard for
  agent–tool interoperability.
- **Composes with — does not replace — CNCF Sandbox neighbors.** k8sgpt, HolmesGPT, kagent,
  and Robusta each solve a focused part of the AI-for-Kubernetes problem; openagentic is the
  integrated operator-facing **platform** layer (chat + Flows + RAG + dashboards + multi-cloud
  + the trust controls) that those point tools can sit alongside or feed into. We see
  ourselves as a complement to that cohort, not a competitor to any one of them.

## The trust model (why operators can run it on real infra)

The differentiators are infrastructure-level, not prompt-level:

- **Human approval on every write.** The agent investigates and recommends; mutating actions
  require explicit operator approval before execution.
- **Immutable audit log.** Every approved action is recorded; the default sink is local
  stdout, with optional operator-configured sinks (their own Datadog/Splunk/S3 — opt-in,
  their credentials).
- **Scoped egress proxy.** Agent tool calls route through an egress proxy that blocks
  cloud-metadata endpoints and private-range SSRF targets.

We deliberately do **not** promise autonomous auto-healing. The honest answer to "what if the
AI deletes our prod database?" is: it investigates, it recommends, and writes are
human-approved and audited.

## Zero telemetry / data sovereignty

The server does not phone home. There is no analytics SDK, no usage or install beacon, and no
license/update-check call. Every outbound network path is either localhost, a
user-configured endpoint (the operator's own model/MCP/OTLP collector), or a cloud-provider
API the product exists to operate — driven by the operator's own credentials. Observability
exporters ship **default-off**. This is enforced in CI by source-regression tests, not just a
README promise.

## License

**Apache License 2.0** — confirmed in the repository [`LICENSE`](../../LICENSE) file and the
[`NOTICE`](../../NOTICE) file. Copyright Agenticwork™ LLC.

**Commitment:** openagentic is and will remain licensed under Apache-2.0. The project will
**not** be relicensed to a non-OSI / source-available license (no BSL, SSPL, or
"Commons Clause"-style restriction). This is a standing commitment to the community and to
the CNCF.

This satisfies the CNCF requirement that Sandbox projects use an OSI-approved license, with
Apache-2.0 being the CNCF-preferred default.

## Open-core boundary (no in-product paywall)

The OSS core is complete and free forever. There is **no in-product paywall, 402 wall,
lock-screen, or feature nag** — everything that ships in this repository is fully functional.
A separate commercial **Agenticwork™ Enterprise** edition (managed hosting, support, and
additional governance/policy capabilities) is offered off-repo at agenticwork.io. The OSS
project's scope, governance, and Apache-2.0 license are independent of, and never gated by,
that commercial offering. The relationship follows the well-understood community-edition
model (n8n, GitLab CE/EE).

## Current state / maturity

- **Stage requested:** Sandbox.
- **Codebase:** an integrated multi-service platform — platform API, React UI, workflow/Flow
  engine, MCP proxy, egress proxy, and 14 bundled MCP servers.
- **Install paths:** one-line `docker compose` installer with a guided TUI wizard, plus a
  Helm chart for Kubernetes.
- **Quality gates:** Vitest source-regression / "architecture cage" test suites (including a
  no-telemetry guard and SSRF/egress allow-list guards) and an OSS-integrity CI workflow.
- **Public release:** preparing the first public GitHub release; this application is part of
  that launch.

## Why Sandbox (and why now)

Sandbox is the right entry point: openagentic is early in its public life, building its
community and contributor base, and seeking a neutral, vendor-independent home that signals
to sovereignty-bound adopters that the project is a true open-source commons rather than an
open-core funnel controlled by a single vendor's roadmap.

Joining the CNCF Sandbox would:

1. Affirm the project's neutrality and its standing Apache-2.0 commitment to a community that
   is, by definition, allergic to vendor lock-in.
2. Place openagentic alongside the AI-for-cloud-native cohort already in the Sandbox
   (k8sgpt, HolmesGPT, kagent, Robusta) as the **integrated platform** layer of that
   landscape.
3. Open a clear path toward broader contributor governance as adoption grows.

## Sponsors / maintainers

> Placeholder — to be completed before submission.

- **Initial maintainer / primary author:** agentic-work (Agenticwork™ LLC).
- **TOC sponsor(s):** _TBD — to be secured prior to submission._
- **Initial committers / governance:** _TBD — maintainer list, `MAINTAINERS.md`, and a
  contributor-governance doc to be added; current process files in the repo:
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`._
- **Code of Conduct:** the project will adopt the CNCF Code of Conduct.

## Repository / links

- **Source:** https://github.com/agentic-work/openagentic
- **License:** Apache-2.0 (`LICENSE`, `NOTICE`)
- **Docs:** openagentics.io
- **Commercial edition + support (optional, off-repo):** agenticwork.io

## Standard Sandbox checklist (self-assessment)

- [x] OSI-approved license (Apache-2.0).
- [x] Cloud-native relevance (Kubernetes, Prometheus, Loki, Alertmanager, OpenTelemetry, MCP).
- [x] Public source repository with build/install instructions.
- [x] Code of Conduct (CNCF CoC to be adopted) + `CONTRIBUTING.md` + `SECURITY.md`.
- [ ] TOC sponsor secured — _pending_.
- [ ] `MAINTAINERS.md` / governance doc and IP/trademark transfer terms reviewed — _pending_.

---

_Backed by Agenticwork™ — the open-source openagentic platform is Apache-2.0 and free
forever; managed hosting + enterprise support are available at agenticwork.io._
