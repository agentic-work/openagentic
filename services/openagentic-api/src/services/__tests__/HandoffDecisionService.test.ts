/**
 * Phase 10 — HandoffDecisionService unit suite.
 *
 * Spec §11.3: model_handoff_offer is capability-score (FCA) driven. When the
 * current model's score for the classified intent is below the threshold AND
 * a strictly-stronger alternative exists above the threshold, decide() returns
 * `shouldOffer: true` with the suggested replacement.
 *
 * The service is intent-keyed, model-agnostic — it never hardcodes "if
 * current === gpt-oss:20b suggest sonnet"; it purely consults the router's
 * per-(model,intent) scoring API.
 *
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md Phase 10
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §11.3
 */
import { describe, it, expect, vi } from 'vitest';
import { HandoffDecisionService } from '../HandoffDecisionService.js';

function makeRouter(scores: Array<{ model: string; confidence: number }>) {
  return {
    routeRequest: vi.fn(async () => scores),
  };
}

describe('HandoffDecisionService', () => {
  it('shouldOffer=true when current<threshold AND a better alternative exists', async () => {
    const router = makeRouter([
      { model: 'gpt-oss:20b', confidence: 0.4 },
      { model: 'sonnet-4', confidence: 0.9 },
      { model: 'haiku-3', confidence: 0.5 },
    ]);
    const svc = new HandoffDecisionService({ router });

    const decision = await svc.decide({
      currentModel: 'gpt-oss:20b',
      intent: 'compliance_gap_analysis',
    });

    expect(decision.shouldOffer).toBe(true);
    expect(decision.currentModel).toBe('gpt-oss:20b');
    expect(decision.suggestedModel).toBe('sonnet-4');
    expect(decision.confidenceCurrent).toBe(0.4);
    expect(decision.confidenceSuggested).toBe(0.9);
    expect(decision.reason).toBeDefined();
  });

  it('shouldOffer=false when current>=threshold (current model is already capable)', async () => {
    const router = makeRouter([
      { model: 'gpt-oss:20b', confidence: 0.7 },
      { model: 'sonnet-4', confidence: 0.95 },
    ]);
    const svc = new HandoffDecisionService({ router });

    const decision = await svc.decide({
      currentModel: 'gpt-oss:20b',
      intent: 'chat',
    });

    expect(decision.shouldOffer).toBe(false);
    expect(decision.suggestedModel).toBeUndefined();
    expect(decision.confidenceCurrent).toBe(0.7);
  });

  it('shouldOffer=false when no better alternative is above threshold', async () => {
    const router = makeRouter([
      { model: 'gpt-oss:20b', confidence: 0.4 },
      { model: 'haiku-3', confidence: 0.5 }, // also below 0.65 — not a candidate
    ]);
    const svc = new HandoffDecisionService({ router });

    const decision = await svc.decide({
      currentModel: 'gpt-oss:20b',
      intent: 'compliance_gap_analysis',
    });

    expect(decision.shouldOffer).toBe(false);
    expect(decision.suggestedModel).toBeUndefined();
    expect(decision.confidenceCurrent).toBe(0.4);
  });

  it('reason mentions the intent and percentages', async () => {
    const router = makeRouter([
      { model: 'small-model', confidence: 0.3 },
      { model: 'big-model', confidence: 0.85 },
    ]);
    const svc = new HandoffDecisionService({ router });

    const decision = await svc.decide({
      currentModel: 'small-model',
      intent: 'architecture_design',
    });

    expect(decision.shouldOffer).toBe(true);
    expect(decision.reason).toContain('architecture_design');
    // Percentages — current 30%, threshold 65%, suggested 85%.
    expect(decision.reason).toMatch(/30%|0\.30/);
    expect(decision.reason).toMatch(/65%|0\.65/);
    expect(decision.reason).toMatch(/85%|0\.85/);
  });

  it('handles router error gracefully (returns shouldOffer=false)', async () => {
    const router = {
      routeRequest: vi.fn(async () => {
        throw new Error('router unavailable');
      }),
    };
    const svc = new HandoffDecisionService({ router });

    const decision = await svc.decide({
      currentModel: 'gpt-oss:20b',
      intent: 'compliance_gap_analysis',
    });

    expect(decision.shouldOffer).toBe(false);
    expect(decision.currentModel).toBe('gpt-oss:20b');
  });

  it('honours custom threshold', async () => {
    const router = makeRouter([
      { model: 'gpt-oss:20b', confidence: 0.7 },
      { model: 'sonnet-4', confidence: 0.95 },
    ]);
    // Custom threshold raised to 0.85 — gpt-oss:20b's 0.7 now falls below.
    const svc = new HandoffDecisionService({ router, threshold: 0.85 });

    const decision = await svc.decide({
      currentModel: 'gpt-oss:20b',
      intent: 'compliance_gap_analysis',
    });

    expect(decision.shouldOffer).toBe(true);
    expect(decision.suggestedModel).toBe('sonnet-4');
  });

  it('picks the strongest alternative (not the first above threshold)', async () => {
    const router = makeRouter([
      { model: 'gpt-oss:20b', confidence: 0.4 },
      { model: 'medium-model', confidence: 0.7 }, // above threshold but not strongest
      { model: 'big-model', confidence: 0.95 }, // strongest
      { model: 'medium-2', confidence: 0.75 },
    ]);
    const svc = new HandoffDecisionService({ router });

    const decision = await svc.decide({
      currentModel: 'gpt-oss:20b',
      intent: 'compliance_gap_analysis',
    });

    expect(decision.shouldOffer).toBe(true);
    expect(decision.suggestedModel).toBe('big-model');
    expect(decision.confidenceSuggested).toBe(0.95);
  });

  it('does not suggest the same model as current even if it appears twice in scores', async () => {
    // Defensive: the router shouldn't return duplicates, but if it does,
    // never propose the user's current model as the "stronger" alternative.
    const router = makeRouter([
      { model: 'gpt-oss:20b', confidence: 0.4 },
      { model: 'gpt-oss:20b', confidence: 0.9 }, // bogus duplicate
    ]);
    const svc = new HandoffDecisionService({ router });

    const decision = await svc.decide({
      currentModel: 'gpt-oss:20b',
      intent: 'compliance_gap_analysis',
    });

    // No NON-current model exists above threshold → no offer.
    expect(decision.shouldOffer).toBe(false);
  });
});
