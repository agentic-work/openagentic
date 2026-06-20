/**
 * Boot step — seed the 8 built-in markdown agents into `prisma.agent`.
 *
 * Option B unification (2026-05-13). Before this slice:
 *   - chatmode Task tool read from 8 markdown files (`src/agents/built-in/*.md`)
 *   - Flows + Admin Console read from `prisma.agent` (33 rows in the dev environment)
 *   - Admin-created custom agents were invisible to chatmode.
 *
 * After this slice:
 *   - The 8 markdown built-ins are upserted into `prisma.agent` on every
 *     api boot. Idempotent (upsert keyed on `name @unique`).
 *   - chatmode reads from `prisma.agent` via `listAgentsFromDb()`.
 *   - Custom agents created via the Admin Console land in the same table
 *     and are immediately dispatchable from chatmode Task.
 *
 * Critical=false: a markdown-loader hiccup or transient DB blip degrades
 * to "Task tool sees the previously-seeded rows" rather than CrashLoopBackOff.
 *
 * Plan: docs/superpowers/plans/2026-05-13-option-b-db-sot-unification.md.
 */

import { loadBuiltInAgents } from '../services/BuiltInAgentRegistry.js';
import { agentSlugToType } from '../services/agentSlugToType.js';
import { primeAgentsFromDbCache } from '../services/listAgentsFromDb.js';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import type { BootstrapStep } from './types.js';

export interface SeedBuiltInAgentsOptions {
  /** Override the markdown source directory (tests). */
  dir?: string;
}

/**
 * Read every markdown file under `dir` (or the canonical built-in dir),
 * convert each hyphenated slug to an underscored agent_type, and upsert
 * a row in `prisma.agent` with `is_default=true, enabled=true`.
 *
 * Upsert key: `name` (which is also `@unique` in the prisma schema). The
 * `agent_type` column equals the underscored slug so chatmode dispatch
 * (which uses `agent_type`) and Flows/Admin (which also uses `agent_type`)
 * see the same identifier.
 *
 * Exported standalone so tests can call without bootstrapping the full
 * startup pipeline.
 */
export async function seedBuiltInAgentsToDb(
  opts: SeedBuiltInAgentsOptions = {},
): Promise<{ upserted: number; errors: number }> {
  const entries = await loadBuiltInAgents(opts.dir);
  let upserted = 0;
  let errors = 0;
  for (const entry of entries) {
    const agentType = agentSlugToType(entry.agent_type);
    try {
      await prisma.agent.upsert({
        where: { name: agentType },
        create: {
          name: agentType,
          display_name: entry.display_name,
          description: entry.description,
          agent_type: agentType,
          category: 'platform',
          system_prompt: entry.body,
          tools_whitelist: entry.tools,
          model_config: {},
          is_default: true,
          enabled: true,
          created_by: 'seed:built-in-agents-md',
        },
        update: {
          display_name: entry.display_name,
          description: entry.description,
          agent_type: agentType,
          system_prompt: entry.body,
          tools_whitelist: entry.tools,
          is_default: true,
          enabled: true,
          updated_by: 'seed:built-in-agents-md',
        },
      });
      upserted++;
    } catch (err: any) {
      errors++;
      loggers.services.warn(
        { err: err.message, agent_type: agentType },
        '[14-agent-md-to-db-seeder] upsert failed for one agent — continuing',
      );
    }
  }
  return { upserted, errors };
}

export const SEED_BUILT_IN_AGENTS_MD: BootstrapStep = {
  name: 'seed-built-in-agents-md',
  critical: false,
  async run() {
    try {
      const result = await seedBuiltInAgentsToDb();
      loggers.services.info(
        result,
        '[14-agent-md-to-db-seeder] built-in agents seeded',
      );
      // Prime the in-memory snapshot so the first chat turn sees the
      // 8 built-ins + any admin-created custom agents from the same DB.
      await primeAgentsFromDbCache();
    } catch (err) {
      loggers.services.warn(
        { err },
        '[14-agent-md-to-db-seeder] seeder failed — chatmode will read pre-existing rows only',
      );
    }
  },
};
