/**
 * Sev-0 #838 — pin the persisted-sub-agent merge contract.
 *
 * Reload-survival regression cage. Pre-fix, after page reload the
 * persisted `sub_agent_complete[d]` payloads rendered in a separate
 * `<div data-testid="persisted-sub-agents">` BELOW the assistant prose,
 * dropping the inline timeline anchor. Post-fix, this helper folds them
 * into the live `subAgentsByMessageId` map so AgenticActivityStream
 * renders inline regardless of hydration source.
 */
import { describe, it, expect } from 'vitest';
import {
  mergePersistedSubAgents,
  normalizePersistedSubAgent,
} from '../mergePersistedSubAgents';

describe('normalizePersistedSubAgent', () => {
  it('maps a fully-populated completed payload to a SubAgentEntry shape', () => {
    const out = normalizePersistedSubAgent({
      role: 'cloud_operations',
      description: 'List Azure subs',
      model: 'us.anthropic.claude-sonnet-4-6',
      ok: true,
      turns: 1,
      tokens: 4177,
      durationMs: 15977,
      toolsUsed: ['azure_list_subscriptions'],
      output: '## Azure subs\n...',
      session_id: 'sub-sess-abc',
    });
    expect(out).toEqual({
      role: 'cloud_operations',
      description: 'List Azure subs',
      model: 'us.anthropic.claude-sonnet-4-6',
      status: 'ok',
      sessionId: 'sub-sess-abc',
      output: '## Azure subs\n...',
      stats: {
        turns: 1,
        tokens: 4177,
        wallMs: 15977,
        toolsUsed: ['azure_list_subscriptions'],
      },
    });
  });

  it('marks ok=false payloads as status=error', () => {
    const out = normalizePersistedSubAgent({
      role: 'validation',
      ok: false,
      error: 'sub-agent timed out',
    });
    expect(out?.status).toBe('error');
    expect(out?.error).toBe('sub-agent timed out');
  });

  it('returns null for empty/missing role (skips malformed payloads)', () => {
    expect(normalizePersistedSubAgent(null as any)).toBeNull();
    expect(normalizePersistedSubAgent(undefined as any)).toBeNull();
    expect(normalizePersistedSubAgent({ role: '' } as any)).toBeNull();
    expect(normalizePersistedSubAgent({} as any)).toBeNull();
  });

  it('handles missing stats — omits the stats block instead of writing zeros', () => {
    const out = normalizePersistedSubAgent({ role: 'planning' });
    expect(out).toEqual({ role: 'planning', model: null, status: 'ok' });
    expect(out?.stats).toBeUndefined();
  });

  it('accepts camelCase `sessionId` alongside snake_case `session_id`', () => {
    expect(normalizePersistedSubAgent({ role: 'r', sessionId: 'a' })?.sessionId).toBe('a');
    expect(normalizePersistedSubAgent({ role: 'r', session_id: 'b' })?.sessionId).toBe('b');
  });
});

describe('mergePersistedSubAgents', () => {
  const messages = [
    { id: 'user-1', role: 'user' },
    {
      id: 'asst-1',
      role: 'assistant',
      visualizations: [
        {
          type: 'sub_agent_completed',
          data: {
            role: 'cloud_operations',
            description: 'aws audit',
            ok: true,
            turns: 1,
            tokens: 4000,
            durationMs: 16000,
          },
        },
        {
          type: 'sub_agent_completed',
          data: {
            role: 'validation',
            description: 'compose_visual validation',
            ok: true,
            turns: 1,
            tokens: 1198,
            durationMs: 15500,
          },
        },
        {
          type: 'visual_render',
          data: { template: 'sankey' },
        },
      ],
    },
    {
      id: 'asst-2',
      role: 'assistant',
      visualizations: [
        {
          type: 'sub_agent_complete', // legacy spelling
          data: { role: 'planning', ok: true, turns: 1, tokens: 5626, durationMs: 76000 },
        },
      ],
    },
  ];

  it('threads 2 persisted sub-agents into the assistant message map (reload survival)', () => {
    const merged = mergePersistedSubAgents({}, messages);
    expect(merged['asst-1']).toHaveLength(2);
    expect(merged['asst-1'].map(e => e.role).sort()).toEqual(['cloud_operations', 'validation']);
    expect(merged['asst-1'][0].status).toBe('ok');
    expect(merged['asst-1'][0].stats?.tokens).toBe(4000);
  });

  it('accepts legacy `sub_agent_complete` spelling alongside `sub_agent_completed`', () => {
    const merged = mergePersistedSubAgents({}, messages);
    expect(merged['asst-2']).toHaveLength(1);
    expect(merged['asst-2'][0].role).toBe('planning');
  });

  it('lets live entries win over persisted on key collision (no stale clobber)', () => {
    const live = {
      'asst-1': [
        {
          role: 'cloud_operations',
          model: null,
          status: 'running' as const,
        },
      ],
    };
    const merged = mergePersistedSubAgents(live, messages);
    // Live entry kept, NOT replaced with the persisted snapshot.
    expect(merged['asst-1']).toHaveLength(1);
    expect(merged['asst-1'][0].status).toBe('running');
  });

  it('user messages have no sub-agent slot (only assistant rows checked)', () => {
    const merged = mergePersistedSubAgents({}, messages);
    expect(merged['user-1']).toBeUndefined();
  });

  it('handles null/undefined inputs without throwing', () => {
    expect(mergePersistedSubAgents(null, null)).toEqual({});
    expect(mergePersistedSubAgents(undefined, undefined)).toEqual({});
    expect(mergePersistedSubAgents({}, [])).toEqual({});
  });

  it('preserves unrelated assistant-message entries in the live map', () => {
    const live = {
      'asst-other': [{ role: 'data_query', model: null, status: 'ok' as const }],
    };
    const merged = mergePersistedSubAgents(live, messages);
    expect(merged['asst-other']).toHaveLength(1);
    expect(merged['asst-1']).toHaveLength(2);
  });

  it('drops malformed visualization entries silently — no card from junk', () => {
    const merged = mergePersistedSubAgents({}, [
      {
        id: 'asst-junk',
        role: 'assistant',
        visualizations: [
          { type: 'sub_agent_completed', data: null },
          { type: 'sub_agent_completed', data: {} as any }, // no role
          { type: 'sub_agent_completed', data: { role: '' } as any },
        ],
      },
    ]);
    expect(merged['asst-junk']).toBeUndefined();
  });
});
