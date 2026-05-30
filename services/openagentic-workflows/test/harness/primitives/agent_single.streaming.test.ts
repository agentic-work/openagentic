/**
 * agent_single streaming — Tier D placeholder (BLOCKED on openagentic-proxy).
 *
 * agent_* nodes route through openagentic-proxy `POST /api/agents/execute-sync`,
 * which is BLOCKING — the endpoint returns the final aggregated response
 * after the inner LLM agent completes. The agent's inner LLM canonical
 * events never leave the openagentic-proxy process, so this node cannot emit
 * per-token canonical frames today.
 *
 * Tier D scope: add `POST /api/agents/execute-stream` to openagentic-proxy
 * (or upgrade /execute-sync with an Accept: text/event-stream branch)
 * that forwards inner LLM canonical events back to the workflow engine.
 * The agent_* executors will then wire emitCanonical the same way the
 * 6 Group-1 nodes did in Tier C.
 *
 * Tier C scope: Group-1 LLM-direct nodes (llm_completion,
 * openagentic_chat, azure_ai, bedrock, vertex, reasoning,
 * structured_output) — already shipped.
 */

import { describe, it } from 'vitest';

describe.skip('agent_single per-token streaming (Tier D — openagentic-proxy work)', () => {
  it.todo('emits text_delta events when openagentic-proxy supports /execute-stream');
});
