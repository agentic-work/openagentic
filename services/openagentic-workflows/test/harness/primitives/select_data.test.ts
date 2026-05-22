/**
 * select_data — Flows harness test.
 *
 * Verifies the typed processing primitive through the full
 * WorkflowExecutionEngine path (template substitution + node_complete
 * frame contract). Uses real k8s_list_pods fixture from F.5 evidence.
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

describe('select_data node — typed processing primitive', () => {
  it('pick mode — projects name + status from each real pod', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 's1',
            type: 'select_data',
            data: {
              input: '{{trigger.pods}}',
              fields: ['name', 'status'],
              mode: 'pick',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 's1' }],
      },
      input: { pods: PODS_REAL },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.s1 as Array<{ name: string; status: string }>;
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(5);
    expect(Object.keys(out[0]).sort()).toEqual(['name', 'status']);
    // Real pod restarts field must have been dropped.
    expect((out[0] as any).restarts).toBeUndefined();
  });

  it('omit mode — drops listed fields, keeps the rest', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 's1',
            type: 'select_data',
            data: {
              input: '{{trigger.pods}}',
              fields: ['restarts', 'labels'],
              mode: 'omit',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 's1' }],
      },
      input: { pods: PODS_REAL },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.s1 as Array<Record<string, unknown>>;
    expect(out.length).toBe(5);
    expect(out[0].restarts).toBeUndefined();
    expect(out[0].labels).toBeUndefined();
    // Other fields remain.
    expect(out[0].name).toBeDefined();
    expect(out[0].status).toBeDefined();
  });

  it('handles a single object input (not just arrays)', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 's1',
            type: 'select_data',
            data: {
              input: '{{trigger.firstPod}}',
              fields: ['name'],
              mode: 'pick',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 's1' }],
      },
      input: { firstPod: PODS_REAL[0] },
    });
    expect(result.status).toBe('completed');
    expect(result.outputs.s1).toEqual({ name: PODS_REAL[0].name });
  });

  it('emits node_error when fields is empty', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 's1',
            type: 'select_data',
            data: { input: '{{trigger.pods}}', fields: [] },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 's1' }],
      },
      input: { pods: PODS_REAL },
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/non-empty array/i);
  });
});
