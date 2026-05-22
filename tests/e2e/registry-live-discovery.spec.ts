/**
 * #650 U9 — Live discovery contract on the dev environment.
 *
 * Drives 4 providers through the Add-Model + Refresh-from-provider
 * surface and asserts the Registry row's discovered fields match
 * upstream truth (capabilities, context window, pricing source).
 *
 * Auth: re-uses `.auth/user.json` from saveAuthState helper. Regen on
 * JWT expiry per release-readiness.spec.ts top-of-file recipe.
 *
 * Pre-conditions (the fixture state on the dev environment):
 * - Bedrock provider exists with credentials configured
 * - Vertex provider exists with credentials configured
 * - Azure AI Foundry provider exists with `awf-aif-20902` deployment
 * - Ollama provider exists pointing at the in-cluster ollama-hal pod
 *
 * If a provider isn't configured the corresponding test soft-skips so
 * the rest of the suite can run.
 *
 * Run:
 *   npx playwright test tests/e2e/registry-live-discovery.spec.ts
 */

import { test, expect, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const AUTH_FILE = path.join(__dirname, '../../.auth/user.json');

test.use({
  storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
});

interface RegistryRow {
  id: string;
  model: string;
  provider: string;
  role: string;
  enabled: boolean;
  max_tokens?: number | null;
  temperature?: number | null;
  thinking_budget?: number | null;
  capabilities?: Record<string, boolean>;
  options?: any;
  cost_per_input_token_usd?: any;
  cost_per_output_token_usd?: any;
  pricing_source?: string | null;
  pricing_fetched_at?: string | null;
}

interface ProviderRow {
  id: string;
  name: string;
  provider_type: string;
  registry_rows?: RegistryRow[];
}

async function fetchRegistry(request: APIRequestContext): Promise<{
  providers: ProviderRow[];
}> {
  const resp = await request.get(`${BASE}/api/admin/llm-providers/database`);
  expect(resp.status()).toBe(200);
  return resp.json();
}

function findRow(
  reg: { providers: ProviderRow[] },
  providerType: string,
  modelMatcher: RegExp | string,
): { provider: ProviderRow; row: RegistryRow } | null {
  const provider = reg.providers.find((p) => p.provider_type === providerType);
  if (!provider) return null;
  const row = (provider.registry_rows ?? []).find((r) =>
    typeof modelMatcher === 'string' ? r.model === modelMatcher : modelMatcher.test(r.model),
  );
  if (!row) return null;
  return { provider, row };
}

test.describe('#650 Live discovery — Registry rows match upstream truth', () => {
  test('Vertex Gemini row carries vertex-publisher-list pricing + 1M context', async ({ request }) => {
    const reg = await fetchRegistry(request);
    const found = findRow(reg, 'vertex-ai', /^gemini/);
    test.skip(!found, 'No Vertex Gemini row in Registry — add via admin first');

    const { row } = found!;
    expect(row.pricing_source, `pricing_source for ${row.model}`).toBe('vertex-publisher-list');
    expect(Number(row.cost_per_input_token_usd ?? 0)).toBeGreaterThan(0);
    expect(Number(row.cost_per_output_token_usd ?? 0)).toBeGreaterThan(0);
    expect(row.options?.contextWindow ?? 0).toBeGreaterThanOrEqual(1_000_000);
    expect(row.capabilities?.streaming).toBe(true);
    expect(row.capabilities?.tools).toBe(true);
  });

  test('Bedrock Claude row carries bedrock-pricing-sdk pricing + 200K context', async ({ request }) => {
    const reg = await fetchRegistry(request);
    const found = findRow(reg, 'aws-bedrock', /claude/);
    test.skip(!found, 'No Bedrock Claude row in Registry — add via admin first');

    const { row } = found!;
    expect(row.pricing_source).toBe('bedrock-pricing-sdk');
    expect(Number(row.cost_per_input_token_usd ?? 0)).toBeGreaterThan(0);
    expect(Number(row.cost_per_output_token_usd ?? 0)).toBeGreaterThan(0);
    expect(row.options?.contextWindow ?? 0).toBeGreaterThanOrEqual(200_000);
    expect(row.capabilities?.tools).toBe(true);
    expect(row.capabilities?.streaming).toBe(true);
  });

  test('AIF gpt-5.x row carries azure-retail-prices pricing + 128K+ context', async ({ request }) => {
    const reg = await fetchRegistry(request);
    const found = findRow(reg, 'azure-ai-foundry', /^gpt-5/);
    test.skip(!found, 'No AIF gpt-5.x row in Registry — deploy + add via admin first');

    const { row } = found!;
    expect(row.pricing_source).toBe('azure-retail-prices');
    expect(Number(row.cost_per_input_token_usd ?? 0)).toBeGreaterThan(0);
    expect(row.options?.contextWindow ?? 0).toBeGreaterThanOrEqual(128_000);
  });

  test('Ollama local row carries zero-cost-local pricing + non-zero context', async ({ request }) => {
    const reg = await fetchRegistry(request);
    const found = findRow(reg, 'ollama', /.+/);
    test.skip(!found, 'No Ollama row in Registry — add via admin first');

    const { row } = found!;
    expect(row.pricing_source).toBe('zero-cost-local');
    expect(Number(row.cost_per_input_token_usd ?? 0)).toBe(0);
    expect(Number(row.cost_per_output_token_usd ?? 0)).toBe(0);
    expect(row.options?.contextWindow ?? 0).toBeGreaterThan(8_000);
  });

  test('Refresh-from-provider button bumps pricing_fetched_at', async ({ request }) => {
    const before = await fetchRegistry(request);
    // Pick the first row that has a pricing_fetched_at to refresh.
    let target: { provider: ProviderRow; row: RegistryRow } | null = null;
    for (const provider of before.providers) {
      for (const row of provider.registry_rows ?? []) {
        if (row.pricing_source && row.pricing_source !== 'manual') {
          target = { provider, row };
          break;
        }
      }
      if (target) break;
    }
    test.skip(!target, 'No live-discovered Registry row to refresh');

    const { provider, row } = target!;
    const beforeFetched = row.pricing_fetched_at;

    const resp = await request.post(
      `${BASE}/api/admin/llm-providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(row.model)}/refresh`,
      { headers: { 'Content-Type': 'application/json' }, data: '{}' },
    );
    expect(resp.status(), 'refresh endpoint should 200').toBe(200);
    const body = await resp.json();
    expect(body).toMatchObject({ message: expect.stringMatching(/refresh/i) });

    const after = await fetchRegistry(request);
    const afterRow = (after.providers
      .find((p) => p.id === provider.id)
      ?.registry_rows ?? [])
      .find((r) => r.model === row.model);
    expect(afterRow, 'refreshed row should still exist').toBeTruthy();
    expect(afterRow!.pricing_fetched_at, 'pricing_fetched_at should advance').not.toBe(beforeFetched);
  });

  test('Refresh-all sweep runs without error and reports counts', async ({ request }) => {
    const resp = await request.post(`${BASE}/api/admin/llm-providers/refresh-all`, {
      headers: { 'Content-Type': 'application/json' },
      data: '{}',
    });
    expect(resp.status(), 'refresh-all endpoint should 200').toBe(200);
    const body = await resp.json();
    expect(body).toMatchObject({
      message: expect.stringMatching(/sweep/i),
      total: expect.any(Number),
      refreshed: expect.any(Number),
      failed: expect.any(Number),
      skipped: expect.any(Number),
    });
    // Sanity: refreshed should be > 0 if there were rows to walk.
    if (body.total > 0) {
      expect(body.refreshed + body.skipped).toBeGreaterThan(0);
    }
  });
});
