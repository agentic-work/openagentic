/**
 * PricingService orchestrator tests (task #342, unit 3).
 *
 * These tests exercise the atomic-write contract described in the task:
 *   - pickFetcher('aws-bedrock') returns a BedrockPricingFetcher
 *   - pickFetcher('ollama'|'anthropic'|unknown) returns null → no-op
 *   - On successful fetch, `prisma.modelRoleAssignment.update` is called
 *     ONCE with all 8 pricing columns set in the same data block so the
 *     CHECK constraint (`rates non-null ⇒ source+fetched_at non-null`)
 *     is always satisfied.
 *   - Partial pricing (e.g., only input+output, no cache) still writes
 *     `pricing_source` + `pricing_fetched_at` atomically.
 *   - On fetch failure, NO update is issued (fail-open — row stays with
 *     NULL rates and the error is logged, never propagated).
 *   - P2025 from Prisma (row not found) is swallowed, never propagated.
 */

import { describe, it, expect, vi } from 'vitest';
import { PricingService } from '../PricingService.js';
import type { ModelPricing, PricingFetcher } from '../types.js';

/** Tiny stub fetcher that returns a canned pricing object. */
function stubFetcher(pricing: ModelPricing): PricingFetcher {
  return { fetch: vi.fn().mockResolvedValue(pricing) };
}

/** Stub fetcher that throws — simulates AWS SDK error. */
function throwingFetcher(err: Error): PricingFetcher {
  return { fetch: vi.fn().mockRejectedValue(err) };
}

/** Capturing mock Prisma that records all .update() calls. */
function mockPrisma() {
  const updateCalls: Array<{ where: any; data: any }> = [];
  return {
    calls: updateCalls,
    client: {
      modelRoleAssignment: {
        update: vi.fn(async (args: any) => {
          updateCalls.push(args);
          return { id: args.where.id };
        }),
      },
    },
  };
}

/** P2025 is the Prisma error code for "record to update not found". */
function mockPrismaThrowingP2025() {
  const err = Object.assign(new Error('Record to update not found'), {
    code: 'P2025',
    name: 'PrismaClientKnownRequestError',
  });
  return {
    client: {
      modelRoleAssignment: {
        update: vi.fn(async () => {
          throw err;
        }),
      },
    },
  };
}

describe('PricingService.pickFetcher', () => {
  const svc = new PricingService({} as any);

  it('returns a fetcher for aws-bedrock', () => {
    // Cast to any — pickFetcher is private in the type but we're unit-testing.
    const fetcher = (svc as any).pickFetcher('aws-bedrock');
    expect(fetcher).not.toBeNull();
    expect(typeof fetcher.fetch).toBe('function');
  });

  it('returns null for ollama (no catalog pricing)', () => {
    expect((svc as any).pickFetcher('ollama')).toBeNull();
  });

  it('returns null for anthropic direct (tenant uses CSP creds only)', () => {
    expect((svc as any).pickFetcher('anthropic')).toBeNull();
  });

  it('returns null for unknown provider types', () => {
    expect((svc as any).pickFetcher('not-a-real-provider')).toBeNull();
  });

  it('returns null for azure-ai-foundry in this commit (unit 4)', () => {
    expect((svc as any).pickFetcher('azure-ai-foundry')).toBeNull();
  });

  it('returns null for vertex-ai in this commit (unit 5)', () => {
    expect((svc as any).pickFetcher('vertex-ai')).toBeNull();
  });
});

describe('PricingService.fetchAndStorePricing — happy path', () => {
  it('writes all 6 rate columns + source + fetched_at atomically in ONE update', async () => {
    const fetched = new Date('2026-04-23T10:00:00.000Z').toISOString();
    const pricing: ModelPricing = {
      inputTokenUsd: 15.0,
      outputTokenUsd: 75.0,
      cacheReadUsd: 1.5,
      cacheWriteUsd: 18.75,
      thinkingTokenUsd: 75.0,
      embeddingTokenUsd: 0.1,
      source: 'bedrock-pricing-sdk',
      fetchedAt: fetched,
    };
    const fetcher = stubFetcher(pricing);
    const { client, calls } = mockPrisma();
    const svc = new PricingService(client as any);
    // Inject the stub fetcher by overriding pickFetcher for this test.
    (svc as any).pickFetcher = () => fetcher;

    await svc.fetchAndStorePricing({
      providerType: 'aws-bedrock',
      modelId: 'anthropic.claude-opus-4-6-v1:0',
      region: 'us-east-1',
      registryRowId: 'row-abc',
    });

    expect(fetcher.fetch).toHaveBeenCalledWith({
      modelId: 'anthropic.claude-opus-4-6-v1:0',
      region: 'us-east-1',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].where).toEqual({ id: 'row-abc' });
    // All 8 audit+rate columns present in the SAME data block.
    expect(calls[0].data).toEqual({
      cost_per_input_token_usd: 15.0,
      cost_per_output_token_usd: 75.0,
      cost_per_cache_read_usd: 1.5,
      cost_per_cache_write_usd: 18.75,
      cost_per_thinking_token_usd: 75.0,
      cost_per_embedding_token_usd: 0.1,
      pricing_source: 'bedrock-pricing-sdk',
      pricing_fetched_at: new Date(fetched),
    });
  });

  it('handles partial pricing (only input+output) — still writes source + fetched_at together', async () => {
    const fetched = new Date('2026-04-23T11:00:00.000Z').toISOString();
    const pricing: ModelPricing = {
      inputTokenUsd: 3.0,
      outputTokenUsd: 15.0,
      // No cache, no thinking, no embedding — typical cheaper chat model.
      source: 'bedrock-pricing-sdk',
      fetchedAt: fetched,
    };
    const fetcher = stubFetcher(pricing);
    const { client, calls } = mockPrisma();
    const svc = new PricingService(client as any);
    (svc as any).pickFetcher = () => fetcher;

    await svc.fetchAndStorePricing({
      providerType: 'aws-bedrock',
      modelId: 'anthropic.claude-haiku-v1:0',
      region: 'us-east-1',
      registryRowId: 'row-haiku',
    });

    expect(calls).toHaveLength(1);
    // source + fetched_at must be present alongside the rates that DID fetch.
    expect(calls[0].data.pricing_source).toBe('bedrock-pricing-sdk');
    expect(calls[0].data.pricing_fetched_at).toEqual(new Date(fetched));
    expect(calls[0].data.cost_per_input_token_usd).toBe(3.0);
    expect(calls[0].data.cost_per_output_token_usd).toBe(15.0);
    // Missing rates: either omitted or explicitly null — either is
    // acceptable under the CHECK constraint. Assert they are NOT
    // positive numbers (i.e., not accidentally set from a stale fetch).
    expect(calls[0].data.cost_per_cache_read_usd ?? null).toBeNull();
    expect(calls[0].data.cost_per_cache_write_usd ?? null).toBeNull();
    expect(calls[0].data.cost_per_thinking_token_usd ?? null).toBeNull();
    expect(calls[0].data.cost_per_embedding_token_usd ?? null).toBeNull();
  });
});

describe('PricingService.fetchAndStorePricing — fail-open behavior', () => {
  it('does NOT call update when the fetcher throws (row left unchanged)', async () => {
    const fetcher = throwingFetcher(new Error('AWS Pricing SDK: throttled'));
    const { client, calls } = mockPrisma();
    const svc = new PricingService(client as any);
    (svc as any).pickFetcher = () => fetcher;

    // Must NOT throw — fail-open.
    await expect(
      svc.fetchAndStorePricing({
        providerType: 'aws-bedrock',
        modelId: 'anthropic.claude-opus-4-6-v1:0',
        region: 'us-east-1',
        registryRowId: 'row-xyz',
      }),
    ).resolves.toBeUndefined();

    expect(fetcher.fetch).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(0);
  });

  it('skips fetch + update when pickFetcher returns null (ollama)', async () => {
    const { client, calls } = mockPrisma();
    const svc = new PricingService(client as any);
    // Do NOT override pickFetcher — rely on the real null-return path.

    await expect(
      svc.fetchAndStorePricing({
        providerType: 'ollama',
        modelId: 'llama3.2:3b',
        region: null,
        registryRowId: 'row-ollama',
      }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(0);
  });

  it('swallows P2025 (row not found) — registry row deleted between insert and bg fetch', async () => {
    const fetched = new Date().toISOString();
    const pricing: ModelPricing = {
      inputTokenUsd: 15,
      outputTokenUsd: 75,
      source: 'bedrock-pricing-sdk',
      fetchedAt: fetched,
    };
    const fetcher = stubFetcher(pricing);
    const { client } = mockPrismaThrowingP2025();
    const svc = new PricingService(client as any);
    (svc as any).pickFetcher = () => fetcher;

    await expect(
      svc.fetchAndStorePricing({
        providerType: 'aws-bedrock',
        modelId: 'anthropic.claude-opus-4-6-v1:0',
        region: 'us-east-1',
        registryRowId: 'non-existent',
      }),
    ).resolves.toBeUndefined();
  });

  it('skips bedrock fetch when region is null (no region = no price list)', async () => {
    const fetcher = stubFetcher({
      inputTokenUsd: 15,
      outputTokenUsd: 75,
      source: 'bedrock-pricing-sdk',
      fetchedAt: new Date().toISOString(),
    });
    const { client, calls } = mockPrisma();
    const svc = new PricingService(client as any);
    (svc as any).pickFetcher = () => fetcher;

    await svc.fetchAndStorePricing({
      providerType: 'aws-bedrock',
      modelId: 'anthropic.claude-opus-4-6-v1:0',
      region: null,
      registryRowId: 'row-noregion',
    });

    // No region → no fetch, no write — we can't ask AWS for pricing
    // without telling it which region.
    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});
