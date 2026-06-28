/**
 * Feedback learning source-regression — Phase 13.
 *
 * Pins the advisory-only contract for FeedbackLearningService.analyze().
 *  1. FeedbackService + FeedbackLearningService source files exist.
 *  2. POST /api/feedback route registered (existing route reused).
 *  3. FeedbackLearningService.analyze() never imports/calls a RouterTuning
 *     mutation. Static grep on the source — body of analyze() can read
 *     RouterTuning state, but cannot call .update / .upsert / .set / .apply.
 *  4. v3Metrics has a feedbackSignals counter (Phase 13 metric add).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const FEEDBACK_SERVICE = resolve(
  __dirname,
  '../../services/FeedbackService.ts',
);
const FEEDBACK_LEARNING = resolve(
  __dirname,
  '../../services/FeedbackLearningService.ts',
);
const FEEDBACK_ROUTE = resolve(__dirname, '../../routes/feedback.ts');
const V3_METRICS = resolve(__dirname, '../../services/V3MetricsRegistry.ts');

describe('Phase 13 — feedback advisory source pins', () => {
  it('FeedbackService.ts exists', () => {
    expect(existsSync(FEEDBACK_SERVICE)).toBe(true);
  });

  it('FeedbackLearningService.ts exists', () => {
    expect(existsSync(FEEDBACK_LEARNING)).toBe(true);
  });

  it('routes/feedback.ts exists and registers POST /', () => {
    expect(existsSync(FEEDBACK_ROUTE)).toBe(true);
    const src = readFileSync(FEEDBACK_ROUTE, 'utf8');
    expect(src).toMatch(/fastify\.post\b/);
  });

  it('FeedbackLearningService exports an analyze method', () => {
    const src = readFileSync(FEEDBACK_LEARNING, 'utf8');
    expect(src).toMatch(/\banalyze\s*\(/);
  });

  it('FeedbackLearningService.analyze() does NOT call RouterTuning write methods', () => {
    const src = readFileSync(FEEDBACK_LEARNING, 'utf8');
    // Phase 13 hard rule — advisory only. Surface any direct mutation
    // through routerTuning. Read-only access (`.get`) is fine.
    expect(src).not.toMatch(/routerTuning\s*\.\s*update\s*\(/);
    expect(src).not.toMatch(/routerTuning\s*\.\s*upsert\s*\(/);
    expect(src).not.toMatch(/routerTuning\s*\.\s*set\s*\(/);
    expect(src).not.toMatch(/routerTuning\s*\.\s*updateTuning\s*\(/);
    expect(src).not.toMatch(/routerTuning\s*\.\s*upsertTuning\s*\(/);
    expect(src).not.toMatch(/routerTuning\s*\.\s*apply\s*\(/);
  });

  it('V3MetricsRegistry exposes feedbackSignals counter', () => {
    const src = readFileSync(V3_METRICS, 'utf8');
    expect(src).toMatch(/feedbackSignals\s*:/);
    expect(src).toContain("'v3_feedback_signals_total'");
  });
});
