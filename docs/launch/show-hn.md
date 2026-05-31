Title: Show HN: OpenAgentic — self-hosted, zero-telemetry AI ops platform (chat + flows + 14 cloud/k8s/observability MCPs)

URL: https://github.com/agentic-work/openagentic

---

Hi HN,

I spent a long stretch of my career as the person who gets paged. You know the
shape of it: an alert fires at 02:30, and the next twenty minutes are pure
manual fan-out. Tab one is Grafana. Tab two is `kubectl get pods -n prod` and
`kubectl logs --tail`. Tab three is Loki, hand-writing LogQL because you can't
remember the label you need. Tab four is the AWS console because maybe it's the
RDS failover again. You're the join engine, correlating four systems in your
head while the error budget burns. Most of that is not thinking — it's
retrieval and stitching. It's toil, and it's the toil that wakes you up.

The obvious move in 2026 is to point an LLM at it. And there are good products
doing exactly the cross-domain RCA loop — Cleric, Resolve.ai, the cloud
vendors' own SRE agents. Every one I could actually buy had the same
disqualifier for the orgs I care about: it's closed SaaS, and to do its job it
ingests your logs, your metrics, your kubectl output, your infra topology. If
you're a DORA-bound bank, a healthcare shop touching PHI, or anyone under
NIS2/EU sovereignty rules, you are simply not allowed to stream prod
observability data to someone else's inference endpoint. The exact teams with
the most painful on-call are the ones legally forbidden from using the tools
built to fix it.

There's good open source in the neighborhood — HolmesGPT, k8sgpt, kagent — but
they're point tools: a CLI or a single-domain diagnoser, no chat surface, no
visual flows, no RAG/memory, no admin dashboards, and they don't span
aws + k8s + prometheus + loki in one agent. Nobody was shipping the *full*
platform as something you self-host and own.

So I built that. OpenAgentic is an Apache-2.0, self-hosted, zero-telemetry ops
platform. It runs the cross-domain RCA loop entirely inside your perimeter,
against your own model. Think the open-source, self-hosted alternative to the
$1B AI-SRE — except your data never leaves the box.

## The hero loop

Alert fires. The agent queries Prometheus, Loki, and kubectl **in parallel**,
assembles a root-cause narrative *with the evidence attached* (the actual
series, the actual log lines, the actual pod state — not a vibes summary), then
proposes a fix behind a human approval gate. You read it, you click Approve, it
executes, and an immutable audit-log entry records what ran and who said yes.
About 60 seconds, on your laptop, against your own Ollama, with nothing leaving
the machine.

## What's actually in the box

- **Chat** — multi-provider, persistent history, semantic search over past
  conversations + uploaded docs.
- **Flows** — visual agent runbooks (the engine is Flowise-derived): drag-drop
  nodes, branching, tool calls, RAG.
- **14 first-party MCP servers** — AWS, Azure, GCP, Kubernetes, Prometheus,
  Loki, Alertmanager, GitHub, plus Web, Knowledge (RAG), Incident, Runbook,
  Admin, and Agent Architect. All disabled by default; enable what you need.
  The agent routes calls semantically (tools indexed by description in Milvus),
  so you can have all 14 active and it still picks the right one.
- **Bring-your-own LLM** — Ollama for free local inference, or plug in
  Anthropic / OpenAI / Azure OpenAI / Vertex keys. Local Ollama is the default,
  which is what makes "zero data leaving the box" a literal default rather than
  a config you have to discover.
- **Bring-your-own MCPs** — paste any Claude-Desktop-format JSON config into
  the admin panel; the proxy installs + indexes it and the agent can route to
  it.

Single node: `docker compose up -d`. Kubernetes: there's a Helm chart.

## The honest answer to "so it deleted your prod DB?"

This is the first question anyone sane asks, and I want to answer it straight
rather than wave it away. The trust model here is **infra-level, not
prompt-level** — it does not depend on the model behaving, on a good system
prompt, or on the LLM "deciding" to be careful:

1. **Human approval on every write.** Read/diagnose paths run freely. Anything
   that mutates state stops at an approval gate and waits for a human click.
   The model proposes; it does not execute on its own authority.
2. **Immutable audit log.** Every approved action is recorded — what ran, the
   arguments, who approved it. Default sink is local stdout; it never leaves
   the box unless you deliberately wire it to your own collector.
3. **Scoped egress proxy.** Agent tool calls go through a proxy that blocks the
   cloud metadata endpoints (169.254.169.254, metadata.google.internal),
   RFC1918 ranges, and `.svc.cluster.local` by default — so a tool can't be
   talked into exfiltrating or pivoting through the internal network.

So the answer to "AI deleted our prod DB" is: it investigates, it recommends,
and the write only happens after a human approves it — with a permanent record
of who did. I am explicitly **not** promising autonomous auto-healing. I think
"the agent fixes prod by itself" is the wrong (and frankly dangerous) product,
and I'd rather lose the demo magic than ship that.

## Zero telemetry, and I mean it

No analytics SDK. No usage beacon. No license check, no update ping, no
install registration. I went looking with a fine comb before claiming this:
no PostHog/Segment/Mixpanel/Amplitude/Sentry/GA anywhere in the tree, no
`sendBeacon`, no `callHome`/`checkForUpdate`/`registerInstall`. Every outbound
path is either localhost, an endpoint *you* configured (your Ollama, your LLM
key, your MCP target, your OTLP collector), or a cloud API the product exists
to drive using *your* creds. OpenTelemetry tracing exists but is opt-in and
defaults to `none` — the shipped compose file emits nothing. There's a
source-regression test in CI that fails the build if anyone reintroduces an
analytics import or a hardcoded external beacon host, so this doesn't rot.

One honest caveat I won't bury: a couple of in-browser *artifact* renderers
(when the model emits a chart/diagram to display) can still pull a library from
a public CDN inside a sandboxed iframe, triggered by you rendering that
artifact. That's a browser resource load in your own tab, not server-side and
not analytics — but a strict "nothing leaves the box" reviewer will see it in
the network tab, so I'm naming it rather than letting you find it. Vendoring
those fully is on the list.

## First-run war stories (because self-hosted lives or dies on minute one)

A platform that takes an afternoon to stand up is a platform nobody adopts. The
gap between "works on my machine" and "works on a stranger's fresh clone" ate a
real chunk of the early work. Two that were worth the scar tissue:

- **Prisma migrations never ran on first boot** → the API crash-looped on
  `table admin.prompt_templates does not exist`. Fix: the API entrypoint runs
  `prisma db push --accept-data-loss --skip-generate` before starting the
  server. It's idempotent — a no-op on every subsequent boot. Related: the
  embedding columns use pgvector's `halfvec`, so postgres needs
  `CREATE EXTENSION vector` to run on first boot *before* the schema push, via
  an init mount.
- **`Connect Timeout` to Ollama under load.** When a chat call and an embedding
  call hit Ollama concurrently, the undici connection pool starved and requests
  timed out. The fix that mattered: a shared undici `Agent` (64 connections,
  30s connect timeout) wired in per-call via the `dispatcher` option. Sharp
  edge for anyone doing this with Node's built-in fetch — `setGlobalDispatcher()`
  from the npm undici package does **not** affect built-in fetch; only the
  per-call `dispatcher` does. That one cost a day.

These are documented in-repo so the next person hitting a fresh-install
failure can diff against them.

## The promise, and how this is funded

The OSS core is the whole product, and it stays that way: no locked admin
screens, no 402 walls, no "demo mode," no feature gates, no phone-home, no
usage caps — ever. The edition marker in the code literally reads "retained
only as a harmless build label." This isn't a stripped trial. Fork it, rebrand
it, run it on prem, ship it to your own customers — Apache-2.0 means you can,
and that's the point.

It's backed by Agenticwork™ LLC. The business is a separate commercial
enterprise edition + support (the n8n / GitLab CE↔EE shape) for orgs that want
the managed and hardened tier — never an in-product nag here. The free
self-hosted edition is complete on its own terms.

Repo: https://github.com/agentic-work/openagentic
Install (quick path — probes local Ollama, pulls models, brings the stack up):

    curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash

Guided wizard instead:

    curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash -s -- --wizard

Kubernetes:

    curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash -s -- --helm

I'd genuinely like the sharp questions — especially on the trust model and the
egress boundary, since that's where I think the real work is. If you self-host
ops tooling under a compliance regime, I want to hear what would actually make
this safe to run in your environment. Happy to go deep in the thread.
