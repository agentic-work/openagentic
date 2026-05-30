/**
 * #669 — Reranker must NEVER call provider.createCompletion with an
 * empty model. The current code passes only `messages`/`max_tokens`,
 * leaving `request.model = undefined`. OllamaProvider then falls back
 * to `this.healthCheckModel` (which is "" for several deployed
 * configurations), and crashes with:
 *   "Model '' is not available on the Ollama host"
 *
 * Captured live (chat-dev, 2026-05-07T16:43:05.141Z):
 *   "[OllamaProvider] Model not found on Ollama host — will NOT auto-pull"
 *   modelName: ""
 *   stack: at OllamaProvider.ensureModelExists
 *          at rerankWithLLM (utils/reranker.js:57:26)
 *
 * Outcome: tool reranking always fails on Ollama-backed clusters,
 * tools come back unranked, and "show me my cloud resources" returns
 * an empty assistant message.
 *
 * Contract:
 *   - rerankWithLLM MUST resolve a non-empty model before calling
 *     provider.createCompletion(...).
 *   - When the chosen provider can't supply a model, fall back to the
 *     original tools (no rerank) — DO NOT call createCompletion with
 *     model="".
 */

import { describe, it, expect, vi } from 'vitest';
import { rerankWithLLM } from '../reranker.js';

function makeProvider(captured: any) {
  return {
    createCompletion: vi.fn(async (req: any) => {
      captured.lastRequest = req;
      // Mimic OllamaProvider's empty-model crash.
      if (!req.model || typeof req.model !== 'string' || req.model.trim() === '') {
        throw new Error(`Model '${req.model ?? ''}' is not available on the Ollama host.`);
      }
      // Simulate a sane LLM-rerank response shape.
      return { choices: [{ message: { content: '1\n2\n3' } }] };
    }),
  };
}

function makeManager(provider: any, opts: { defaultChatModel?: string } = {}) {
  return {
    getProviderNames: () => ['hal'],
    getProvider: () => provider,
    getDefaultChatModel: () => opts.defaultChatModel ?? null,
  } as any;
}

describe('#669 reranker — must always pass a non-empty model', () => {
  it('passes an explicit model arg when provider manager can supply a default', async () => {
    const captured: any = {};
    const provider = makeProvider(captured);
    const manager = makeManager(provider, { defaultChatModel: 'gpt-oss:20b' });

    await rerankWithLLM('list my azure subs', [
      { name: 'azure_list_subscriptions', description: 'List Azure subs' },
      { name: 'aws_list_accounts', description: 'List AWS accounts' },
    ], 5, manager);

    expect(provider.createCompletion).toHaveBeenCalledTimes(1);
    expect(captured.lastRequest.model).toBeDefined();
    expect(typeof captured.lastRequest.model).toBe('string');
    expect(captured.lastRequest.model.length).toBeGreaterThan(0);
  });

  it('falls back to original tools when no default model is available — does NOT call createCompletion with empty model', async () => {
    const captured: any = {};
    const provider = makeProvider(captured);
    const manager = makeManager(provider, { defaultChatModel: undefined });

    const tools = [
      { name: 'azure_list_subscriptions', description: 'List Azure subs' },
      { name: 'aws_list_accounts', description: 'List AWS accounts' },
    ];
    const out = await rerankWithLLM('list my azure subs', tools, 5, manager);

    expect(provider.createCompletion).not.toHaveBeenCalled();
    expect(out).toEqual(tools);
  });
});
