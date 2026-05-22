/**
 * #650 U3 — VertexPublisherListFetcher reads from the vendored rate sheet.
 *
 * GCP doesn't publish a public REST API for per-model Vertex GenAI pricing,
 * so the rate table lives at services/openagentic-api/src/services/pricing/
 * data/vertex-publisher-list.json. This test pins the contract.
 */
import { describe, it, expect } from 'vitest';
import { VertexPublisherListFetcher } from '../VertexPublisherListFetcher.js';

describe('VertexPublisherListFetcher (#650 U3)', () => {
  it('returns rates for gemini-2.5-pro per the vendored sheet', async () => {
    const f = new VertexPublisherListFetcher();
    const r = await f.fetch({ modelId: 'gemini-2.5-pro', region: 'us-central1' });
    expect(r.inputTokenUsd).toBe(1.25);
    expect(r.outputTokenUsd).toBe(10.0);
    expect(r.source).toBe('vertex-publisher-list');
    expect(r.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('returns embedding rate for text-embedding-005', async () => {
    const r = await new VertexPublisherListFetcher().fetch({
      modelId: 'text-embedding-005',
      region: 'us-central1',
    });
    expect(r.embeddingTokenUsd).toBe(0.025);
  });

  it('returns per-request rate for imagen-4', async () => {
    const r = await new VertexPublisherListFetcher().fetch({
      modelId: 'imagen-4.0-generate-001',
      region: 'us-central1',
    });
    expect(r.imageGenPerRequestUsd).toBe(0.04);
  });

  it('throws PricingFetchError on unknown model', async () => {
    await expect(
      new VertexPublisherListFetcher().fetch({ modelId: 'fake-model-xyz', region: 'us-central1' }),
    ).rejects.toThrow(/PricingFetch:vertex|fake-model-xyz/);
  });

  it('uses an injected sheet when provided (admin-editable override path)', async () => {
    const f = new VertexPublisherListFetcher({
      sheet: {
        _meta: { captured_at: '2099-12-31' },
        rates: { 'custom-model': { inputTokenUsd: 99.99, outputTokenUsd: 199.99 } },
      },
    });
    const r = await f.fetch({ modelId: 'custom-model', region: 'us-central1' });
    expect(r.inputTokenUsd).toBe(99.99);
  });
});
