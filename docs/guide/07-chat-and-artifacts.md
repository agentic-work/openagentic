# Chat & Artifacts

OpenAgentic's chat is an **agentic chat loop**, not a single completion. A turn can fan out across MCP tools, dispatch sub-agents, render interactive widgets and mini-apps inline, pause for your approval on any mutating action, and write an immutable audit row for every tool call — all while streaming back to the browser.

This guide explains:

- how the **chatmode** loop discovers and calls tools (`tool_search`),
- the always-available **meta-tools** (`Task`, `compose_visual`, `compose_app`, `render_artifact`, `request_clarification`, `browser_sandbox_exec`, `memorize`),
- how **inline artifacts** are produced and rendered in a sandboxed iframe,
- the **human-approval gate** on mutating tool calls and the **immutable audit trail**,
- and the **memory** primitives.

Everything below is grounded in the running code. The chat endpoint is `POST /api/chat/stream` (registered by the chat plugin), and the loop streams **NDJSON frames** back to the UI.

> **Model routing note.** The SmartModelRouter is always on. You never pass a `model:` field in a chat request body — the platform selects the model. There are no hardcoded model IDs in the request path; whatever the router picks is given the assembled tool array.

---

## How chat works (the chatmode loop)

A chat turn runs a discovery-mode agentic loop:

1. **Assemble the tool array.** The model is given a fixed set of **T1 meta-tools** plus any MCP tools resolved for the turn. The assembly is the single source of truth in `routes/chat/pipeline/chat/toolRegistry.ts` (`getAllBaseTools` → `buildChatToolArray`).
2. **Discover MCP tools mid-turn.** Rather than front-loading the entire MCP catalog (hundreds of tools), the model is given the meta-tools plus `tool_search`. When it needs a cloud/ops capability, it calls `tool_search`; the matched tool definitions are appended to its tool array **in the same turn**.
3. **Dispatch tools.** Each tool call flows through the dispatch seam, which **audits every call** and **gates mutating calls** for human approval (see below) before the tool actually executes.
4. **Stream.** Prose, tool activity, and artifact frames stream back as NDJSON. Read-only tool calls run in parallel where safe; lifecycle/mutation calls run serially.

The system prompt enforces tool-use discipline. Two rules matter for this guide:

- **Read the loaded catalog before reaching for `tool_search`.** If a tool that fits is already loaded this turn, the model calls it directly. `tool_search` must not be called more than twice in a row with the same query.
- **Artifacts render ONLY via `tool_use` blocks.** Writing a `compose_visual` / `compose_app` / `render_artifact` schema as JSON or raw `<html>`/`<svg>` in prose renders **nothing** — the user just sees raw code. The model must dispatch a `tool_use` block.

### Tool discovery — `tool_search`

`tool_search` is a synthetic meta-tool (`services/openagentic-api/src/services/ToolSearchTool.ts`) that lets the model expand its own tool set without a conversation round-trip.

```ts
// schema (abridged)
{
  name: 'tool_search',
  parameters: {
    query: string,          // plain-language, semantic search
    k?: integer,            // how many tools to retrieve (default 8, 1–20)
  }
}
```

When invoked, it POSTs the query to the internal `/api/internal/tool-search` route (semantic search over the Milvus `mcp_tools_cache` collection), and returns 5–8 real tool definitions — each with a full JSON-Schema `parameters` block. Those definitions are appended to the model's tool array via the loop's discovery hook, so the model can call any of them on its next `tool_use`.

If **no** connected tool matches the query, `tool_search` returns an honest no-match message that names what *is* connected and tells the model **not** to keep re-searching — it should tell the user plainly that the capability is not available (for example, a cloud MCP that has no credentials configured). This is what stops the "spin forever" failure mode on an unauthenticated provider.

```text
No connected tool matches 'azure subscriptions list'. No MCP servers are connected this session.
Azure, GCP, GitHub, Kubernetes, Prometheus and other cloud/ops servers are NOT connected ...
Do NOT search again for this capability. Tell the user plainly that it is not available ...
```

---

## The meta-tools

These ship as part of the `openagentic-api` image and are assembled by `getAllBaseTools()`. They are always available to the model (no discovery needed) — analogous to a base toolset. Discovery primitives, sub-agent lifecycle, IO primitives, memory, and the visualization/clarification tools are all in this set.

| Tool | Purpose | Frame / effect |
|---|---|---|
| `tool_search` | Discover MCP tools by semantic query; expands the catalog mid-turn | appends tool defs to the turn |
| `Task` | Dispatch a specialized **sub-agent** (own ReAct loop, filtered tools, own prompt) | runs a sub-agent |
| `compose_visual` | Template-driven inline chart/diagram from a JSON `data` object | `visual_render` |
| `compose_app` | Inline interactive **mini-app** (sandboxed HTML/JS document) | `app_render` |
| `render_artifact` | Escape-hatch: hand-authored HTML / SVG / React / Python-plot PNG | `artifact_render` |
| `request_clarification` | Ask the user one focused question (output-format / destructive-scope ambiguity) | `request_clarification` |
| `browser_sandbox_exec` | Run a short Python (Pyodide) / JS snippet **in the user's browser** | `browser_exec_request` |
| `memorize` | Persist a durable fact / preference across sessions | `memory_written` |
| `memory_search` | Recall previously-memorized facts | — |
| `generate_image` | Generate a real image (via the imageGen role) instead of fabricating an `<img>` | — |

> `Task` is gated by `shouldExposeTaskToolForModel(selectedModel)` (`services/modelTaskGate.ts`): small/cheap models physically don't see `Task`, so they can't dispatch a sub-agent for a trivial one-tool query. Unknown/undefined models fail open (Task included).

### `Task` — sub-agent dispatch

`Task` (`services/TaskTool.ts`) picks a specialized sub-agent from a description-driven, DB-backed registry (`prisma.agent`, including admin-created custom agents) and runs it in its own loop with a filtered tool list. The tool requires a `description`, the verbatim `prompt`, and a `subagent_type` (defaults to `general-purpose`). Each `Task` call carries a `multi_step_justification` that a server-side validator checks — the model must articulate why a sub-agent dispatch is warranted instead of calling a single tool directly.

There is no enum gate and no regex post-filter — the **tool description is the routing**. The optional per-call `model` override is deliberately *not* biased toward any provider family; omit it and the sub-agent falls through to its definition's preference and finally the parent turn's chat model.

### `request_clarification`

`request_clarification` (`services/RequestClarificationTool.ts`) emits a single `request_clarification` frame; the UI renders an inline question card and the user's answer arrives as the next user message. It is intended **only** for:

- **output-format** ambiguity (chart vs. dashboard vs. prose) *before* emitting an expensive artifact, and
- **destructive-scope** ambiguity where the wrong choice would irreversibly change user data (e.g. "which of your 3 prod databases should I drop?").

It has a strong bias *against* asking. The model must **not** ask about authentication, login, SSO/OBO, permissions/access, or "should I proceed?" — it should just act, surface any auth/permission error verbatim, or render with a sensible default and state the assumption in prose.

---

## Inline artifacts

Artifacts are interactive widgets that render *inline* in the chat, alongside the model's prose. There are three production tools, in order of preference:

1. **`compose_visual`** — template-first charts/diagrams. **Primary path.**
2. **`compose_app`** — full interactive mini-apps.
3. **`render_artifact`** — hand-authored escape hatch.

All three return an `artifact_id` immediately and support **hot-swap**: re-emitting with the same `group_id` replaces the previous artifact in place (e.g. "make the chart bigger") instead of stacking a new one.

### `compose_visual` — template-driven charts/diagrams

`compose_visual` (`services/ComposeVisualTool.ts`) is the preferred path. The model picks a `template` and supplies a small JSON `data` object; the **server renders deterministically** (no LLM SVG authoring), which is why small models that emit clean JSON but fail at long SVG still produce good visuals.

```jsonc
// tool_use(compose_visual, …)
{
  "template": "sankey",
  "title": "cloud_cost_6mo",
  "data": {
    "flows": [
      { "from": "prod", "to": "core-api", "value": 12450 },
      { "from": "prod", "to": "data",     "value": 8460  }
    ]
  },
  "group_id": "cost-flow",
  "caption": "Top cost drivers for the last 6 months."   // optional 1–2 sentence narrative line
}
```

Supported templates (`COMPOSE_VISUAL_TEMPLATES`):

| Template | Data shape (summary) | Renders as |
|---|---|---|
| `sankey` | `{ flows: [{from, to, value}] }` | flow ribbons (auto-upgrades to 3-column when flows describe 3 columns) |
| `sankey_3col` | `{ left, mid, right, flows_lm, flows_mr }` | 3-column gradient sankey (SVG) |
| `bar_chart` | `{ x: string[], y: number[] }` | premium chart |
| `line_chart` | `{ x: string[], y: number[] }` | premium chart (time-series) |
| `table` | `{ columns: string[], rows: any[][] }` | streaming table |
| `kpi_grid` | `{ kpis: [{label, value, delta?, trend?}] }` | metric cards (HTML) |
| `arch_diagram` (alias `arch`) | `{ nodes, edges, groups?, direction? }` | stencil cloud-architecture diagram (dagre auto-layout) |
| `chord`, `sunburst`, `radial_tree`, `treemap`, `parallel_coords`, `heatmap` | template-specific | ECharts → SVG (server-side `renderToSVGString`) |
| `reactflow_arch` | `{ nodes, edges }` (explicit coords) | **deprecated** alias for `arch_diagram` |
| `svg_raw` / `html_raw` | `{ svg }` / `{ html }` | last-resort hand-authored escape hatch |

Notes grounded in the renderer:

- **`arch_diagram`** takes resource-typed nodes (`type: "aws_s3" | "k8s_pod" | …`) and edges (`kind: flow | data | auth | control | event`). It needs **no x/y coordinates** — layout is automatic. Unknown type slugs fall back to a generic `service` stencil so the diagram never breaks. **Mermaid has been removed from this platform**; use `arch_diagram` for architecture/sequence/flowchart diagrams.
- The server **validates every `data` shape** and returns a structured error the model can correct (e.g. *"sankey requires at least one flow in data.flows"*).
- **Turn-scoped dedupe**: two identical `compose_visual` calls (same `template` + `data`) within a turn collapse to a single artifact — the second returns the existing `artifact_id` and skips the re-emit.
- For `template: "table"`, the tool additionally emits a `streaming_table` frame (sticky headers, severity cell coloring, monospace/tabular-number cells) and suppresses the generic visual frame so a table never double-renders.

Charts and diagram kinds (`chart`, `arch_diagram`, `reactflow_arch`) mount as native React components inline; `svg`/`html` kinds mount in a sandboxed iframe via the v2 `WidgetRenderer`.

### `compose_app` — interactive mini-apps

`compose_app` (`services/ComposeAppTool.ts`) is for answers a single chart can't carry: cost dashboards with linked filters, dependency graphs, simulators, audit matrices. The model can:

- pick a **registry template** (`template` slug + a tiny typed `params` object — server hydrates the HTML), or
- author a **freestyle** full HTML/JS document (`html`).

Either way, **every** payload — template-hydrated or freestyle — runs through the same server-side validator (`composeAppValidator.ts`) before an `app_render` frame is emitted. The registry path is **not** a privilege escalation.

**Validator hard rules (all violations reported together):**

| Rule | Limit |
|---|---|
| Size cap | ≤ 1 MiB payload |
| Script sources | must start with the same-origin `/api/cdn/lib/` allow-list — public CDNs (jsdelivr / unpkg / cdnjs / skypack / esm.sh) and any other absolute host are **blocked** |
| No `eval(...)` / `new Function(...)` | rejected |
| No nested `<iframe>` | rejected (sandbox-escape risk) |

The library allow-list is fixed and served same-origin by the UI (no external host is ever reached): `d3@7`, `d3-sankey@0`, `d3-hierarchy@3`, `d3-chord@3`, `echarts@5`, `plotly@2`, `cytoscape@3`, and `pyodide/0.27` (only when `pyodide_required=true`).

On success the validator generates a **fresh per-render CSP nonce** and attaches `nonce="<value>"` to every `<script>` tag in the payload (`hardenedHtml`). That nonce is carried on the `app_render` frame so the iframe CSP can drop `'unsafe-inline'` and only execute validated tags.

```jsonc
// tool_use(compose_app, …)  — freestyle example
{
  "title": "azure_cost_2026q1",
  "html": "<!doctype html><html><head><title>Azure Costs</title>
           <script src=\"/api/cdn/lib/echarts@5/dist/echarts.min.js\"></script>
           </head><body><div id=\"chart\" style=\"height:480px\"></div>
           <script>/* echarts init + click filters */</script></body></html>",
  "group_id": "azure-cost-q1"
}
```

### `render_artifact` — hand-authored escape hatch

`render_artifact` (`services/RenderArtifactTool.ts`) is the last resort, used only when neither `compose_visual` nor `compose_app` fits. It emits a single `artifact_render` frame. Four kinds:

| `kind` | Content | How it renders |
|---|---|---|
| `html` | full self-contained HTML document | sandboxed iframe |
| `svg` | raw authored SVG | sandboxed iframe |
| `react` | JSX/TSX source | compiled in-iframe via Babel standalone (React 18 + ReactDOM are globals; **no** `import` statements; **no** charting libraries — charts are hand-authored SVG) |
| `python_plot` | base64 PNG produced by the browser Pyodide sandbox | shown inline |

If the model omits or malforms `kind`, the server **infers it from the content shape** (`export default`/`from 'react'`/hooks+JSX → `react`; leading `<svg` → `svg`; `<!doctype`/`<html` → `html`; a bare base64 blob → `python_plot`) so a weaker model doesn't dead-turn. It hard-rejects only when the content shape is also unrecognizable.

---

## How artifacts render — the sandboxed iframe

Inline artifacts that contain markup (`compose_app`'s `app_render`, plus `html`/`svg`/`react` kinds from `render_artifact`) mount inside an isolated iframe. The canonical mount for `app_render` is the v2 `AppRenderer` (`services/openagentic-ui/.../components/v2/AppRenderer.tsx`); `compose_visual` SVG/HTML mounts via the sibling `WidgetRenderer`. The hardened sandbox model mirrors Claude.ai artifacts:

- **`sandbox="allow-scripts"` only** — *never* `allow-same-origin`. Combined with `srcdoc`, the iframe gets an **opaque origin** and is automatically isolated from the parent's cookies and `localStorage`.
- **An inline CSP `<meta http-equiv>`** is injected at the top of `<head>` before any user script runs. For `compose_app`:

  ```text
  default-src 'none';
  script-src 'self' <origin>/api/cdn/lib/ <origin>/artifact-runtime/ 'nonce-XXX';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;          /* allows Pyodide matplotlib PNGs */
  connect-src 'self' <origin>;
  font-src 'self' data:;
  worker-src 'self' blob:;             /* only when pyodide_required */
  ```

  `script-src` is **path-prefixed** to `/api/cdn/lib/` (and the same-origin `/artifact-runtime/` library bundle), so the iframe can't load arbitrary JS from any endpoint that returns `application/javascript`. When a per-render nonce is present, `'unsafe-inline'` is dropped in favor of `'nonce-XXX'`.

- **A `<base href>`** pins relative URLs to the parent origin (without it, `srcdoc` iframes resolve relative URLs against `about:srcdoc` and every fetch fails).
- **Theme inheritance** is injected: iframes don't inherit CSS variables, so the renderer writes the parent's resolved theme tokens (`--cm-bg-*`, `--cm-fg-*`, `--cm-accent`, fonts, etc.) into the iframe `:root` so widgets follow the user's light/dark + accent.
- **`kind: "react"` artifacts** arrive as raw JSX, not a full document. The renderer wraps them in a Babel-transpiling shell that loads React 18 + ReactDOM + `@babel/standalone` from the **same-origin `/artifact-runtime/` directory** (the synth-CDN `/api/cdn` path is not deployed in OSS), strips ES `import`/`export` lines (there's no module resolver in the iframe), and mounts the default export (or a top-level `Widget`/`App`/`Dashboard`/`Component`).

The `/artifact-runtime/` directory ships these same-origin libraries: `react.production.min.js`, `react-dom.production.min.js`, `babel.min.js`, `d3.min.js`, `d3-sankey.min.js`, `plotly-basic.min.js`, `chart.min.js`, `katex.min.js`/`.css`, `mermaid.min.js`, `runtime.js`, and `oat-bridge.js`.

A safety harness inside each artifact iframe caps the DOM at **5000 nodes** (via `MutationObserver`) and auto-resizes the iframe to its content height via a `postMessage` bridge.

### `browser_sandbox_exec` — code in the user's browser

`browser_sandbox_exec` (`services/BrowserSandboxExecTool.ts`) runs a short snippet **in the user's browser**, not on the server:

- Python via **Pyodide** (NumPy / pandas / matplotlib available); JS in an isolated iframe.
- **No network access, no filesystem writes.** Server default deadline 30s (overridable via `timeout_ms`, capped at 30 000 ms).

The mechanism: the server emits a `browser_exec_request` frame → the UI executes the code in its sandbox → the UI POSTs the result to `POST /api/chat/sandbox-result` → an in-process rendezvous store resolves the tool call. For a matplotlib plot, the model calls `plt.savefig("plot.png")` and gets a base64 PNG back, which it can render inline or feed to `compose_visual`.

---

## The approval gate (human-in-the-loop)

Before any tool actually executes, every call passes through the **audit-and-gate** primitive (`services/approval/auditAndGate.ts`). This is wired at the dispatch seam **and** at the MCP-execution seam (the convergence point every named MCP tool passes through), with a single-pass flag so a call is never double-audited.

The flow:

1. **Classify** the tool as `READ` or `MUTATING` (`services/approval/classifyTool.ts`). Classification is by verb token: known read verbs (`get`, `list`, `describe`, `status`, `metrics`, `tool_search`, `web_search`, `compose_visual`, `render_artifact`, …) are always READ; known mutating verbs (`create`, `delete`, `apply`, `deploy`, `scale`, `drop`, `restart`, `grant`, …) are MUTATING. Collision-prone short verbs (`post`, `set`, `add`, `run`, …) match a token **exactly** so `postgres` is not misread as `post`. Unknown → READ (deliberately does **not** over-gate).
2. **READ calls** (and **all** calls when the gate is off) are audited with `decision: 'auto'` and execute immediately. A read tool is **never** gated, so chat never hangs on a `tool_search` / `get_*` / `list_*`.
3. **MUTATING calls with the gate on** are recorded as `decision: 'pending'`, an `approval_required` SSE event is emitted (with the tool name, args, and a truncated `preview`), and the loop **waits** for a decision via the in-process `ApprovalRegistry`.

You approve or deny via:

```text
POST /api/approvals/:auditId/approve
POST /api/approvals/:auditId/deny
```

(registered under `/api` behind auth in the chat plugin). The decision does a **guarded single transition** (`pending → approved | denied | timed_out`, `updateMany WHERE decision='pending'`, so a human-approve and a timeout-deny can only win once) and resolves the awaiting tool call.

- **Approved** → the tool executes.
- **Denied / timed out** → the call is **blocked before it reaches the proxy**; the model receives a synthetic tool failure with the block reason and continues.
- **Timeout default** is 300 000 ms (5 minutes), after which the call is denied.

**Fail-safe:** if the platform can't even record the pending row for a mutating call, the call is **blocked** (an un-audited mutation must never slip through). A failure to audit a *read* degrades to allow-and-log (you already expect the read to run).

### Policy

The policy is resolved by `resolveApprovalGatePolicy()` (DB row overrides env; env is the default):

| Setting | Source | Default |
|---|---|---|
| `gateMutating` | `APPROVAL_GATE_MUTATING` env / `systemConfiguration` row | `true` |
| `timeoutMs` | `systemConfiguration` row | `300000` |

**Audit is always on** — it is never part of this policy. Turning `gateMutating` off disables only the *human gate*; every call is still audited.

---

## The immutable audit trail

Every tool call writes one row to the `admin.tool_call_audit_log` table (`prisma.toolCallAuditLog`, via `services/approval/auditLog.ts`):

```prisma
model ToolCallAuditLog {
  id             String    @id @default(uuid())
  tool_name      String
  server_name    String?
  args           Json      @default("{}")
  preview        String?   @db.Text     // truncated JSON of args (≤ 500 chars)
  classification String                 // 'READ' | 'MUTATING'
  decision       String    @default("pending") // 'auto' | 'pending' | 'approved' | 'denied' | 'timed_out'
  decided_by     String?
  decided_at     DateTime?
  user_id        String?
  session_id     String?
  message_id     String?
  origin         String    @default("chat") // 'chat' | 'subagent'
  created_at     DateTime  @default(now())
  // indexes: decision, user_id, tool_name, created_at
  @@map("tool_call_audit_log")
  @@schema("admin")
}
```

Key properties:

- **Append-only with a single mutation path.** `insertAuditRow` is the only insert; `decideAuditRow` is the only update and transitions `pending` to a terminal decision **exactly once** (concurrency-guarded). There is no delete path.
- **Every call is covered**, including sub-agent calls (`origin: 'subagent'`). The dual-seam design exists specifically so an MCP execution can't bypass the audit — the durable evidence was a real `web_search` that executed while the audit log read `total: 0`, which the MCP-execution seam closed.
- **The `preview`** captures a truncated, serialized view of the args so reviewers see *what* the tool was asked to do without storing unbounded payloads.

This audit trail is the platform's trust moat: it lets an operator answer "what did the agent actually run, with what arguments, and who approved it?" for any session.

---

## Memory

The model can persist durable facts across sessions with `memorize` and recall them with `memory_search` — both ship in the always-available T1 set.

### `memorize`

`memorize` (`services/MemorizeTool.ts`) wraps `AgentMemoryService.store()` and emits a `memory_written` frame (the UI shows a small "memory written" pill).

```jsonc
// tool_use(memorize, …)
{
  "key": "preferred_cloud",   // stable id; reusing a key updates the value
  "value": "azure",           // stored verbatim, phrased as a fact/preference
  "scope": "user"             // "session" | "user" (default) | "tenant"
}
```

The model is instructed to use it when you explicitly ask it to remember something, when you state a durable preference/identity fact, or when a piece of workflow state would help next session. It must **not** memorize transient state or anything that looks like a secret/credential/token. Prompt-injection scanning and DLP run at the underlying `AgentMemoryService` layer.

### `memory_search`

`memory_search` (`services/MemorySearchTool.ts`) recalls previously-memorized entries (Postgres substring + semantic recall over the user's memory in Milvus). A fact memorized on turn *N* of one session can be retrieved on a later turn in a different session. Recall is user-scoped.

---

## Quick reference — NDJSON frames

| Frame | Emitted by | UI effect |
|---|---|---|
| `visual_render` | `compose_visual` | mount chart/diagram (WidgetRenderer / native chart) |
| `streaming_table` | `compose_visual` (`table` template) | streaming table primitive |
| `app_render` | `compose_app` | mount mini-app in sandboxed iframe (AppRenderer) |
| `artifact_render` | `render_artifact` | mount html/svg/react/python_plot |
| `request_clarification` | `request_clarification` | inline question card |
| `browser_exec_request` | `browser_sandbox_exec` | run code in browser, POST result to `/api/chat/sandbox-result` |
| `memory_written` | `memorize` | "memory written" pill |
| `approval_required` / `approval_resolved` | approval gate | approval modal → `POST /api/approvals/:auditId/{approve,deny}` |
