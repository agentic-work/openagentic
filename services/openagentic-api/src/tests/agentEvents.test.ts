/**
 * Server-side tests for the Phase F.6 typed agent-event envelope.
 *
 * This file enforces the invariant that every lifecycle wire name is
 * recognised exactly once in AGENT_EVENT_TYPES and in lockstep with the
 * UI copy (services/openagentic-ui/src/features/chat/types/agentEvents.ts).
 */

import { describe, it, expect } from 'vitest';
import {
  AGENT_EVENT_TYPES,
  AGENT_EVENT_SET,
  isAgentEventType,
} from '../services/agentEvents';

describe('AGENT_EVENT_TYPES (server)', () => {
  it('is non-empty and only contains agent_* / execution_* names', () => {
    expect(AGENT_EVENT_TYPES.length).toBeGreaterThan(0);
    for (const t of AGENT_EVENT_TYPES) {
      expect(t.startsWith('agent_') || t.startsWith('execution_')).toBe(true);
    }
  });

  it('has no duplicate entries (de-dupes to same size)', () => {
    expect(new Set(AGENT_EVENT_TYPES).size).toBe(AGENT_EVENT_TYPES.length);
  });

  it('matches the UI copy verbatim to prevent wire drift', () => {
    // Must stay in sync with services/openagentic-ui/src/features/chat/types/agentEvents.ts
    const expected = [
      'agent_spawn_plan',
      'agent_start',
      'agent_stream',
      'agent_tool_call',
      'agent_tool_result',
      'agent_thinking',
      'agent_complete',
      'agent_return',
      'agent_delegation',
      'agent_image_generated',
      'execution_complete',
    ];
    expect([...AGENT_EVENT_TYPES]).toEqual(expected);
  });
});

describe('AGENT_EVENT_SET membership', () => {
  it('is a ReadonlySet with every canonical name present', () => {
    for (const t of AGENT_EVENT_TYPES) {
      expect(AGENT_EVENT_SET.has(t)).toBe(true);
    }
  });

  it('does not include noisy approval events (those live alongside, not inside)', () => {
    expect(AGENT_EVENT_SET.has('approval_required')).toBe(false);
    expect(AGENT_EVENT_SET.has('mcp_approval_required')).toBe(false);
  });
});

describe('isAgentEventType', () => {
  it('accepts canonical wire names', () => {
    expect(isAgentEventType('agent_start')).toBe(true);
    expect(isAgentEventType('agent_complete')).toBe(true);
    expect(isAgentEventType('execution_complete')).toBe(true);
  });

  it('rejects unknown and non-string values', () => {
    expect(isAgentEventType('agent_turbo')).toBe(false);
    expect(isAgentEventType('')).toBe(false);
    expect(isAgentEventType(42)).toBe(false);
    expect(isAgentEventType(null)).toBe(false);
    expect(isAgentEventType(undefined)).toBe(false);
    expect(isAgentEventType({ type: 'agent_start' })).toBe(false);
  });
});
