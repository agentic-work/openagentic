/**
 * ollamaParseToolCallSoftFailure — pure detector for OllamaProvider
 * recovery path (#851, 2026-05-14).
 *
 * Live failure mode: gpt-oss:20b sometimes emits Harmony-channel
 * reasoning prose as the value of `tool_calls[0].function.arguments`.
 * Ollama's server-side tool_call parser rejects the prose and returns
 * HTTP 500 before any chunk reaches us, with body:
 *
 *   {"error":"error parsing tool call: raw='We attempted wrong
 *    subscription id...'"}
 *
 * This is a soft failure — the model produced output that didn't fit
 * the tool-call schema, but our pipeline state is otherwise healthy.
 * OllamaProvider catches this signature and yields a synthetic
 * text content_block + message_stop so chatLoop terminates the turn
 * cleanly. The user sees a brief recovery prose instead of
 * PIPELINE_ERROR; the next turn (driven by either the no-progress
 * guard or a subsequent user message) can proceed.
 */

const PARSE_TOOL_CALL_RE = /error parsing tool call/i;

export function isOllamaParseToolCallError(
  status: number,
  errorText: string | null | undefined,
): boolean {
  if (status !== 500) return false;
  if (!errorText || typeof errorText !== 'string') return false;
  return PARSE_TOOL_CALL_RE.test(errorText);
}

/**
 * Human-readable recovery prose surfaced when the parse-failure
 * branch fires. Brief on purpose — the user is meant to retry.
 */
export const PARSE_TOOL_CALL_RECOVERY_TEXT =
  "I had trouble continuing — the model produced an invalid tool call. " +
  "Please retry, or rephrase the question.";
