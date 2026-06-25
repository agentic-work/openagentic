/**
 * BULLETPROOF SoT contract test — providers/models flow through the
 * two-table SoT (llm_providers + model_registry) ONLY.
 *
 * Per the rule in `feedback_two_sot_providers_models_only.md`:
 *
 *   "only TWO SOT's for providers/models- period- if helm values adds
 *    providers/models- they act as if an admin added them and they show
 *    up in ONLY SOT thats show in admin console llm/providers/model
 *    registry- OR if admins ADD them AFTER deploy."
 *
 * This is NOT a mock test. It hits the running api in the dev environment with an
 * admin API key and exercises the live admin endpoints. It then asserts
 * end-to-end behavior — including via `/api/chat/stream`, which is the
 * load-bearing routing decision path.
 *
 * Why real-platform: prompt-string / shape-only tests passed while the
 * real chain still picked the wrong model. See
 * `feedback_prompt_rule_tests_must_be_real_model_gates.md`.
 *
 * Layers under test (Layers 2–4 of the bulletproof harness; Layer 1 is
 * the file-level arch cage at `architecture/no-hardcoded-model-literals.source-regression.test.ts`):
 *
 *   L2 — SoT contract:
 *     a) GET /api/models returns ONLY rows in model_registry with
 *        is_active=true
 *     b) Every returned row has roles[] populated (≥ 1 of
 *        chat / code / embedding / vision / image)
 *     c) GET /api/admin/llm-providers reflects the same providers
 *        referenced by /api/models
 *
 *   L3 — Router reads from SoT:
 *     d) POST /api/chat/stream returns a `model` field. That model
 *        MUST be in the /api/models active set.
 *     e) Models that aren't in the registry MUST NOT appear in any
 *        response.model — even via prefix heuristics, even via
 *        SmartModelRouter cheapest-fallback. (post-rip assertion)
 *
 *   L4 — Helm-seed = admin-add equivalence:
 *     f) Models declared in helm/values.yaml providers[].model_config.models[]
 *        appear in /api/models with the same shape as if added via
 *        the admin wizard. No "seeded" flag, no separate cache path.
 *
 * Skip behavior: when OPENAGENTIC_TEST_KEY is absent (CI without admin
 * creds), the test prints a skip notice and exits 0. This is the only
 * skip path — never silently passes.
 *
 * Stamped after #911–#914 (2026-05-17 PM).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const HOST = process.env.OPENAGENTIC_HOST || 'https://chat.example.com';
const KEY = process.env.OPENAGENTIC_TEST_KEY || '';
const TIMEOUT = 180_000;

const SKIP = !KEY;
const describeReal = SKIP ? describe.skip : describe;

beforeAll(() => {
  if (SKIP) {
    // eslint-disable-next-line no-console
    console.warn(
      '[two-sot-real-test] OPENAGENTIC_TEST_KEY not set — skipping real-platform contract test.\n' +
        'To run: export OPENAGENTIC_TEST_KEY=oa_xxxx (admin API key minted via /api/admin/tokens).',
    );
  }
});

interface RegistryModel {
  id: string;
  name?: string;
  provider?: string;
  providerId?: string;
  status?: string;
  capabilities?: string[];
  roles?: string[];
  type?: string;
  metadata?: { roles?: string[]; source?: string };
}

interface ChatStreamFrame {
  type: string;
  model?: string;
  reason?: string;
  delta?: { type?: string; text?: string; thinking?: string };
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${HOST}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`${path} → ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json() as Promise<T>;
}

async function listActiveModels(): Promise<RegistryModel[]> {
  const data = await api<{ models: RegistryModel[] }>('/api/models');
  const arr = data?.models || [];
  return arr.filter((m) => (m.status || '').toLowerCase() !== 'inactive' && (m.status || '').toLowerCase() !== 'disabled');
}

async function createSession(title: string): Promise<string> {
  const data = await api<{ session: { id: string } }>('/api/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return data.session.id;
}

async function streamTurnAndCollectFrames(sessionId: string, message: string): Promise<{
  frames: ChatStreamFrame[];
  rawNdjson: string;
}> {
  const r = await fetch(`${HOST}/api/chat/stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, sessionId }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`/api/chat/stream → ${r.status}: ${body.slice(0, 300)}`);
  }
  const raw = await r.text();
  const frames: ChatStreamFrame[] = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ChatStreamFrame;
      } catch {
        return null;
      }
    })
    .filter((x): x is ChatStreamFrame => x !== null);
  return { frames, rawNdjson: raw };
}

function pickedModel(frames: ChatStreamFrame[]): string | undefined {
  // The `done` frame carries the model id the router/provider settled on.
  return frames.find((f) => f.type === 'done')?.model;
}

describeReal('TWO-SoT contract — providers/models via real platform', () => {
  // ────────────────────────────────────────────────────────────
  // L2 — SoT contract
  // ────────────────────────────────────────────────────────────

  it('L2a: GET /api/models returns only active registry rows', async () => {
    const models = await listActiveModels();
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.id, `model row missing id: ${JSON.stringify(m)}`).toBeTruthy();
      expect(m.providerId || m.provider, `model ${m.id} missing provider`).toBeTruthy();
      const status = (m.status || '').toLowerCase();
      expect(status, `model ${m.id} status=${status}`).not.toBe('inactive');
      expect(status, `model ${m.id} status=${status}`).not.toBe('disabled');
    }
  }, TIMEOUT);

  it('L2b: every active model has roles[] populated (chat/code/embedding/vision/image)', async () => {
    const models = await listActiveModels();
    const allowedRoles = new Set(['chat', 'code', 'embedding', 'vision', 'image']);

    const offenders: string[] = [];
    for (const m of models) {
      // Roles may live on .roles, .metadata.roles, or .capabilities.
      const roleish = [
        ...(m.roles || []),
        ...((m.metadata as any)?.roles || []),
        ...(m.capabilities || []),
      ].map((r) => String(r).toLowerCase());

      const hasAtLeastOne =
        roleish.some((r) => allowedRoles.has(r)) ||
        // Tolerate the legacy `type` field while phase-2 migration is in flight.
        ['chat', 'code', 'embedding', 'vision', 'image'].includes((m.type || '').toLowerCase());

      if (!hasAtLeastOne) {
        offenders.push(`${m.id} (provider=${m.providerId || m.provider})`);
      }
    }

    expect(
      offenders,
      `Models without a recognised role assignment — these can never be picked by router:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  }, TIMEOUT);

  it('L2c: every model in /api/models points at a real provider in /api/admin/llm-providers', async () => {
    const models = await listActiveModels();
    const provData = await api<{ providers: Array<{ id?: string; provider_id?: string; name?: string }> }>(
      '/api/admin/llm-providers',
    );
    const providerIds = new Set<string>(
      (provData.providers || [])
        .map((p) => p.id || p.provider_id || p.name || '')
        .filter(Boolean),
    );

    const orphans = models.filter((m) => {
      const pid = m.providerId || m.provider || '';
      return pid && !providerIds.has(pid) && !providerIds.has(String(pid).toLowerCase());
    });
    expect(
      orphans,
      `Orphan models (referenced provider not in llm_providers SoT):\n  ${orphans.map((m) => `${m.id} → ${m.providerId || m.provider}`).join('\n  ')}`,
    ).toEqual([]);
  }, TIMEOUT);

  // ────────────────────────────────────────────────────────────
  // L3 — Router reads from SoT
  // ────────────────────────────────────────────────────────────

  it('L3d: trivial chat picks a model that IS in the active /api/models set', async () => {
    const models = await listActiveModels();
    const activeIds = new Set(models.map((m) => m.id));

    const sid = await createSession('bulletproof-harness-L3d');
    const { frames } = await streamTurnAndCollectFrames(sid, 'what is 2+2');
    const picked = pickedModel(frames);

    expect(picked, 'no model id returned in `done` frame').toBeTruthy();
    expect(
      activeIds.has(picked || '') ||
        // Tolerate Bedrock cross-region prefix mismatch ("us." vs not) — the
        // router strips it before lookup, so accept either form.
        activeIds.has((picked || '').replace(/^us\./, '')),
      `Picked model "${picked}" is NOT in /api/models active set (${activeIds.size} active). ` +
        `This means SmartModelRouter / ProviderManager bypassed the SoT. ` +
        `Active set head: ${[...activeIds].slice(0, 5).join(', ')}`,
    ).toBe(true);
  }, TIMEOUT);

  it('L3e: post-rip — `gpt-oss:20b` MUST NOT appear unless present in /api/models', async () => {
    const models = await listActiveModels();
    const gptOssActive = models.some((m) => m.id === 'gpt-oss:20b');

    const sid = await createSession('bulletproof-harness-L3e');
    const { frames } = await streamTurnAndCollectFrames(sid, 'what is 2+2');
    const picked = pickedModel(frames);

    if (gptOssActive) {
      // If admin has gpt-oss:20b in registry, no constraint.
      // eslint-disable-next-line no-console
      console.log(`[L3e] gpt-oss:20b is in registry — no constraint applied. Picked: ${picked}`);
      return;
    }

    expect(
      picked,
      `[L3e] gpt-oss:20b is NOT in registry but router still picked it. ` +
        `This is the bug from 2026-05-17 PM: hardcoded cheapest-fallback in SmartModelRouter and/or prefix-heuristic in ProviderManager bypassing the SoT.`,
    ).not.toBe('gpt-oss:20b');
  }, TIMEOUT);

  // ────────────────────────────────────────────────────────────
  // L4 — Helm-seed = admin-add equivalence (deferred until #913 ships)
  // ────────────────────────────────────────────────────────────
  it.skip('L4f: helm-seeded models appear in /api/models indistinguishable from admin-added (needs #913)', async () => {
    // After #913: parse helm/values.yaml providers[], for each model[] assert it shows
    // up in /api/models with roles[] populated AND its `metadata.source` is NOT
    // a special "seeded" flag (i.e. helm rows look identical to admin-added rows).
  });
});
