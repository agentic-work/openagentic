/**
 * regex — Flows harness test.
 *
 * Verifies the typed processing primitive through the full
 * WorkflowExecutionEngine path. Uses a real prometheus_alerts text-block
 * fixture from F.5 evidence as the input for the match case (operator-
 * facing alerts text is a canonical place to apply regex extraction).
 *
 * Path convention: when `input: { text: "..." }` is the trigger payload,
 * the engine stores `__trigger__.body = { text: "..." }` AND spreads its
 * keys onto __trigger__ (so {{trigger.text}} also resolves). Reference
 * the field via {{trigger.text}} to get the string directly — {{trigger.body}}
 * resolves to the wrapped object, which would JSON-stringify and break
 * the string-only contract of this node.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFlow } from '../runFlow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ALERTS_TEXT = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/prom_alerts-real.json'), 'utf8'),
).result.result.content[0].text;

describe('regex node — typed processing primitive', () => {
  it('match mode — extracts every Severity line from real Prometheus alerts', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'r1',
            type: 'regex',
            data: {
              input: '{{trigger.text}}',
              pattern: 'Severity: (\\w+)',
              flags: 'g',
              mode: 'match',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'r1' }],
      },
      input: { text: ALERTS_TEXT },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.r1 as {
      matches: Array<{ full: string; groups: string[] }>;
      count: number;
    };
    // Real fixture has 3 alerts → 3 Severity lines.
    expect(out.count).toBe(3);
    expect(out.matches[0].groups[0]).toBe('critical');
    expect(out.matches[1].groups[0]).toBe('warning');
    expect(out.matches[2].groups[0]).toBe('warning');
  });

  it('replace mode — redacts IPs from a text input', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'r1',
            type: 'regex',
            data: {
              input: '{{trigger.text}}',
              pattern: '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}',
              flags: 'g',
              mode: 'replace',
              replacement: '[REDACTED]',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'r1' }],
      },
      input: { text: 'Pod a on 10.42.6.41, pod b on 10.42.7.103' },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.r1 as { result: string; replacedCount: number };
    expect(out.result).toBe('Pod a on [REDACTED], pod b on [REDACTED]');
    expect(out.replacedCount).toBe(2);
  });

  it('test mode — returns boolean for pattern check', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'r1',
            type: 'regex',
            data: {
              input: '{{trigger.text}}',
              pattern: 'FIRING',
              mode: 'test',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'r1' }],
      },
      input: { text: ALERTS_TEXT },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.r1 as { matches: boolean };
    expect(out.matches).toBe(true);
  });

  it('emits node_error on invalid regex pattern', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'r1',
            type: 'regex',
            data: { input: 'hi', pattern: '[invalid', mode: 'match' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'r1' }],
      },
      input: {},
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/invalid pattern/);
  });
});
