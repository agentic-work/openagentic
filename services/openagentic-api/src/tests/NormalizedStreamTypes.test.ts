/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * NormalizedStreamTypes Unit Tests
 * TDD: written before implementation to drive the type guard API.
 */

import { describe, test, expect } from 'vitest';
import {
  type NormalizedStreamEvent,
  isThinkingEvent,
  isToolEvent,
  isTextEvent,
  isAgentEvent,
  isEnvelopeEvent,
} from '../services/NormalizedStreamTypes.js';

// ---------------------------------------------------------------------------
// Helpers — construct one valid event per discriminant
// ---------------------------------------------------------------------------

const streamStart: NormalizedStreamEvent = {
  type: 'stream_start',
  messageId: 'msg-1',
  model: 'claude-sonnet-4-6',
  provider: 'anthropic',
};

const streamEnd: NormalizedStreamEvent = {
  type: 'stream_end',
  finishReason: 'stop',
  totalDurationMs: 1234,
};

const thinkingStart: NormalizedStreamEvent = {
  type: 'thinking_start',
  id: 'th-1',
};

const thinkingDelta: NormalizedStreamEvent = {
  type: 'thinking_delta',
  id: 'th-1',
  content: 'Let me think…',
  accumulated: 'Let me think…',
  tokenCount: 5,
};

const thinkingDeltaNoToken: NormalizedStreamEvent = {
  type: 'thinking_delta',
  id: 'th-1',
  content: 'more',
  accumulated: 'Let me think… more',
  // tokenCount is optional — omitted here
};

const thinkingStop: NormalizedStreamEvent = {
  type: 'thinking_stop',
  id: 'th-1',
  elapsedMs: 420,
};

const redactedThinking: NormalizedStreamEvent = {
  type: 'redacted_thinking',
  id: 'th-2',
  signature: 'abc123',
};

const redactedThinkingNoSig: NormalizedStreamEvent = {
  type: 'redacted_thinking',
  id: 'th-3',
  // signature is optional — omitted
};

const toolStart: NormalizedStreamEvent = {
  type: 'tool_start',
  id: 'tool-1',
  toolName: 'list_files',
  serverName: 'filesystem',
  agentId: 'agent-1',
};

const toolStartNoAgent: NormalizedStreamEvent = {
  type: 'tool_start',
  id: 'tool-2',
  toolName: 'web_search',
  serverName: 'web',
  // agentId is optional — omitted
};

const toolDelta: NormalizedStreamEvent = {
  type: 'tool_delta',
  id: 'tool-1',
  argsFragment: '{"path":"/tmp"',
};

const toolStop: NormalizedStreamEvent = {
  type: 'tool_stop',
  id: 'tool-1',
  result: { files: ['a.ts', 'b.ts'] },
  durationMs: 80,
};

const textStart: NormalizedStreamEvent = {
  type: 'text_start',
  id: 'txt-1',
};

const textDelta: NormalizedStreamEvent = {
  type: 'text_delta',
  id: 'txt-1',
  content: 'Hello',
};

const textStop: NormalizedStreamEvent = {
  type: 'text_stop',
  id: 'txt-1',
};

const agentStart: NormalizedStreamEvent = {
  type: 'agent_start',
  id: 'agent-1',
  name: 'ResearchAgent',
  role: 'researcher',
  parentId: 'root',
};

const agentStop: NormalizedStreamEvent = {
  type: 'agent_stop',
  id: 'agent-1',
  durationMs: 5000,
  tokensIn: 800,
  tokensOut: 200,
  cost: 0.0042,
};

const hitlRequest: NormalizedStreamEvent = {
  type: 'hitl_request',
  id: 'hitl-1',
  agentId: 'agent-1',
  tool: 'delete_file',
  description: 'Delete /tmp/data.csv?',
  scope: 'destructive',
  metadata: { path: '/tmp/data.csv' },
};

const hitlResponse: NormalizedStreamEvent = {
  type: 'hitl_response',
  id: 'hitl-1',
  approved: true,
  waitMs: 3200,
};

const artifactStart: NormalizedStreamEvent = {
  type: 'artifact_start',
  id: 'art-1',
  artifactType: 'code',
  title: 'solution.ts',
};

const artifactDelta: NormalizedStreamEvent = {
  type: 'artifact_delta',
  id: 'art-1',
  content: 'const x = 1;',
};

const artifactStop: NormalizedStreamEvent = {
  type: 'artifact_stop',
  id: 'art-1',
  sizeBytes: 13,
};

const usage: NormalizedStreamEvent = {
  type: 'usage',
  tokensIn: 500,
  tokensOut: 120,
  cost: 0.0021,
  contextUsed: 620,
  contextMax: 200000,
};

const error: NormalizedStreamEvent = {
  type: 'error',
  code: 'RATE_LIMIT',
  message: 'Too many requests',
  retryable: true,
  stage: 'completion',
};

const errorNoStage: NormalizedStreamEvent = {
  type: 'error',
  code: 'INTERNAL',
  message: 'Unexpected error',
  retryable: false,
  // stage is optional — omitted
};

// ---------------------------------------------------------------------------
// Constructability — TypeScript compilation proves these; runtime checks here
// ---------------------------------------------------------------------------

describe('NormalizedStreamEvent constructability', () => {
  test('all event variants can be constructed', () => {
    const events: NormalizedStreamEvent[] = [
      streamStart,
      streamEnd,
      thinkingStart,
      thinkingDelta,
      thinkingDeltaNoToken,
      thinkingStop,
      redactedThinking,
      redactedThinkingNoSig,
      toolStart,
      toolStartNoAgent,
      toolDelta,
      toolStop,
      textStart,
      textDelta,
      textStop,
      agentStart,
      agentStop,
      hitlRequest,
      hitlResponse,
      artifactStart,
      artifactDelta,
      artifactStop,
      usage,
      error,
      errorNoStage,
    ];
    expect(events).toHaveLength(25);
    events.forEach((e) => expect(e).toHaveProperty('type'));
  });

  test('tool_stop does NOT have tokensIn or tokensOut', () => {
    expect(toolStop).not.toHaveProperty('tokensIn');
    expect(toolStop).not.toHaveProperty('tokensOut');
  });

  test('thinking_delta tokenCount is optional', () => {
    expect(thinkingDelta).toHaveProperty('tokenCount');
    expect(thinkingDeltaNoToken).not.toHaveProperty('tokenCount');
  });

  test('redacted_thinking signature is optional', () => {
    expect(redactedThinking).toHaveProperty('signature');
    expect(redactedThinkingNoSig).not.toHaveProperty('signature');
  });

  test('tool_start agentId is optional', () => {
    expect(toolStart).toHaveProperty('agentId');
    expect(toolStartNoAgent).not.toHaveProperty('agentId');
  });
});

// ---------------------------------------------------------------------------
// isEnvelopeEvent
// ---------------------------------------------------------------------------

describe('isEnvelopeEvent', () => {
  test('returns true for stream_start', () => {
    expect(isEnvelopeEvent(streamStart)).toBe(true);
  });

  test('returns true for stream_end', () => {
    expect(isEnvelopeEvent(streamEnd)).toBe(true);
  });

  test('returns false for thinking events', () => {
    expect(isEnvelopeEvent(thinkingStart)).toBe(false);
    expect(isEnvelopeEvent(thinkingDelta)).toBe(false);
    expect(isEnvelopeEvent(thinkingStop)).toBe(false);
    expect(isEnvelopeEvent(redactedThinking)).toBe(false);
  });

  test('returns false for tool events', () => {
    expect(isEnvelopeEvent(toolStart)).toBe(false);
    expect(isEnvelopeEvent(toolDelta)).toBe(false);
    expect(isEnvelopeEvent(toolStop)).toBe(false);
  });

  test('returns false for text events', () => {
    expect(isEnvelopeEvent(textStart)).toBe(false);
    expect(isEnvelopeEvent(textDelta)).toBe(false);
    expect(isEnvelopeEvent(textStop)).toBe(false);
  });

  test('returns false for agent events', () => {
    expect(isEnvelopeEvent(agentStart)).toBe(false);
    expect(isEnvelopeEvent(agentStop)).toBe(false);
  });

  test('returns false for usage, error, hitl, artifact', () => {
    expect(isEnvelopeEvent(usage)).toBe(false);
    expect(isEnvelopeEvent(error)).toBe(false);
    expect(isEnvelopeEvent(hitlRequest)).toBe(false);
    expect(isEnvelopeEvent(hitlResponse)).toBe(false);
    expect(isEnvelopeEvent(artifactStart)).toBe(false);
    expect(isEnvelopeEvent(artifactDelta)).toBe(false);
    expect(isEnvelopeEvent(artifactStop)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isThinkingEvent
// ---------------------------------------------------------------------------

describe('isThinkingEvent', () => {
  test('returns true for thinking_start', () => {
    expect(isThinkingEvent(thinkingStart)).toBe(true);
  });

  test('returns true for thinking_delta', () => {
    expect(isThinkingEvent(thinkingDelta)).toBe(true);
  });

  test('returns true for thinking_stop', () => {
    expect(isThinkingEvent(thinkingStop)).toBe(true);
  });

  test('returns true for redacted_thinking', () => {
    expect(isThinkingEvent(redactedThinking)).toBe(true);
  });

  test('returns false for envelope events', () => {
    expect(isThinkingEvent(streamStart)).toBe(false);
    expect(isThinkingEvent(streamEnd)).toBe(false);
  });

  test('returns false for tool events', () => {
    expect(isThinkingEvent(toolStart)).toBe(false);
    expect(isThinkingEvent(toolDelta)).toBe(false);
    expect(isThinkingEvent(toolStop)).toBe(false);
  });

  test('returns false for text events', () => {
    expect(isThinkingEvent(textStart)).toBe(false);
    expect(isThinkingEvent(textDelta)).toBe(false);
    expect(isThinkingEvent(textStop)).toBe(false);
  });

  test('returns false for agent events', () => {
    expect(isThinkingEvent(agentStart)).toBe(false);
    expect(isThinkingEvent(agentStop)).toBe(false);
  });

  test('returns false for usage, error, hitl, artifact', () => {
    expect(isThinkingEvent(usage)).toBe(false);
    expect(isThinkingEvent(error)).toBe(false);
    expect(isThinkingEvent(hitlRequest)).toBe(false);
    expect(isThinkingEvent(artifactStart)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isToolEvent
// ---------------------------------------------------------------------------

describe('isToolEvent', () => {
  test('returns true for tool_start', () => {
    expect(isToolEvent(toolStart)).toBe(true);
  });

  test('returns true for tool_delta', () => {
    expect(isToolEvent(toolDelta)).toBe(true);
  });

  test('returns true for tool_stop', () => {
    expect(isToolEvent(toolStop)).toBe(true);
  });

  test('returns false for envelope events', () => {
    expect(isToolEvent(streamStart)).toBe(false);
    expect(isToolEvent(streamEnd)).toBe(false);
  });

  test('returns false for thinking events', () => {
    expect(isToolEvent(thinkingStart)).toBe(false);
    expect(isToolEvent(thinkingDelta)).toBe(false);
    expect(isToolEvent(thinkingStop)).toBe(false);
    expect(isToolEvent(redactedThinking)).toBe(false);
  });

  test('returns false for text events', () => {
    expect(isToolEvent(textStart)).toBe(false);
    expect(isToolEvent(textDelta)).toBe(false);
    expect(isToolEvent(textStop)).toBe(false);
  });

  test('returns false for agent events', () => {
    expect(isToolEvent(agentStart)).toBe(false);
    expect(isToolEvent(agentStop)).toBe(false);
  });

  test('returns false for usage, error, hitl, artifact', () => {
    expect(isToolEvent(usage)).toBe(false);
    expect(isToolEvent(error)).toBe(false);
    expect(isToolEvent(hitlRequest)).toBe(false);
    expect(isToolEvent(artifactStop)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTextEvent
// ---------------------------------------------------------------------------

describe('isTextEvent', () => {
  test('returns true for text_start', () => {
    expect(isTextEvent(textStart)).toBe(true);
  });

  test('returns true for text_delta', () => {
    expect(isTextEvent(textDelta)).toBe(true);
  });

  test('returns true for text_stop', () => {
    expect(isTextEvent(textStop)).toBe(true);
  });

  test('returns false for envelope events', () => {
    expect(isTextEvent(streamStart)).toBe(false);
    expect(isTextEvent(streamEnd)).toBe(false);
  });

  test('returns false for thinking events', () => {
    expect(isTextEvent(thinkingStart)).toBe(false);
    expect(isTextEvent(redactedThinking)).toBe(false);
  });

  test('returns false for tool events', () => {
    expect(isTextEvent(toolStart)).toBe(false);
    expect(isTextEvent(toolDelta)).toBe(false);
    expect(isTextEvent(toolStop)).toBe(false);
  });

  test('returns false for agent events', () => {
    expect(isTextEvent(agentStart)).toBe(false);
    expect(isTextEvent(agentStop)).toBe(false);
  });

  test('returns false for usage, error, hitl, artifact', () => {
    expect(isTextEvent(usage)).toBe(false);
    expect(isTextEvent(error)).toBe(false);
    expect(isTextEvent(hitlResponse)).toBe(false);
    expect(isTextEvent(artifactDelta)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isAgentEvent
// ---------------------------------------------------------------------------

describe('isAgentEvent', () => {
  test('returns true for agent_start', () => {
    expect(isAgentEvent(agentStart)).toBe(true);
  });

  test('returns true for agent_stop', () => {
    expect(isAgentEvent(agentStop)).toBe(true);
  });

  test('returns false for envelope events', () => {
    expect(isAgentEvent(streamStart)).toBe(false);
    expect(isAgentEvent(streamEnd)).toBe(false);
  });

  test('returns false for thinking events', () => {
    expect(isAgentEvent(thinkingStart)).toBe(false);
    expect(isAgentEvent(thinkingDelta)).toBe(false);
    expect(isAgentEvent(thinkingStop)).toBe(false);
    expect(isAgentEvent(redactedThinking)).toBe(false);
  });

  test('returns false for tool events', () => {
    expect(isAgentEvent(toolStart)).toBe(false);
    expect(isAgentEvent(toolDelta)).toBe(false);
    expect(isAgentEvent(toolStop)).toBe(false);
  });

  test('returns false for text events', () => {
    expect(isAgentEvent(textStart)).toBe(false);
    expect(isAgentEvent(textDelta)).toBe(false);
    expect(isAgentEvent(textStop)).toBe(false);
  });

  test('returns false for usage, error, hitl, artifact', () => {
    expect(isAgentEvent(usage)).toBe(false);
    expect(isAgentEvent(error)).toBe(false);
    expect(isAgentEvent(hitlRequest)).toBe(false);
    expect(isAgentEvent(hitlResponse)).toBe(false);
    expect(isAgentEvent(artifactStart)).toBe(false);
    expect(isAgentEvent(artifactDelta)).toBe(false);
    expect(isAgentEvent(artifactStop)).toBe(false);
  });
});
