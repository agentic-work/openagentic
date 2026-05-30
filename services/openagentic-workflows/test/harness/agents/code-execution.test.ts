/**
 * code-execution agent — Phase E2 built-in-agent contract.
 *
 * Public contract under test:
 *   - role='code-execution' writes a small script and runs it in the
 *     platform's sandbox via `browser_sandbox_exec` / `code_interpreter`.
 *   - Returns the script, its `stdout` / `stderr` / `exit_code`, and a
 *     short interpretation. Tool allowlist: `browser_sandbox_exec`,
 *     `code_interpreter`, `file_read`, `file_write`. The flow surfaces
 *     this via the `agent_single` envelope.
 */
import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('code-execution agent — sandboxed script run', () => {
  it('returns script + stdout/stderr/exit_code via agent_single', async () => {
    const { handler, captured } = mockOpenAgenticProxyExecuteSync({
      output: JSON.stringify({
        script:
          'import pandas as pd\ndf = pd.read_csv("latency.csv")\nprint(df["ms"].quantile(0.95))',
        stdout: '482.3\n',
        stderr: '',
        exit_code: 0,
        artifacts: [],
        interpretation: 'p95 latency in the sample CSV is 482.3 ms.',
      }),
      results: [
        {
          agentId: 'code-execution',
          role: 'code-execution',
          status: 'completed',
          content: 'Computed p95 latency = 482.3 ms.',
        },
      ],
      metrics: { totalTokens: 290 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'code',
            type: 'agent_single',
            data: {
              role: 'code-execution',
              prompt:
                'Compute the 95th-percentile latency from this CSV and write the bucket counts to a table.',
              maxTurns: 3,
              tools: [
                'browser_sandbox_exec',
                'code_interpreter',
                'file_read',
                'file_write',
              ],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'code' }],
      },
      input: { message: 'compute p95' },
    });

    expect(result.status).toBe('completed');
    expect(captured.role).toBe('code-execution');
    expect(captured.tools).toEqual(
      expect.arrayContaining(['browser_sandbox_exec', 'code_interpreter', 'file_read']),
    );

    const out = result.outputs.code as {
      source: string;
      content: string;
      status: string;
    };
    expect(out.source).toBe('agent_single');
    expect(out.status).toBe('completed');

    const payload = JSON.parse(out.content) as {
      script: string;
      stdout: string;
      stderr: string;
      exit_code: number;
      artifacts: unknown[];
      interpretation: string;
    };
    expect(typeof payload.script).toBe('string');
    expect(payload.script.length).toBeGreaterThan(0);
    expect(typeof payload.stdout).toBe('string');
    expect(typeof payload.stderr).toBe('string');
    expect(payload.exit_code).toBe(0);
    expect(Array.isArray(payload.artifacts)).toBe(true);
    expect(typeof payload.interpretation).toBe('string');
  });
});
