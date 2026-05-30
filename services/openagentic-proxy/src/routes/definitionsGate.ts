/**
 * DEFER_AGENTS gating helper — pure function, fully unit-testable.
 *
 * When DEFER_AGENTS is enabled the chatmode tool array hides every
 * specialized sub-agent definition behind the `agent_search` synthetic
 * meta-tool. The only agent that stays exposed at the resolution
 * endpoint is `general-purpose`, which the Task tool can dispatch
 * without any prior discovery.
 *
 * This file is dependency-free so tests under `node:test` +
 * `--experimental-strip-types` can import it cleanly without dragging
 * in pino, axios, fastify, or the auth chain.
 *
 * Plan: docs/superpowers/specs/2026-05-02-tool-selection-at-scale-research.md
 */

export interface AgentDefinitionLike {
  id: string;
  name?: string;
  description?: string;
  role?: string;
  // Other fields permitted; we only key on `id` for the gate.
  [k: string]: unknown;
}

/**
 * The canonical general-purpose agent. Mirrors Claude Code's default
 * `general-purpose` Agent. Has access to all tools. The Task tool
 * dispatches to it when `subagent_type` is omitted.
 */
export const GENERAL_PURPOSE_AGENT = {
  id: 'general-purpose',
  name: 'General-Purpose Agent',
  description:
    'Default sub-agent. Has access to every tool the main loop has. ' +
    'Dispatch via Task({prompt, description}) without setting ' +
    '`subagent_type` — the runtime fills in `general-purpose`.',
  role: 'general',
  model: 'auto',
  tools: [],
  category: 'platform',
  icon: 'bot',
  background: null,
  source: 'builtin',
} as const;

/**
 * Resolve `process.env.DEFER_AGENTS` to a boolean. Treats any
 * case-insensitive `'true'` / `'1'` / `'yes'` as ON; everything else
 * (including `undefined`) as OFF.
 */
export function isDeferAgentsEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/**
 * Apply the DEFER_AGENTS gate to a (built-ins, DB-agents) pair.
 *
 *  - DEFER_AGENTS off → returns built-ins + DB merged. DB takes
 *    precedence on id collisions (matches the legacy behaviour).
 *  - DEFER_AGENTS on  → returns ONLY [GENERAL_PURPOSE_AGENT]. Any DB
 *    agent that claims `id="general-purpose"` is REJECTED to prevent
 *    a malicious admin from shadowing the canonical agent.
 */
export function applyDeferAgentsGate(
  builtIns: AgentDefinitionLike[],
  dbAgents: AgentDefinitionLike[],
  deferEnv: string | undefined,
): AgentDefinitionLike[] {
  if (isDeferAgentsEnabled(deferEnv)) {
    return [{ ...GENERAL_PURPOSE_AGENT }];
  }

  const dbIds = new Set(dbAgents.map(a => a.id));
  const merged: AgentDefinitionLike[] = [
    ...builtIns.filter(a => !dbIds.has(a.id)),
    ...dbAgents,
  ];
  return merged;
}
