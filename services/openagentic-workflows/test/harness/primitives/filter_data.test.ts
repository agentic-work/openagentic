/**
 * filter_data node — typed processing primitive.
 *
 * Filters an array by a field predicate. Replaces the JS-expression-only
 * path through `transform` for the most common AIOps case: "give me the
 * pods where status.phase === 'Pending'", "give me the alerts where
 * severity contains 'critical'", etc.
 *
 * Contract:
 *   input:  items (path or literal array), field (dot-path), operator, value
 *   output: { filtered: <Array>, droppedCount, totalCount }
 *
 * Operators: eq, neq, gt, lt, gte, lte, contains, exists, starts_with,
 * ends_with, in, not_in, matches_regex.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFlow } from '../runFlow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PODS_REAL = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/k8s_list_pods-real.json'), 'utf8'),
).result.result.pods;

describe('filter_data node — typed processing primitive', () => {
  it('filters real k8s pods by status.phase == "Running"', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'f1',
            type: 'filter_data',
            data: {
              items: '{{trigger.pods}}',
              field: 'status',
              operator: 'eq',
              value: 'Running',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'f1' }],
      },
      input: { pods: PODS_REAL },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.f1 as {
      filtered: Array<{ status: string }>;
      droppedCount: number;
      totalCount: number;
    };
    expect(out.totalCount).toBe(5);
    // 3 Running (api/ui/mcp-proxy/redis are 4 actually let me recount): pods array
    // has openagentic-api(Running), openagentic-ui(Running), workflows(Pending),
    // mcp-proxy(Running), harbor-redis(Running) → 4 Running, 1 Pending
    expect(out.filtered.length).toBe(4);
    expect(out.droppedCount).toBe(1);
    expect(out.filtered.every((p) => p.status === 'Running')).toBe(true);
  });

  it('supports "neq" operator', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'f1',
            type: 'filter_data',
            data: {
              items: '{{trigger.items}}',
              field: 'status',
              operator: 'neq',
              value: 'Running',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'f1' }],
      },
      input: {
        items: [
          { status: 'Running' },
          { status: 'Pending' },
          { status: 'Failed' },
        ],
      },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.f1 as { filtered: any[]; droppedCount: number };
    expect(out.filtered.length).toBe(2);
    expect(out.droppedCount).toBe(1);
  });

  it('supports "gt"/"gte"/"lt"/"lte" numeric operators', async () => {
    const flow = (op: string, val: number) => ({
      nodes: [
        { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
        {
          id: 'f1',
          type: 'filter_data',
          data: {
            items: '{{trigger.pods}}',
            field: 'restarts',
            operator: op,
            value: val,
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'f1' }],
    });

    const gt = await runFlow({ flow: flow('gt', 0), input: { pods: PODS_REAL } });
    expect(gt.status).toBe('completed');
    const gtOut = gt.outputs.f1 as { filtered: any[] };
    // workflows(restarts=8) + mcp-proxy(restarts=12) = 2 pods
    expect(gtOut.filtered.length).toBe(2);

    const lte = await runFlow({ flow: flow('lte', 0), input: { pods: PODS_REAL } });
    const lteOut = lte.outputs.f1 as { filtered: any[] };
    expect(lteOut.filtered.length).toBe(3);

    const gte = await runFlow({ flow: flow('gte', 8), input: { pods: PODS_REAL } });
    const gteOut = gte.outputs.f1 as { filtered: any[] };
    expect(gteOut.filtered.length).toBe(2);
  });

  it('supports "contains" operator on strings', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'f1',
            type: 'filter_data',
            data: {
              items: '{{trigger.pods}}',
              field: 'name',
              operator: 'contains',
              value: 'workflows',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'f1' }],
      },
      input: { pods: PODS_REAL },
    });
    const out = result.outputs.f1 as { filtered: any[] };
    expect(out.filtered.length).toBe(1);
    expect(out.filtered[0].name).toMatch(/workflows/);
  });

  it('supports "exists" operator (omits value)', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'f1',
            type: 'filter_data',
            data: {
              items: '{{trigger.items}}',
              field: 'ip',
              operator: 'exists',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'f1' }],
      },
      input: {
        items: [
          { name: 'a', ip: '10.0.0.1' },
          { name: 'b', ip: null },
          { name: 'c' },
        ],
      },
    });
    const out = result.outputs.f1 as { filtered: any[] };
    expect(out.filtered.length).toBe(1);
    expect(out.filtered[0].name).toBe('a');
  });

  it('supports "starts_with" / "ends_with"', async () => {
    const sw = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'f1',
            type: 'filter_data',
            data: {
              items: '{{trigger.pods}}',
              field: 'name',
              operator: 'starts_with',
              value: 'openagentic',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'f1' }],
      },
      input: { pods: PODS_REAL },
    });
    const swOut = sw.outputs.f1 as { filtered: any[] };
    expect(swOut.filtered.length).toBe(4);

    const ew = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'f1',
            type: 'filter_data',
            data: {
              items: '{{trigger.items}}',
              field: 'name',
              operator: 'ends_with',
              value: '.io',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'f1' }],
      },
      input: { items: [{ name: 'foo.io' }, { name: 'bar.com' }] },
    });
    const ewOut = ew.outputs.f1 as { filtered: any[] };
    expect(ewOut.filtered.length).toBe(1);
  });

  it('supports "in" / "not_in"', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'f1',
            type: 'filter_data',
            data: {
              items: '{{trigger.items}}',
              field: 'severity',
              operator: 'in',
              value: ['critical', 'warning'],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'f1' }],
      },
      input: {
        items: [
          { severity: 'critical' },
          { severity: 'info' },
          { severity: 'warning' },
        ],
      },
    });
    const out = result.outputs.f1 as { filtered: any[] };
    expect(out.filtered.length).toBe(2);
  });

  it('supports "matches_regex"', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'f1',
            type: 'filter_data',
            data: {
              items: '{{trigger.pods}}',
              field: 'name',
              operator: 'matches_regex',
              value: '^harbor-',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'f1' }],
      },
      input: { pods: PODS_REAL },
    });
    const out = result.outputs.f1 as { filtered: any[] };
    expect(out.filtered.length).toBe(1);
    expect(out.filtered[0].name).toBe('harbor-redis-0');
  });

  it('returns empty filtered array when nothing matches', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'f1',
            type: 'filter_data',
            data: {
              items: '{{trigger.pods}}',
              field: 'status',
              operator: 'eq',
              value: 'NoSuchPhase',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'f1' }],
      },
      input: { pods: PODS_REAL },
    });
    const out = result.outputs.f1 as { filtered: any[]; droppedCount: number; totalCount: number };
    expect(out.filtered).toHaveLength(0);
    expect(out.droppedCount).toBe(5);
    expect(out.totalCount).toBe(5);
  });

  it('emits node_error when items resolves to non-array', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'f1',
            type: 'filter_data',
            data: {
              items: '{{trigger.notAnArray}}',
              field: 'status',
              operator: 'eq',
              value: 'x',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'f1' }],
      },
      input: { notAnArray: { some: 'object' } },
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/filter_data|array/i);
  });
});
