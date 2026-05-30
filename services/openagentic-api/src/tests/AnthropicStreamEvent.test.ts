/**
 * AnthropicStreamEvent / AgenticStreamEvent Unit Tests
 * ====================================================
 *
 * Verifies two related discriminated unions:
 *
 *   1. `AnthropicStreamEvent` — wire-exact Anthropic Messages streaming
 *      events. Tests construct one valid example of every variant and
 *      exercise the Anthropic-wire type guards.
 *
 *   2. `AgenticStreamEvent` — platform superset (canonical model-stream
 *      + envelope, agent, HITL, artifact, usage events). Tests exercise
 *      the platform-superset type guards.
 *
 * Slice G.3 (2026-05-01) — the synthetic `Normalized*` model-stream
 * variants (`thinking_*`, `tool_*`, `text_*`, `redacted_thinking`) and
 * their `is{Thinking,Tool,Text}Event` guards have been ripped. All
 * provider adapters now emit canonical Anthropic Messages SSE
 * `content_block_*` events directly. Detection on the canonical wire
 * is via `isAnthropic*` plus `event.content_block.type` /
 * `event.delta.type` discriminators.
 *
 * The `NormalizedStreamEvent` deprecated alias is kept as a stable name
 * for the existing importers across api + UI.
 */

import { describe, test, expect } from 'vitest';
import {
  type AnthropicStreamEvent,
  type AnthropicMessageStartEvent,
  type AnthropicContentBlockStartEvent,
  type AnthropicContentBlockDeltaEvent,
  type AnthropicContentBlockStopEvent,
  type AnthropicMessageDeltaEvent,
  type AnthropicMessageStopEvent,
  type AnthropicPingEvent,
  type AnthropicErrorEvent,
  type AgenticStreamEvent,
  type NormalizedStreamEvent,
  isEnvelopeEvent,
  isAgentEvent,
  isAnthropicToolUseBlockStart,
  isAnthropicInputJsonDelta,
  isAnthropicThinkingDelta,
  isAnthropicCitationsDelta,
} from '../services/AnthropicStreamEvent.js';

// ---------------------------------------------------------------------------
// 1. Anthropic wire-exact event examples
// ---------------------------------------------------------------------------

const messageStart: AnthropicMessageStartEvent = {
  type: 'message_start',
  message: {
    id: 'msg_01ABC',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: 12,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  },
};

const contentBlockStartText: AnthropicContentBlockStartEvent = {
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'text', text: '' },
};

const contentBlockStartThinking: AnthropicContentBlockStartEvent = {
  type: 'content_block_start',
  index: 1,
  content_block: { type: 'thinking', thinking: '', signature: 'sig-0' },
};

const contentBlockStartToolUse: AnthropicContentBlockStartEvent = {
  type: 'content_block_start',
  index: 2,
  content_block: {
    type: 'tool_use',
    id: 'toolu_01ABC',
    name: 'azure_resource_graph_query',
    input: {},
  },
};

const contentBlockDeltaText: AnthropicContentBlockDeltaEvent = {
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'text_delta', text: 'Hello' },
};

const contentBlockDeltaThinking: AnthropicContentBlockDeltaEvent = {
  type: 'content_block_delta',
  index: 1,
  delta: { type: 'thinking_delta', thinking: 'Let me reason about this…' },
};

const contentBlockDeltaInputJson: AnthropicContentBlockDeltaEvent = {
  type: 'content_block_delta',
  index: 2,
  delta: { type: 'input_json_delta', partial_json: '{"query": "resources"' },
};

const contentBlockDeltaSignature: AnthropicContentBlockDeltaEvent = {
  type: 'content_block_delta',
  index: 1,
  delta: { type: 'signature_delta', signature: 'sig-complete' },
};

const contentBlockDeltaCitations: AnthropicContentBlockDeltaEvent = {
  type: 'content_block_delta',
  index: 0,
  delta: {
    type: 'citations_delta',
    citation: {
      type: 'char_location',
      cited_text: 'this is the cited passage',
      document_index: 0,
      document_title: 'source.md',
      start_char_index: 10,
      end_char_index: 36,
      url: 'https://example.com/source.md',
    },
  },
};

const contentBlockStop: AnthropicContentBlockStopEvent = {
  type: 'content_block_stop',
  index: 0,
};

const messageDelta: AnthropicMessageDeltaEvent = {
  type: 'message_delta',
  delta: { stop_reason: 'end_turn', stop_sequence: null },
  usage: { output_tokens: 42 },
};

const messageStop: AnthropicMessageStopEvent = { type: 'message_stop' };

const ping: AnthropicPingEvent = { type: 'ping' };

const errorEvent: AnthropicErrorEvent = {
  type: 'error',
  error: { type: 'overloaded_error', message: 'Server overloaded' },
};

// ---------------------------------------------------------------------------
// 2. Agentic platform-superset examples (envelope + orchestration only;
//    model-stream events are the canonical content_block_* family above)
// ---------------------------------------------------------------------------

const streamStart: AgenticStreamEvent = {
  type: 'stream_start',
  messageId: 'msg-1',
  model: 'claude-sonnet-4-6',
  provider: 'anthropic',
};

const streamEnd: AgenticStreamEvent = {
  type: 'stream_end',
  finishReason: 'stop',
  totalDurationMs: 1234,
};

const agentStart: AgenticStreamEvent = {
  type: 'agent_start',
  id: 'agent-1',
  name: 'ResearchAgent',
  role: 'researcher',
  parentId: 'root',
};
const agentStop: AgenticStreamEvent = {
  type: 'agent_stop',
  id: 'agent-1',
  durationMs: 5000,
  tokensIn: 800,
  tokensOut: 200,
  cost: 0.0042,
};

const hitlRequest: AgenticStreamEvent = {
  type: 'hitl_request',
  id: 'hitl-1',
  agentId: 'agent-1',
  tool: 'delete_file',
  description: 'Delete /tmp/data.csv?',
  scope: 'destructive',
  metadata: { path: '/tmp/data.csv' },
};
const hitlResponse: AgenticStreamEvent = {
  type: 'hitl_response',
  id: 'hitl-1',
  approved: true,
  waitMs: 3200,
};

const artifactStart: AgenticStreamEvent = {
  type: 'artifact_start',
  id: 'art-1',
  artifactType: 'code',
  title: 'solution.ts',
};
const artifactDelta: AgenticStreamEvent = {
  type: 'artifact_delta',
  id: 'art-1',
  content: 'const x = 1;',
};
const artifactStop: AgenticStreamEvent = { type: 'artifact_stop', id: 'art-1', sizeBytes: 13 };

const usage: AgenticStreamEvent = {
  type: 'usage',
  tokensIn: 500,
  tokensOut: 120,
  cost: 0.0021,
  contextUsed: 620,
  contextMax: 200000,
};

const platformError: AgenticStreamEvent = {
  type: 'error',
  code: 'RATE_LIMIT',
  message: 'Too many requests',
  retryable: true,
  stage: 'completion',
};

// ---------------------------------------------------------------------------
// 3. Constructability
// ---------------------------------------------------------------------------

describe('AnthropicStreamEvent constructability', () => {
  test('all 8 wire-exact variants can be constructed', () => {
    const events: AnthropicStreamEvent[] = [
      messageStart,
      contentBlockStartText,
      contentBlockStartThinking,
      contentBlockStartToolUse,
      contentBlockDeltaText,
      contentBlockDeltaThinking,
      contentBlockDeltaInputJson,
      contentBlockDeltaSignature,
      contentBlockDeltaCitations,
      contentBlockStop,
      messageDelta,
      messageStop,
      ping,
      errorEvent,
    ];
    // 14 example events covering 8 event-type discriminants (three
    // content_block_start variants × content types; five
    // content_block_delta variants × delta types).
    expect(events).toHaveLength(14);
    events.forEach((e) => expect(e).toHaveProperty('type'));
  });

  test('message_start carries the canonical Anthropic message shell', () => {
    expect(messageStart.message.role).toBe('assistant');
    expect(messageStart.message.type).toBe('message');
    expect(messageStart.message.usage.input_tokens).toBe(12);
  });

  test('content_block_start.content_block.type discriminates the three block kinds', () => {
    expect(contentBlockStartText.content_block.type).toBe('text');
    expect(contentBlockStartThinking.content_block.type).toBe('thinking');
    expect(contentBlockStartToolUse.content_block.type).toBe('tool_use');
  });

  test('content_block_delta.delta.type discriminates the five delta kinds', () => {
    expect(contentBlockDeltaText.delta.type).toBe('text_delta');
    expect(contentBlockDeltaThinking.delta.type).toBe('thinking_delta');
    expect(contentBlockDeltaInputJson.delta.type).toBe('input_json_delta');
    expect(contentBlockDeltaSignature.delta.type).toBe('signature_delta');
    expect(contentBlockDeltaCitations.delta.type).toBe('citations_delta');
  });

  test('Anthropic error event carries nested error object (not flat code/message)', () => {
    expect(errorEvent.error.type).toBe('overloaded_error');
    expect(errorEvent.error.message).toBe('Server overloaded');
    // Flat 'code' belongs to PlatformErrorEvent, NOT AnthropicErrorEvent
    expect(errorEvent).not.toHaveProperty('code');
  });

  test('ping is payload-free', () => {
    expect(Object.keys(ping)).toEqual(['type']);
  });

  test('message_stop is payload-free', () => {
    expect(Object.keys(messageStop)).toEqual(['type']);
  });
});

describe('AgenticStreamEvent constructability', () => {
  test('all platform-superset variants can be constructed', () => {
    const events: AgenticStreamEvent[] = [
      streamStart,
      streamEnd,
      agentStart,
      agentStop,
      hitlRequest,
      hitlResponse,
      artifactStart,
      artifactDelta,
      artifactStop,
      usage,
      platformError,
    ];
    expect(events).toHaveLength(11);
    events.forEach((e) => expect(e).toHaveProperty('type'));
  });

  test('platform error is FLAT (code / message / retryable / stage)', () => {
    if (platformError.type === 'error') {
      expect(platformError.code).toBe('RATE_LIMIT');
      expect(platformError.message).toBe('Too many requests');
      expect(platformError.retryable).toBe(true);
      expect(platformError.stage).toBe('completion');
    }
  });

  test('deprecated NormalizedStreamEvent alias accepts AgenticStreamEvent values', () => {
    // Compile-time check: the alias widens to the same union so every
    // AgenticStreamEvent is assignable without a cast.
    const alias: NormalizedStreamEvent = streamStart;
    expect(alias.type).toBe('stream_start');
  });

  test('AgenticStreamEvent accepts Anthropic wire events (superset)', () => {
    const asSuperset: AgenticStreamEvent = messageStart;
    expect(asSuperset.type).toBe('message_start');
  });
});

// ---------------------------------------------------------------------------
// 4. Platform-superset type guards
// ---------------------------------------------------------------------------

describe('isEnvelopeEvent', () => {
  test('returns true for stream_start / stream_end', () => {
    expect(isEnvelopeEvent(streamStart)).toBe(true);
    expect(isEnvelopeEvent(streamEnd)).toBe(true);
  });

  test('returns false for agent / usage / error / hitl / artifact', () => {
    expect(isEnvelopeEvent(agentStart)).toBe(false);
    expect(isEnvelopeEvent(usage)).toBe(false);
    expect(isEnvelopeEvent(platformError)).toBe(false);
    expect(isEnvelopeEvent(hitlRequest)).toBe(false);
    expect(isEnvelopeEvent(artifactStart)).toBe(false);
  });

  test('returns false for Anthropic wire events', () => {
    expect(isEnvelopeEvent(messageStart)).toBe(false);
    expect(isEnvelopeEvent(contentBlockStartText)).toBe(false);
    expect(isEnvelopeEvent(messageStop)).toBe(false);
  });
});

describe('isAgentEvent', () => {
  test('returns true for agent_start / agent_stop', () => {
    expect(isAgentEvent(agentStart)).toBe(true);
    expect(isAgentEvent(agentStop)).toBe(true);
  });

  test('returns false for all other platform events', () => {
    expect(isAgentEvent(streamStart)).toBe(false);
    expect(isAgentEvent(usage)).toBe(false);
    expect(isAgentEvent(platformError)).toBe(false);
    expect(isAgentEvent(hitlRequest)).toBe(false);
    expect(isAgentEvent(artifactStart)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Anthropic-wire type guards
// ---------------------------------------------------------------------------

describe('isAnthropicToolUseBlockStart', () => {
  test('returns true for tool_use content_block_start', () => {
    expect(isAnthropicToolUseBlockStart(contentBlockStartToolUse)).toBe(true);
  });

  test('returns false for text / thinking content_block_start', () => {
    expect(isAnthropicToolUseBlockStart(contentBlockStartText)).toBe(false);
    expect(isAnthropicToolUseBlockStart(contentBlockStartThinking)).toBe(false);
  });

  test('returns false for non-content_block_start events', () => {
    expect(isAnthropicToolUseBlockStart(messageStart)).toBe(false);
    expect(isAnthropicToolUseBlockStart(contentBlockDeltaText)).toBe(false);
    expect(isAnthropicToolUseBlockStart(messageStop)).toBe(false);
  });
});

describe('isAnthropicInputJsonDelta', () => {
  test('returns true for input_json_delta', () => {
    expect(isAnthropicInputJsonDelta(contentBlockDeltaInputJson)).toBe(true);
  });

  test('returns false for other content_block_delta variants', () => {
    expect(isAnthropicInputJsonDelta(contentBlockDeltaText)).toBe(false);
    expect(isAnthropicInputJsonDelta(contentBlockDeltaThinking)).toBe(false);
    expect(isAnthropicInputJsonDelta(contentBlockDeltaSignature)).toBe(false);
    expect(isAnthropicInputJsonDelta(contentBlockDeltaCitations)).toBe(false);
  });

  test('returns false for non-content_block_delta events', () => {
    expect(isAnthropicInputJsonDelta(messageStart)).toBe(false);
    expect(isAnthropicInputJsonDelta(contentBlockStartToolUse)).toBe(false);
  });
});

describe('isAnthropicThinkingDelta', () => {
  test('returns true for thinking_delta', () => {
    expect(isAnthropicThinkingDelta(contentBlockDeltaThinking)).toBe(true);
  });

  test('returns false for other content_block_delta variants', () => {
    expect(isAnthropicThinkingDelta(contentBlockDeltaText)).toBe(false);
    expect(isAnthropicThinkingDelta(contentBlockDeltaInputJson)).toBe(false);
    expect(isAnthropicThinkingDelta(contentBlockDeltaSignature)).toBe(false);
  });
});

describe('isAnthropicCitationsDelta', () => {
  test('returns true for citations_delta', () => {
    expect(isAnthropicCitationsDelta(contentBlockDeltaCitations)).toBe(true);
  });

  test('returns false for other content_block_delta variants', () => {
    expect(isAnthropicCitationsDelta(contentBlockDeltaText)).toBe(false);
    expect(isAnthropicCitationsDelta(contentBlockDeltaThinking)).toBe(false);
    expect(isAnthropicCitationsDelta(contentBlockDeltaInputJson)).toBe(false);
  });

  test('returns false for non-content_block_delta events', () => {
    expect(isAnthropicCitationsDelta(messageDelta)).toBe(false);
  });
});

// hitlResponse referenced for completeness — assert constructability
test('hitlResponse and artifactDelta/Stop / streamEnd construct cleanly', () => {
  expect(hitlResponse.type).toBe('hitl_response');
  expect(artifactDelta.type).toBe('artifact_delta');
  expect(artifactStop.type).toBe('artifact_stop');
  expect(streamEnd.type).toBe('stream_end');
});
