# openagentic-api — Service-Level Patterns

API-specific patterns for contributors and agents. Companion to the root `CLAUDE.md`.

## server.ts Contract (Phase 3 decomposition — completed Phase 5)

`server.ts` is a thin orchestrator. Its job is:

1. **Bootstrap** — run numbered startup steps (`src/startup/01-secrets.ts` … `11-validate-admin-portal.ts`)
2. **Decorate** — call `decorateApp(server, ctx)` to attach the `AppContext` singleton as `server.app`
3. **Register plugins** — one `server.register(plugin)` call per domain; NO route logic lives in `server.ts`

### AppContext Pattern

```ts
// src/context/AppContext.ts
export interface AppContext {
  milvusClient: MilvusClient;
  redis: UnifiedRedisClient;
  providerManager: ProviderManager;
  // …
}
```

Plugins access it via:

```ts
const ctx = (fastify as any).app;                 // inside plugin body
const milvusClient = options.milvusClient ?? ctx?.milvusClient;
```

Ordering guarantee is caller-level (server.ts runs `decorateApp` before `registerAllRoutes`), NOT Fastify-enforced. Plugin `dependencies: []` is intentional.

### BootstrapStep Pattern

Every file in `src/startup/` exports a `BootstrapStep`:

```ts
// src/startup/types.ts
export interface BootstrapStep {
  name: string;
  critical: boolean;
  run(deps: { server: FastifyInstance; ctx: AppContext }): Promise<void>;
}
```

`critical: true` steps abort startup on failure; `critical: false` steps log and continue.

### Plugin-Per-Domain Rule

Each domain has exactly one plugin file in `src/plugins/`. The plugin:
- Has a strongly-typed `XxxRoutesPluginOptions` interface (exported)
- Wraps sub-routes in independent `try/catch` blocks (a single failing sub-route never blocks others)
- Uses static top-of-file imports for all route modules EXCEPT those that are:
  - Feature-gated at runtime (e.g. `ollamaEnabled`, `ssoActive`)
  - Inside HTTP handler bodies (lazy by design)
  - Native binding hazards (`src/startup/06-rag.ts` — milvus bindings)
  - Conditionally initialized singletons (e.g. `SynthService` in `memory-ai.plugin.ts`)

Current domain plugins:

| Plugin file | Domain | Prefix(es) |
|---|---|---|
| `admin.plugin.ts` | Admin routes | `/api/admin/*` |
| `auth.plugin.ts` | Authentication | `/api/auth/*` |
| `chat.plugin.ts` | Chat & streaming | `/api/chat/*` |
| `user.plugin.ts` | User profile | `/api/user*` |
| `docs.plugin.ts` | Documentation | `/api/docs/*` |
| `models.plugin.ts` | Model/provider management | `/api/models/*`, `/api/providers/*` |
| `memory-ai.plugin.ts` | Memory, prompting, synth | `/api/memories/*`, `/api/prompts/*`, `/api/synth/*` |
| `workflows.plugin.ts` | Workflows & orchestration | `/api/workflows/*`, `/api/orchestrate/*` |
| `storage-data.plugin.ts` | Storage, images, files | `/api/storage/*`, `/api/files/*` |
| `admin-audit.plugin.ts` | Audit logs & metrics | `/api/admin/audit/*` |
| `admin-mcp.plugin.ts` | MCP management | `/api/admin/mcp/*` |
| `admin-observability.plugin.ts` | Analytics & monitoring | `/api/admin/analytics/*` |
| `admin-misc.plugin.ts` | Misc admin routes | `/api/admin/auth/*`, `/api/openagentic/*`, … |
| `integrations.plugin.ts` | SSO integrations | `/api/integrations/*` |
| `cluster.plugin.ts` | Cluster services | `/api/cluster-services` |
| `misc.plugin.ts` | Miscellaneous | various |
| `v1.plugin.ts` | v1 API router | `/v1/*` |
| `health.plugin.ts` | Health checks | `/health`, `/healthz` |

### featureFlags Pattern

`src/config/featureFlags.ts` resolves `process.env.*` once at module load time. Use it in plugins instead of inline `process.env` reads:

```ts
import { featureFlags } from '../config/featureFlags.js';

// Instead of: process.env.OLLAMA_ENABLED === 'true'
if (featureFlags.ollamaEnabled) { ... }

// Instead of: process.env.AUTH_PROVIDER || 'azure-ad'
const provider = options.authProvider || featureFlags.authProvider;
```

Safe for vitest: test workers start fresh per file, and tests `await import(plugin)` inside `beforeAll` AFTER setting env vars — so featureFlags resolves with the test values.

## Seeder Patterns

- `LLMProviderSeeder` uses `SEEDER_VERSION` env var for schema version gating. Bump it when seed schema changes or existing DB rows at the old version are never re-synced.
- Bootstrap provider is seeded from helm `values.yaml`; all other providers/models go through the Admin UI.
- The seeder adds exactly 3 default models (chat/code/embedding) — no auto-population from provider discovery.

## RAG Patterns

- `src/startup/06-rag.ts` keeps ALL imports dynamic — native milvus bindings must not load at module parse time.
- `SKIP_TOOL_SEMANTIC_CACHE=false` is required; `true` disables ALL tool embedding generation + RAG init.

## Model Routing Rules

- NO hardcoded model IDs anywhere in source except `UniversalEmbeddingService`, `ProviderManager`, `LLMProviderSeeder`, and env-var parsing helpers. See root `docs/rules/no-hardcoded-models.md`.
- Smart Router is always on — never specify a `model:` field in API bodies.

## DB Migration Patterns

- Schema changes are forward-only. Edit `prisma/schema.prisma` → `prisma migrate dev --name <slug>` locally → commit the generated `prisma/migrations/<ts>_<slug>/migration.sql`. The boot path (`docker-entrypoint.sh`) runs `prisma migrate deploy`, with P3005 auto-baseline for legacy environments. Never `prisma db push --accept-data-loss` on a live DB — it bypasses the migration log and silently drops drifted columns. Pinned by `__tests__/architecture/no-destructive-migration-at-boot.source-regression.test.ts`.
- Never `psql INSERT/UPDATE/DELETE` directly on live DB — use helm seeder or API admin endpoints.

## V2 Cascade Architecture (chatmode tool routing)

The chatmode tool-array path is a single primitive (`ToolRankerService.rankAndSubset`) called from two places (main agent in `runChatV2Pipeline`, sub-agents via `BuiltInAgentScope.executeMcpTool`). Stages, in order:

```
USER PROMPT
   │
   ▼  IntentClassifierService.classify()
   │  one LLM call, Redis-cached, JSON-mode
   │  → { intent, server?, keywords?, confidence }
   ▼
ChatMCPService.listTools()  ── returns 270 normalized OpenAI-shape MCP tools
   │
   ▼  ToolRankerService.rankAndSubset()
   │  Stage 1  wildcardScope filter (sub-agent only — frontmatter `tools: [...]`)
   │  Stage 2  server prefix filter (e.g. `azure_*` keeps ~71 of 270)
   │  Stage 3  keyword lexical filter (name/description substring match)
   │  Stage 4  semantic top-K (Milvus cosine over pgvector embeddings, BM25 fallback)
   │  Stage 5  real-def hydration (canonical tool defs — never stub strings)
   ▼
buildChatToolArray() prepends 6 meta tools (Task, compose_visual, render_artifact,
                                            request_clarification, browser_sandbox_exec, memorize)
   │
   ▼  Smart Router selects model — never tier-based handoff. Whatever the router
   │  picks gets the cascade-narrowed array. Incapability is the model's job to
   │  signal (request_clarification), not the platform's to short-circuit.
   ▼
provider.createCompletion({ tools: [6 meta + N MCP] })
```

**V2 discovery-mode debug recipe — read these three structured log lines in order:**

The cascade was ripped 2026-04-30 (`runChatV2Pipeline.ts:412-461`); V2 is now discovery-mode (model gets meta tools + `tool_search`, MCP tools resolved via `discoveryHook` mid-turn). Log seam names changed accordingly.

| Seam | File | Log msg | Field |
|---|---|---|---|
| 1 | `routes/chat/handlers/stream.handler.ts:1100` | `[STREAM] V2 mcpTools loaded` | `listMcpToolsCount` |
| 2 | `routes/chat/pipeline/v2/runChatV2Pipeline.ts:451` | `[V2] discovery entry — model gets meta+tool_search; MCP via discovery` | `inputMcpToolsCount`, `hasRanker`, `hasIntentClassifier`, `classifiedIntent`, `classifiedServer`, `classifiedKeywords`, `cascadeMode: 'discovery'` |
| 3 | `routes/chat/pipeline/v2/runChatV2Pipeline.ts:460` | `[V2] discovery exit — meta-only base; tool_search expands via discoveryHook` | `rankedMcpToolsCount` (always 0 — discovery-mode), `mcpCatalogSize`, `cascadeMode: 'discovery'` |

Triangulation:
- `seam #1 listMcpToolsCount=270` AND `seam #2 inputMcpToolsCount=0` → `normalizeToolArray` is dropping tools (shape mismatch).
- `seam #2 hasIntentClassifier=false` → `chat/index.ts` v2-deps init silently failed the redis/milvus/embeddings AND-gate.
- Seam #3 always reports `rankedMcpToolsCount=0` under discovery-mode by design — this is normal post-rip behavior, not a bug. Tools resolve mid-turn via the model invoking `tool_search`.

Pinned by `__tests__/architecture/cascade-tool-array-instrumentation.source-regression.test.ts` and the live battery at `tests/e2e/cascade-tool-routing.spec.ts` (10 probes covering chat / cloud-list / k8s / aws / azure / single-read / cost+sankey / architecture / clarification / ambiguous).

**Do NOT read `[OllamaProvider] toolNames` to gauge MCP tool presence** — that field is sliced to the first 5 names, which happens to equal the 6 meta tool names whenever an MCP-using turn dispatches. Read `toolCount` instead. Tracked in #566 to log a count-by-prefix breakdown instead.
