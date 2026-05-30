/**
 * GeminiCacheManager — REAL Vertex AI `cachedContents` lifecycle integration test.
 *
 * Hits the actual Vertex AI cachedContents REST surface:
 *   POST   /v1/projects/{P}/locations/{L}/cachedContents     → create
 *   GET    /v1/projects/{P}/locations/{L}/cachedContents/{ID} → fetch
 *   PATCH  /v1/projects/{P}/locations/{L}/cachedContents/{ID} → refresh TTL
 *   DELETE /v1/projects/{P}/locations/{L}/cachedContents/{ID} → cleanup
 *
 * Auth model: `TokenProvider` injection. Production wiring uses
 * google-auth-library (DB-seeded service account or ADC). This test
 * shells out to `gcloud auth print-access-token` because ADC is often
 * stale in dev shells while the user's gcloud login is fresh. Per
 * memory rule `feedback_no_synthetic_chunks_only_real_provider_captures`:
 * no mock provider responses — real Vertex or skip-with-loud-warn.
 *
 * Test endpoint:    https://us-central1-aiplatform.googleapis.com
 * Test project:     openagentic-dev (or GOOGLE_CLOUD_PROJECT env override)
 * Test location:    us-central1 (or VERTEX_LOCATION override)
 * Test model:       gemini-2.5-flash (4k-token min cache size)
 *
 * Skip-with-loud-warn when: gcloud unavailable OR token fetch fails OR
 * project resolves empty. NEVER falls back to synthesized responses.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { GeminiCacheManager, type TokenProvider } from '../GeminiCacheManager.js';

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'openagentic-dev';
const LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const MODEL = process.env.VERTEX_TEST_MODEL || 'gemini-2.5-flash';

function gcloudTokenProvider(): TokenProvider {
  return {
    async getAccessToken(): Promise<string> {
      const tok = execSync('gcloud auth print-access-token', {
        encoding: 'utf8',
        timeout: 10_000,
      }).trim();
      if (!tok) throw new Error('gcloud returned empty access token');
      return tok;
    },
  };
}

function probeVertexReachable(token: string): Promise<boolean> {
  return fetch(
    `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/cachedContents`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
    .then((r) => r.status === 200)
    .catch(() => false);
}

// Eager check at file-eval time so the suite can be skip-with-loud-warn'd
// cleanly without firing each test individually.
let VERTEX_OK = false;
let VERTEX_SKIP_REASON = '';
try {
  const tok = execSync('gcloud auth print-access-token', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
  }).trim();
  if (!tok) {
    VERTEX_SKIP_REASON = 'gcloud auth print-access-token returned empty';
  } else {
    // We'll do the reachability check in beforeAll where async is allowed.
    VERTEX_OK = true;
  }
} catch (err) {
  VERTEX_SKIP_REASON = `gcloud auth print-access-token failed: ${(err as Error).message}`;
}

const describeIf = VERTEX_OK ? describe : describe.skip;

// Build a `contents` payload that safely exceeds Gemini 2.5 Flash's 4096-
// token minimum. Vertex AI cachedContents requires the content to live on
// `contents` (or `systemInstruction` AND `contents`) — systemInstruction
// alone does not count toward the cache size floor.
//
// Real-validated body size: 62.8k chars ≈ 14002 tokens (confirmed by
// usageMetadata.totalTokenCount on a manual curl probe 2026-05-12).
function bigContents(): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const paragraph =
    'OpenAgentic is an enterprise AI platform that orchestrates multi-provider LLM chat with parallel tool use, sub-agent delegation, and FedRAMP-grade auditing. ';
  // 157 chars × 400 = 62.8k chars ≈ 14k tokens. Safely above the 4k minimum.
  return [{ role: 'user', parts: [{ text: paragraph.repeat(400) }] }];
}

describeIf('GeminiCacheManager — real Vertex AI cachedContents lifecycle', () => {
  const createdNames: string[] = [];
  let mgr: GeminiCacheManager;
  let token: string;

  beforeAll(async () => {
    const provider = gcloudTokenProvider();
    token = await provider.getAccessToken();
    const reachable = await probeVertexReachable(token);
    if (!reachable) {
      // Loud warn — surface to console but DO NOT pollute test fixtures
      // by falling back to synthetic data.
      // eslint-disable-next-line no-console
      console.warn(
        `[GeminiCacheManager.realVertex] Vertex AI cachedContents endpoint unreachable for project=${PROJECT} location=${LOCATION}. Skipping integration suite. ` +
          'Fix: ensure project has Vertex AI API enabled + IAM grants gcloud user the aiplatform.cachedContents.create permission.',
      );
      VERTEX_OK = false;
      return;
    }
    mgr = new GeminiCacheManager({
      project: PROJECT,
      location: LOCATION,
      tokenProvider: provider,
    });
  }, 30_000);

  afterAll(async () => {
    if (!mgr) return;
    for (const name of createdNames) {
      try {
        await mgr.delete(name);
      } catch {
        // best-effort cleanup; don't fail the suite if delete races with TTL expiry
      }
    }
  }, 30_000);

  it('creates a real cachedContent resource with canonical resource-name shape', async () => {
    if (!VERTEX_OK) return;
    const result = await mgr.create({
      model: MODEL,
      contents: bigContents(),
      ttlSeconds: 600,
      displayName: `openagentic-test-create-${Date.now()}`,
    });
    expect(result.name).toMatch(
      new RegExp(`^projects/[^/]+/locations/${LOCATION}/cachedContents/[a-zA-Z0-9]+$`),
    );
    expect(result.model).toContain(MODEL);
    // Vertex must have actually counted enough tokens to satisfy the floor.
    expect(result.usageMetadata?.totalTokenCount ?? 0).toBeGreaterThanOrEqual(4096);
    createdNames.push(result.name);
  }, 60_000);

  it('GET on the created resource returns the same name + TTL metadata', async () => {
    if (!VERTEX_OK || createdNames.length === 0) return;
    const name = createdNames[0];
    const fetched = await mgr.get(name);
    expect(fetched.name).toBe(name);
    expect(fetched.expireTime).toBeDefined();
  }, 30_000);

  it('refresh extends the TTL (expireTime moves forward)', async () => {
    if (!VERTEX_OK || createdNames.length === 0) return;
    const name = createdNames[0];
    const before = await mgr.get(name);
    const beforeExpiry = new Date(before.expireTime).getTime();
    // Wait a bit so the new expireTime is observably later
    await new Promise((r) => setTimeout(r, 1500));
    await mgr.refresh(name, 1200);
    const after = await mgr.get(name);
    const afterExpiry = new Date(after.expireTime).getTime();
    expect(afterExpiry).toBeGreaterThan(beforeExpiry);
  }, 30_000);

  it('delete removes the resource (subsequent GET returns 404)', async () => {
    if (!VERTEX_OK || createdNames.length === 0) return;
    const name = createdNames.shift()!;
    await mgr.delete(name);
    await expect(mgr.get(name)).rejects.toThrow(/404|not.?found/i);
  }, 30_000);
});
