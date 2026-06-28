# Zero telemetry — the proof

openagentic does not phone home. There is no analytics SDK, no usage beacon,
no license check, no update ping, no install registration — anywhere in the
product. This page documents exactly what that means and how you can verify it
yourself.

## The claim, precisely

**The server never sends data to Agenticwork, or to any third party, ever.**
Every outbound network path in the running platform is one of:

- **localhost** — the API talking to its own Postgres / Redis / Milvus.
- **An endpoint you configured** — your own Ollama, your own LLM provider
  keys, your own MCP servers, your own OTLP collector.
- **A cloud API the product exists to operate** — AWS, Azure, GCP,
  Kubernetes, Prometheus, Loki — driven entirely by *your* credentials.

Nothing in that list is us.

## What we checked

A source-wide scan for analytics and beacon patterns across all
`.ts / .tsx / .js / .jsx / .py / .html` (excluding `node_modules` and build
output) returns **zero product-code matches** for:

```
posthog · segment · @sentry · mixpanel · amplitude · datadog/dd-trace
google-analytics · gtag · bugsnag · rollbar · fullstory · heap
hotjar · plausible · fathom · matomo · rudderstack
```

No `sendBeacon`, no pixel beacon, no `callHome` / `checkForUpdate` /
`version-check` / `license-check` / `registerInstall`. The only `track(` style
calls in the tree are internal Prometheus span tracking, UI navigation state,
and a local cost tracker — none of which leave the box.

## Observability is opt-in and default-off

The platform ships an optional OpenTelemetry / LLM-tracing layer. With the
default environment it emits **nothing**:

- `OBSERVABILITY_PROVIDER` defaults to `none` → a no-op adapter, zero emission.
- The OTLP, Phoenix, and Langfuse adapters all default to `localhost` or an
  in-memory discard, and are skipped entirely unless you set their endpoint.
- `docker-compose.yml` and `.env.example` never point any of these at a
  non-localhost host.

If you wire up a collector, the spans go to **your** collector. Not to us.

## Verify it yourself

```bash
# 1. No analytics/beacon SDKs in product source
grep -rEi 'posthog|segment|@sentry|mixpanel|amplitude|dd-trace|gtag|bugsnag|fullstory|heap|hotjar|plausible|fathom|matomo' \
  services --include='*.ts' --include='*.tsx' --include='*.js' --include='*.py' \
  | grep -v node_modules

# 2. Watch the wire during a full chat round-trip
#    (point your own tooling at the API container; every external request
#     should resolve to localhost, your Ollama, or a cloud API you configured)
```

There is also a source-regression test in the suite that fails CI if anyone
ever reintroduces one of the forbidden SDKs or a new hardcoded external host.

## Honest caveat: browser-side artifact rendering

When the model emits a rich visual artifact (a chart, a diagram, a small
React preview) and **you choose to render it**, the sandboxed preview iframe
in your browser may load a rendering library (e.g. Pyodide, or a charting lib)
from a public CDN. This is:

- **In your browser, not the server** — the server still never phones home.
- **User-action-triggered** — it only happens when you render that artifact.
- **Sandboxed** — it runs in a CSP-scoped iframe with no access to your data.

If you need a fully air-gapped posture, the artifact runtime can be vendored
locally (the bundled libraries already ship under the UI's
`public/artifact-runtime/`), and the Helm chart includes an air-gapped values
template. For the strictest reviewers we scope the headline claim precisely:
**the server never phones home.**

## Why we can promise this

This is the whole point of the project. openagentic is the self-hosted,
zero-telemetry, model-agnostic ops platform for teams who are legally
forbidden from shipping their infrastructure logs to a SaaS AI-SRE — the
open-source, self-hosted alternative to the closed cloud incident agents, where
your data never leaves the box. The trust moat is infra-level, not
prompt-level: human approval on every write, an immutable local audit log, and
a scoped egress proxy. No analytics is part of that contract, not a footnote
to it.

## Backed by Agenticwork™

The OSS core is free, complete, and Apache-2.0 — forever. No paywall, no
locked admin screens, no 402 walls, no usage caps, and (as this page proves)
no calling home. The commercial **enterprise edition** — advanced monitoring,
chargeback, integrations hub, rate-limit tiers, network- and webhook-security
policy consoles, managed DLP policy packs — plus support lives at
[agenticwork.io](https://agenticwork.io). Entirely optional; the self-hosted
edition here is the real thing.

---

[Apache-2.0](../LICENSE) · © Agenticwork™ LLC
