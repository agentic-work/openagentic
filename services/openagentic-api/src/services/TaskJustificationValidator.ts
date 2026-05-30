/**
 * TaskJustificationValidator — #844 (2026-05-14)
 *
 * Server-side gate on every Task sub-agent dispatch. Capability-agnostic
 * (replaces / supplements #843 which only hid Task from cheap-tier models).
 * Works on any model — because the constraint is schema-checked, not
 * description-advisory.
 *
 * Contract: every Task call must include a `multi_step_justification`
 * field with three required signals. The validator rejects any call that:
 *   - estimates fewer than 3 distinct tool calls (sub-agent dispatch is
 *     for genuine 3+ tool chains; one-tool queries should call the tool
 *     directly)
 *   - admits a direct single-tool alternative exists (model just told us
 *     a one-call path works — let it use that path)
 *   - says it doesn't need dedicated context (no reason to spend a fresh
 *     ReAct loop)
 *
 * Why this works where #843 didn't:
 *   #843 was a model-tier gate — invisible to high-tier models. High-tier
 *   models stayed seeing Task and kept dispatching for trivial queries.
 *   This gate forces the model to articulate WHY a sub-agent is justified,
 *   and rejects the answer when the model just admits it isn't.
 *   The schema makes the description's "DO NOT USE for show me X" rule
 *   into a CHECKED constraint, not advice the model rationalizes around.
 *
 * NO regex on the user prompt. NO model-name match. Pure structural
 * inspection of the model's own self-reported justification.
 */

/** Minimum tool-count threshold for a Task dispatch to be justified. */
export const MIN_TOOL_COUNT_FOR_TASK = 3;

export interface MultiStepJustification {
  /** Model's estimate of how many distinct tool calls the sub-agent will make. */
  tool_count_estimate: number;
  /** Whether a fresh ReAct loop with its own context window is needed. */
  requires_dedicated_context: boolean;
  /** Model's free-form rationale; surfaced in logs + audit. */
  why: string;
  /**
   * If a single direct tool COULD answer this in one call, the model
   * names it here. Non-null means the dispatch is unjustified — the
   * model should call that tool instead.
   */
  single_tool_alternative: string | null;
}

export interface JustificationValidationResult {
  ok: boolean;
  /** Human-readable rejection message returned to the model as tool_result. */
  error?: string;
  /**
   * Structured hint the model can read in its next turn. Tells the model
   * exactly which direct tool to call instead. Non-null only on reject.
   */
  directToolHint?: string;
}

/**
 * Pure validator — no I/O, no model calls, no regex on user prompt.
 *
 * Returns { ok: true } when the dispatch is justified by the model's
 * own self-reported signals. Otherwise returns { ok: false, error,
 * directToolHint }.
 *
 * Missing/malformed justification is rejected as "Task requires a
 * multi_step_justification field" — forces the model to think before
 * dispatching.
 */
export function validateMultiStepJustification(
  justification: MultiStepJustification | undefined | null,
): JustificationValidationResult {
  if (!justification || typeof justification !== 'object') {
    return {
      ok: false,
      error:
        'Task requires a `multi_step_justification` field with ' +
        '{ tool_count_estimate, requires_dedicated_context, why, single_tool_alternative }. ' +
        'If this task is a single "show me / list" query, call the relevant tool directly ' +
        'instead of dispatching a sub-agent.',
    };
  }

  const {
    tool_count_estimate,
    requires_dedicated_context,
    why,
    single_tool_alternative,
  } = justification;

  if (typeof tool_count_estimate !== 'number' || !Number.isFinite(tool_count_estimate)) {
    return {
      ok: false,
      error:
        'multi_step_justification.tool_count_estimate must be a finite number. ' +
        'If this would be one tool call, call that tool directly instead of dispatching a sub-agent.',
    };
  }

  if (typeof requires_dedicated_context !== 'boolean') {
    return {
      ok: false,
      error: 'multi_step_justification.requires_dedicated_context must be a boolean.',
    };
  }

  if (typeof why !== 'string' || why.trim().length < 20) {
    return {
      ok: false,
      error:
        'multi_step_justification.why must be a 1-sentence rationale (≥20 chars) explaining ' +
        'why a dedicated sub-agent context is needed rather than direct tool calls.',
    };
  }

  // The three substantive checks — these are the gate.

  if (tool_count_estimate < MIN_TOOL_COUNT_FOR_TASK) {
    return {
      ok: false,
      error:
        `Task dispatch rejected: tool_count_estimate=${tool_count_estimate} is below the ` +
        `${MIN_TOOL_COUNT_FOR_TASK}-tool minimum. Sub-agent dispatch is reserved for genuine ` +
        `multi-step chains. Call the relevant tools directly.`,
    };
  }

  if (requires_dedicated_context === false) {
    return {
      ok: false,
      error:
        'Task dispatch rejected: requires_dedicated_context=false — the model itself reports ' +
        'no need for a fresh ReAct loop. Call the relevant tools directly in this turn.',
    };
  }

  if (
    typeof single_tool_alternative === 'string' &&
    single_tool_alternative.trim().length > 0
  ) {
    return {
      ok: false,
      error:
        `Task dispatch rejected: a single direct tool answers this — ` +
        `"${single_tool_alternative.trim()}". Call it directly instead of dispatching a sub-agent.`,
      directToolHint: single_tool_alternative.trim(),
    };
  }

  return { ok: true };
}
