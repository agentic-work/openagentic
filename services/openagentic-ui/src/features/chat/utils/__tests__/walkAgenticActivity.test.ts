/**
 * walkAgenticActivity — vitest unit tests (Phase 0.2).
 *
 * Fixtures: hand-built DOM matching the AAS taxonomy from the mocks.
 * The Playwright spec at tests/e2e/dom-interleave.spec.ts drives the same
 * walker against chat-dev — these tests pin the pure classification logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  walkAgenticActivity,
  tracesEqual,
  type DomTrace,
} from '../walkAgenticActivity.js';

function mount(html: string): HTMLElement {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe('walkAgenticActivity', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns mounted=false when no AAS root exists', () => {
    const root = mount('<div>nothing here</div>');
    const trace = walkAgenticActivity(root);
    expect(trace.mounted).toBe(false);
    expect(trace.entries).toEqual([]);
  });

  it('walks the chronological children of an AAS root', () => {
    const root = mount(`
      <div data-aas-mounted="true">
        <div class="inline-thinking-block" data-duration="2.1s">Thought · 2.1s · ~74 tok</div>
        <div class="interleaved-text-block">Good — all three cost tools are in catalog.</div>
        <div data-testid="tool-card" data-tool-name="azure_cost_by_service" data-tool-status="ok">
          <div class="t-name">azure_cost_by_service</div>
          <div class="t-status">ok</div>
          <div class="t-timer">2.1s</div>
        </div>
        <div class="interleaved-text-block">Now pulling Azure data.</div>
        <div class="cm-streaming-table"><table></table></div>
        <div class="viz" data-template="sankey"><div class="viz-head"><div class="badge">sankey</div></div></div>
        <div class="followups"><button class="chip">drill</button><button class="chip">explain</button></div>
      </div>
    `);
    const trace = walkAgenticActivity(root, 'post-stream');
    expect(trace.mounted).toBe(true);
    expect(trace.label).toBe('post-stream');
    expect(trace.entries.map((e) => e.kind)).toEqual([
      'thinking',
      'text',
      'tool',
      'text',
      'streaming-table',
      'viz',
      'followups',
    ]);
    expect(trace.entries[0].durationLabel).toBe('2.1s');
    expect(trace.entries[2].name).toBe('azure_cost_by_service');
    expect(trace.entries[2].status).toBe('ok');
    expect(trace.entries[5].name).toBe('sankey');
    expect(trace.entries[6].childCount).toBe(2);
  });

  it('expands a parallel-tool-group into group + per-tool entries', () => {
    const root = mount(`
      <div data-aas-mounted="true">
        <div data-testid="parallel-tool-group">
          <div data-testid="parallel-tool-subcard" data-tool-name="aws_cost_explorer" data-tool-status="ok"></div>
          <div data-testid="parallel-tool-subcard" data-tool-name="azure_cost_by_service" data-tool-status="ok"></div>
          <div data-testid="parallel-tool-subcard" data-tool-name="gcp_query_cost_usage" data-tool-status="ok"></div>
        </div>
      </div>
    `);
    const trace = walkAgenticActivity(root);
    expect(trace.entries.map((e) => e.kind)).toEqual([
      'tool-group',
      'tool',
      'tool',
      'tool',
    ]);
    expect(trace.entries[0].childCount).toBe(3);
    expect(trace.entries.slice(1).map((e) => e.name)).toEqual([
      'aws_cost_explorer',
      'azure_cost_by_service',
      'gcp_query_cost_usage',
    ]);
  });

  it('falls back to alternative AAS root selectors', () => {
    const root = mount(`
      <div data-testid="agentic-activity-stream">
        <div class="interleaved-text-block">Hello</div>
      </div>
    `);
    const trace = walkAgenticActivity(root);
    expect(trace.mounted).toBe(true);
    expect(trace.entries[0].kind).toBe('text');
  });

  it('emits `other` entries when AAS is mounted but contains unrecognized children', () => {
    const root = mount(`
      <div data-aas-mounted="true">
        <div class="mystery-widget">??</div>
      </div>
    `);
    const trace = walkAgenticActivity(root);
    expect(trace.mounted).toBe(true);
    expect(trace.entries).toHaveLength(1);
    expect(trace.entries[0].kind).toBe('other');
    expect(trace.entries[0].rawClass).toContain('mystery-widget');
  });

  it('recognizes subagent cards with name + status', () => {
    const root = mount(`
      <div data-aas-mounted="true">
        <div class="cm-subagent-card" data-agent-name="cloud_operations">
          <div class="sa-name">cloud_operations</div>
          <div class="sa-status">complete</div>
        </div>
      </div>
    `);
    const trace = walkAgenticActivity(root);
    expect(trace.entries[0]).toMatchObject({
      kind: 'subagent',
      name: 'cloud_operations',
      status: 'complete',
    });
  });

  it('recognizes data-app-renderer iframe as a viz', () => {
    const root = mount(`
      <div data-aas-mounted="true">
        <div data-app-renderer="true" data-template="migration_plan">
          <iframe></iframe>
        </div>
      </div>
    `);
    const trace = walkAgenticActivity(root);
    expect(trace.entries[0].kind).toBe('viz');
    expect(trace.entries[0].name).toBe('migration_plan');
  });

  describe('tracesEqual', () => {
    function makeTrace(...kinds: Array<readonly [string, string?]>): DomTrace {
      return {
        mounted: true,
        entries: kinds.map(([kind, name]) => ({
          kind: kind as DomTrace['entries'][number]['kind'],
          name,
        })),
      };
    }

    it('returns true for identical traces', () => {
      const a = makeTrace(['text'], ['tool', 'azure_list_subscriptions']);
      const b = makeTrace(['text'], ['tool', 'azure_list_subscriptions']);
      expect(tracesEqual(a, b)).toBe(true);
    });

    it('returns false when lengths differ', () => {
      const a = makeTrace(['text'], ['tool', 'x']);
      const b = makeTrace(['text']);
      expect(tracesEqual(a, b)).toBe(false);
    });

    it('returns false when tool names diverge', () => {
      const a = makeTrace(['tool', 'azure_list_subscriptions']);
      const b = makeTrace(['tool', 'aws_list_accounts']);
      expect(tracesEqual(a, b)).toBe(false);
    });
  });
});
