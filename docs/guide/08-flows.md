# Flows & Workflows

Flows are OpenAgentic's visual orchestration layer. Where chat is a single
agentic conversation, a flow is a **persistent, reusable, multi-step graph** of
nodes — LLM calls, MCP tool calls, branching logic, RAG retrieval, integrations,
and human-in-the-loop gates — that you build once on a canvas and then run on
demand, on a schedule, or as a callable tool.

This page covers the visual builder, the node types that ship, the flow
templates seeded out of the box, how chat can author a flow for you, scheduling
with cron triggers, the human-in-the-loop "needs input" gate, and how to run and
monitor a flow.

---

## Architecture

A flow is split across two services plus one shared library:

| Component | Location | Role |
|---|---|---|
| **Flows UI** | `services/openagentic-ui` (`src/features/workflows`) | The React canvas, node palette, properties panels, AI Flow Builder, execution panels |
| **Platform API** | `services/openagentic-api` (`src/routes/workflows.ts`) | CRUD for workflows, versions, executions, webhooks, secrets, data-requests; auth-gated; proxies execution to the workflows service |
| **Workflows engine service** | `services/openagentic-workflows` | Standalone Fastify service that compiles + executes flow definitions, runs the cron scheduler, and seeds templates |
| **Workflow engine library** | `services/shared/workflow-engine` | The shared, schema-driven node registry + executors + graph validators, imported by the workflows service as `@openagentic/workflow-engine` |

The API never runs the heavy execution loop in-process. Instead it proxies to
the dedicated workflows service over an internal-key-authenticated HTTP call, so
flow execution can't block the API event loop and can scale independently. In
the default compose stack the workflows service listens on port `3400`
(`WORKFLOWS_PORT`), and the API reaches it via `WORKFLOW_SERVICE_URL`
(default `http://workflows:3400`).

```
 UI (canvas)  ──►  openagentic-api  ──►  openagentic-workflows  ──►  @openagentic/workflow-engine
   build a flow      /api/workflows/*       POST /execute(-sync)         registry + node executors
```

### The flow definition

A flow's structure is a [ReactFlow](https://reactflow.dev)-style graph stored as
JSON on the `Workflow.definition` column:

```json
{
  "nodes": [
    { "id": "trigger", "type": "trigger", "data": { "label": "Start", "triggerType": "manual" } },
    { "id": "llm",     "type": "llm_completion", "data": { "model": "auto", "prompt": "..." } }
  ],
  "edges": [
    { "id": "e1", "source": "trigger", "target": "llm" }
  ]
}
```

Every node has an `id`, a `type` (one of the registered node types below), and a
`data` object holding that node's configuration. Edges connect a `source` node's
output to a `target` node's input. Downstream nodes reference upstream output
with template strings — `{{trigger.<field>}}` for the trigger payload and
`{{steps.<nodeId>.<field>}}` (or `{{steps.<nodeId>.output...}}`) for any prior
node's result.

Each saved flow also keeps an immutable version history (`WorkflowVersion`), so
edits create new versions you can diff, activate, or restore.

---

## Node types

Nodes are defined by a **schema-driven plugin registry**. The single source of
truth is `services/shared/workflow-engine/src/nodes/registry.ts`: each node lives
in its own directory with a `schema.json` (palette metadata, settings, AI hints,
output assertions) and an `executor.ts`. Adding a node is purely additive — no
edits to the compiler, engine, palette, or AI Flow Builder are required.

As of this release the registry exposes **71 node types across 7 categories**.
The categories, with the count the platform self-reports for each:

| Category | Count | What lives here |
|---|---|---|
| **Trigger** | 1 | `trigger` — the entry point |
| **AI** | 21 | LLM completion, reasoning, multi-agent, agent pool/supervisor, RAG, embeddings, structured output, guardrails, grounding check, … |
| **Control** | 16 | condition, switch, parallel, loop, map_reduce, retry_with_backoff, dedup, wait, wait_for, error_handler, human_approval, human_input, … |
| **Data** | 20 | transform, merge, filter/select/extract/parse/regex, csv_processor, document_loader, text_splitter, vector_store, knowledge_ingest/search, rag_query, … |
| **Integration** | 10 | mcp_tool, slack, teams, discord, email/outlook, pagerduty, servicenow, jira, splunk, … |
| **Action** | 2 | http_request, webhook_response |
| **Annotation** | 1 | canvas annotation |

> The authoritative, always-current list is generated from the registry into
> `services/openagentic-ui/public/docs/generated/node-types.json` and is browsable
> in the in-app docs. Treat that file (and the registry itself) as canonical if a
> count here ever drifts.

### Node families worth knowing

- **`trigger`** — every flow starts here. Its `triggerType` is one of
  `manual`, `webhook`, `schedule`, `event`, or `workflow_finished`. The
  `workflow_finished` type fires this flow when another named flow completes,
  exposing `{{trigger.sourceExecutionId}}`, `{{trigger.sourceStatus}}`, etc.

- **LLM nodes** — `llm_completion` / `openagentic_llm` (aliases of the same
  executor) run a prompt through the platform's **Smart Router**. Use
  `"model": "auto"` (the convention; never hardcode a model ID). `reasoning`
  exposes extended-thinking budgets; `structured_output` enforces a JSON schema;
  `guardrails` and `grounding_check` validate model output.

- **Agent nodes** — `agent_single`, `agent_pool`, `agent_supervisor`,
  `multi_agent`, `agent_spawn`, `a2a` run one or many sub-agents. They route
  through the egress proxy (`openagentic-proxy`); if it's unavailable the engine
  falls back to a direct LLM call.

- **`mcp_tool`** (Integration) — calls any built-in MCP tool by `toolServer` +
  `toolName` (e.g. `openagentic_prometheus` / `prometheus_query`), passing
  `arguments`. This is how flows reach the AWS / Azure / GCP / Kubernetes /
  Prometheus / Loki / GitHub / admin / web MCP servers. `http_request` (Action)
  and `code` make raw HTTP calls and run sandboxed inline code, respectively.

- **Control flow** — `condition` (boolean branch), `switch` (N-way),
  `parallel` (explicit fan-out/fan-in), `loop`, `map_reduce`,
  `retry_with_backoff`, `dedup` (idempotency gate), `wait` /
  `wait_for` (poll-until-condition), `error_handler`.

- **HITL** — `human_approval` (alias `approval`) pauses for an approve/reject
  decision; `human_input` (alias `request_data`) pauses to collect typed values
  from a user. See [Human-in-the-loop](#human-in-the-loop-the-needs-input-gate).

- **RAG / data** — `knowledge_ingest`, `knowledge_search`, `embedding`,
  `rerank`, `multi_query`, `vector_store`, `rag_query`, `document_loader`,
  `text_splitter`, plus the typed processing primitives (`filter_data`,
  `select_data`, `extract_key`, `parse_json`, `regex`, `csv_processor`).

### Output assertions (no "fake success")

Many node schemas declare `outputAssertions` — small expressions that run
against the node's return value after it executes. An agent that returns an
empty answer, a refusal, or a failed status fails its assertion, and the engine
emits a `node_error` with `output_failed_assertion` instead of treating the
unhelpful output as a success. This catches the common failure mode where a step
"completes" but produced nothing usable.

---

## Flow templates

Five opinionated templates ship in the box. They are stored as JSON under
`services/openagentic-workflows/seed/templates/` and **seeded on every workflows
service boot** by `seedTemplatesOnBoot()` (`templateSeeder.ts`):

- Templates are baked into the image at `/app/templates/*.json` (or resolved
  from `seed/templates/` in local dev; override with `WORKFLOW_TEMPLATES_DIR`).
- Seeding is **idempotent** — keyed on `name + is_template=true`, it creates a
  row the first time and updates it in place on subsequent boots, so fixing a
  template JSON and redeploying reconciles automatically.
- Rows are written `is_template=true` and `is_public=true`, which the workflow
  read paths expose to everyone. Seeding is non-fatal: a bad template JSON is
  logged and skipped, never gating startup.

| Template | Category | What it does |
|---|---|---|
| **Incident Triage** | aiops | Hero flow. Fans the trigger out to three parallel MCP calls — `prometheus_query` (metrics), `loki_search_errors` (logs), `k8s_list_pods` (cluster state) — merges them, then asks the LLM for an **evidence-cited** root-cause narrative and renders an HTML report artifact. |
| **Failed Deploy RCA** | aiops | Pulls Kubernetes rollout status + namespace events + Loki errors in parallel, correlates them, and produces a root-cause analysis for a stuck/failed deployment. |
| **Cost Anomaly** | finops | Queries AWS Cost Explorer (`aws_cost_by_service` + `aws_cost_summary`) in parallel with Prometheus usage over the same window, then has the LLM produce a cost-anomaly verdict + report. |
| **RAG Knowledge-Base Q&A** | rag | Grounded, cited Q&A: expands the question (`multi_query`), embeds it, semantically searches `shared_knowledge`, reranks chunks, fact-checks with `grounding_check`, synthesizes, then screens output with `guardrails`. |
| **Research and Publish** | research | End-to-end data-layer demo: pulls web content (`web_search_and_read`), ingests it into the knowledge base, RAGs it back against the question, and renders an interactive HTML report artifact. |

Every template uses `"model": "auto"` (Smart Router) and references MCP tools by
their canonical `openagentic_<server>` names — there are no hardcoded model IDs
or provider strings anywhere in the templates.

The ops-focused templates (Incident Triage, Failed Deploy RCA, Cost Anomaly)
expect their MCPs to be connected and authenticated. The Prometheus / Loki /
Kubernetes MCPs work in-cluster with no external credentials; the AWS MCP needs
cloud credentials (`~/.openagentic/cloud-secrets/aws.env` or mounted host CLI
creds). The `web` MCP needs no credentials.

### Anatomy of a template

The Incident Triage definition is a good worked example of the parallel-MCP
pattern: a single `trigger` fans out via three edges to three `mcp_tool` nodes,
which converge into a labeled `merge`, get normalized by a `transform`, are
narrated by an `llm_completion` node, cleaned by a second `transform`, and
rendered by a `webhook_response` node that persists the HTML as an artifact:

```json
{
  "nodes": [
    { "id": "trigger", "type": "trigger", "data": { "triggerType": "manual" } },
    { "id": "metrics", "type": "mcp_tool",
      "data": { "toolServer": "openagentic_prometheus", "toolName": "prometheus_query",
                "arguments": { "query": "{{trigger.symptom_query}}" } } },
    { "id": "logs", "type": "mcp_tool",
      "data": { "toolServer": "openagentic_loki", "toolName": "loki_search_errors",
                "arguments": { "namespace": "{{trigger.namespace}}", "time_range": "{{trigger.time_range}}" } } },
    { "id": "kube", "type": "mcp_tool",
      "data": { "toolServer": "openagentic_kubernetes", "toolName": "k8s_list_pods",
                "arguments": { "namespace": "{{trigger.namespace}}" } } },
    { "id": "merge_evidence", "type": "merge", "data": { "mergeStrategy": "object" } },
    { "id": "rca", "type": "llm_completion", "data": { "model": "auto" } },
    { "id": "report", "type": "webhook_response", "data": { "persistAsArtifact": true } }
  ],
  "edges": [
    { "id": "e1", "source": "trigger", "target": "metrics" },
    { "id": "e2", "source": "trigger", "target": "logs" },
    { "id": "e3", "source": "trigger", "target": "kube" }
  ]
}
```

---

## The visual builder

The Flows UI lives under `services/openagentic-ui/src/features/workflows`. From
the canvas you can:

- **Drag nodes** from the palette (`NodePaletteDrawer`) onto the canvas and wire
  them with edges. Connection validity is enforced live by the shared engine's
  graph validators (`isValidConnection` / `validateFlow`).
- **Configure** a node in the properties panel (`NodePropertiesPanel`), with
  per-node docs (`NodeDocsPanel`).
- **Preflight-validate** the graph (`PreflightValidationPopover`) — the same
  `validateFlow` contract checks trigger presence, connectivity, orphan nodes,
  unresolved references, and required inputs/secrets.
- **Estimate cost** before running (`CostEstimateBadge`).
- **Run** with inputs (`RunInputsModal` / `ExecutionInputDialog`) and watch
  results stream into `ExecutionPanel` / `ExecutionResultsPanel`.
- **Version** flows (`VersionHistoryPanel`, `VersionDiffView`), **export/import**
  them (`FlowExportImportButton`), and **share** them (`ShareDialog`).
- Run the **AI Flow Builder** (`AIFlowBuilder`) to author or fix a flow by chatting.

### Validating without running

You can validate a graph at any time:

```bash
# Compile-only check via the workflows service (internal)
# or, through the API, validate the structural graph:
curl -sX POST http://localhost:8080/api/workflows/validate \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"definition": {"nodes": [...], "edges": [...]}}'
```

The compiler returns `{ valid, errors[], warnings[], nodeCount, edgeCount }`.
Compilation failures (missing trigger, disconnected nodes, circular
dependencies) block execution.

---

## Chat-authored flows (AI Flow Builder)

You don't have to wire a flow by hand — describe it in natural language and the
**AI Flow Builder** generates the graph for you. This is implemented by the
`useAIFlowChat` hook (`src/features/workflows/hooks/useAIFlowChat.ts`).

How it works:

1. The builder is **isolated from chat** — it does not create chat sessions. It
   calls the OpenAI-compatible endpoint `POST /api/v1/chat/completions` directly
   with `model: "auto"` (Smart Router), streaming the response.
2. Its system prompt is **schema-driven**: the available node types, their
   settings, and AI hints are pulled live from the workflow engine's registry
   via `GET /node-schemas` (the `generateAiPromptFragment()` output), so the
   builder always knows the real, current node catalog. It is also enriched with
   the live MCP tool names, the user's existing flows, and available models.
3. The model returns a ` ```workflow ` JSON block, which the hook parses into a
   `WorkflowDefinition` and drops onto the canvas.
4. For edits to the open flow, the model can emit a ` ```patch ` block of
   targeted node updates instead of regenerating the whole graph.
5. The builder also **troubleshoots**: when a run fails, the failed-node results
   (with errors) are fed back in, and the model proposes fixes — typically as a
   patch — using the built-in troubleshooting playbook (MCP arg-shape errors,
   `NO_CAPABLE_MODELS`, condition/transform expression mistakes, etc.).

Because the generated flow is a normal `Workflow` row, everything else on this
page — versioning, scheduling, HITL gates, running, monitoring — applies to it
unchanged. (Note: a chat-authored flow is persisted with `tenant_id = null`; the
scheduler falls back to the implicit `default` tenant so a scheduled
chat-authored flow still fires.)

> The AI Flow Builder generates flow JSON; it does **not** itself execute
> agentic tool calls. It is a builder assistant, not the chat agent.

---

## Scheduling (cron triggers)

A flow can run on a recurring schedule via a `WorkflowSchedule` row. The
schedule binds a workflow to a cron expression, a timezone, and an optional
`input_template` that becomes the run's input.

### The WorkflowSchedule model

| Field | Meaning |
|---|---|
| `cron_expression` | 5-field cron or a macro (see below) |
| `timezone` | IANA timezone, default `UTC` (DST-safe) |
| `input_template` | JSON input passed to each scheduled run (default `{}`) |
| `is_active` | whether the schedule is polled |
| `next_run_at` / `last_run_at` / `last_run_status` | scheduler bookkeeping |
| `total_runs` / `successful_runs` / `failed_runs` | run statistics |

### The WorkflowScheduler

Scheduling is driven by `WorkflowScheduler`
(`services/openagentic-workflows/src/services/WorkflowScheduler.ts`, with a peer
in the API service). It is a singleton started at boot
(`startWorkflowScheduler()`), and it works by polling — not by registering OS
timers:

1. On start it **initializes** `next_run_at` for any active schedule that
   doesn't have one yet.
2. Every poll interval (default **30s**, `WORKFLOW_SCHEDULER_POLL_MS`) it queries
   for active schedules whose `next_run_at <= now`, taking at most
   `WORKFLOW_SCHEDULER_MAX_PER_CYCLE` (default **10**) per cycle to avoid a
   thundering herd.
3. For each due schedule it **advances `next_run_at` first** (preventing
   duplicate execution), validates the workflow is active and compiles, creates a
   `WorkflowExecution` row with `trigger_type: "schedule"`, and fires the run.
4. After the run it updates `last_run_status`, the schedule's
   success/failure counters, and the workflow's execution statistics.

Cron parsing is backed by [`croner`](https://github.com/hexagon/croner), which
supports:

- Standard 5-field expressions (`minute hour dom month dow`)
- Day-of-week names and ranges (`MON`, `MON-FRI`, …)
- Macros: `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`, `@annually`
- `@reboot` (treated as a no-op at runtime — it never matches on a poll tick)
- IANA timezone handling with proper DST support

```cron
# every 5 minutes
*/5 * * * *

# weekdays at 09:00 in the schedule's timezone
0 9 * * MON-FRI

# macro form
@daily
```

Scheduled runs are robust to first-boot races: if the workflow tables don't
exist yet (a fresh install where migrations haven't finished), the poll cycle
logs a single quiet warning and backs off rather than spamming errors. Legacy
schedule rows with no tenant are **skipped** (fail-closed), not silently run.

> **Note on creating schedules in OSS:** the scheduler in this edition *polls and
> executes* existing `WorkflowSchedule` rows — it does not auto-derive them from a
> flow's `triggers` config, and the OSS API routes do not expose a dedicated
> "create schedule" endpoint. To enable a recurring flow, ensure a
> `WorkflowSchedule` row exists for it (with `is_active = true`, a valid
> `cron_expression`, and a `timezone`); the scheduler picks it up on its next
> poll. A flow's `trigger` node with `triggerType: "schedule"` documents intent
> on the canvas and tags the flow as `scheduled`.

---

## Human-in-the-loop: the "needs input" gate

Two HITL node types let a flow **pause for a human** and resume later. They share
the same pause/persist/resume substrate but collect different things:

| Node | Alias | Collects | Persisted as | Pause reason |
|---|---|---|---|---|
| `human_approval` | `approval` | an approve / reject decision | `WorkflowApproval` | `awaiting_approval` |
| `human_input` | `request_data` | typed form values | `WorkflowDataRequest` | `awaiting_input` |

### How a needs-input pause works

When a `human_input` node executes:

1. The executor validates its configured `fields[]` (each field has a `name` and
   a `type` of `string`, `number`, `enum`, `secret`, `boolean`, `file`, `date`, or
   `json`, plus optional `required`, `options`, `default`, `placeholder`,
   `validation`) and interpolates the title/description templates.
2. It calls the engine-wired `ctx.requestData` hook, which **creates a
   `WorkflowDataRequest` row**, sets the execution to awaiting input, and emits a
   `needs_input` event carrying `{ requestId, nodeId, title, fields }`.
3. The node returns `status: "awaiting_input"`; the engine recognizes that and
   emits `execution_paused`, halting downstream nodes.

The `WorkflowDataRequest` row carries the typed `fields`, a `timeout_seconds`
(default 24h) with a `timeout_action` of `fail` or `use_default` (the latter is
only allowed when every required field has a default — fail-closed otherwise), an
`assign_to` list scoping who may answer, a `channel` (default `chat`), and the
input/context snapshot.

In the UI, `NeedsInputForm` renders the typed form from the `needs_input` frame.

### Submitting and resuming

The user submits their answers to the API:

```bash
curl -sX POST \
  http://localhost:8080/api/workflows/executions/$EXEC_ID/data-requests/$REQUEST_ID \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"values": {"environment": "prod", "approver": "alice"}}'
```

The API authorizes the caller against `assign_to`, then proxies to the workflows
service `POST /resume-execution`, which validates the submitted `values` against
the stored `fields[]` and **re-enters the engine from the paused node**.
Downstream nodes can then read the answers as
`{{steps.<nodeId>.output.values.<fieldName>}}`.

The approval gate works the same way (it emits `approval_required` / pauses with
`awaiting_approval`), and resumes through the same `/resume-execution` path. The
shared engine's `canAutoApprove` helper decides when an approval can be
auto-cleared versus requiring a human decision.

---

## Running and monitoring a flow

### Run a flow

Execute a saved flow by ID. Smart Router selects the model — never pass a
`model` field; flow nodes that need routing already use `"auto"`.

```bash
# Manual run of a saved flow
curl -sX POST http://localhost:8080/api/workflows/$WORKFLOW_ID/execute \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"input": {"alert": "High error rate on api", "namespace": "agentic-dev", "time_range": "1h"}}'
```

The execute route supports a `?dryRun=` and `?async=` query flag. Under the hood
the API creates a `WorkflowExecution` row and proxies to the workflows service —
either `POST /execute` (true SSE streaming) or `POST /execute-sync` (events
collected into the JSON response). Both endpoints support an `Idempotency-Key`
header that replays a stored result for a duplicate request within the retention
window.

You can also test a definition without saving it, via `POST /api/workflows/test`
(whole graph) or `POST /api/workflows/test-node` (a single node).

### Stream and inspect executions

```bash
# Live event stream for a running execution (SSE)
curl -N http://localhost:8080/api/workflows/executions/$EXEC_ID/stream \
  -H "Authorization: Bearer $TOKEN"

# Your recent executions
curl -s http://localhost:8080/api/workflows/executions/mine \
  -H "Authorization: Bearer $TOKEN"

# Executions for one workflow
curl -s http://localhost:8080/api/workflows/$WORKFLOW_ID/executions \
  -H "Authorization: Bearer $TOKEN"

# A single execution's detail (status, node outputs, logs)
curl -s http://localhost:8080/api/workflows/$WORKFLOW_ID/executions/$EXEC_ID \
  -H "Authorization: Bearer $TOKEN"
```

Lifecycle control endpoints let you `pause`, `resume`, `stop`/`cancel` an
execution and `retry-node` a single failed node:

```bash
curl -sX POST http://localhost:8080/api/workflows/executions/$EXEC_ID/pause  -H "Authorization: Bearer $TOKEN"
curl -sX POST http://localhost:8080/api/workflows/executions/$EXEC_ID/resume -H "Authorization: Bearer $TOKEN"
curl -sX POST http://localhost:8080/api/workflows/executions/$EXEC_ID/cancel -H "Authorization: Bearer $TOKEN"
```

### Execution events

The engine emits a typed event stream you'll see in the UI and over SSE:

| Event | Meaning |
|---|---|
| `execution_start` / `execution_complete` / `execution_error` | run lifecycle |
| `node_start` / `node_complete` / `node_error` | per-node lifecycle |
| `node_stream` / `node_progress` / `node_canonical` | streamed/partial node output |
| `node_retry` / `node_fallback` | a node retried or fell back (e.g. agent → direct LLM) |
| `approval_required` / `approval_received` | HITL approval gate |
| `needs_input` | HITL data-request gate (typed form) |
| `execution_paused` / `execution_resumed` | run suspended / re-entered |

### Metrics

The workflows service exposes Prometheus metrics at `GET /metrics`, including:

- `workflow_executions_total{status}` — counted successes/failures/errors
- `workflow_active_executions` — currently running executions
- `workflow_execution_duration_seconds` — run duration histogram
- `workflow_node_duration_seconds{node_type}` — per-node duration histogram
- `workflow_node_errors_total{node_type,error_code}` — node error counter

Per-workflow rollups (`total_executions`, `successful_executions`,
`failed_executions`) and per-schedule rollups (`total_runs`, `successful_runs`,
`failed_runs`, `last_run_status`) are persisted on the `Workflow` and
`WorkflowSchedule` rows, so the admin dashboard can show flow health without
scraping logs.

---

## Quick reference

| I want to… | Path |
|---|---|
| Build a flow visually | Flows UI → drag nodes from the palette → wire edges → Save |
| Have chat build a flow | AI Flow Builder panel → describe it in natural language |
| List / create / update / delete flows | `GET|POST /api/workflows`, `PUT|DELETE /api/workflows/:id` |
| Validate a graph | `POST /api/workflows/validate` |
| Run a flow | `POST /api/workflows/:id/execute` |
| Stream a run | `GET /api/workflows/executions/:executionId/stream` |
| Answer a needs-input gate | `POST /api/workflows/executions/:executionId/data-requests/:requestId` |
| See node types | `services/.../docs/generated/node-types.json` (in-app docs) |
| See templates | seeded on workflows-service boot; browse in the Flows template gallery |
