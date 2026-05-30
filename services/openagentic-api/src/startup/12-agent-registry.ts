/**
 * Bootstrap step — initialize the BuiltInAgentRegistry once at api startup.
 *
 * The chatmode V2 pipeline's `Task` tool builds its tool description from
 * the live built-in agent set. `getBuiltInAgents()` reads from a process-
 * lifetime cache populated by `initializeAgentRegistry()` (which scans
 * `services/openagentic-api/src/agents/built-in/*.md` and parses each
 * frontmatter + body).
 *
 * This step runs after secrets/db/providers/milvus/rag/mcp-index/tool-cache/
 * prompt-cache are up. The registry is a pure-fs read (no network, no DB),
 * so it could theoretically run earlier — we keep it late to honor the
 * "configuration before features" startup ordering convention and so any
 * frontmatter-validation errors surface AFTER the platform itself is healthy.
 *
 * `critical: false` — if the markdown loader hits a malformed frontmatter,
 * we log and continue. The Task tool falls back to the `listSubagentTypes`
 * dep returning whatever it can (empty array), and the pipeline still works
 * — chat just loses sub-agent dispatch until the bad file is fixed. Better
 * than a CrashLoopBackOff on day 1 of the cutover.
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §218 — "Loader
 * services/openagentic-api/src/services/AgentRegistry.ts reads the dir at
 * startup, exposes getBuiltInAgents()."
 */

import { initializeAgentRegistry } from '../services/BuiltInAgentRegistry.js';
import { loggers } from '../utils/logger.js';
import type { BootstrapStep } from './types.js';

export const INIT_AGENT_REGISTRY: BootstrapStep = {
  name: 'agent-registry-init',
  critical: false,
  async run() {
    try {
      await initializeAgentRegistry();
      loggers.services.info('BuiltInAgentRegistry initialized');
    } catch (err) {
      loggers.services.warn(
        { err },
        'BuiltInAgentRegistry init failed — Task tool sub-agent dispatch will be empty until fixed',
      );
    }
  },
};
