# Architecture

OpenAgentic is a small fleet of cooperating services, not a monolith. Each one
has a single responsibility, talks to the others over the internal Docker
network, and shares a small set of stateful backends (PostgreSQL, Redis,
Milvus). This page is the canonical map of that topology: what each service
does, how a chat turn actually flows through the system, how MCP tools are
spawned and discovered, how flows execute, how vector search works, how
sub-agents are dispatched, and how the services authenticate to one another.

Everything below is grounded in the real `docker-compose.yml` and service
source. Where a behavior is subtle (the chat tool pipeline, internal-auth token
formats), the relevant file is cited so you can read it yourself.

---

## Service topology

A default `docker compose --profile milvus up -d` brings up the following
containers. They all share a single bridge network (`oap`) and reach each other
by service name.

| Service | Image / build | Internal address | Responsibility |
|---|---|---|---|
| `api` (openagentic-api) | `openagentic-api` | `http://api:8000` | The platform brain: chat + streaming, flows orchestration, LLM provider/model management, RAG, auth, admin. Fastify, plugin-per-domain. |
| `ui` (openagentic-ui) | `openagentic-ui` | published on `:8080` | React SPA served by nginx; reverse-proxies `/api/*` to the api. The only port you open in a browser. |
| `workflows` (openagentic-workflows) | `openagentic-workflows` | `http://workflows:3400` | Standalone flow-execution engine. Runs flow graphs out-of-process so heavy runs never block the api event loop. |
| `mcp-proxy` (openagentic-mcp-proxy) | `openagentic-mcp-proxy` | `http://mcp-proxy:8080` | Spawns the built-in MCP servers as subprocesses and fronts them with one JSON-RPC/HTTP surface. Python/FastAPI. |
| `proxy` (openagentic-proxy) | `openagentic-proxy` | `http://proxy:3300` | Sub-agent dispatch / egress: runs `Task` sub-agents and background agents, relays their progress back to the chat stream. Fastify. |
| `ollama` | `ollama/ollama` | `http://ollama:11434` | Local model runtime. Always required — it serves the embedding model used for semantic tool indexing, and optionally a local chat model. |
| `ollama-init` | `ollama/ollama` | one-shot | Pulls the embedding model (`nomic-embed-text`) on first boot, then exits. |
| `postgres` | `pgvector/pgvector:pg16` | `postgres:5432` | System-of-record. All relational state + `pgvector`/`halfvec` embedding columns. |
| `redis` | `redis:7-alpine` | `redis:6379` | Cache, pub/sub (live prompt invalidation, SSE relay), MCP enabled-state, execution store. |
| `milvus` | `milvusdb/milvus:v2.4.15` | `milvus:19530` | Vector database for semantic search (tool catalog, agents, memories, patterns, docs). **Mandatory** — the api exits at boot if it cannot connect. |
| `etcd` | `quay.io/coreos/etcd` | internal | Milvus metadata store. |
| `minio` | `minio/minio` | internal | Milvus object storage backend. |
| `searxng` | `searxng/searxng` | `http://searxng:8080` | Free self-hosted metasearch engine; the default search backend for the `web` MCP (no API key needed). |
| `prometheus` | `prom/prometheus:v2.54.1` | `prometheus:9090` | Scrapes `/api/metrics` (and the proxy/workflows) so the admin dashboard shows real data. Published on `:9090`. |

> **Profile gating.** `etcd`, `minio`, and `milvus` are gated behind the
> `milvus` compose profile so they pull as one unit. Because the api requires
> Milvus on boot, a bare `docker compose up -d` (no profile) crashes the api.
> Always use `docker compose --profile milvus up -d`. `prometheus` is in the
> default profile — it lights up the dashboard on a normal `up`.

### Why a fleet, not a monolith

The split is deliberate:

- **`workflows` is separate from `api`** so a long, branchy flow run can't block
  the api's chat event loop. The api delegates every flow run to
  `POST /execute-sync` (or `/execute` for SSE) on the workflows service.
- **`mcp-proxy` is separate** so MCP server subprocesses (Python FastMCP, npx,
  etc.) live in their own container with their own credential mounts, and can be
  started/stopped/restarted independently of the api.
- **`proxy` is separate** so sub-agent fan-out runs in its own process with its
  own loop detection, cost tracking, and budget enforcement, isolated from the
  parent chat turn.

---

## Stateful backends

### PostgreSQL + pgvector

PostgreSQL is the system of record for everything relational — users, sessions,
chat messages, LLM providers/models, flow definitions, audit tables, RBAC
prompts, and more. The image is `pgvector/pgvector:pg16`, and
`scripts/postgres-init/01-extensions.sql` runs `CREATE EXTENSION IF NOT EXISTS
vector` on first boot so Prisma's `halfvec` embedding columns can be created
during schema push.

Schema is managed by Prisma. The api's boot path runs the schema migration
before starting the server, so a fresh database self-provisions on first launch.

### Redis

Redis is the shared coordination layer:

- **Caching** — provider/model state, router tuning, embedding/tool caches.
- **Pub/sub** — e.g. `prompt:invalidate` so admin edits to RBAC system prompts
  propagate live without a container rebuild.
- **MCP enabled-state** — `mcp:server:enabled:*` keys let runtime toggles
  override the proxy's build-time MCP configuration.
- **SSE relay + execution store** — the `proxy` service relays sub-agent
  progress and stores execution records through Redis.

### Milvus (mandatory)

Milvus is the vector database. The api connects to it on boot and calls
`process.exit(1)` if it is unreachable — there is **no** pgvector-only fallback
for the boot connection (`MILVUS_HOST` defaults to `milvus`). Milvus standalone
is itself three containers: `milvus` plus its `etcd` (metadata) and `minio`
(object storage) dependencies.

Milvus holds the semantic-search collections the platform relies on, including:

| Collection (conceptual) | Used by | Purpose |
|---|---|---|
| MCP tool catalog (`mcp_tools_*`) | `tool_search` discovery | Semantic search over every indexed MCP tool. |
| `mcp_agents_cache` | `agent_search` | Semantic search over the agent registry. |
| `learned_patterns` | `pattern_save` / `pattern_recall` | Model-curated, user-scoped tool-chain exemplars. |
| User memories | memory recall | Per-user semantic memory injected into the system prompt. |
| Docs RAG | documentation search | Embedded platform docs for retrieval. |

`SKIP_TOOL_SEMANTIC_CACHE` only gates **embedding generation / RAG indexing** —
it does *not* let the api skip the mandatory Milvus boot connection.

### Ollama

Ollama is required even on an all-cloud install because it serves the **embedding
model** used to index the tool catalog and power semantic discovery. The
`ollama-init` one-shot pulls `nomic-embed-text` (768-dim) on first boot. Ollama
can also serve a local **chat** model (e.g. `gpt-oss:20b`) when one is pulled, so
a zero-API-key install can chat entirely locally.

---

## Anatomy of a chat turn

A chat turn is the most important data flow in the system. OpenAgentic uses a
**V2 discovery-mode** tool pipeline: the model is given a small set of
always-on meta-tools (not the full MCP catalog), and it pulls in the specific
MCP tools it needs mid-turn via a `tool_search` meta-tool. This keeps the
per-turn token cost low even with hundreds of MCP tools registered.

### Request path

```
Browser (UI)
   │  POST /api/chat/stream   (SSE)
   ▼
nginx (ui container)  ── proxies /api/* ──▶  api:8000
   │
   ▼
openagentic-api  ── chat plugin → V2 discovery pipeline (runChat / chatLoop)
   │
   ├─▶ ChatMCPService.listTools()      ── GET mcp-proxy:8080/servers + tools
   ├─▶ SmartModelRouter.routeRequest() ── pick the model (never client-specified)
   ├─▶ LLM provider.createCompletion() ── Ollama / Bedrock / …
   └─▶ tool dispatch                   ── mcp-proxy /mcp (tools/call) or T1 meta-tool
```

### Stage by stage

**1. Build the tool array (meta-tools only at turn 1).**
The pipeline assembles the tool array in `buildChatToolArray`
(`routes/chat/pipeline/chat/toolRegistry.ts`). At turn 1 the model is given the
**T1 meta-tool catalog** — the agentic primitives that ship inside the
openagentic-api image, *not* the full MCP catalog. These include:

```
tool_search   ── semantic discovery over the indexed MCP tool catalog
agent_search  ── semantic discovery over the agent registry
Task          ── dispatch a sub-agent (capability-gated per model)
agent_send / agent_list / agent_stop  ── sub-agent lifecycle
read_large_result
web_search / web_fetch
pattern_save / pattern_recall         ── self-curated tool-chain memory
memorize / memory_search              ── per-user RAG memory
compose_visual / compose_app / generate_image / render_artifact
request_clarification
```

> Earlier designs shipped a "cascade" that pre-filtered the full ~270-tool MCP
> catalog into the turn. That was ripped (2026-04-30). The model now sees
> meta-tools plus `tool_search`; the actual MCP tools are resolved mid-turn.
> See `services/openagentic-api/CLAUDE.md` (V2 section) for the debug seams.

**2. SmartModelRouter picks the model.**
`SmartModelRouter.routeRequest()` (`services/SmartModelRouter.ts`) is **always
on**. It analyzes the request (tool use, vision, prompt shape via the
`PromptClassifier`), filters the live set of routable, DB-registered models by
capability floors (function-calling accuracy, context window), and scores them
on cost + quality. **Never pass a `model:` field in an API body** — the router
owns model selection. There are no hardcoded model IDs outside the provider
adapters, embedding service, and seeder.

**3. The model runs and may call `tool_search`.**
The selected provider's `createCompletion({ tools: [...] })` runs. When the
model wants a capability it doesn't see in its meta-tool set, it calls
`tool_search` with a plain-language query. The `executeToolSearch` dispatcher
(`services/ToolSearchTool.ts`) hits an internal tool-search endpoint backed by a
semantic-cache service over the Milvus MCP-tool collection and returns matching
tool definitions.

**4. Discovered tools expand the catalog for the next turn.**
`chatLoop.ts` carries a discovery side-channel: when `tool_search` /
`agent_search` return `discoveredTools`, the loop appends them (deduped by
function name) to the `tools` array so the model sees them on the **next** turn.
This is the discovery handshake — small base catalog, on-demand expansion,
without paying the token cost of shipping every tool every turn.

**5. MCP tools execute through the mcp-proxy.**
When the model emits a `tool_use` for an MCP tool, the api dispatches it to the
mcp-proxy's `/mcp` endpoint as a JSON-RPC `tools/call`. The api authenticates
that call with an inter-service token (see [Internal service
auth](#internal-service-authentication)). Mutating tool calls pass through the
approval gate / audit log before they run.

**6. Robustness for weak local models.**
Small local models (e.g. `gpt-oss:20b`) sometimes skip the `tool_search`
handshake and emit an MCP tool call directly by name. Rather than dropping the
unknown call, the pipeline resolves it by exact name against the indexed MCP
catalog and executes it through the same audited dispatch seam, so the platform
works out-of-the-box on local Ollama.

### The discovery seams (for debugging)

The three structured log lines that triangulate a chat turn's tool wiring are
documented in `services/openagentic-api/CLAUDE.md` under "V2 discovery-mode
debug recipe": `[STREAM] V2 mcpTools loaded` → `[V2] discovery entry` → `[V2]
discovery exit`. Under discovery-mode, `rankedMcpToolsCount=0` is **normal** —
tools resolve mid-turn via `tool_search`, not by pre-ranking.

---

## How the mcp-proxy spawns MCP servers

The mcp-proxy is the bridge between the LLM tool layer and the actual MCP
servers. On startup, `mcp_manager.initialize_servers()`
(`services/openagentic-mcp-proxy/src/mcp_manager.py`) registers each built-in
MCP server, gated by a per-server `*_MCP_DISABLED` environment flag. Most
servers are spawned as **stdio subprocesses** (Python FastMCP); a few support a
remote HTTP mode when a `*_MCP_URL` is set.

### The nine built-in MCPs

| MCP | Server id | Spawn command (default) | Credentials |
|---|---|---|---|
| web | `openagentic_web` | `python .../oap-web-mcp/server.py` | none — uses SearXNG (`SEARXNG_URL`) |
| admin | `openagentic_admin` | `fastmcp run -t stdio .../oap-admin-mcp/server.py` | none — reads platform DB/Redis/Milvus (admin users only) |
| kubernetes | `openagentic_kubernetes` | `fastmcp run -t stdio .../oap-kubernetes-mcp/server.py` | kubeconfig / in-cluster SA |
| aws | `openagentic_aws` | `fastmcp run -t stdio .../oap-aws-mcp/server.py` | static keypair (boto3 default chain) |
| azure | `openagentic_azure` | `fastmcp run -t stdio .../oap-azure-mcp/src/server.py` | service principal |
| gcp | `openagentic_gcp` | `fastmcp run -t stdio .../oap-gcp-mcp/src/server.py` | service account |
| prometheus | `openagentic_prometheus` | `fastmcp run -t stdio .../oap-prometheus-mcp/server.py` | `PROMETHEUS_URL` (wired to in-stack `prometheus:9090`) |
| loki | `openagentic_loki` | `fastmcp run -t stdio .../oap-loki-mcp/server.py` | external `LOKI_URL` |
| github | `openagentic_github` | `fastmcp run -t stdio .../oap-github-mcp/server.py` | PAT (`GITHUB_TOKEN`) |

> **All nine spawn out-of-the-box.** None of them hard-require a token/URL just
> to *start* — the subprocess boots, and an unconfigured server only surfaces a
> "needs config" / connection error when a tool is actually called. `web`,
> `admin`, and `kubernetes` (in-cluster) need no external credentials at all.
> `MCPS_ENABLED` is documentary only; the real per-MCP gate is each
> `OpenAgentic_*_MCP_DISABLED` flag read by `initialize_servers`.

### Credential sourcing

The mcp-proxy prefers the operator's existing host CLI configs. Compose mounts
`~/.azure`, `~/.aws`, `~/.config/gcloud`, and `~/.kube` read-only into the
container, so the cloud MCPs pick them up via their default credential chains —
the same auth the operator already has on their box. As a fallback, env files
from `~/.openagentic/cloud-secrets/*.env` are loaded (install.sh creates empty
stubs so the mounts never fail). This is what makes "show me my Azure subs" work
within minutes of install.

### One surface for the api

The api never talks to the individual MCP servers directly. It fetches the live
server list from `GET mcp-proxy:8080/servers`, lists tools, and routes
`tools/call` JSON-RPC requests through `POST mcp-proxy:8080/mcp` (the proxy
selects the target server and forwards the call). The catalog the api indexes
into Milvus is built from what the proxy reports.

---

## The flows engine

Flows are graph-based workflows (the engine is Flowise-derived) that wire MCP
tools, LLM nodes, and control flow into repeatable automations. Flow execution
is a **separate service** (`openagentic-workflows`) so a heavy run never blocks
the api.

```
api  ── POST workflows:3400/execute-sync   (JSON, internal-key auth)
     ── POST workflows:3400/execute        (SSE stream)
     ▼
WorkflowExecutionEngine
   ├─ WorkflowCompiler   ── compiles the graph
   ├─ node registry      ── mcp_tool / llm / control nodes
   ├─ approval gate      ── human-in-the-loop pause/resume
   └─ scheduler          ── cron-triggered runs
```

Key facts grounded in `services/openagentic-workflows/src/index.ts`:

- The api delegates flow runs by calling the workflows service at
  `WORKFLOW_SERVICE_URL` (default `http://workflows:3400`). Without that the api
  errors with "WORKFLOW_SERVICE_URL is not set".
- The engine and api share the **same PostgreSQL database** — flow definitions,
  templates, and execution records are Prisma tables. The api runs the schema
  push, so the workflows service `depends_on` the api being healthy before it
  boots and seeds templates.
- **MCP-tool nodes** call the same mcp-proxy as chat (`MCP_PROXY_URL`, default
  `http://mcp-proxy:8080`), authenticating with the shared internal key.
- **Human-in-the-loop** is built in: a flow can pause on a needs-input gate
  (`approvalGate` / `dataRequestSubmissionHandler`) and resume on a later API
  call.
- A built-in **scheduler** fires cron-triggered flows.

---

## Vector search: Milvus + pgvector

OpenAgentic uses two complementary vector stores:

- **Milvus** is the primary semantic-search engine for runtime discovery: the
  MCP tool catalog (`tool_search`), the agent registry (`agent_search`,
  `mcp_agents_cache`), learned patterns, user memories, and docs RAG. Searches
  are cosine similarity over embeddings.
- **pgvector / `halfvec`** columns in PostgreSQL give the same embeddings an
  ACID home alongside their relational rows — durable, transactional storage
  that survives a Milvus rebuild and supports SQL-side semantic queries.

### How tools get indexed

`MCPToolIndexingService` (`services/openagentic-api/src/services/MCPToolIndexingService.ts`)
runs the indexing pipeline:

1. Load MCP tools from the mcp-proxy.
2. Generate embeddings for each tool's searchable text via
   `UniversalEmbeddingService` (Ollama `nomic-embed-text`, 768-dim, by default;
   other providers supported).
3. Store them in the Milvus tool collection for semantic search.
4. Cache them in Redis for fast fallback.
5. Persist them to PostgreSQL with pgvector embeddings.

On first boot the tool index is empty; the platform warns and continues rather
than failing, and indexing re-triggers on the first chat request. Discovery
(`tool_search`) queries the Milvus collection populated by this service.

---

## Sub-agent dispatch via openagentic-proxy

When the chat model (or a flow) needs to fan work out to specialist agents, it
calls the `Task` / `agent_send` / `agent_list` / `agent_stop` meta-tools. These
dispatch to the **openagentic-proxy** service, which runs the sub-agents in an
isolated process.

```
api (chat tool dispatch)
   │  POST proxy:3300/api/agents/execute        (start)
   │  POST proxy:3300/api/agents/executions/:id/send   (follow-up)
   │  GET  proxy:3300/api/agents/executions/:id        (status)
   ▼
openagentic-proxy
   ├─ AgentOrchestrator  ── parallel / sequential / supervisor / hierarchical
   ├─ AgentRunner        ── per-agent ReAct loop + loop detection + budget
   ├─ MCPBridge          ── sub-agent MCP tool calls → mcp-proxy
   └─ SSERelay (Redis)   ── progress events → /api/chat/agent-event → chat stream
```

Grounded behaviors:

- The orchestrator resolves agent config from the api
  (`GET /api/agents/resolve`) and supports `parallel`, `sequential`,
  `supervisor`, and `hierarchical` orchestration plus `merge` / `synthesize` /
  `first` / `vote` aggregation (`AgentOrchestrator.ts`).
- Each sub-agent's LLM completions go **back through the api**
  (`POST /api/v1/chat/completions`), so SmartModelRouter still chooses the model
  for sub-agents — no hardcoded model in the proxy.
- Sub-agent MCP tool calls go through `MCPBridge` to the same mcp-proxy as the
  main chat turn; mutating calls hit the same approval/audit path.
- `AgentRunner` enforces loop detection, cost tracking, and budget limits per
  sub-agent so a runaway agent can't burn the turn.
- Progress streams back via Redis (`SSERelay`) and an HTTP callback to
  `/api/chat/agent-event`, which re-emits the events on the parent chat SSE
  stream so the user sees sub-agent activity live.

---

## Internal service authentication

All internal traffic between services is authenticated with a small set of
shared secrets that **must agree across the api, ui, workflows, mcp-proxy, and
proxy**. Compose passes them all from `.env`, and they use fail-fast `${VAR:?}`
guards (install.sh generates them with `openssl rand -hex 32`). No weak defaults
ship.

| Secret | Set on | Purpose |
|---|---|---|
| `JWT_SECRET` | api, ui, workflows, mcp-proxy | Signs/validates user + internal HS256 JWTs. |
| `SIGNING_SECRET` | api, ui, workflows, mcp-proxy | Shared signing secret for internal JWTs. |
| `INTERNAL_API_KEY` | api, ui, workflows, mcp-proxy, proxy | The shared service-to-service trust root (the proxy reads it as `API_INTERNAL_KEY`; the openagentic-proxy reads it as `OPENAGENTIC_PROXY_INTERNAL_KEY`). |
| `INTERNAL_SERVICE_SECRET` | api, mcp-proxy | HMAC key for the `oa_sys_` inter-service system token. |

### Credential types the mcp-proxy accepts

The mcp-proxy's `get_user_info` (`main.py`) accepts these credential types, in
order, and **fails closed** when auth is enabled and no valid credential is
presented:

1. **`oa_sys_` system token** — the api mints it as
   `oa_sys_<HMAC_SHA256(INTERNAL_SERVICE_SECRET, "openagentic-system-token")>`
   via `mintInterServiceSystemToken`; the proxy HMAC-verifies it with the same
   secret (constant-time). A forged `Bearer oa_sys_<anything>` fails
   verification and is rejected. Grants a system-root service-principal context.
2. **`oa_` user API key** — validated by calling back to the api's
   `/api/auth/me`.
3. **`INTERNAL_API_KEY` (raw)** — the api→proxy service path; grants a service
   account context with SP credentials.
4. **Internal HS256 JWT** — validated against the shared signing secret.

### How the api authenticates a tool call

When dispatching an MCP `tools/call`, the api builds the `Authorization` header
in priority order (`ChatMCPService.ts`): the inbound user's `Bearer <token>` if
present, otherwise the minted `oa_sys_` inter-service token, otherwise the raw
`INTERNAL_API_KEY` as a last-ditch service credential. The workflows engine
authenticates its MCP-tool nodes with `Bearer ${API_INTERNAL_KEY}`.

### How the openagentic-proxy authenticates dispatch

The openagentic-proxy's `authMiddleware` (`proxy/src/middleware/auth.ts`)
accepts an internal-service fast path: a request stamped with `X-Agent-Proxy:
true` **and** `Authorization: Bearer ${OPENAGENTIC_PROXY_INTERNAL_KEY}` is
treated as the system service account. Otherwise it validates the bearer token
against the api (`POST /api/auth/validate-token`, 60s cache). The api's
`agent_send` / `agent_list` tools **fail closed** if
`OPENAGENTIC_PROXY_INTERNAL_KEY` is unset — they refuse to call the proxy rather
than dispatch unauthenticated.

### User authentication (OSS)

The OSS edition is **local-auth only**: username/password stored in PostgreSQL,
JWT sessions, and `oa_`-prefixed API keys. There is no SSO, Azure AD, OBO, or
MFA in the open-source build (`AUTH_PROVIDER=local`). The initial admin is
seeded on first boot from `ADMIN_USER_EMAIL` / `ADMIN_SEED_PASSWORD`.

---

## Putting it together

A single "show me my Kubernetes pods, then summarize" request touches most of
the fleet:

1. The **UI** posts to `/api/chat/stream`; nginx proxies it to the **api**.
2. The **api** builds the meta-tool array, **SmartModelRouter** picks a model,
   and the chosen **provider** (Ollama or a cloud LLM) runs.
3. The model calls **`tool_search`**, which queries the **Milvus** tool catalog
   and returns the kubernetes tools; `chatLoop` adds them for the next turn.
4. The model emits a kubernetes tool call; the **api** dispatches it via an
   `oa_sys_` token to the **mcp-proxy**, which forwards it to the spawned
   **kubernetes MCP subprocess** (using the mounted kubeconfig).
5. The result streams back; the model synthesizes a summary; **Prometheus**
   records the metrics the admin dashboard reads.

Every dependency is connection-checked at `GET /api/health`, and every service
self-reports against the same shared backends described above.
