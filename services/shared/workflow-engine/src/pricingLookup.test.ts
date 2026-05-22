import { describe, it, expect, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { PricingLookup } from './pricingLookup.js';

// Fallback rates match the safe-default in pricingLookup.ts (input: 0.15, output: 0.60 per 1M)
const FALLBACK_INPUT = 0.15;
const FALLBACK_OUTPUT = 0.60;

// Build a Prisma-shaped mock that returns the given rows from findMany.
function makePrisma(rows: object[] = [], shouldThrow = false) {
  const findMany = shouldThrow
    ? vi.fn().mockRejectedValue(new Error('DB connection refused'))
    : vi.fn().mockResolvedValue(rows);
  return { lLMCostRate: { findMany } };
}

function makeLogger() {
  return { warn: vi.fn() };
}

// ---- helpers ----

function pastDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function futureDate(daysAhead: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d;
}

// A "currently active" DB row with plain-number prices.
function activeRow(model: string, input: number, output: number, overrides: object = {}) {
  return {
    model,
    input_cost_per_1m: input,
    output_cost_per_1m: output,
    effective_from: pastDate(30),
    effective_to: null,
    ...overrides,
  };
}

describe('PricingLookup', () => {
  describe('calculateCost — DB hit (exact model name)', () => {
    it('returns cost using DB rates when a matching row is found', async () => {
      const rows = [activeRow('test-model-a', 3.0, 15.0)];
      const prisma = makePrisma(rows);
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      const cost = await lookup.calculateCost('test-model-a', 1_000_000, 500_000);
      // (1_000_000 * 3.0 + 500_000 * 15.0) / 1_000_000 = 3.0 + 7.5 = 10.5
      expect(cost).toBeCloseTo(10.5, 6);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('computes cost arithmetic correctly: (prompt*inputRate + completion*outputRate) / 1_000_000', async () => {
      const rows = [activeRow('test-model-b', 2.0, 8.0)];
      const prisma = makePrisma(rows);
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      const promptTokens = 200_000;
      const completionTokens = 50_000;
      const expected = (promptTokens * 2.0 + completionTokens * 8.0) / 1_000_000;
      const cost = await lookup.calculateCost('test-model-b', promptTokens, completionTokens);
      expect(cost).toBeCloseTo(expected, 9);
    });
  });

  // ── Q4: prefix / case-insensitive matching ────────────────────────────────

  describe('Q4 — prefix / case-insensitive matching', () => {
    it('matches a versioned model name against a short DB row prefix (e.g. "test-prefix-a-2024-11-20" → DB row "test-prefix-a")', async () => {
      // DB stores the short name; production callers pass the full versioned string.
      const rows = [activeRow('test-prefix-a', 5.0, 20.0)];
      const prisma = makePrisma(rows);
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      // Requested model contains the DB row's model name as a prefix.
      const cost = await lookup.calculateCost('test-prefix-a-2024-11-20', 1_000_000, 0);
      expect(cost).toBeCloseTo(5.0, 6);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('matches case-insensitively: upper-cased requested model hits lower-cased DB row', async () => {
      const rows = [activeRow('test-ci-model', 6.0, 24.0)];
      const prisma = makePrisma(rows);
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      const cost = await lookup.calculateCost('TEST-CI-MODEL', 1_000_000, 0);
      expect(cost).toBeCloseTo(6.0, 6);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('prefers the longest (most specific) DB row when multiple rows match', async () => {
      // "test-short-a" and "test-short-ab" both prefix-match "test-short-ab-v2".
      // The longer key ("test-short-ab") is more specific and should win.
      const rows = [
        activeRow('test-short-a', 1.0, 4.0),
        activeRow('test-short-ab', 10.0, 40.0),
      ];
      const prisma = makePrisma(rows);
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      const cost = await lookup.calculateCost('test-short-ab-v2', 1_000_000, 0);
      // Should use the longer-key row (10.0 input, 40.0 output), not the shorter one.
      expect(cost).toBeCloseTo(10.0, 6);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  // ── Q8: Decimal coercion ──────────────────────────────────────────────────

  describe('Q8 — Decimal coercion from Prisma', () => {
    it('correctly converts Prisma Decimal objects to numbers in cost arithmetic', async () => {
      // Real Prisma returns Decimal instances, not plain JS numbers.
      const rows = [
        {
          model: 'test-decimal-model',
          input_cost_per_1m: new Decimal(3.0),
          output_cost_per_1m: new Decimal(15.0),
          effective_from: pastDate(30),
          effective_to: null,
        },
      ];
      const prisma = makePrisma(rows);
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      // 1000 * 3.0 / 1_000_000 + 500 * 15.0 / 1_000_000 = 0.003 + 0.0075 = 0.0105
      const cost = await lookup.calculateCost('test-decimal-model', 1_000, 500);
      expect(cost).toBeCloseTo(0.0105, 9);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  // ── Q9: effective_from filter (no future rows) ────────────────────────────

  describe('Q9 — effective_from / effective_to date range filtering', () => {
    it('ignores rows with a future effective_from (row not yet active)', async () => {
      // The mock returns the future-dated row as if the DB returned it; the helper
      // must filter it out in JS since the where clause also guards it.
      // For this test we simulate the DB returning only the future row.
      const rows = [
        {
          model: 'test-future-model',
          input_cost_per_1m: 99.0,
          output_cost_per_1m: 99.0,
          effective_from: futureDate(10), // starts 10 days from now — NOT active yet
          effective_to: null,
        },
      ];
      const prisma = makePrisma(rows);
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      // Should fall back because the only row isn't effective yet.
      const cost = await lookup.calculateCost('test-future-model', 1_000, 500);
      const expected = (1_000 * FALLBACK_INPUT + 500 * FALLBACK_OUTPUT) / 1_000_000;
      expect(cost).toBeCloseTo(expected, 9);
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it('uses the current row and ignores a future-dated row when both are present', async () => {
      const rows = [
        activeRow('test-versioned-model', 5.0, 20.0),                          // currently active
        {
          model: 'test-versioned-model',
          input_cost_per_1m: 99.0,
          output_cost_per_1m: 99.0,
          effective_from: futureDate(30), // future row — must be ignored
          effective_to: null,
        },
      ];
      const prisma = makePrisma(rows);
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      const cost = await lookup.calculateCost('test-versioned-model', 1_000_000, 0);
      expect(cost).toBeCloseTo(5.0, 6); // current rate, not 99.0
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('ignores rows whose effective_to is in the past (expired)', async () => {
      const rows = [
        {
          model: 'test-expired-model',
          input_cost_per_1m: 77.0,
          output_cost_per_1m: 77.0,
          effective_from: pastDate(60),
          effective_to: pastDate(5), // expired 5 days ago
        },
      ];
      const prisma = makePrisma(rows);
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      const cost = await lookup.calculateCost('test-expired-model', 1_000, 500);
      const expected = (1_000 * FALLBACK_INPUT + 500 * FALLBACK_OUTPUT) / 1_000_000;
      expect(cost).toBeCloseTo(expected, 9);
      expect(logger.warn).toHaveBeenCalledOnce();
    });
  });

  // ── Fallback / error paths ────────────────────────────────────────────────

  describe('calculateCost — fallback on DB miss', () => {
    it('returns fallback cost when no DB row matches', async () => {
      const prisma = makePrisma([]); // findMany returns empty array
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      const promptTokens = 1_000;
      const completionTokens = 500;
      const expected = (promptTokens * FALLBACK_INPUT + completionTokens * FALLBACK_OUTPUT) / 1_000_000;
      const cost = await lookup.calculateCost('test-model-c', promptTokens, completionTokens);
      expect(cost).toBeCloseTo(expected, 9);
      // Warn so admin knows to populate the table
      expect(logger.warn).toHaveBeenCalledOnce();
    });
  });

  describe('calculateCost — fallback on DB error', () => {
    it('returns fallback cost when Prisma throws and does not propagate the error', async () => {
      const prisma = makePrisma([], true); // throws
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      const promptTokens = 2_000;
      const completionTokens = 1_000;
      const expected = (promptTokens * FALLBACK_INPUT + completionTokens * FALLBACK_OUTPUT) / 1_000_000;

      await expect(lookup.calculateCost('test-model-d', promptTokens, completionTokens)).resolves.toBeCloseTo(expected, 9);
      expect(logger.warn).toHaveBeenCalledOnce();
    });
  });

  // ── Caching ───────────────────────────────────────────────────────────────

  describe('per-instance caching', () => {
    it('calls Prisma findMany only once for repeated lookups of the same model', async () => {
      const rows = [activeRow('test-model-e', 1.0, 4.0)];
      const prisma = makePrisma(rows);
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      const cost1 = await lookup.calculateCost('test-model-e', 100_000, 50_000);
      const cost2 = await lookup.calculateCost('test-model-e', 200_000, 80_000);

      // findMany loads all rows ONCE for the lifetime of the instance;
      // subsequent lookups are satisfied from the in-memory cache.
      expect(prisma.lLMCostRate.findMany).toHaveBeenCalledOnce();
      // Both calls should use DB rates
      expect(cost1).toBeCloseTo((100_000 * 1.0 + 50_000 * 4.0) / 1_000_000, 9);
      expect(cost2).toBeCloseTo((200_000 * 1.0 + 80_000 * 4.0) / 1_000_000, 9);
    });

    it('does NOT share cache between different PricingLookup instances', async () => {
      const rows = [activeRow('test-model-f', 1.0, 4.0)];
      const prisma = makePrisma(rows);
      const logger = makeLogger();

      const lookup1 = new PricingLookup(prisma, logger);
      const lookup2 = new PricingLookup(prisma, logger);

      await lookup1.calculateCost('test-model-f', 100_000, 50_000);
      await lookup2.calculateCost('test-model-g', 100_000, 50_000);

      // Each instance performs its own findMany load.
      expect(prisma.lLMCostRate.findMany).toHaveBeenCalledTimes(2);
    });

    it('caches the full row set — a second different model name hits no extra DB call', async () => {
      const rows = [
        activeRow('test-model-h', 1.0, 4.0),
        activeRow('test-model-i', 2.0, 8.0),
      ];
      const prisma = makePrisma(rows);
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      await lookup.calculateCost('test-model-h', 100, 50);
      await lookup.calculateCost('test-model-i', 200, 100);
      await lookup.calculateCost('test-model-h', 300, 150);

      // All lookups satisfied from a single findMany load.
      expect(prisma.lLMCostRate.findMany).toHaveBeenCalledOnce();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('caches miss result — warn fires only once even for repeated calls with no matching row', async () => {
      const prisma = makePrisma([]);
      const logger = makeLogger();
      const lookup = new PricingLookup(prisma, logger);

      await lookup.calculateCost('test-model-j', 100, 50);
      await lookup.calculateCost('test-model-j', 200, 100);

      // Prisma hit once; warn fires once.
      expect(prisma.lLMCostRate.findMany).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledOnce();
    });
  });
});
