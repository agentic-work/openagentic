/**
 * Vertex Publisher List pricing fetcher (#650 U3).
 *
 * GCP does NOT publish a public REST endpoint covering per-model Vertex
 * GenAI pricing. CloudCatalog SKUs are inconsistent for Gemini, and the
 * @google-cloud/billing SDK exposes only resource-level rates.
 *
 * Solution: vendor the rate sheet at
 * `services/openagentic-api/src/services/pricing/data/vertex-publisher-list.json`,
 * sourced from https://cloud.google.com/vertex-ai/generative-ai/pricing.
 * The file is admin-editable, and the daily refresh cron flags drift via
 * a diff log so admins know when GCP changes a rate.
 *
 * The constructor accepts an optional `sheet` override so tests can run
 * without touching the real file, and so the admin "Refresh from
 * provider" button can substitute an updated rate sheet at runtime.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ModelPricing, PricingFetcher, PricingFetchRequest } from './types.js';
import { PricingFetchError } from './types.js';

interface VertexRateRow {
  inputTokenUsd?: number;
  outputTokenUsd?: number;
  cacheReadUsd?: number;
  cacheWriteUsd?: number;
  thinkingTokenUsd?: number;
  embeddingTokenUsd?: number;
  imageGenPerRequestUsd?: number;
}

interface VertexPublisherSheet {
  _meta: { captured_at: string; source?: string; note?: string; captured_by?: string };
  rates: Record<string, VertexRateRow>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SHEET_PATH = join(__dirname, 'data', 'vertex-publisher-list.json');

export class VertexPublisherListFetcher implements PricingFetcher {
  private readonly sheet: VertexPublisherSheet;

  constructor(opts?: { sheet?: VertexPublisherSheet; sheetPath?: string }) {
    if (opts?.sheet) {
      this.sheet = opts.sheet;
    } else {
      const path = opts?.sheetPath ?? DEFAULT_SHEET_PATH;
      this.sheet = JSON.parse(readFileSync(path, 'utf8')) as VertexPublisherSheet;
    }
  }

  async fetch(req: PricingFetchRequest): Promise<ModelPricing> {
    const rate = this.sheet.rates[req.modelId];
    if (!rate) {
      throw new PricingFetchError(
        'vertex',
        req.modelId,
        `not found in vertex-publisher-list.json (captured ${this.sheet._meta.captured_at})`,
      );
    }
    return {
      ...rate,
      source: 'vertex-publisher-list',
      fetchedAt: new Date().toISOString(),
      sourceDetails: `vertex-publisher-list.json captured ${this.sheet._meta.captured_at}`,
    };
  }
}
