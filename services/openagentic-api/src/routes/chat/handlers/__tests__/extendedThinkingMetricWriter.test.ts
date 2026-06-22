/**
 * RED → GREEN spec for Task B.2: extended thinking metric write-path.
 *
 * Tests the standalone writeExtendedThinkingMetric and computeThinkingRequested
 * helpers extracted from the stream handler so they can be unit-tested
 * without a full Fastify / runChat stack.
 *
 * RED cycle:
 *  - writeExtendedThinkingMetric doesn't exist yet → import fails.
 *  - computeThinkingRequested doesn't exist yet → import fails.
 * GREEN cycle:
 *  - Functions exist, prisma mock receives the correct data shape,
 *    requested/delivered are computed correctly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  writeExtendedThinkingMetric,
  computeThinkingRequested,
  type ExtendedThinkingMetricInput,
} from '../extendedThinkingMetricWriter.js';

// ─── prisma mock ─────────────────────────────────────────────────────────────
function makePrismaMock() {
  return {
    extendedThinkingMetric: {
      create: vi.fn().mockResolvedValue({ id: 'cuid-test-1' }),
    },
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function baseInput(overrides: Partial<ExtendedThinkingMetricInput> = {}): ExtendedThinkingMetricInput {
  return {
    userId: 'u-test',
    sessionId: 's-test',
    turnId: 'turn-001',
    providerId: 'anthropic-provider',
    model: 'test-model-for-thinking',
    requested: true,
    delivered: true,
    thinkingTokensApprox: 250,
    thinkingDurationMs: 1200,
    totalOutputTokens: 800,
    totalTurnMs: 3500,
    ...overrides,
  };
}

// ─── writeExtendedThinkingMetric tests ───────────────────────────────────────
describe('writeExtendedThinkingMetric', () => {
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
  });

  it('calls prisma.extendedThinkingMetric.create with the correct data shape', async () => {
    await writeExtendedThinkingMetric(prisma, baseInput());

    expect(prisma.extendedThinkingMetric.create).toHaveBeenCalledOnce();
    const { data } = prisma.extendedThinkingMetric.create.mock.calls[0][0];
    expect(data.user_id).toBe('u-test');
    expect(data.session_id).toBe('s-test');
    expect(data.message_id).toBe('turn-001');
    expect(data.provider_id).toBe('anthropic-provider');
    expect(data.model).toBe('test-model-for-thinking');
    expect(data.requested).toBe(true);
    expect(data.delivered).toBe(true);
    expect(data.thinking_tokens).toBe(250);
    expect(data.thinking_duration_ms).toBe(1200);
    expect(data.total_output_tokens).toBe(800);
    expect(data.total_turn_ms).toBe(3500);
  });

  it('writes requested:true, delivered:false when no thinking arrived (C2 force-dispatch case)', async () => {
    await writeExtendedThinkingMetric(
      prisma,
      baseInput({ requested: true, delivered: false, thinkingTokensApprox: 0, thinkingDurationMs: undefined }),
    );

    const { data } = prisma.extendedThinkingMetric.create.mock.calls[0][0];
    expect(data.requested).toBe(true);
    expect(data.delivered).toBe(false);
    expect(data.thinking_tokens).toBeNull();      // 0 → null (no actual thinking)
    expect(data.thinking_duration_ms).toBeNull(); // undefined → null
  });

  it('writes requested:false when user turned off Brain toggle (requested=false)', async () => {
    await writeExtendedThinkingMetric(
      prisma,
      baseInput({ requested: false, delivered: false, thinkingTokensApprox: undefined }),
    );

    const { data } = prisma.extendedThinkingMetric.create.mock.calls[0][0];
    expect(data.requested).toBe(false);
    expect(data.delivered).toBe(false);
    expect(data.thinking_tokens).toBeNull();
  });

  it('maps undefined userId/sessionId/turnId to null (nullable columns)', async () => {
    await writeExtendedThinkingMetric(
      prisma,
      baseInput({ userId: undefined, sessionId: undefined, turnId: undefined }),
    );

    const { data } = prisma.extendedThinkingMetric.create.mock.calls[0][0];
    expect(data.user_id).toBeNull();
    expect(data.session_id).toBeNull();
    expect(data.message_id).toBeNull();
  });

  it('propagates prisma rejection so the caller can log it', async () => {
    prisma.extendedThinkingMetric.create.mockRejectedValue(new Error('DB timeout'));

    await expect(writeExtendedThinkingMetric(prisma, baseInput())).rejects.toThrow('DB timeout');
  });
});

// ─── computeThinkingRequested tests ──────────────────────────────────────────
describe('computeThinkingRequested', () => {
  it('true when flag is undefined (not set by UI) and model supports thinking', () => {
    expect(computeThinkingRequested(undefined, true)).toBe(true);
  });

  it('true when flag is explicitly true and model supports thinking', () => {
    expect(computeThinkingRequested(true, true)).toBe(true);
  });

  it('false when flag is false (user turned off Brain toggle) regardless of model support', () => {
    expect(computeThinkingRequested(false, true)).toBe(false);
  });

  it('false when model does not support thinking, even if flag is on', () => {
    expect(computeThinkingRequested(true, false)).toBe(false);
    expect(computeThinkingRequested(undefined, false)).toBe(false);
  });

  it('false when both flag is off and model does not support thinking', () => {
    expect(computeThinkingRequested(false, false)).toBe(false);
  });
});
