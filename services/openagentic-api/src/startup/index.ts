import { loggers } from '../utils/logger.js';
import { bootstrapStepDuration } from '../metrics/index.js';
import type { BootstrapDeps, BootstrapStep } from './types.js';

export type { BootstrapDeps, BootstrapStep } from './types.js';

// Step imports — added one by one as each file is created.
// During RED phase all these will resolve once the step files exist.
import { LOAD_SECRETS } from './01-secrets.js';
import { INIT_VAULT } from './02-vault.js';
import { INIT_DATABASE } from './03-database.js';
import { INIT_PROVIDERS } from './04-providers.js';
import { INIT_MILVUS } from './05-milvus.js';
import { INIT_RAG } from './06-rag.js';
// #1059 — mcp-proxy now OWNS mcp_tools INDEXING (the WRITE side: Milvus +
// pgvector writer). Step 07 (mcp-index) RIPPED. BUT step 08 (tool-cache) is
// the api-side READER that wires `ctx.toolSemanticCache` for the
// /api/internal/tool-search endpoint — it MUST stay. Without it the route
// returns 503 in 0ms and every model tool_search call fails (root cause
// found while driving Q1 on 0.7.1-b23ed3c1).
import { INIT_TOOL_CACHE } from './08-tool-cache.js';
import { INIT_PROMPT_CACHE } from './09-prompt-cache.js';
import { START_JOB_WATCHER } from './10-job-watcher.js';
// 11-validate-admin-portal RIPPED — required PromptTemplate + UserPromptAssignment
// rows that no longer exist post-chatmode-rip. RBAC prompts are file-sourced now.
import { INIT_AGENT_REGISTRY } from './12-agent-registry.js';
import { INIT_MILVUS_COLLECTION_PROBE } from './13-milvus-collection-probe.js';
import { SEED_BUILT_IN_AGENTS_MD } from './14-agent-md-to-db-seeder.js';
// SEED_OMHS_TEMPLATES removed — moved into SEED_WORKFLOW_TEMPLATES inline
// (services/openagentic-api/src/routes/workflows.ts) for the same reason
// SEED_PLATFORM_TEMPLATES was removed: the dedicated seeders wrote to the
// `WorkflowTemplate` marketplace model with an invalid where:{name}
// upsert (name isn't @unique), so neither pack ever landed in any env.

export const STEPS: BootstrapStep[] = [
  LOAD_SECRETS,
  INIT_VAULT,
  INIT_DATABASE,
  INIT_PROVIDERS,
  INIT_MILVUS,
  INIT_RAG,
  // #1059 — INIT_MCP_INDEX (writer) moved to mcp-proxy. INIT_TOOL_CACHE
  // (reader, wires ctx.toolSemanticCache for /api/internal/tool-search)
  // STAYS — without it model tool_search dispatches 503 in 0ms.
  INIT_TOOL_CACHE,
  INIT_PROMPT_CACHE,
  // Initialize the BuiltInAgentRegistry before job watcher / portal so any
  // chat traffic that arrives mid-startup can read built-in agents without
  // racing the markdown-loader. See 12-agent-registry.ts.
  INIT_AGENT_REGISTRY,
  // Option B (2026-05-13) — upsert the 8 markdown built-in agents into
  // prisma.agent so chatmode + Flows + admin all read from the same DB
  // table. Runs AFTER INIT_AGENT_REGISTRY (the markdown loader must
  // have populated its cache first; the seeder loads from disk again
  // via the same loader).
  SEED_BUILT_IN_AGENTS_MD,
  // #605 — Milvus collection-size probe (mcp_tools, agents). Runs
  // AFTER the indexer + cache are wired so the probe sees populated
  // collections. Critical=false; set MILVUS_BOOT_GATE_REQUIRED=true to
  // hard-fail when below thresholds (prod helm gate).
  INIT_MILVUS_COLLECTION_PROBE,
  START_JOB_WATCHER,
];

export async function runStartup(deps: BootstrapDeps): Promise<void> {
  for (const step of STEPS) {
    const t0 = Date.now();
    try {
      await step.run(deps);
      const ms = Date.now() - t0;
      loggers.services.info({ step: step.name, ms }, 'Bootstrap step complete');
      bootstrapStepDuration.labels(step.name, 'success').observe(ms / 1000);
    } catch (err) {
      const ms = Date.now() - t0;
      if (step.critical) {
        loggers.services.error({ err, step: step.name, ms }, 'CRITICAL startup failure');
        bootstrapStepDuration.labels(step.name, 'failed').observe(ms / 1000);
        process.exit(1);
      }
      loggers.services.warn({ err, step: step.name, ms }, 'Non-critical startup step failed');
      bootstrapStepDuration.labels(step.name, 'non_critical_failed').observe(ms / 1000);
    }
  }
}
