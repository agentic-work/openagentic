/**
 * P0-1 part 2 of chatmode UX parity — per-message scoping for sub-agent cards.
 *
 * the design notes
 *
 * User direction (verbatim 2026-04-30):
 * "the agent cards as well as other objects do not STAY in their own fucking
 *  chat session let alone their own space where they rendered inline in the
 *  interleave."
 *
 * Part 1 (commit fdb3686c) fixed cross-session bleed by clearing
 * setSubAgents([]) on session switch. Part 2 (this file) addresses the
 * per-message scope: when the user scrolls back to message #1, it must
 * render only the sub-agents dispatched DURING message #1's turn — not
 * the latest snapshot from message #3.
 *
 * State shape change:
 *   subAgents: SubAgentEntry[]           (session-global; problematic)
 *     ↓
 *   subAgentsByMessageId: Record<msgId, SubAgentEntry[]>
 *
 * Mirrors `applyTierHintFrame` (per-message map keyed by active assistant
 * messageId) and `applySubAgentStarted` (existing flat-array reducer).
 *
 * The flat `subAgents` state is preserved for backwards compatibility so
 * any consumer still reading the flat array sees the union of all
 * per-message entries (matches today's behavior). The new
 * `subAgentsByMessageId` state is what ChatMessages consults to thread
 * the right subset into each MessageBubble.
 */

import { describe, it, expect } from 'vitest';
import {
  applySubAgentStartedScoped,
  applySubAgentCompletedScoped,
  type SubAgentEntry,
} from '../useChatStream';

describe('applySubAgentStartedScoped — per-message sub_agent_started reducer', () => {
  it('appends a new running entry under the active messageId', () => {
    const before: Record<string, SubAgentEntry[]> = {};
    const next = applySubAgentStartedScoped(before, 'msg-1', {
      type: 'sub_agent_started',
      role: 'cost-analysis',
      description: 'right-size the fleet',
      model: 'sonnet-4',
      session_id: 's1',
    });
    expect(next['msg-1']).toBeDefined();
    expect(next['msg-1']).toHaveLength(1);
    expect(next['msg-1'][0]).toMatchObject({
      role: 'cost-analysis',
      status: 'running',
    });
  });

  it('does not mutate the input map (returns a new object)', () => {
    const before: Record<string, SubAgentEntry[]> = {};
    const next = applySubAgentStartedScoped(before, 'msg-1', {
      type: 'sub_agent_started',
      role: 'security-analysis',
    });
    expect(next).not.toBe(before);
    expect(before['msg-1']).toBeUndefined();
  });

  it('preserves entries for other messageIds when adding new ones', () => {
    let m: Record<string, SubAgentEntry[]> = {};
    m = applySubAgentStartedScoped(m, 'msg-1', {
      type: 'sub_agent_started',
      role: 'cost-analysis',
    });
    m = applySubAgentStartedScoped(m, 'msg-2', {
      type: 'sub_agent_started',
      role: 'security-analysis',
    });
    expect(m['msg-1']).toHaveLength(1);
    expect(m['msg-1'][0].role).toBe('cost-analysis');
    expect(m['msg-2']).toHaveLength(1);
    expect(m['msg-2'][0].role).toBe('security-analysis');
  });

  it('appends multiple entries under the same messageId', () => {
    let m: Record<string, SubAgentEntry[]> = {};
    m = applySubAgentStartedScoped(m, 'msg-1', {
      type: 'sub_agent_started',
      role: 'cost-analysis',
    });
    m = applySubAgentStartedScoped(m, 'msg-1', {
      type: 'sub_agent_started',
      role: 'security-analysis',
    });
    expect(m['msg-1']).toHaveLength(2);
    expect(m['msg-1'][0].role).toBe('cost-analysis');
    expect(m['msg-1'][1].role).toBe('security-analysis');
  });

  it('drops the frame silently when messageId is empty (defensive)', () => {
    const before: Record<string, SubAgentEntry[]> = {};
    const next = applySubAgentStartedScoped(before, '', {
      type: 'sub_agent_started',
      role: 'foo',
    });
    expect(Object.keys(next)).toHaveLength(0);
  });

  it('drops the frame silently when role is missing (no orphan entry)', () => {
    const before: Record<string, SubAgentEntry[]> = {};
    const next = applySubAgentStartedScoped(before, 'msg-1', {
      type: 'sub_agent_started',
      role: '',
    });
    // Either no key at msg-1, or empty array — both are acceptable as
    // "frame dropped silently". The consumer (ChatMessages) tolerates both.
    expect((next['msg-1'] ?? []).length).toBe(0);
  });
});

describe('applySubAgentCompletedScoped — per-message sub_agent_completed reducer', () => {
  it('flips matching running entry to ok with stats', () => {
    let m: Record<string, SubAgentEntry[]> = {};
    m = applySubAgentStartedScoped(m, 'msg-1', {
      type: 'sub_agent_started',
      role: 'cost-analysis',
    });
    m = applySubAgentCompletedScoped(m, 'msg-1', {
      type: 'sub_agent_completed',
      role: 'cost-analysis',
      ok: true,
      turns: 3,
      tokens: 1024,
      durationMs: 5500,
      toolsUsed: ['azure_list_subscriptions'],
    });
    expect(m['msg-1']).toHaveLength(1);
    expect(m['msg-1'][0]).toMatchObject({
      role: 'cost-analysis',
      status: 'ok',
      stats: { turns: 3, tokens: 1024, wallMs: 5500 },
    });
  });

  it('flips matching running entry to err when ok=false', () => {
    let m: Record<string, SubAgentEntry[]> = {};
    m = applySubAgentStartedScoped(m, 'msg-1', {
      type: 'sub_agent_started',
      role: 'security-analysis',
    });
    m = applySubAgentCompletedScoped(m, 'msg-1', {
      type: 'sub_agent_completed',
      role: 'security-analysis',
      ok: false,
      error: 'tool denied',
      turns: 1,
      tokens: 256,
      durationMs: 800,
    });
    expect(m['msg-1'][0].status).toBe('error');
    expect(m['msg-1'][0].error).toBe('tool denied');
  });

  it('does not affect entries under other messageIds', () => {
    let m: Record<string, SubAgentEntry[]> = {};
    m = applySubAgentStartedScoped(m, 'msg-1', {
      type: 'sub_agent_started',
      role: 'cost-analysis',
    });
    m = applySubAgentStartedScoped(m, 'msg-2', {
      type: 'sub_agent_started',
      role: 'cost-analysis',
    });
    m = applySubAgentCompletedScoped(m, 'msg-1', {
      type: 'sub_agent_completed',
      role: 'cost-analysis',
      ok: true,
      turns: 1,
      tokens: 1,
      durationMs: 1,
    });
    expect(m['msg-1'][0].status).toBe('ok');
    expect(m['msg-2'][0].status).toBe('running');
  });

  it('returns input unchanged when messageId is empty', () => {
    const before: Record<string, SubAgentEntry[]> = {
      'msg-1': [{ role: 'r', status: 'running', description: null, model: null }],
    };
    const next = applySubAgentCompletedScoped(before, '', {
      type: 'sub_agent_completed',
      role: 'r',
      ok: true,
      turns: 0,
      tokens: 0,
      durationMs: 0,
    });
    expect(next).toBe(before);
  });

  it('returns input unchanged when no matching running entry exists', () => {
    const before: Record<string, SubAgentEntry[]> = {
      'msg-1': [{ role: 'r', status: 'running', description: null, model: null }],
    };
    const next = applySubAgentCompletedScoped(before, 'msg-1', {
      type: 'sub_agent_completed',
      role: 'different-role',
      ok: true,
      turns: 0,
      tokens: 0,
      durationMs: 0,
    });
    expect(next['msg-1'][0].status).toBe('running'); // unchanged
  });

  it('does not mutate the input map (returns a new object)', () => {
    let before: Record<string, SubAgentEntry[]> = {};
    before = applySubAgentStartedScoped(before, 'msg-1', {
      type: 'sub_agent_started',
      role: 'r',
    });
    const next = applySubAgentCompletedScoped(before, 'msg-1', {
      type: 'sub_agent_completed',
      role: 'r',
      ok: true,
      turns: 0,
      tokens: 0,
      durationMs: 0,
    });
    expect(next).not.toBe(before);
    expect(before['msg-1'][0].status).toBe('running');
  });
});
