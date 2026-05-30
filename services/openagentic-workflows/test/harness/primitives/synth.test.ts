/**
 * synth node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - POSTs an intent to `${apiUrl}/api/synth/synthesize`.
 *   - Normal-completion response unwraps to
 *     `{ toolName, tool: {explanation, riskLevel, capabilitiesUsed}, result, metrics }`.
 *
 * synth-executor is mocked via MSW — the contract is "the node wires the
 * intent through correctly and unwraps the api response", NOT the
 * code-synthesis pipeline itself.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('synth node — dynamic tool synthesis', () => {
  it('dispatches intent to synth api and unwraps the success envelope', async () => {
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/synth/synthesize', async () =>
        HttpResponse.json({
          success: true,
          toolName: 'compute_sum',
          tool: {
            explanation: 'Adds two integers and prints the result.',
            riskLevel: 'low',
            capabilitiesUsed: ['python_exec'],
          },
          result: { stdout: '4\n', exitCode: 0 },
          metrics: { synthesisTimeMs: 120, executionTimeMs: 8, totalTimeMs: 128, costUsd: 0 },
        }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'synth',
            type: 'synth',
            data: {
              intent: 'compute 2 + 2 in python and print the answer',
              capabilities: ['python_exec'],
              dryRun: false,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'synth' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.synth as {
      toolName: string;
      tool: { riskLevel: string; capabilitiesUsed: string[] };
      result: unknown;
      metrics: { totalTimeMs: number };
    };
    expect(out.toolName).toBe('compute_sum');
    expect(out.tool.riskLevel).toBe('low');
    expect(out.tool.capabilitiesUsed).toContain('python_exec');
    expect(out.metrics.totalTimeMs).toBeGreaterThan(0);
  });
});
