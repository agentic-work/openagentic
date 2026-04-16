/**
 * NormalizedStreamEvent — discriminated union for all provider stream output.
 *
 * Every LLM provider adapter (Anthropic, OpenAI, Google Vertex, Ollama,
 * AWS Bedrock, Azure AI Foundry) normalises its raw events into this type
 * before forwarding to the frontend.  The frontend therefore only needs to
 * handle one format regardless of the underlying model.
 */

// ---------------------------------------------------------------------------
// Core discriminated union
// ---------------------------------------------------------------------------

export type NormalizedStreamEvent =
  // --- Envelope ---
  | { type: 'stream_start'; messageId: string; model: string; provider: string }
  | { type: 'stream_end'; finishReason: string; totalDurationMs: number }

  // --- Thinking ---
  | { type: 'thinking_start'; id: string }
  | { type: 'thinking_delta'; id: string; content: string; accumulated: string; tokenCount?: number }
  | { type: 'thinking_stop'; id: string; elapsedMs: number }
  | { type: 'redacted_thinking'; id: string; signature?: string }

  // --- Tools ---
  | { type: 'tool_start'; id: string; toolName: string; serverName: string; agentId?: string }
  | { type: 'tool_delta'; id: string; argsFragment: string }
  | { type: 'tool_stop'; id: string; result: any; durationMs: number }

  // --- Text ---
  | { type: 'text_start'; id: string }
  | { type: 'text_delta'; id: string; content: string }
  | { type: 'text_stop'; id: string }

  // --- Agents ---
  | { type: 'agent_start'; id: string; name: string; role: string; parentId?: string }
  | { type: 'agent_stop'; id: string; durationMs: number; tokensIn: number; tokensOut: number; cost: number }

  // --- Human-in-the-loop ---
  | { type: 'hitl_request'; id: string; agentId?: string; tool: string; description: string; scope: string; metadata: Record<string, string> }
  | { type: 'hitl_response'; id: string; approved: boolean; waitMs: number }

  // --- Artifacts ---
  | { type: 'artifact_start'; id: string; artifactType: string; title: string }
  | { type: 'artifact_delta'; id: string; content: string }
  | { type: 'artifact_stop'; id: string; sizeBytes: number }

  // --- Usage (per LLM completion round) ---
  | { type: 'usage'; tokensIn: number; tokensOut: number; cost: number; contextUsed: number; contextMax: number }

  // --- Errors ---
  | { type: 'error'; code: string; message: string; retryable: boolean; stage?: string };

// ---------------------------------------------------------------------------
// Type guard helpers
// ---------------------------------------------------------------------------

/** Matches: stream_start, stream_end */
export function isEnvelopeEvent(
  event: NormalizedStreamEvent,
): event is Extract<NormalizedStreamEvent, { type: 'stream_start' | 'stream_end' }> {
  return event.type === 'stream_start' || event.type === 'stream_end';
}

/** Matches: thinking_start, thinking_delta, thinking_stop, redacted_thinking */
export function isThinkingEvent(
  event: NormalizedStreamEvent,
): event is Extract<
  NormalizedStreamEvent,
  { type: 'thinking_start' | 'thinking_delta' | 'thinking_stop' | 'redacted_thinking' }
> {
  return (
    event.type === 'thinking_start' ||
    event.type === 'thinking_delta' ||
    event.type === 'thinking_stop' ||
    event.type === 'redacted_thinking'
  );
}

/** Matches: tool_start, tool_delta, tool_stop */
export function isToolEvent(
  event: NormalizedStreamEvent,
): event is Extract<NormalizedStreamEvent, { type: 'tool_start' | 'tool_delta' | 'tool_stop' }> {
  return (
    event.type === 'tool_start' ||
    event.type === 'tool_delta' ||
    event.type === 'tool_stop'
  );
}

/** Matches: text_start, text_delta, text_stop */
export function isTextEvent(
  event: NormalizedStreamEvent,
): event is Extract<NormalizedStreamEvent, { type: 'text_start' | 'text_delta' | 'text_stop' }> {
  return (
    event.type === 'text_start' ||
    event.type === 'text_delta' ||
    event.type === 'text_stop'
  );
}

/** Matches: agent_start, agent_stop */
export function isAgentEvent(
  event: NormalizedStreamEvent,
): event is Extract<NormalizedStreamEvent, { type: 'agent_start' | 'agent_stop' }> {
  return event.type === 'agent_start' || event.type === 'agent_stop';
}
