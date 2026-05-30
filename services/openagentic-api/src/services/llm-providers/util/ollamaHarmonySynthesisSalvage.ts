/**
 * ollamaHarmonySynthesisSalvage — recovery helper for the
 * "error parsing tool call" 500 when the turn ALREADY has tool results
 * (#1071 / Q1-harmony-recovery, 2026-05-24).
 *
 * Live failure mode (api pod openagentic-api-6688c8569d-qvrq6, 2026-05-24):
 * user asks "show me my Azure subscriptions and what is in each resource
 * group" → gpt-oss:20b successfully calls azure_list_subscriptions +
 * azure_list_resource_groups (both return real data). On the NEXT
 * (synthesis) turn the model leaks its Harmony chain-of-thought REASONING
 * PROSE into the tool_call channel:
 *
 *   {"error":"error parsing tool call: raw='We need to list subscriptions
 *    and then resource groups in each subscription. Received subscription
 *    list: two subscriptions...'"}
 *
 * The #851 soft-recovery converted that 500 into a "Please retry" message,
 * so the user got NO Azure answer even though the tool RESULTS WERE ALREADY
 * FETCHED and sit in the message history. That punt is the Sev-0.
 *
 * Salvage: when the failing request's history contains ≥1 tool result, the
 * recovery re-issues ONE Ollama chat call with the SAME history but with
 * tools stripped (tool_choice forced 'none') plus a system nudge telling the
 * model to produce a final plain-text summary. The yielded text becomes the
 * assistant synthesis. Only if THAT also fails do we fall back to the
 * existing #851 "Please retry" prose.
 */

/** System nudge appended for the no-tools synthesis re-call. */
export const HARMONY_SYNTHESIS_NUDGE =
  'You already have all the tool results you need. Produce a FINAL plain-text ' +
  'answer summarizing them for the user. Do NOT call any tools or emit ' +
  'tool-call syntax.';

/**
 * True when the Ollama wire-shape history carries at least one tool result
 * (role:'tool') OR an assistant turn that recorded tool_calls — i.e. the
 * turn has already done real work whose output we can synthesize.
 */
export function historyHasToolResult(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const role = (m as { role?: unknown }).role;
    if (role === 'tool') return true;
    const toolCalls = (m as { tool_calls?: unknown }).tool_calls;
    if (role === 'assistant' && Array.isArray(toolCalls) && toolCalls.length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Build the no-tools synthesis re-call wire body from the original failing
 * Ollama request. Returns a NEW object — does NOT mutate the input.
 *
 *   - `tools` field removed entirely (Ollama ignores tool_choice:'none';
 *     dropping tools[] is the only reliable way to forbid tool calls —
 *     see buildOllamaWireBody Sev-0 #5).
 *   - A system message carrying HARMONY_SYNTHESIS_NUDGE is appended to the
 *     END of the history so it wins precedence for the synthesis turn.
 *   - `stream:false` — the salvage path reads the whole body once.
 *   - `think` is dropped so the model spends its budget on the answer,
 *     not on more chain-of-thought that could re-trigger the leak.
 */
export function buildHarmonySynthesisRecall(
  ollamaRequest: Record<string, unknown>,
): Record<string, unknown> {
  const srcMessages = Array.isArray(ollamaRequest?.messages)
    ? (ollamaRequest.messages as unknown[])
    : [];

  const messages = [
    ...srcMessages,
    { role: 'system', content: HARMONY_SYNTHESIS_NUDGE },
  ];

  const recall: Record<string, unknown> = {
    ...ollamaRequest,
    messages,
    stream: false,
    // Force reasoning OFF. Deleting `think` lets Ollama default gpt-oss
    // reasoning ON, which can route the entire synthesis into the Harmony
    // reasoning channel (message.thinking) and leave message.content empty —
    // the live Q2 IAM failure (2026-05-24) where the salvage re-call came
    // back empty and punted. think:false pushes the answer into content.
    think: false,
  };
  // Strip anything that re-enables tool emission.
  delete recall.tools;
  delete recall.tool_choice;
  delete recall.format;

  return recall;
}

/**
 * Extract the assistant text from a non-streaming Ollama /api/chat
 * response body. Returns trimmed content, or null when empty/absent.
 *
 * Falls back to `message.thinking` (the Harmony reasoning channel) when
 * `content` is empty: gpt-oss:20b sometimes routes the whole synthesis into
 * thinking and returns empty content (live Q2 IAM 2026-05-24). The reasoning
 * text still carries the grounded answer, so surfacing it beats punting
 * "Please retry" and discarding already-fetched tool results.
 */
export function extractOllamaContent(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const message = (data as { message?: { content?: unknown; thinking?: unknown } }).message;
  const content = message?.content;
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.length > 0) return trimmed;
  }
  const thinking = message?.thinking;
  if (typeof thinking === 'string') {
    const trimmedThinking = thinking.trim();
    if (trimmedThinking.length > 0) return trimmedThinking;
  }
  return null;
}
