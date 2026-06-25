/**
 * FeedbackLearningService.analyze — TDD spec (Phase 13).
 *
 * the design notes
 * the design notes
 *
 * ADVISORY ONLY — analyze() returns recommendations a human reviews/applies
 * via /admin#feedback-advisories. It MUST NOT call routerTuning.set/update/upsert.
 * Read-only consumers of RouterTuning state are fine for surfacing currentValue.
 *
 * Coverage:
 *  1. analyze() returns empty when no feedback in window.
 *  2. analyze() returns empty when evidence < minEvidence.
 *  3. analyze() recommends model_demote when positive rate < 0.5 with sufficient evidence.
 *  4. analyze() recommends model_promote when positive rate > 0.85 with sufficient evidence.
 *  5. analyze() recommends intent_floor_bump when ALL models for an intent are below 0.5.
 *  6. analyze() respects window param (24h vs 7d vs 30d).
 *  7. analyze() does NOT mutate RouterTuning.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedbackLearningService } from '../FeedbackLearningService.js';

function makeLogger(): any {
  const l: any = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  l.child = vi.fn(() => l);
  return l;
}

type Sig = 'positive' | 'negative';

interface RowSeed {
  intent: string;
  model: string;
  signal: Sig;
  daysAgo: number;
  count?: number;
}

function expandSeeds(seeds: RowSeed[]): any[] {
  const out: any[] = [];
  let id = 1;
  const now = Date.now();
  for (const s of seeds) {
    const n = s.count ?? 1;
    for (let i = 0; i < n; i++) {
      out.push({
        id: `r-${id++}`,
        message_id: `msg-${id}`,
        user_id: `user-${id}`,
        session_id: `sess-${id}`,
        feedback_type: s.signal === 'positive' ? 'thumbs_up' : 'thumbs_down',
        intent: s.intent,
        model: s.model,
        created_at: new Date(now - s.daysAgo * 24 * 3600 * 1000),
      });
    }
  }
  return out;
}

function makeFeedbackServiceStub(rows: any[]) {
  return {
    listSince: vi.fn(async (since: Date) =>
      rows.filter((r) => r.created_at >= since),
    ),
  };
}

function makeRouterTuningStub() {
  const writeMethods = ['update', 'upsert', 'set', 'updateTuning', 'upsertTuning', 'apply'];
  const stub: any = {
    get: vi.fn(async () => ({ fcaCloudListFloor: 0.5, fcaSimpleToolFloor: 0.4 })),
  };
  for (const m of writeMethods) {
    stub[m] = vi.fn(() => {
      throw new Error(`router-tuning.${m} must NOT be called from analyze()`);
    });
  }
  return stub;
}

describe('FeedbackLearningService.analyze — advisory only', () => {
  let routerTuning: ReturnType<typeof makeRouterTuningStub>;
  beforeEach(() => {
    routerTuning = makeRouterTuningStub();
  });

  it('returns empty when no feedback in window', async () => {
    const fbk = makeFeedbackServiceStub([]);
    const svc = new FeedbackLearningService({} as any, makeLogger());
    (svc as any).feedback = fbk;
    (svc as any).routerTuning = routerTuning;
    const out = await svc.analyze({ window: '7d', minEvidence: 5 });
    expect(out).toEqual([]);
  });

  it('returns empty when evidence < minEvidence', async () => {
    // 4 negative signals with intent=cloud_list, model=A — but minEvidence is 5
    const rows = expandSeeds([
      { intent: 'cloud_list', model: 'A', signal: 'negative', daysAgo: 1, count: 4 },
    ]);
    const fbk = makeFeedbackServiceStub(rows);
    const svc = new FeedbackLearningService({} as any, makeLogger());
    (svc as any).feedback = fbk;
    (svc as any).routerTuning = routerTuning;
    const out = await svc.analyze({ window: '7d', minEvidence: 5 });
    expect(out).toEqual([]);
  });

  it('recommends model_demote when positive rate < 0.5 with sufficient evidence', async () => {
    // 12 negative + 3 positive for (cloud_list, modelA) → 0.20 positive rate, 15 evidence
    const rows = expandSeeds([
      { intent: 'cloud_list', model: 'modelA', signal: 'negative', daysAgo: 1, count: 12 },
      { intent: 'cloud_list', model: 'modelA', signal: 'positive', daysAgo: 1, count: 3 },
      // For other-intent positive control — no recommendation expected
      { intent: 'chat', model: 'modelB', signal: 'positive', daysAgo: 1, count: 10 },
    ]);
    const fbk = makeFeedbackServiceStub(rows);
    const svc = new FeedbackLearningService({} as any, makeLogger());
    (svc as any).feedback = fbk;
    (svc as any).routerTuning = routerTuning;
    const out = await svc.analyze({ window: '7d', minEvidence: 10 });
    const demote = out.find(
      (r) => r.type === 'model_demote' && r.model === 'modelA' && r.intent === 'cloud_list',
    );
    expect(demote).toBeDefined();
    expect(demote!.evidenceCount).toBe(15);
    expect(demote!.positiveRate).toBeCloseTo(0.2, 2);
  });

  it('recommends model_promote when positive rate > 0.85 with sufficient evidence', async () => {
    // 18 positive + 1 negative for (chat, modelC) → ~0.947 positive rate, 19 evidence
    const rows = expandSeeds([
      { intent: 'chat', model: 'modelC', signal: 'positive', daysAgo: 1, count: 18 },
      { intent: 'chat', model: 'modelC', signal: 'negative', daysAgo: 1, count: 1 },
    ]);
    const fbk = makeFeedbackServiceStub(rows);
    const svc = new FeedbackLearningService({} as any, makeLogger());
    (svc as any).feedback = fbk;
    (svc as any).routerTuning = routerTuning;
    const out = await svc.analyze({ window: '7d', minEvidence: 10 });
    const promote = out.find(
      (r) => r.type === 'model_promote' && r.model === 'modelC' && r.intent === 'chat',
    );
    expect(promote).toBeDefined();
    expect(promote!.evidenceCount).toBe(19);
    expect(promote!.positiveRate).toBeGreaterThan(0.85);
  });

  it('recommends intent_floor_bump when ALL models for an intent are below 0.5', async () => {
    // (cloud_list, modelA): 8 neg / 12 total = 0.33
    // (cloud_list, modelB): 7 neg / 10 total = 0.30
    // Both individually trigger model_demote AND collectively trigger intent_floor_bump.
    const rows = expandSeeds([
      { intent: 'cloud_list', model: 'modelA', signal: 'negative', daysAgo: 1, count: 8 },
      { intent: 'cloud_list', model: 'modelA', signal: 'positive', daysAgo: 1, count: 4 },
      { intent: 'cloud_list', model: 'modelB', signal: 'negative', daysAgo: 1, count: 7 },
      { intent: 'cloud_list', model: 'modelB', signal: 'positive', daysAgo: 1, count: 3 },
    ]);
    const fbk = makeFeedbackServiceStub(rows);
    const svc = new FeedbackLearningService({} as any, makeLogger());
    (svc as any).feedback = fbk;
    (svc as any).routerTuning = routerTuning;
    const out = await svc.analyze({ window: '7d', minEvidence: 10 });
    const bump = out.find(
      (r) => r.type === 'intent_floor_bump' && r.intent === 'cloud_list',
    );
    expect(bump).toBeDefined();
  });

  it('respects window param — older rows are ignored when window=24h', async () => {
    const rows = expandSeeds([
      // 11 fresh negatives (today) — within both 24h and 7d windows
      { intent: 'cloud_list', model: 'modelA', signal: 'negative', daysAgo: 0, count: 11 },
      // 11 stale positives (5 days old) — within 7d but not 24h
      { intent: 'cloud_list', model: 'modelA', signal: 'positive', daysAgo: 5, count: 11 },
    ]);
    const fbk = makeFeedbackServiceStub(rows);
    const svc = new FeedbackLearningService({} as any, makeLogger());
    (svc as any).feedback = fbk;
    (svc as any).routerTuning = routerTuning;
    const out24 = await svc.analyze({ window: '24h', minEvidence: 5 });
    // 24h window sees only the 11 negatives → 0% positive rate → demote
    const demote24 = out24.find(
      (r) => r.type === 'model_demote' && r.model === 'modelA' && r.intent === 'cloud_list',
    );
    expect(demote24).toBeDefined();
    expect(demote24!.positiveRate).toBe(0);
    expect(demote24!.evidenceCount).toBe(11);

    const out7d = await svc.analyze({ window: '7d', minEvidence: 5 });
    // 7d window sees 22 rows, 11 positive, rate = 0.5 — no recommendation (must be < 0.5)
    const demote7d = out7d.find(
      (r) => r.type === 'model_demote' && r.model === 'modelA' && r.intent === 'cloud_list',
    );
    expect(demote7d).toBeUndefined();
  });

  it('NEVER calls routerTuning write methods', async () => {
    const rows = expandSeeds([
      { intent: 'cloud_list', model: 'modelA', signal: 'negative', daysAgo: 1, count: 12 },
      { intent: 'cloud_list', model: 'modelA', signal: 'positive', daysAgo: 1, count: 3 },
    ]);
    const fbk = makeFeedbackServiceStub(rows);
    const svc = new FeedbackLearningService({} as any, makeLogger());
    (svc as any).feedback = fbk;
    (svc as any).routerTuning = routerTuning;
    await svc.analyze({ window: '7d', minEvidence: 10 });
    expect(routerTuning.update).not.toHaveBeenCalled();
    expect(routerTuning.upsert).not.toHaveBeenCalled();
    expect(routerTuning.set).not.toHaveBeenCalled();
    expect(routerTuning.updateTuning).not.toHaveBeenCalled();
    expect(routerTuning.upsertTuning).not.toHaveBeenCalled();
    expect(routerTuning.apply).not.toHaveBeenCalled();
  });
});
