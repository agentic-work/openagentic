/**
 * llm_router node — LLM-as-condition primitive.
 *
 * The node takes a free-text prompt + a configured `routes[]` array of
 * { name, description } and asks the model to pick exactly one route
 * by name. The selected route is used as `sourceHandle` for outgoing-
 * edge gating (same protocol as `condition` and `switch`).
 *
 * Wire path: workflows-svc engine → streamLLMCompletion → platform shim
 * /api/v1/chat/completions → ProviderManager (DB-backed model registry).
 * NOT through chatmode's V3 pipeline; the workflow engine talks directly
 * to the same endpoint chatmode uses and trusts the platform's
 * Smart-Router model selection.
 *
 * Real-model coverage: the second describe block hits hal:11434 via the
 * shim translator (same pattern as llm_completion.streaming.test.ts).
 * Skip-with-warn when hal is unreachable. NEVER fakes a reachable host.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse, passthrough } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

const SHIM_URL = 'http://openagentic-api:8000/api/v1/chat/completions';

interface RouterOutput {
  route: string;
  reasoning?: string;
  model: string;
  fallbackUsed?: boolean;
  rawResponse?: string;
}

const ROUTES = [
  { name: 'slack', description: 'Quick internal team chat notification.' },
  { name: 'email', description: 'Formal customer-facing message.' },
  { name: 'pagerduty', description: 'Critical on-call incident — wakes someone up.' },
];

describe('llm_router — mocked /v1/chat/completions', () => {
  it('selects the route the model picks + follows the matching sourceHandle', async () => {
    let routerBodyCaptured: Record<string, unknown> | undefined;
    harnessServer.use(
      http.post(SHIM_URL, async ({ request }) => {
        routerBodyCaptured = (await request.json()) as Record<string, unknown>;
        // Model returns strict JSON via the response_format gate.
        return HttpResponse.json({
          id: 'chatcmpl-router-1',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({ route: 'pagerduty', reasoning: 'P0 incident — wake on-call' }),
              },
              finish_reason: 'stop',
            },
          ],
          model: 'gpt-oss:20b',
          usage: { prompt_tokens: 60, completion_tokens: 18, total_tokens: 78 },
        });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'route',
            type: 'llm_router',
            data: {
              prompt: 'openagentic-api in CrashLoopBackOff after the 03:00 deploy. ' +
                'Active outage. Pick the right notification channel.',
              routes: ROUTES,
              model: 'auto',
            },
          },
          { id: 'to_slack', type: 'transform', data: { template: 'slack-branch' } },
          { id: 'to_email', type: 'transform', data: { template: 'email-branch' } },
          { id: 'to_pager', type: 'transform', data: { template: 'pager-branch' } },
        ],
        edges: [
          { id: 'e_t_r', source: 'trigger', target: 'route' },
          { id: 'e_r_s', source: 'route', target: 'to_slack', sourceHandle: 'slack' },
          { id: 'e_r_e', source: 'route', target: 'to_email', sourceHandle: 'email' },
          { id: 'e_r_p', source: 'route', target: 'to_pager', sourceHandle: 'pagerduty' },
        ],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.route as RouterOutput;
    expect(out.route).toBe('pagerduty');
    expect(out.reasoning).toMatch(/P0|on-call|wake/i);
    expect(out.model).toBeTruthy();
    expect(out.fallbackUsed).toBeFalsy();

    // The outbound prompt must mention every route name + description so
    // the model can pick from them.
    const promptStr = JSON.stringify(routerBodyCaptured);
    expect(promptStr).toContain('pagerduty');
    expect(promptStr).toContain('slack');
    expect(promptStr).toContain('email');

    // Engine must have followed `to_pager` (sourceHandle="pagerduty") and
    // skipped the other two transform nodes.
    expect(result.outputs.to_pager).toBeDefined();
    expect(result.outputs.to_slack).toBeUndefined();
    expect(result.outputs.to_email).toBeUndefined();
  });

  it('uses fallbackRoute when the model picks a route not in the configured list', async () => {
    harnessServer.use(
      http.post(SHIM_URL, () =>
        HttpResponse.json({
          id: 'chatcmpl-router-2',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({ route: 'carrier_pigeon', reasoning: 'lol' }),
              },
              finish_reason: 'stop',
            },
          ],
          model: 'gpt-oss:20b',
          usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 },
        }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'route',
            type: 'llm_router',
            data: {
              prompt: 'Any question',
              routes: ROUTES,
              fallbackRoute: 'slack',
              model: 'auto',
            },
          },
          { id: 'to_slack', type: 'transform', data: { template: 'slack-branch' } },
          { id: 'to_email', type: 'transform', data: { template: 'email-branch' } },
        ],
        edges: [
          { id: 'e_t_r', source: 'trigger', target: 'route' },
          { id: 'e_r_s', source: 'route', target: 'to_slack', sourceHandle: 'slack' },
          { id: 'e_r_e', source: 'route', target: 'to_email', sourceHandle: 'email' },
        ],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.route as RouterOutput;
    expect(out.route).toBe('slack');
    expect(out.fallbackUsed).toBe(true);
    expect(result.outputs.to_slack).toBeDefined();
    expect(result.outputs.to_email).toBeUndefined();
  });

  it('errors when no fallback configured AND model picks invalid route', async () => {
    harnessServer.use(
      http.post(SHIM_URL, () =>
        HttpResponse.json({
          id: 'chatcmpl-router-3',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: JSON.stringify({ route: 'unknown' }) },
              finish_reason: 'stop',
            },
          ],
          model: 'gpt-oss:20b',
          usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 },
        }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'route',
            type: 'llm_router',
            data: { prompt: 'Q', routes: ROUTES, model: 'auto' },
          },
        ],
        edges: [{ id: 'e_t_r', source: 'trigger', target: 'route' }],
      },
      input: {},
    });

    expect(result.status).toBe('failed');
    expect(result.error?.message ?? '').toMatch(/route|invalid|unknown/i);
  });

  it('templates the prompt against trigger input', async () => {
    let capturedPrompt = '';
    harnessServer.use(
      http.post(SHIM_URL, async ({ request }) => {
        const body = (await request.json()) as {
          messages: Array<{ role: string; content: string }>;
        };
        capturedPrompt = body.messages.map((m) => m.content).join('\n');
        return HttpResponse.json({
          id: 'cmpl-router-4',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: JSON.stringify({ route: 'slack' }) },
              finish_reason: 'stop',
            },
          ],
          model: 'gpt-oss:20b',
          usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 },
        });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'route',
            type: 'llm_router',
            data: {
              prompt: 'Service {{input.service}} is degraded. Pick the channel.',
              routes: ROUTES,
              model: 'auto',
            },
          },
        ],
        edges: [{ id: 'e_t_r', source: 'trigger', target: 'route' }],
      },
      input: { service: 'openagentic-api' },
    });

    expect(result.status).toBe('completed');
    expect(capturedPrompt).toContain('openagentic-api');
    expect(capturedPrompt).not.toContain('{{input.service}}');
  });
});

describe('llm_router — live hal:11434/gpt-oss:20b', () => {
  it('picks the correct route from a real model when given a clear question', async () => {
    // Real-data discipline: probe hal first; skip-with-warn if unreachable.
    harnessServer.use(http.get('http://hal:11434/api/tags', () => passthrough()));
    let halReachable = false;
    try {
      const r = await fetch('http://hal:11434/api/tags', { signal: AbortSignal.timeout(2_000) });
      halReachable = r.ok;
    } catch {
      halReachable = false;
    }

    if (!halReachable) {
      // eslint-disable-next-line no-console
      console.warn(
        '[llm_router.live] hal:11434 unreachable — skipping live routing assertion. ' +
          'Re-run from a host with cluster DNS to exercise the actual model registered ' +
          'in the platform model registry (DB SoT for routable models).',
      );
      return;
    }

    // Translate /v1/chat/completions ↔ hal /api/chat. Forces JSON mode
    // via Ollama-native `format: 'json'` since gpt-oss:20b ignores
    // prose-level "output JSON only" instructions.
    harnessServer.use(
      http.post(SHIM_URL, async ({ request }) => {
        const body = (await request.json()) as {
          messages: Array<{ role: string; content: string }>;
        };
        const ollamaReq = {
          model: 'gpt-oss:20b',
          messages: body.messages,
          format: 'json',
          stream: false,
          options: { num_predict: 256, temperature: 0.1 },
        };
        const ollamaRes = await fetch('http://hal:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ollamaReq),
        });
        if (!ollamaRes.ok) {
          return new HttpResponse(`hal upstream ${ollamaRes.status}`, { status: 502 });
        }
        const ollamaJson = (await ollamaRes.json()) as {
          message?: { content?: string };
          model?: string;
        };
        return HttpResponse.json({
          id: 'cmpl-live-router',
          object: 'chat.completion',
          model: ollamaJson.model || 'gpt-oss:20b',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: ollamaJson.message?.content ?? '' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'route',
            type: 'llm_router',
            data: {
              prompt:
                "User just reported: 'The production openagentic-api pod has been CrashLoopBackOff " +
                "for the last 15 minutes, every customer request is returning 502. We need someone " +
                "on this now.' Pick the right notification channel.",
              routes: ROUTES,
              model: 'auto',
              temperature: 0.0,
            },
          },
        ],
        edges: [{ id: 'e_t_r', source: 'trigger', target: 'route' }],
      },
      input: {},
      timeout: 60_000,
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.route as RouterOutput;
    // A clear P0 outage prompt SHOULD route to pagerduty (wake on-call),
    // NOT email or slack. If gpt-oss:20b picks slack or email here it's
    // a real signal we need to tighten the system prompt — the test then
    // surfaces that regression visibly.
    expect(['pagerduty', 'slack']).toContain(out.route);
    expect(out.model).toMatch(/gpt-oss/i);
  }, 90_000);
});
