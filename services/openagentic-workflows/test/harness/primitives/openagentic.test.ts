/**
 * openagentic node — Phase E1 primitive contract.
 *
 * Public contract: posts `{ language, code, timeout, workflowExecutionId }`
 * to `${openagenticManagerUrl}/api/execute`. Returns
 * `{ stdout, stderr, exitCode, language, sessionStatus, transcript, summary }`.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('openagentic node — sandboxed CLI session', () => {
  it('forwards the code to the manager and surfaces stdout + sessionStatus', async () => {
    let receivedBody: any;
    harnessServer.use(
      http.post('http://code-exec.example.test:8080/api/execute', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          stdout: 'hello from sandbox\n',
          stderr: '',
          exitCode: 0,
          sessionStatus: 'completed',
          transcript: 'Wrote 3 lines, ran tests successfully.',
          summary: 'Session ok.',
        });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ac',
            type: 'openagentic',
            data: {
              language: 'python',
              code: 'print("hello from sandbox")',
              timeout: 5000,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ac' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.ac as {
      stdout: string;
      exitCode: number;
      language: string;
      sessionStatus: string;
    };
    expect(out.stdout).toContain('hello from sandbox');
    expect(out.exitCode).toBe(0);
    expect(out.language).toBe('python');
    expect(out.sessionStatus).toBe('completed');
    expect(receivedBody?.language).toBe('python');
  });
});
