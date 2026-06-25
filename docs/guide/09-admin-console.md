# Admin Console

The OpenAgentic admin console is the operator control plane for a self-hosted
deployment. It is a single-page React app (the "v3" admin shell) embedded in the
main UI, served from the same origin as chat and flows. Every page reads from
the platform API under `/api/admin/*`, and every admin endpoint is guarded so
only an admin user can reach it.

This guide covers what each admin page does and the real data it shows, grounded
in the v3 admin pages (`services/openagentic-ui/src/features/admin/pages-v3`) and
the admin API routes (`services/openagentic-api/src/routes`).

---

## Accessing the console

The admin console is reached at the `/admin` route. Navigating there mounts the
v3 admin shell (`AdminPortalHostV3`) over the chat shell. Deep links work via the
URL hash — for example `/admin#mcp-fleet` opens the MCP Fleet page directly,
`/admin#dashboard` opens the dashboard. The active leaf is reflected back into
the hash as you navigate, so bookmarks and the browser back/forward buttons
behave as expected.

### Authentication and access control

OpenAgentic's OSS edition uses **local authentication only** — username/password
with JWT plus API keys. There is no SSO, AAD, or OBO in the open-source edition.

Every `/api/admin/*` route is admin-guarded. Two equivalent guard middlewares are
used across the route files:

- `adminMiddleware` / `adminGuard` — extracts the bearer token, validates it with
  the unified token validator (`requireAdmin: true`), and attaches the resolved
  user to the request. A non-admin token returns **403 Forbidden**; a missing or
  invalid token returns **401 Unauthorized**.
- `requireAdminFastify` — the Fastify `preHandler` form used by the Prometheus
  proxy and other newer admin routes.

```ts
// services/openagentic-api/src/middleware/adminGuard.ts
const result = await validateAnyToken(token, {
  requireAdmin: true,
  logger: request.log,
});
if (!result.isValid) {
  const statusCode = result.error?.includes('Administrator') ? 403 : 401;
  // …
}
```

There are three predefined system roles (from `admin-roles.ts`), keyed off the
`is_admin` flag on the users table — there is no separate custom-role table:

| Role | Description | Permissions |
|---|---|---|
| `admin` | Full system administrator | `*` |
| `user` | Standard user (chat + profile) | `chat`, `chat:create`, `chat:read`, `chat:delete`, `profile`, `profile:read`, `profile:update` |
| `viewer` | Read-only access to chat history | `chat:read`, `profile:read` |

---

## Shell, navigation, and chrome

The console is organized into a left sidebar of grouped leaves, a top bar, a live
ribbon (status cells + a UTC clock), a command palette, an activity drawer, and a
floating "Admin AI Agent" dock.

The sidebar groups (from `shell-v3/sidebar-data.ts`) are:

| Group | Leaves |
|---|---|
| overview | Dashboard |
| system management | User Management, Auth Access Control, User Permissions, User Lockouts, API Tokens, System Settings, Approval Audit Log |
| llm | Provider Management, Default Models, Models, Ollama Hosts, Tiered Function Calling, Router Tuning, Performance Metrics |
| tools management | MCP Fleet, Enriched Tools |
| openagentic flows | All Workflows, All Executions, Flow Costs, Credentials, Governance, KPI Dashboard, Audit Logs, Teams |
| agent management | Agent Registry, AgentOps, Skills & Plugins, Executions |
| prompts | Modules, Pipeline Settings, Effectiveness, Metrics |
| content | Templates, Shared Knowledge Base, Unified Data Layer, User Memory |

Each leaf maps to a native v3 page via the host's `renderPage` switch
(`components/Shell/AdminPortalHostV3.tsx`). Several leaves share a hub page that
opens to the right sub-tab — for example `workflows`/`executions`/`flow-costs`
all open the Workflows hub at a different default tab, and the four `agent-*`
leaves open a single Agents hub. Every page is wrapped in a `LeafErrorBoundary`,
so a single page that throws shows an inline error and the rest of the console
keeps working.

### Productivity affordances

- **Command palette** — `Cmd/Ctrl+K` opens a fuzzy navigator over all leaves.
- **Vim-style mnemonic jump** — type a leaf's two-letter key (for example `tf`
  for MCP Fleet, `gd` for Dashboard) to jump.
- **Activity drawer** and a per-shell **Admin AI Agent** dock that POSTs
  questions to `/api/admin/ai/ask` and streams the answer back.

---

## Dashboard

**Leaf:** `dashboard` · **Page:** `Dashboard.tsx`

The dashboard is the platform overview. It auto-refreshes every 30s and carries a
"refreshed Xs ago" badge that pulses while a background refetch is in flight. A
time-range selector (`1h · 6h · 12h · 24h · 7d · 30d · 90d`) at the top right is
shared by every analytics pane on the page.

The page is a single scroll region with six sections; a sticky sub-tab strip
acts as a scroll-spy ("you are here") and clicking a tab smooth-scrolls to its
section:

1. **Overview** — a one-line health verdict banner, an 8-cell scoring strip, and
   7 platform-count KPI cards.
2. **Usage & cost**
3. **LLM & router**
4. **Flows & agents**
5. **MCP & tools**
6. **Infra & perf**

### Platform counts

The overview KPIs come from `GET /api/admin/dashboard/counts`
(`admin-dashboard-counts.ts`), which returns simple Prisma `count()` rollups —
each wrapped in a `safeCount` so a missing table returns `0` instead of failing
the whole response:

```json
{ "chats": 0, "messages": 0, "users": 0, "workflows": 0,
  "flowRuns": 0, "agentRuns": 0, "llmRequests": 0 }
```

These map to `chatSession`, `chatMessage`, `user`, `workflow`,
`workflowExecution`, `agentExecution`, and `lLMRequestLog` counts. Provider
health for the scoring strip comes from `GET /api/admin/llm-providers/health`.

> Note: the legacy `/api/admin/dashboard/metrics` endpoint was removed in the OSS
> edition. The UI hooks call `/api/admin/dashboard/counts` and the Prometheus
> proxy instead.

### Prometheus-backed analytics

Sections 2–6 (and a compact strip on the Overview) are rendered by
`AnalyticsPanes.tsx`. Each chart runs a PromQL query through the API's
**Prometheus reverse proxy** and renders with the theme-aware `MetricChart`. The
proxy (`routes/admin/prom-proxy.ts`) lets the browser fetch same-origin so the
monitoring-stack URL never leaks to the client:

| Endpoint | Purpose |
|---|---|
| `POST /api/admin/prom/query` | instant PromQL query |
| `POST /api/admin/prom/query_range` | range query (used for time-series) |
| `GET /api/admin/prom/labels` | label discovery |
| `GET /api/admin/prom/health` | single-shot reachability probe |

The proxy forwards to `PROMETHEUS_HOST:PROMETHEUS_PORT` (default
`prometheus.monitoring-stack.svc.cluster.local:9090`), blocks catch-all/
destructive queries, and returns a structured **503 `prometheus_unreachable`**
with a NetworkPolicy hint when the upstream is down — so charts can show a clear
"awaiting data" or "unreachable" state instead of a generic error.

Representative panes and the metrics they chart (PromQL families from
`gen_ai_*`, `http_*`, `openagentic_*`, `v3_*`):

- **Usage & cost** — tokens/sec by type and by model, sub-agent cost ($/sec),
  cache-read tokens/sec.
- **LLM & router** — operation latency p95 by model, request rate by model,
  time-per-output-token p95, finish reasons/sec, errors/sec by class, router
  decision latency.
- **Flows & agents** — chat turns/sec by model, agent invocations/sec,
  concurrent sub-agent dispatch, compaction tokens freed/sec.
- **MCP & tools** — top tools by call rate (rank chart), tool calls/sec by
  outcome.
- **Infra & perf** — HTTP requests/sec, HTTP latency p95, requests/sec by status
  code, HITL wait p95.

Charts distinguish two empty states honestly: a metric that has **no samples at
all** renders "awaiting data — populates as activity flows", while a metric that
is **present but legitimately zero** in the window (errors, failures) draws a
flat zero line with a calm "no &lt;metric&gt; in this window" note.

---

## MCP Fleet

**Leaf:** `mcp-fleet` · **Page:** `MCPFleetV3.tsx`

The MCP Fleet page is the management surface for the Model Context Protocol
servers that supply the platform's tools. The page header shows totals
("N servers · M healthy · K tools indexed") and offers **+ add server**,
**import JSON**, and bulk actions.

### Data sources

| Hook | Endpoint | Use |
|---|---|---|
| `useMcpServers` | `GET /api/admin/mcp/servers` | per-server fleet list |
| `useMcpHealth` | `GET /api/admin/mcp/health` | health summary (total/healthy/tools indexed) |
| `useMcpStats` | `GET /api/admin/mcp-logs/stats` | call aggregates by server + tool |
| `useMcpLogs` | `GET /api/admin/mcp-logs` | recent call log |
| `useMcpHealthcheckHistory` | `GET /api/admin/mcp/servers/:id/healthcheck-history` | per-server probe history |
| (tools tab) | `GET /api/admin/mcp/tools-list` | all tools across servers |

The `GET /api/admin/mcp/servers` handler (`routes/admin/mcp-management.ts`)
**unions two sources**: the DB registry and the actually-loaded servers reported
by the mcp-proxy (the live truth, including pod-hosted built-ins and
user-connected remotes). Each row reports `synced_to_proxy` and `db_registered`
flags so the operator can see registry-vs-runtime drift.

### Status lifecycle

The fleet normalizes raw status into five categories. Notably, a built-in MCP
that **ships but is not enabled** (for example `aws`/`gcp`/`azure` with no
credentials) surfaces as a calm **`available · needs config`** badge — installable,
not an error — distinct from healthy (green), degraded (amber), down (red), and
unknown (gray).

| Category | Meaning |
|---|---|
| `healthy` | up / running / connected |
| `degraded` | warning state |
| `down` | failed / unreachable / error |
| `available` | shipped but env-disabled / not spawned (needs config) |
| `unknown` | unmapped |

### Views and KPIs

The list renders as **cards** or a **table**, with filters for status, tier
(t1/t2/t3), hosted (pod/remote), and free-text search. Four KPI tiles summarize
total servers (with a healthy/attention/available breakdown), a health triplet
(healthy · degraded · down), tools indexed, and calls/min (with a 24h spark). A
three-panel donut row shows **calls by server**, **calls by tool**, and **tools
by server**, all sourced from real `mcp_usage` aggregates (no Prometheus
required).

### Per-server detail panel

Selecting a server opens a side panel with six sub-tabs:

- **Overview** — metadata (status, tier, hosted, category, tool count,
  transport, endpoint, region, last call, source, `db_registered`,
  `synced_to_proxy`) plus a 24h probe-history strip with success/fail counts and
  p50/p95 latency, fed by the healthcheck-history endpoint.
- **Tools** — filterable list of the server's tools with descriptions and
  argument names (required args marked `*`), from `/api/admin/mcp/tools-list`.
- **Logs** — recent calls via `/api/admin/mcp-logs` (5s poll) with best-effort
  SSE live tail from `/api/admin/mcp/logs/stream`.
- **Config** — read-only identity / runtime / sync groups; **secrets are masked**
  in both the provider-config and auth-config dumps. A banner explains the source
  of truth: built-in MCPs are configured by per-MCP env flags on
  `openagentic-mcp-proxy` (the `OpenAgentic_<NAME>_MCP_DISABLED` flag).
- **IAM** and **Cost** sub-tabs round out the panel.

### Mutations

The page wires a full CRUD surface to the management routes:

| Action | Endpoint |
|---|---|
| Register a server | `POST /api/admin/mcp/servers` |
| Edit a server | `PATCH /api/admin/mcp/servers/:serverId` |
| Unregister a server | `DELETE /api/admin/mcp/servers/:serverId` |
| Test a server | `POST /api/admin/mcp/servers/:serverId/test` |
| Force-sync all | `POST /api/admin/mcp/sync` |
| Import from manifest | `POST /api/admin/mcp/servers/manifest` |

The **import JSON** modal accepts a Claude-Desktop-style `mcpServers` object or a
`{ "servers": [...] }` array, registers them, and triggers a reindex so new
tools become discoverable.

---

## LLM: Providers, Models, Default Models

The `llm` group hosts the model-routing control surface. OpenAgentic's
**SmartModelRouter is always on** — you never pass a `model` field; you register
providers and models and assign default-model roles, and the router picks.

### Provider Management

**Leaf:** `providers` · **Page:** `LLMProvidersPage.tsx`

Lists every registered LLM provider with health, model counts, and 24h spend.
Backed by:

- `GET /api/admin/llm-providers` — per-row provider list with `models[]`.
- `GET /api/admin/llm-providers/health` — per-provider health.
- `GET /api/admin/dashboard/counts` (for the spend/period KPIs via the metrics
  hook) and `/api/admin/audit-logs` (for the activity sub-tab).

KPI tiles show total providers (with disabled count), healthy/total, models
registered, and spend (24h). Six tabs — **overview, health, models, performance,
cost, activity** — plus a per-provider detail panel (overview / models / auth /
logs / cost). Mutations:

| Action | Endpoint |
|---|---|
| Add provider | `POST /api/admin/llm-providers` (via the provider modal) |
| Enable/disable / edit | `PUT /api/admin/llm-providers/:id` |
| Delete | `DELETE /api/admin/llm-providers/:id?force=true` |
| Re-probe health | `POST /api/admin/llm-providers/:name/test` |

The page also runs bulk enable/disable and bulk delete across selected rows.

### Models (Model Registry)

**Leaf:** `model-management` · **Page:** `ModelRegistryPage.tsx`

The model registry is the catalog of every model across all providers. KPI tiles
show models in registry, enabled/total, distinct providers, and average input
cost per 1M tokens. Five tabs — **catalog, capabilities, pricing, live usage,
playground** — and a per-model detail panel (overview / caps / pricing / usage
24h / logs).

Backed by:

- `GET /api/admin/llm-providers/registry?enabledOnly=false` — registry rows.
- `GET /api/admin/llm-providers` — to join provider display info.
- dashboard metrics (`modelUsage`) and `/api/admin/audit-logs` for the usage and
  logs panes.

Mutations:

| Action | Endpoint |
|---|---|
| Toggle a model | `PATCH /api/admin/llm-providers/registry/:id` `{ enabled }` |
| Delete a model | `DELETE /api/admin/llm-providers/:provider/models/:model?force=true` |
| Refresh one model | `POST /api/admin/llm-providers/:provider/models/:model/refresh` |
| Refresh all from providers | `POST /api/admin/llm-providers/registry/refresh-all` |

**Add model** opens a browse-catalog modal that lists the live provider SDK
catalog (Bedrock / Vertex / Ollama, sortable by capability/context) so admins
pick a model rather than typing IDs from memory — backed by
`/api/admin/llm-providers/:name/discover-models`. The bulk-refresh walks every
enabled provider, runs `discoverModels()` server-side, merges into the registry,
and reports `providersScanned`, `modelsAdded`, `modelsUpdated`, and errors.

Consistent with the platform's **no-hardcoded-model-IDs** rule, model IDs live in
the registry/seeder, not in source — the registry is where you manage them.

### Default Models, Router Tuning, Tiered Function Calling, Ollama Hosts, Performance

The remaining `llm` leaves render native v3 pages or sub-tabs:

- **Default Models** (`default-models`) — the assignment of registry models to
  routing roles (chat / code / embedding / imageGen). Backed by
  `/api/admin/llm-providers/default-models` and the registry.
- **Router Tuning** (`router-tuning`) — the Smart Router scoring weights and
  function-calling floors, via `/api/admin/router-tuning`.
- **Tiered Function Calling** (`tiered-fc`), **Ollama Hosts** (`ollama`), and
  **Performance Metrics** (`llm-performance`) — rendered through the LLM Extras
  hub. Performance is also a sub-tab on Provider Management.

---

## Audit logs

OpenAgentic ships **two** distinct audit surfaces. Both are read-only;
the tool-call log is additionally append-only.

### Audit Logs (unified activity feed)

**Leaf:** `audit-logs` (Flows group) · **Page:** `AuditLogsPage.tsx`

A unified, filterable activity feed that UNIONs every audit source into one shape
via the API's `activityAggregator`. The backing routes (`admin-audit-logs.ts`,
plural) are:

| Endpoint | Returns |
|---|---|
| `GET /api/admin/audit-logs` | main unified feed `{ success, logs, pagination }` |
| `GET /api/admin/audit-logs/stats` | counts by type + outcome over the range |
| `GET /api/admin/audit-logs/errors` | failures only |
| `GET /api/admin/audit-logs/sessions` | chat sessions feed |
| `GET /api/admin/audit-logs/export` | CSV (or JSON) of the current filter |

The page has six sub-tabs (**all, admin, errors, auth, sessions, resource**) and
chip filters for scope (`all` / `admin` / `user`), resource type (LLMProvider,
MCPServer, Workflow, User, Token, Prompt), status (success/error), free-text
search, and a time range (`1h` … `30d`). It polls every 5s and merges a
best-effort SSE live tail from `/api/admin/audit/logs/stream` (falling back to
the 5s poll if no SSE token is present). Four KPI cards show events (24h), errors
(24h), auth events, and admin actions (24h).

Clicking a row opens a detail side panel that renders the full record as JSON
with **common secret-shaped keys masked client-side** (`secret`, `token`,
`api_key`, `password`, `authorization`). **Export CSV** streams the current
filter through the `/export` endpoint.

### Approval Audit Log (tool-call decisions)

**Leaf:** `approval-audit` (System Management group) · **Page:**
`ApprovalAuditLogPage.tsx`

A read-only, append-only viewer over the `tool_call_audit_log` Prisma table —
this is the **trust moat**: every tool call is recorded, READ calls auto-audited
and MUTATING calls captured with their human-approval decision. Backed by the
singular route `GET /api/admin/audit-log` (`admin-audit-log.ts`), which is paged
and filterable by `decision`, `classification`, `tool_name`, and `user_id`.

Each row shows the timestamp, decision status, who decided, the tool and server
name, and the classification (read vs mutating). The decision filter chips are
`all / auto / approved / denied / timed_out / pending`. The page paginates (50
per page) over the full history.

```json
// one tool_call_audit_log row (shape the page renders)
{
  "id": "…", "tool_name": "aws_ec2_describe_instances",
  "server_name": "aws", "classification": "READ",
  "decision": "auto", "decided_by": null,
  "user_id": "…", "session_id": "…", "origin": "chat",
  "created_at": "2026-06-18T…Z"
}
```

---

## Tool permissions and governance

### User Permissions (Tool Permissions)

**Leaf:** `permissions` · **Page:** `PermissionsPage.tsx`

This is the **global** tool-permission surface — the platform-wide allow/deny/ask
rule editor plus the read-only kill switch. Backed by:

- `GET /api/admin/permissions` — `{ rules, pending }`.
- `PUT /api/admin/permissions` — replace the rule set.
- `POST /api/admin/permissions/reset` — reset to seeded defaults.
- `GET` / `PUT /api/admin/permissions/read-only-mode` — the global kill switch.

Rules use Claude-Code-style globs (for example `azure_list_*`, `*_delete_*`),
edited as three side-by-side textareas (one glob per line; blank lines and `#`
comments ignored):

- **allow.list** — auto-approved, no prompt.
- **deny.list** — auto-denied, never executed.
- **ask.list** — prompts the user in chat before executing.

Evaluation order: **deny beats allow beats ask** on a tie, more-specific globs
beat broader ones, and the default fall-through is **ask**. A **global READ-ONLY
mode** toggle (`#790`) is the master kill switch — when ON, every tool resolves to
deny except explicit allow-list matches, and the chat model is told via system
prompt so it stops emitting write calls. The page also lists **pending
approvals** (tool, user, age, reason), refreshed every 10s.

### Flows Governance and KPIs

The `openagentic flows` group includes a **Governance** leaf and a **KPI
Dashboard** leaf (rendered through the Flows Extras hub), plus per-flow
credentials and teams, for governing workflow execution.

---

## Prompt governance

**Leaf:** `prompt-modules` (and `pipeline-settings`, `prompt-effectiveness`,
`prompt-metrics`) · **Page:** `PromptsHubPage.tsx`

The Prompt Engineering hub consolidates prompt governance into one page with four
sub-tabs:

- **Pipeline Settings** — chat-pipeline prompt configuration.
- **Effectiveness** — prompt effectiveness analytics.
- **RBAC Templates** — role-keyed system-prompt templates, summarized from
  `GET /api/admin/rbac-system-prompts` (the page KPI shows how many role keys have
  an active version).
- **Service Prompts** — the named service prompt keys (slack, title-gen, memory,
  etc.), from `GET /api/admin/service-prompts`.

Two KPI tiles report active RBAC versions (of the seeded role keys) and the count
of service-prompt keys.

---

## Users, tokens, and system settings

### User Management

**Leaf:** `users` (and `permissions` opens the same page on its Permissions
sub-tab) · **Page:** `UserPermissionsPage.tsx`

A master/detail page: a left list of users with role/status filters and search,
and a right detail panel (profile / permissions / etc.). KPI tiles summarize total
users, users active in the last 7 days, and admins. An **invite user** modal
creates accounts. Per-user API tokens are surfaced via the user-tokens hook.

### Auth Access Control, User Lockouts, API Tokens, System Settings

These four System-Management leaves render through the **System Settings hub**
(`SystemSettingsHubPage.tsx`), each leaf opening its own sub-tab:

| Leaf | Sub-tab |
|---|---|
| `auth-access` | auth |
| `user-lockouts` | lockouts |
| `tokens` | tokens |
| `system-settings` | settings |

API tokens are backed by the `admin-api-tokens.ts` routes; auth/lockout settings
by the auth-access routes.

---

## Enriched Tools

**Leaf:** `enriched-tools` · **Page:** `EnrichedToolsPage.tsx`

Surfaces the EnrichedTool registry — per-tool metadata (`outputTemplate`,
`truncate_summary` template, input/output JSON Schemas, MCP server, category,
tier) that drives how tool output is split between the model channel (a compact
summary) and the UI channel (a render template). Default rows are seeded at boot
by `EnrichedToolSeeder` across cloud-ops / k8s / data / meta categories;
subsequent boots refresh structural fields but preserve admin-set `enabled`
flags. The API is live:

```text
GET    /api/admin/enriched-tools[?category|mcp_server|enabled]
GET    /api/admin/enriched-tools/:slug
POST   /api/admin/enriched-tools                 (upsert; admin only)
PATCH  /api/admin/enriched-tools/:slug/toggle    (enable/disable; admin only)
DELETE /api/admin/enriched-tools/:slug           (admin only)
```

---

## Theme: accent picker and Terminal Glass

The admin console is dark-first and uses the **Terminal Glass** design — frosted
glass panels over a warm dark field, IBM Plex Mono for technical labels, and a
single source-of-truth accent color.

### One source of truth

All `--color-*` palette tokens live in `src/styles/theme.css`, keyed on
`[data-theme]` and `[data-accent]`. Flipping those attributes on the document
element repaints every surface — there is no hand-synced palette map in the admin
code. The admin `useTheme` hook (`hooks/useTheme.ts`) only sets the
`data-theme` / `data-accent` / `data-density` attributes (and the legacy
`.dark` / `.light` class) and persists the choice to `localStorage`.

### Where you change it

Theme and accent are **not** edited from the admin top bar in v3 — the v3 TopBar
deliberately removed its theme toggle so there is a single place to change it. The
canonical control is the chat shell's **Settings → Appearance** menu
(`SettingsMenu.tsx`), which offers:

- **Mode** — Dark / Light.
- **Accent Color** — a swatch picker driven by `accentColors` in
  `contexts/ThemeContext.jsx`:

  | Accent | Color |
  |---|---|
  | Emerald (default) | `#34D399` |
  | Blue | `#1E40AF` |
  | Orange (signal orange) | `#FF5722` |
  | Purple | `#7C3AED` |

- **Background animations** toggle.

The admin `useTheme` hook keeps the admin surface in sync: it reads the chat
app's canonical `ac-theme` / `ac-accent-color` localStorage keys and re-applies
on `storage` and `focus` events, so changing the accent in the chat settings menu
immediately recolors the admin console. (Density — compact / cozy / comfortable —
is the one display setting still adjustable per-surface; the admin default is
`compact`.)

A separate, developer-oriented **theme inspector** panel (`ThemePanel.tsx`, used
by the v2 shell) lists the live resolved `--color-*` values grouped by background
/ foreground / line / accent, for debugging token resolution.

---

## Endpoint reference

The admin pages above are backed by these route files
(`services/openagentic-api/src/routes`):

| Area | Route file | Key endpoints |
|---|---|---|
| Dashboard counts | `admin-dashboard-counts.ts` | `GET /api/admin/dashboard/counts` |
| Analytics (Prometheus) | `admin/prom-proxy.ts` | `POST /api/admin/prom/query`, `/query_range`; `GET /api/admin/prom/labels`, `/health` |
| MCP Fleet | `admin/mcp-management.ts` | `GET/POST /api/admin/mcp/servers`, `PATCH/DELETE /…/:serverId`, `/test`, `/sync`, `/manifest`, `/tools-list`; `GET /api/admin/mcp/health` |
| MCP logs | `admin-mcp-logs.ts` | `GET /api/admin/mcp-logs`, `/api/admin/mcp-logs/stats` |
| Providers / Models | `admin/llm-providers.ts` | `GET /api/admin/llm-providers`, `/health`, `/registry`; CRUD + `/test`, `/refresh-all`, `/discover-models` |
| Unified audit feed | `admin-audit-logs.ts` | `GET /api/admin/audit-logs`, `/stats`, `/errors`, `/sessions`, `/export` |
| Tool-call audit | `admin-audit-log.ts` | `GET /api/admin/audit-log` |
| Tool permissions | `admin/permissions.ts` | `GET/PUT /api/admin/permissions`, `/reset`, `/read-only-mode` |
| Prompt governance | `admin-prompts.ts`, `admin-service-prompts.ts` | `GET /api/admin/rbac-system-prompts`, `/service-prompts` |
| Roles | `admin-roles.ts` | system roles (admin / user / viewer) |
| API tokens | `admin-api-tokens.ts` | `GET/POST /api/admin/api-tokens` |
| Router tuning | `admin/router-tuning.ts` | `GET /api/admin/router-tuning` |
| Enriched tools | `admin/enriched-tools.ts` | `GET/POST/PATCH/DELETE /api/admin/enriched-tools` |
| Admin AI agent | (ai routes) | `POST /api/admin/ai/ask` (SSE) |

All of the above require an admin token; the guard middleware returns 401 (no/
invalid token) or 403 (valid non-admin token).
