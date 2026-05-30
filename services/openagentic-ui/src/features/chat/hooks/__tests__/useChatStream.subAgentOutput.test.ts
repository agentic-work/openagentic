/**
 * Phase 16 — sub-agent `output` flows end-to-end through the reducer.
 *
 * Wire frame extension: SubAgentCompletedFrame.output: string
 * Reducer: applySubAgentCompleted(Scoped) carries output into SubAgentEntry
 *
 * The SubAgentCard then renders entry.output in the cm-sa-return strip
 * instead of the meaningless "X turns Y tok" stats-string.
 */

import { describe, it, expect } from 'vitest';
import {
  applySubAgentStarted,
  applySubAgentCompleted,
  applySubAgentStartedScoped,
  applySubAgentCompletedScoped,
  type SubAgentEntry,
} from '../useChatStream';

describe('sub-agent output threading (Phase 16)', () => {
  it('flat reducer: completion frame writes output onto the entry', () => {
    let list: SubAgentEntry[] = [];
    list = applySubAgentStarted(list, {
      type: 'sub_agent_started',
      role: 'cloud_operations',
      description: 'list azure RGs',
    });
    list = applySubAgentCompleted(list, {
      type: 'sub_agent_completed',
      role: 'cloud_operations',
      ok: true,
      turns: 7,
      tokens: 5485,
      durationMs: 32400,
      toolsUsed: ['azure_subscriptions', 'azure_resource_groups'],
      output: 'Found 6 resource groups across 2 subscriptions; openagentic-dev has 5, sub-1 has 1.',
    } as any);
    expect(list[0].status).toBe('ok');
    expect(list[0].output).toBe(
      'Found 6 resource groups across 2 subscriptions; openagentic-dev has 5, sub-1 has 1.',
    );
  });

  it('scoped reducer: completion frame writes output onto the per-message entry', () => {
    let m: Record<string, SubAgentEntry[]> = {};
    m = applySubAgentStartedScoped(m, 'msg-1', {
      type: 'sub_agent_started',
      role: 'cloud_operations',
    });
    m = applySubAgentCompletedScoped(m, 'msg-1', {
      type: 'sub_agent_completed',
      role: 'cloud_operations',
      ok: true,
      turns: 3,
      tokens: 2731,
      durationMs: 14500,
      toolsUsed: [],
      output: '3 RGs found',
    } as any);
    expect(m['msg-1'][0].output).toBe('3 RGs found');
  });

  it('output is undefined on the entry when frame omits it (back-compat)', () => {
    let list: SubAgentEntry[] = [];
    list = applySubAgentStarted(list, {
      type: 'sub_agent_started',
      role: 'cost-analysis',
    });
    list = applySubAgentCompleted(list, {
      type: 'sub_agent_completed',
      role: 'cost-analysis',
      ok: true,
      turns: 5,
      tokens: 1247,
      durationMs: 3800,
      // no output field
    });
    expect(list[0].output).toBeUndefined();
    // status/stats still populate
    expect(list[0].status).toBe('ok');
    expect(list[0].stats?.tokens).toBe(1247);
  });
});
