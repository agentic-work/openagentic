/**
 * Sev-1 — no-confab tool-failure reporting.
 *
 * Observed trust bug (2026-04-19): when an MCP or synth tool call returned
 * `null` / `undefined`, the pipeline handed the LLM the bare string
 * "No data returned from tool" (or an empty string for synth). The model
 * then fabricated plausible-looking JSON output that matched the prompt's
 * implied shape — a full "Succeeded" tool card with invented contents.
 *
 * Root cause: the LLM had no unmistakable signal that the tool failed.
 * A bare prose fragment is easy to ignore when the prompt template
 * strongly implies success. A structured `<tool_error>` block carrying
 * an error code, the tool name, and an explicit DO-NOT-FABRICATE
 * directive is training-distribution behaviour that Claude / GPT / Qwen
 * uniformly respect.
 *
 * This module is the single source of truth for (a) detecting an empty
 * tool result and (b) producing the LLM-facing failure block. Every tool
 * execution site that forwards a result into the LLM context must route
 * through `formatToolResultForLLM` / `formatToolFailureForLLM`.
 */

export type ToolFailureCode =
  | 'NO_RESULT'
  | 'NO_RESULT_AFTER_APPROVAL'
  | 'EXECUTION_FAILED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'PROXY_ERROR'
  | 'SANDBOX_ERROR'
  | 'INVALID_ARGUMENTS';

export interface ToolFailureDetail {
  toolName: string;
  code: ToolFailureCode;
  /** Human-readable sentence for the LLM; no trailing period required. */
  reason: string;
  /** Optional machine context such as HTTP status, duration, subsystem. */
  context?: Record<string, unknown>;
}

/**
 * True for values the LLM would treat as "nothing came back". Guards
 * against the three most common footguns:
 *   - null / undefined
 *   - empty string / whitespace
 *   - empty array / empty plain object
 *
 * We intentionally do NOT treat `0` or `false` as empty — those are
 * legitimate results (counts, status flags).
 */
export function isEmptyToolResult(result: unknown): boolean {
  if (result === null || result === undefined) return true;
  if (typeof result === 'string') return result.trim().length === 0;
  if (Array.isArray(result)) return result.length === 0;
  if (typeof result === 'object') {
    try {
      return Object.keys(result as Record<string, unknown>).length === 0;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Produce the structured error block the LLM sees in the tool-result
 * message. The `<tool_error>` XML-ish shape is training-distribution
 * syntax — every major model family treats it as a tool failure and
 * will narrate the failure to the user rather than confabulate.
 */
export function formatToolFailureForLLM(detail: ToolFailureDetail): string {
  const ctx = detail.context ? JSON.stringify(detail.context) : '';
  const ctxLine = ctx ? `\n  <context>${ctx}</context>` : '';
  return [
    `<tool_error code="${detail.code}" tool="${detail.toolName}">`,
    `  <reason>${detail.reason}</reason>${ctxLine}`,
    `  <directive>The tool did not succeed. DO NOT fabricate a result. Acknowledge the failure to the user, state what was attempted, and suggest a concrete next step (retry, alternative tool, manual diagnosis).</directive>`,
    `</tool_error>`,
  ].join('\n');
}

/**
 * Convenience: route a raw tool result through empty-check, returning
 * either the formatted success text or a `<tool_error>` block. Intended
 * as the single point every MCP / synth / codemode pipeline should pass
 * tool results through before handing them to the LLM.
 */
export function formatToolResultForLLM(
  toolName: string,
  result: unknown,
  opts?: { failureCode?: ToolFailureCode; failureReason?: string },
): { content: string; isFailure: boolean } {
  if (isEmptyToolResult(result)) {
    return {
      content: formatToolFailureForLLM({
        toolName,
        code: opts?.failureCode ?? 'NO_RESULT',
        reason:
          opts?.failureReason ??
          'The tool returned no data. This usually means the tool execution failed (network, auth, sandbox policy) or the query matched zero records.',
      }),
      isFailure: true,
    };
  }

  if (typeof result === 'string') return { content: result, isFailure: false };
  try {
    return { content: JSON.stringify(result, null, 2), isFailure: false };
  } catch {
    // Circular / non-serializable object — treat as failure, don't hand the
    // LLM unreliable best-effort text it might narrate as a real result.
    return {
      content: formatToolFailureForLLM({
        toolName,
        code: 'EXECUTION_FAILED',
        reason: 'The tool returned an object that could not be serialized.',
      }),
      isFailure: true,
    };
  }
}
