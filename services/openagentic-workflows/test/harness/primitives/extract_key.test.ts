/**
 * extract_key — Flows harness test.
 *
 * Verifies the typed processing primitive through the full
 * WorkflowExecutionEngine path using real k8s_list_pods fixture.
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

describe('extract_key node — typed processing primitive', () => {
  it('extracts the name of the first real pod via bracket notation', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'x1',
            type: 'extract_key',
            data: {
              input: '{{trigger.pods}}',
              path: '[0].name',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'x1' }],
      },
      input: { pods: PODS_REAL },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.x1 as { value: unknown; found: boolean };
    expect(out.found).toBe(true);
    expect(out.value).toBe(PODS_REAL[0].name);
  });

  it('returns found=false + default when path missing', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'x1',
            type: 'extract_key',
            data: {
              input: '{{trigger.body}}',
              path: 'response.missing.value',
              default: 'fallback',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'x1' }],
      },
      input: { body: { response: { other: 'x' } } },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.x1 as { value: unknown; found: boolean };
    expect(out.found).toBe(false);
    expect(out.value).toBe('fallback');
  });

  it('rejects empty path via schema-required compile gate', async () => {
    // Schema marks `path` as required → compile rejects empty path before
    // the executor runs. The compile error surfaces as status=failed with a
    // FIELD_REQUIRED / required-marker error message; either the compile
    // gate OR the executor's runtime guard catches an empty path.
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'x1',
            type: 'extract_key',
            data: { input: '{{trigger.pods}}', path: '' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'x1' }],
      },
      input: { pods: PODS_REAL },
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/path|required/i);
  });
});
