/**
 * parallelToolCallsPolicy
 *
 * Single source of truth for whether an outbound LLM request should enable
 * parallel tool calls. Called from every provider (OpenAI, Anthropic,
 * Azure, Bedrock, Vertex) so the flag can't drift between backends.
 *
 * Decision ladder (first match wins):
 *   1. Per-request `metadata.disableParallelToolCalls` explicit boolean
 *   2. Env `SYNTH_ENABLE_PARALLEL_TOOL_CALLS=false` kill switch
 *   3. Default: enabled iff tools list non-empty
 */

export interface ParallelToolCallPolicyInput {
  tools?: unknown[];
  metadata?: { disableParallelToolCalls?: boolean };
}

export function shouldEnableParallelToolCalls(
  req: ParallelToolCallPolicyInput,
): boolean {
  const hasTools = Array.isArray(req.tools) && req.tools.length > 0;
  if (!hasTools) return false;

  // Per-request explicit override takes priority.
  if (req.metadata && typeof req.metadata.disableParallelToolCalls === 'boolean') {
    return !req.metadata.disableParallelToolCalls;
  }

  // Env kill switch.
  if (process.env.SYNTH_ENABLE_PARALLEL_TOOL_CALLS === 'false') {
    return false;
  }

  return true;
}
