/**
 * subagentFanOutCap — cost-safety guard on parallel Task fan-out.
 *
 * Anthropic's multi-agent research system explicitly recommends scaling
 * sub-agent count to query complexity: simple = 1 agent / 3-10 tool calls;
 * complex = 10+ agents but bounded. Without a cap, one misguided turn that
 * fires `Task` 32 times (one per Azure subscription / one per cloud / one
 * per region) creates an unbounded cost surface — each sub-agent runs its
 * own ReAct loop on a paid model.
 *
 * Contract: given the list of tool_use blocks the model wants to dispatch
 * this turn, count Task calls. If the count exceeds `maxConcurrentSubagents`,
 * return `{ allowed: false, reason }` so chatLoop can short-circuit and
 * surface guidance to the model (request_clarification or split-by-turn).
 *
 * Tooling for the cap is admin-tunable via ChatLoopConfigService
 * (`maxConcurrentSubagents`, default 4).
 *
 * Source: https://www.anthropic.com/engineering/multi-agent-research-system
 * Plan: docs/superpowers/plans/2026-05-12-chatmode-industry-bestpractices-followup.md
 *       (Q1 — sub-agent fan-out cap)
 */

/** Minimal tool_use block shape we need to count Task calls. */
export interface FanOutCandidateBlock {
  type?: string;
  name: string;
}

export interface FanOutCapDecision {
  allowed: boolean;
  /** How many Task blocks the model wanted to dispatch. */
  requested: number;
  /** Configured ceiling. */
  cap: number;
  /** Human-readable reason — surfaced to the model via annotation frame. */
  reason?: string;
}

/** Default per-turn ceiling. Admin-tunable via ChatLoopConfigService. */
export const DEFAULT_MAX_CONCURRENT_SUBAGENTS = 4;

/**
 * Inspect a batch of tool_use blocks. If more than `cap` Task calls are
 * present, return `allowed: false` with a clear reason. Otherwise allow.
 *
 * The Task tool name is hard-coded — only that one meta-tool spawns
 * sub-agents. Other tools (compose_visual, MCP calls, etc.) are unaffected
 * by this cap.
 */
export function applyFanOutCap(
  toolBlocks: FanOutCandidateBlock[],
  cap: number = DEFAULT_MAX_CONCURRENT_SUBAGENTS,
): FanOutCapDecision {
  const taskCalls = toolBlocks.filter((b) => b.name === 'Task');
  const requested = taskCalls.length;
  if (requested <= cap) {
    return { allowed: true, requested, cap };
  }
  return {
    allowed: false,
    requested,
    cap,
    reason:
      `Requested ${requested} parallel sub-agents in one turn; cap is ${cap}. ` +
      `Split the work: dispatch ${cap} sub-agents this turn, wait for results, ` +
      `then dispatch the next batch. Or use request_clarification to ask the ` +
      `user which subset to analyze first.`,
  };
}
