/**
 * agentModelRouting — role → tier → model resolver.
 *
 * When the legacy sub-agent orchestrator / openagentic-proxy fans out N parallel sub-agents,
 * each one resolves its own model by looking up its ROLE's preferred
 * tier, then asking the registry which concrete model is enabled at
 * that tier. Result: a "research → research → synthesis" fan-out runs
 * 2 cheap + 1 premium instead of 3 copies of the same expensive model.
 *
 * Inputs intentionally minimal so the resolver is pure and testable.
 * SmartRouter stays in its lane — this module is a THIN hint layer.
 */

export type ModelTier = 'premium' | 'balanced' | 'economical' | 'local';

/**
 * Canonical role → tier map. Agent seed rows in admin-agents.ts set
 * `model_config.preferredTier` which should match these; this table is
 * the fallback when an agent role is passed without explicit tier.
 */
export const ROLE_TIER_MAP: Record<string, ModelTier> = {
  // research / discovery — high-volume, cheap-tolerant
  research: 'economical',
  discovery: 'economical',
  scan: 'economical',
  monitor: 'economical',
  // synthesis / architect — low-volume, needs reasoning
  synthesis: 'premium',
  architect: 'premium',
  planner: 'premium',
  planning: 'premium', // built-in agent role (planning.md)
  reviewer: 'premium',
  validation: 'premium', // built-in agent role (validation.md)
  artifact_creation: 'premium',
  'artifact-creation': 'premium', // dash variant — built-in agent role file uses dash
  reasoning: 'premium',  // built-in agent role (reasoning.md) — multi-step thinking, MUST escalate
  // 2026-05-07 #658 — built-in cloud-/code-/data- agents need balanced
  // (NOT economical) because the tools they orchestrate (azure_*, aws_*,
  // kubectl_*, file_*) require multi-turn function-calling accuracy that
  // gpt-oss:20b struggles with. The capstone smoking-gun (Phase 2
  // reasoning sub-agent ran 10+ min on gpt-oss:20b instead of seconds on
  // Sonnet) traced to BOTH this map having no `cloud-operations` entry
  // (fell through to defaultModel = gpt-oss:20b) AND `reasoning` being
  // absent. Adding both as premium so the right model picks the right
  // task automatically.
  'cloud-operations': 'premium', // built-in agent role (cloud-operations.md)
  cloud_operations: 'premium',   // underscore variant for safety
  'code-execution': 'balanced',  // built-in agent role (code-execution.md)
  code_execution: 'balanced',
  'data-query': 'balanced',      // built-in agent role (data-query.md)
  data_query: 'balanced',
  // mechanical / sandbox — deterministic, local
  mechanical: 'local',
  sandbox: 'local',
  formatter: 'local',
  // default-ish
  tool_orchestration: 'balanced',
};

export type RegistryTierResolver = (tier: ModelTier) => string | null;

export interface AgentModelInput {
  /** Agent role / agent_type column in the DB. */
  role: string;
  /** Caller override (request-level). Wins over tier lookup. */
  modelOverride?: string;
}

/**
 * Resolve the model to use for an agent.
 *
 * Decision ladder:
 *   1. modelOverride (explicit caller intent)
 *   2. ROLE_TIER_MAP[role] → registry(tier)
 *   3. defaultModel
 */
export function resolveAgentModel(
  input: AgentModelInput,
  defaultModel: string,
  registry: RegistryTierResolver,
): string {
  if (input.modelOverride) return input.modelOverride;

  const tier = ROLE_TIER_MAP[input.role];
  if (!tier) return defaultModel;

  const resolved = registry(tier);
  if (resolved) return resolved;

  return defaultModel;
}
