/**
 * Tests for the Phase F.6 typed agent-event envelope.
 */

import { describe, it, expect } from 'vitest';
import {
  AGENT_EVENT_TYPES,
  isAgentEvent,
  isAgentEventOfType,
} from '../agentEvents';

describe('AGENT_EVENT_TYPES', () => {
  it('covers every lifecycle wire name the UI branches on', () => {
    // If the server introduces a new agent_* event name, add it here and to
    // the constant — this assertion prevents silent drift.
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

describe('isAgentEvent', () => {
  it('accepts minimal payloads with a known type', () => {
    expect(isAgentEvent({ type: 'agent_start', agentId: 'a', role: 'r' })).toBe(true);
    expect(isAgentEvent({ type: 'agent_complete', agentId: 'a' })).toBe(true);
    expect(isAgentEvent({ type: 'execution_complete', executionId: 'e' })).toBe(true);
  });

  it('rejects primitives', () => {
    expect(isAgentEvent(null)).toBe(false);
    expect(isAgentEvent(undefined)).toBe(false);
    expect(isAgentEvent('agent_start')).toBe(false);
    expect(isAgentEvent(42)).toBe(false);
  });

  it('rejects objects with no type field', () => {
    expect(isAgentEvent({ agentId: 'a' })).toBe(false);
    expect(isAgentEvent({})).toBe(false);
  });

  it('rejects objects with unknown type values', () => {
    expect(isAgentEvent({ type: 'definitely_not_an_agent_event' })).toBe(false);
    expect(isAgentEvent({ type: '' })).toBe(false);
    expect(isAgentEvent({ type: 123 })).toBe(false);
  });

  it('passes extra fields through without rejecting (permissive-by-design)', () => {
    expect(isAgentEvent({ type: 'agent_start', agentId: 'a', role: 'r', extra: 'ok' })).toBe(true);
  });
});

describe('isAgentEventOfType', () => {
  it('narrows to the requested subtype', () => {
    const ev: unknown = { type: 'agent_complete', agentId: 'a', status: 'success' };
    expect(isAgentEventOfType(ev, 'agent_complete')).toBe(true);
    expect(isAgentEventOfType(ev, 'agent_start')).toBe(false);
  });

  it('rejects non-agent events even when the target type is known', () => {
    expect(isAgentEventOfType({ type: 'bogus' }, 'agent_start')).toBe(false);
    expect(isAgentEventOfType(null, 'agent_complete')).toBe(false);
  });
});
