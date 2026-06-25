/**
 * #1020 large-result task-attention guard — unit tests for the helper.
 *
 * Q14 vs Q17 evidence (Q-loop 2026-05-21):
 *   - Q14 (un-primed kube-system inventory): cascade-failed with 3 Sev-0s —
 *     #1015 repeat-call, #1016 hallucinated "List AKS clusters" next-prompt,
 *     #1017 empty synthesis "What would you like to do?"
 *   - Q17 (same prompt + priming "think carefully about JSON structure"):
 *     fully GREEN — 33 pods verbatim, exact count, no drift.
 *
 * The empirical difference was task-attention loss on large JSON payloads,
 * not thinking-budget exhaustion (both Q14 + Q17 used ~910-tok thinking).
 *
 * This guard injects a SYSTEM NOTE into the model-facing tool_result content
 * when the result exceeds LARGE_TOOL_RESULT_THRESHOLD_BYTES (8KB default),
 * directing the model to parse for user-requested fields ONLY, refuse re-
 * fetch, refuse follow-up hallucination — mimicking the Q17 priming effect.
 *
 * The UI emit is upstream of this guard; users see the raw payload. Only the
 * model channel is augmented.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  LARGE_TOOL_RESULT_SYSTEM_NOTE,
  isLargeToolResultContent,
  withLargeToolResultGuard,
} from '../chatLoop.js';

const ORIGINAL_ENV = process.env.LARGE_TOOL_RESULT_THRESHOLD_BYTES;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.LARGE_TOOL_RESULT_THRESHOLD_BYTES;
  } else {
    process.env.LARGE_TOOL_RESULT_THRESHOLD_BYTES = ORIGINAL_ENV;
  }
});

describe('#1020 isLargeToolResultContent', () => {
  it('returns false for null / undefined / empty string', () => {
    expect(isLargeToolResultContent(null)).toBe(false);
    expect(isLargeToolResultContent(undefined)).toBe(false);
    expect(isLargeToolResultContent('')).toBe(false);
  });

  it('returns false for content under the 8KB default threshold', () => {
    expect(isLargeToolResultContent('hello world')).toBe(false);
    expect(isLargeToolResultContent('x'.repeat(8000))).toBe(false);
    expect(isLargeToolResultContent({ rows: [{ name: 'pod-1' }] })).toBe(false);
  });

  it('returns true for content over the 8KB default threshold', () => {
    expect(isLargeToolResultContent('x'.repeat(8 * 1024 + 1))).toBe(true);
    // Simulated 33-pod kube-system JSON — wide rows so serialized length
    // mirrors the Q14 observed payload (~12KB).
    const fakeKubeResult = JSON.stringify({
      pods: Array.from({ length: 33 }, (_, i) => ({
        name: `csi-nfs-node-${i.toString().padStart(20, 'x')}`,
        status: 'Running',
        node: 'node-' + 'x'.repeat(40),
        annotations: { 'k8s.io/managed-by': 'helm', long: 'y'.repeat(150) },
        containers: [
          { image: 'k8s.gcr.io/csi-driver-' + 'x'.repeat(120) },
          { image: 'k8s.gcr.io/sidecar-' + 'y'.repeat(120) },
        ],
      })),
    });
    expect(fakeKubeResult.length).toBeGreaterThan(8 * 1024);
    expect(isLargeToolResultContent(fakeKubeResult)).toBe(true);
  });

  it('respects LARGE_TOOL_RESULT_THRESHOLD_BYTES env override', () => {
    process.env.LARGE_TOOL_RESULT_THRESHOLD_BYTES = '100';
    expect(isLargeToolResultContent('x'.repeat(99))).toBe(false);
    expect(isLargeToolResultContent('x'.repeat(101))).toBe(true);
  });
});

describe('#1020 withLargeToolResultGuard', () => {
  it('prepends LARGE_TOOL_RESULT_SYSTEM_NOTE to string content', () => {
    const guarded = withLargeToolResultGuard('the large payload here');
    expect(guarded).toMatch(/^\[SYSTEM NOTE: This tool returned a large result/);
    expect(guarded).toContain('the large payload here');
    expect(guarded).toContain(LARGE_TOOL_RESULT_SYSTEM_NOTE);
  });

  it('JSON-serializes object content and prepends the note', () => {
    const guarded = withLargeToolResultGuard({ pods: ['a', 'b', 'c'] });
    expect(typeof guarded).toBe('string');
    expect(guarded as string).toContain(LARGE_TOOL_RESULT_SYSTEM_NOTE);
    expect(guarded as string).toContain('"pods":["a","b","c"]');
  });

  it('is idempotent — does not double-prepend on already-guarded content', () => {
    const first = withLargeToolResultGuard('large data');
    const second = withLargeToolResultGuard(first);
    expect(second).toBe(first);
    // Note appears exactly once.
    const matches = (second as string).match(/\[SYSTEM NOTE: This tool returned a large result/g);
    expect(matches?.length).toBe(1);
  });

  it('SYSTEM NOTE includes the three attention-loss countermeasures', () => {
    // Mirrors Q17 priming: parse-only, no re-fetch, no follow-up hallucination.
    expect(LARGE_TOOL_RESULT_SYSTEM_NOTE).toMatch(/parse/i);
    expect(LARGE_TOOL_RESULT_SYSTEM_NOTE).toMatch(/do not call.*re-fetch/i);
    expect(LARGE_TOOL_RESULT_SYSTEM_NOTE).toMatch(/do not invent follow-up/i);
  });
});
