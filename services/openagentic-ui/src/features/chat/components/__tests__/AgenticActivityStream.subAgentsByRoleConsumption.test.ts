/**
 * #1113 — Per-role dispatch FIFO consumption for parallel sub-agents
 * sharing a subagent_type.
 *
 * Live evidence on 0.7.1-cd220a7e (2026-05-25): 3 parallel Tasks all
 * with subagent_type=cloud_operations produced 3 distinct sub_agent_started
 * frames (descriptions: "Azure IAM audit", "AWS IAM audit", "GCP IAM
 * audit" — confirmed via api logs), but the UI rendered all 3 sub-agent
 * cards with the same description because `subAgentByRole.get(role)` was
 * Map<role, SubAgentEntry> last-write-wins.
 *
 * Fix: `subAgentsByRole` is now Map<role, SubAgentEntry[]> (FIFO per role)
 * and the agent_group iterator consumes one entry per group via a per-role
 * `roleConsumedIdx` counter.
 *
 * This test pins the consumption pattern in isolation — a tiny pure-data
 * unit test that doesn't require rendering the full AAS tree.
 */
import { describe, it, expect } from 'vitest';

type SubAgentEntry = {
  role: string;
  description?: string | null;
  model?: string | null;
  status: 'running' | 'ok' | 'error';
};

/**
 * Mirror of the production logic at AgenticActivityStream.tsx (#1113):
 * - Build Map<role, SubAgentEntry[]> from subAgents array
 * - For each agent_group iteration, look up by role and pop FIFO via
 *   a shared per-render counter.
 */
function makeSubAgentsByRole(
  subAgents: SubAgentEntry[],
): Map<string, SubAgentEntry[]> {
  const m = new Map<string, SubAgentEntry[]>();
  for (const sa of subAgents) {
    const existing = m.get(sa.role) ?? [];
    existing.push(sa);
    m.set(sa.role, existing);
  }
  return m;
}

function consumeForGroups(
  groupRoles: string[][],
  subAgentsByRole: Map<string, SubAgentEntry[]>,
): Array<SubAgentEntry | undefined> {
  const roleConsumedIdx = new Map<string, number>();
  const out: Array<SubAgentEntry | undefined> = [];
  for (const roles of groupRoles) {
    for (const role of roles) {
      const entries = subAgentsByRole.get(role) ?? [];
      const idx = roleConsumedIdx.get(role) ?? 0;
      const sa = entries[idx];
      out.push(sa);
      if (sa) roleConsumedIdx.set(role, idx + 1);
    }
  }
  return out;
}

describe('#1113 — per-role dispatch FIFO consumption', () => {
  it('3 parallel Tasks sharing role each get their OWN SubAgentEntry', () => {
    const subAgents: SubAgentEntry[] = [
      { role: 'cloud_operations', description: 'Azure IAM audit', status: 'running' },
      { role: 'cloud_operations', description: 'AWS IAM audit', status: 'running' },
      { role: 'cloud_operations', description: 'GCP IAM audit', status: 'running' },
    ];
    const byRole = makeSubAgentsByRole(subAgents);
    // 3 separate agent_groups, each iterating roleOrder = ['cloud_operations']
    const consumed = consumeForGroups(
      [['cloud_operations'], ['cloud_operations'], ['cloud_operations']],
      byRole,
    );

    expect(consumed).toHaveLength(3);
    expect(consumed[0]?.description).toBe('Azure IAM audit');
    expect(consumed[1]?.description).toBe('AWS IAM audit');
    expect(consumed[2]?.description).toBe('GCP IAM audit');
    // All distinct (no dupes — the bug repro returned the same entry 3x)
    const labels = consumed.map(s => s?.description);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('mixed roles in one agent_group each consume their own queue', () => {
    const subAgents: SubAgentEntry[] = [
      { role: 'cloud_operations', description: 'Azure', status: 'running' },
      { role: 'code_writer', description: 'Refactor', status: 'running' },
      { role: 'cloud_operations', description: 'AWS', status: 'running' },
    ];
    const byRole = makeSubAgentsByRole(subAgents);
    // One agent_group with two roles, then another with one cloud_operations
    const consumed = consumeForGroups(
      [['cloud_operations', 'code_writer'], ['cloud_operations']],
      byRole,
    );

    expect(consumed[0]?.description).toBe('Azure');
    expect(consumed[1]?.description).toBe('Refactor');
    expect(consumed[2]?.description).toBe('AWS');
  });

  it('returns undefined when more groups exist than entries (graceful)', () => {
    const subAgents: SubAgentEntry[] = [
      { role: 'cloud_operations', description: 'Azure', status: 'running' },
    ];
    const byRole = makeSubAgentsByRole(subAgents);
    const consumed = consumeForGroups(
      [['cloud_operations'], ['cloud_operations'], ['cloud_operations']],
      byRole,
    );
    expect(consumed[0]?.description).toBe('Azure');
    expect(consumed[1]).toBeUndefined();
    expect(consumed[2]).toBeUndefined();
  });

  it('does not advance counter on miss (preserves order for late-arriving entries)', () => {
    // Simulate: agent_group iteration runs before sub_agent_started arrives
    // for the role. Counter should NOT increment so when the entry arrives
    // and another render fires, the first group gets the right entry.
    const subAgents: SubAgentEntry[] = []; // empty initially
    const byRole = makeSubAgentsByRole(subAgents);
    const consumed = consumeForGroups(
      [['cloud_operations'], ['cloud_operations']],
      byRole,
    );
    expect(consumed[0]).toBeUndefined();
    expect(consumed[1]).toBeUndefined();

    // Now sub_agent_started arrives:
    const subAgents2: SubAgentEntry[] = [
      { role: 'cloud_operations', description: 'Azure', status: 'running' },
      { role: 'cloud_operations', description: 'AWS', status: 'running' },
    ];
    const byRole2 = makeSubAgentsByRole(subAgents2);
    const consumed2 = consumeForGroups(
      [['cloud_operations'], ['cloud_operations']],
      byRole2,
    );
    expect(consumed2[0]?.description).toBe('Azure');
    expect(consumed2[1]?.description).toBe('AWS');
  });

  it('preserves single-role single-entry behavior (no regression)', () => {
    const subAgents: SubAgentEntry[] = [
      { role: 'researcher', description: 'doc lookup', status: 'running' },
    ];
    const byRole = makeSubAgentsByRole(subAgents);
    const consumed = consumeForGroups([['researcher']], byRole);
    expect(consumed[0]?.description).toBe('doc lookup');
  });
});
