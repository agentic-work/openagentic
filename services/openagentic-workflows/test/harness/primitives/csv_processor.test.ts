/**
 * csv_processor — Flows harness test.
 *
 * Verifies the text-mode CSV parser end-to-end through
 * WorkflowExecutionEngine. Covers records output, the templated-input path
 * (CSV body coming from the trigger), and quoted-field handling.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';

describe('csv_processor node — text-mode CSV parsing', () => {
  it('parses header + records from a templated trigger input', async () => {
    const csv = 'name,role\nalice,engineer\nbob,designer';
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'csv',
            type: 'csv_processor',
            data: {
              csv: '{{trigger.body.csvText}}',
              hasHeader: true,
              outputAs: 'records',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'csv' }],
      },
      input: { body: { csvText: csv } },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.csv as {
      outputAs: string;
      columns: string[];
      count: number;
      records: Array<Record<string, string>>;
    };
    expect(out.outputAs).toBe('records');
    expect(out.columns).toEqual(['name', 'role']);
    expect(out.count).toBe(2);
    expect(out.records[0]).toEqual({ name: 'alice', role: 'engineer' });
    expect(out.records[1]).toEqual({ name: 'bob', role: 'designer' });
  });

  it('handles quoted fields with embedded commas + escaped quotes', async () => {
    const csv = 'name,note\n"alice, smith","she said ""hi"""\n"bob","plain"';
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'csv',
            type: 'csv_processor',
            data: { csv, hasHeader: true, outputAs: 'records' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'csv' }],
      },
      input: {},
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.csv as { records: Array<Record<string, string>> };
    expect(out.records[0]).toEqual({ name: 'alice, smith', note: 'she said "hi"' });
    expect(out.records[1]).toEqual({ name: 'bob', note: 'plain' });
  });
});
