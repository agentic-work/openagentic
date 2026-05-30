/**
 * BedrockPricingFetcher TDD (task #342).
 *
 * Red test: parsing a captured AWS Pricing SDK GetProducts response for
 * Claude Opus 4.6 in us-east-1 must produce the 4 published rates
 * (input / output / cache-read / cache-write), normalized to USD per 1M
 * tokens so the cost ledger can aggregate cleanly.
 *
 * The fetcher uses @aws-sdk/client-pricing under the hood. For this unit
 * test we exercise the pure-function parser against a canned fixture —
 * no live AWS call, no IAM creds required. An integration test hits the
 * live SDK but is gated on AWS_PRICING_INTEGRATION=1 in env.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBedrockPriceList } from '../BedrockPricingFetcher.js';

const FIXTURE = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'bedrock-claude-opus-4-6-us-east-1.json'),
    'utf8',
  ),
);

describe('parseBedrockPriceList — per-1M-token normalization', () => {
  it('extracts input/output/cache-read/cache-write USD rates for claude-opus-4-6', () => {
    const pricing = parseBedrockPriceList(
      FIXTURE.PriceList,
      'anthropic.claude-opus-4-6-v1:0',
    );

    // Bedrock publishes pricePerUnit as USD per TOKEN; parser must
    // normalize to USD per 1M tokens for ledger consistency.
    expect(pricing.inputTokenUsd).toBeCloseTo(15.0, 4);
    expect(pricing.outputTokenUsd).toBeCloseTo(75.0, 4);
    expect(pricing.cacheReadUsd).toBeCloseTo(1.5, 4);
    expect(pricing.cacheWriteUsd).toBeCloseTo(18.75, 4);

    expect(pricing.source).toBe('bedrock-pricing-sdk');
    expect(pricing.sourceDetails).toContain('us-east-1');
    expect(pricing.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns pricing with only the rates the SKUs actually declared', () => {
    const pricing = parseBedrockPriceList(
      FIXTURE.PriceList,
      'anthropic.claude-opus-4-6-v1:0',
    );

    // No embedding SKUs in this fixture → field should be undefined,
    // not zero. Zero would imply "free" which is different from "N/A".
    expect(pricing.embeddingTokenUsd).toBeUndefined();
    expect(pricing.imageGenPerRequestUsd).toBeUndefined();
    expect(pricing.thinkingTokenUsd).toBeUndefined();
  });

  it('returns all-undefined pricing when model is not in the PriceList', () => {
    const pricing = parseBedrockPriceList(
      FIXTURE.PriceList,
      'anthropic.non-existent-model:0',
    );

    expect(pricing.inputTokenUsd).toBeUndefined();
    expect(pricing.outputTokenUsd).toBeUndefined();
    expect(pricing.cacheReadUsd).toBeUndefined();
    expect(pricing.cacheWriteUsd).toBeUndefined();
  });
});
