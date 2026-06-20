/**
 * Five-layer audit L5-1 (Bedrock OBO) — `streamProvider` must forward the
 * caller's `callerContext` ({ aadToken, userEmail }) from the chat ctx
 * onto the outgoing `providerManager.createCompletion(req)` body.
 *
 * Why this test exists
 * --------------------
 * `AWSBedrockProvider.createCompletion` reads `request.callerContext` and
 * exchanges the AAD ID token for short-lived STS credentials via
 * `assumeRoleWithAADToken`, then constructs a user-scoped BedrockRuntimeClient
 * for that turn. That whole machinery exists (since commit `05965e28`) — but
 * NO upstream call site ever set `callerContext` on the request. Result:
 * every Bedrock chat turn fell through to the service-principal singleton
 * client. compliance gap.
 *
 * Pin: streamProvider (the upstream boundary the chatLoop calls) MUST
 * pass req.callerContext through to providerManager.createCompletion(body)
 * as body.callerContext so the Bedrock provider sees it.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeStreamProvider } from '../streamProvider.js';
import type { ProviderRequest } from '../types.js';

describe('streamProvider — L5-1 Bedrock OBO callerContext forwarding', () => {
  it('forwards req.callerContext onto the providerManager.createCompletion body', async () => {
    const createCompletion = vi.fn().mockResolvedValue(
      // Provider returns an empty async iterator so streamProvider exits cleanly.
      (async function* () {
        // no chunks
      })(),
    );
    const providerManager = {
      createCompletion,
      getStreamFormatForModel: () => 'openai' as const,
    };

    const sp = makeStreamProvider(providerManager);
    const req: ProviderRequest = {
      system: 'You are an assistant.',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      tool_choice: 'auto',
      model: 'anthropic.claude-sonnet-4-6-20250101-v1:0',
      callerContext: {
        aadToken: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.fake.aad.token',
        userEmail: 'alice@example.com',
      },
    };

    // Drain the iterator so the closure body actually runs.
    for await (const _ of sp(req)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      void _;
    }

    expect(createCompletion).toHaveBeenCalledTimes(1);
    const body = createCompletion.mock.calls[0]![0];
    expect(body.callerContext).toBeDefined();
    expect(body.callerContext.aadToken).toBe(req.callerContext!.aadToken);
    expect(body.callerContext.userEmail).toBe('alice@example.com');
  });

  it('omits callerContext from the body when caller does not set it (back-compat for non-OBO models)', async () => {
    const createCompletion = vi.fn().mockResolvedValue((async function* () {})());
    const providerManager = {
      createCompletion,
      getStreamFormatForModel: () => 'openai' as const,
    };
    const sp = makeStreamProvider(providerManager);
    const req: ProviderRequest = {
      system: 'You are an assistant.',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      tool_choice: 'auto',
      model: 'gpt-oss:20b',
    };

    for await (const _ of sp(req)) {
      void _;
    }

    const body = createCompletion.mock.calls[0]![0];
    // Caller didn't set it → body must not invent it (provider's null-context
    // branch returns the service-principal client, which is correct for
    // Ollama / non-Bedrock models that don't care about OBO).
    expect(body.callerContext).toBeUndefined();
  });
});
