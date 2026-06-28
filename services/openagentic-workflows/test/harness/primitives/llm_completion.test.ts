/**
 * llm_completion node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - The executor POSTs to `${apiUrl}/api/v1/chat/completions` with an
 *     OpenAI-shaped body (model + messages + temperature + max_tokens).
 *   - The response { choices[0].message.content, model, usage } is
 *     unwrapped into `{ content, model, usage }` on the node output.
 *
 * Real-data discipline (feedback_no_synthetic_chunks_only_real_provider_captures):
 * We probe hal:11434 at the top of the file. When the Ollama server is
 * reachable we DO NOT bypass MSW — the executor still talks to the
 * platform's OpenAI shim, not directly to Ollama — but we note hal as
 * available so a follow-up test (Phase E) can exercise the full
 * Ollama->shim->engine path. When hal is unreachable we still run the
 * mocked contract test; the hal probe is documentary, not gating.
 */

import { describe, it, expect } from 'vitest';
import { http, passthrough } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';

async function halReachable(): Promise<boolean> {
  // Register a passthrough on hal:11434 so MSW does not log an
  // "unhandled request" warning while we exercise the documentary probe.
  harnessServer.use(http.get('http://hal:11434/api/tags', () => passthrough()));
  try {
    const r = await fetch('http://hal:11434/api/tags', {
      signal: AbortSignal.timeout(2_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

describe('llm_completion node — primitive contract', () => {
  it('round-trips a chat completion through the platform shim', async () => {
    const hal = await halReachable();
    if (!hal) {
      // eslint-disable-next-line no-console
      console.warn(
        '[llm_completion] hal:11434 unreachable — mocked-only run. ' +
          'Re-run from a host with cluster DNS for real-Ollama coverage.',
      );
    }

    const { handler } = mockChatCompletions({
      content: 'Two plus two equals four.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'llm',
            type: 'llm_completion',
            data: {
              prompt: 'What is 2+2?',
              model: 'auto',
              temperature: 0.7,
              maxTokens: 64,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'llm' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.llm as { content: string; model: string; usage: unknown };
    expect(out.content).toBe('Two plus two equals four.');
    expect(out.model).toBe('gpt-oss:20b');
    expect(out.usage).toMatchObject({ prompt_tokens: 12, completion_tokens: 6 });
  });
});
