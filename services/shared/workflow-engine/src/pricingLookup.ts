/**
 * pricingLookup.ts
 *
 * DB-driven per-million-token pricing for workflow cost accounting.
 * Reads from the `LLMCostRate` table (admin schema) which stores
 * input_cost_per_1m / output_cost_per_1m matching the cost formula
 * (promptTokens * rate + completionTokens * rate) / 1_000_000.
 *
 * Why LLMCostRate?
 *  - Fields map 1-to-1 with the existing cost arithmetic (per-1M, not per-1K).
 *  - ModelPricing uses per-1K which would require a conversion factor.
 *  - ModelRoleAssignment.cost_per_request is a single flat number, not per-token.
 *  - LLMCostRate has effective_from/effective_to date range for time-aware lookups.
 *
 * Matching strategy (Q4):
 *  All currently-active rows are loaded once at first use and cached for the
 *  instance lifetime.  Model name resolution uses a JS include-match:
 *    requestedModel.toLowerCase().includes(row.model.toLowerCase())
 *  so that full versioned names (e.g. "test-prefix-a-2024-11-20") match a DB
 *  row whose `model` column stores the short canonical name ("test-prefix-a").
 *  When multiple rows match the longest (most specific) key wins.
 *
 * Date filtering (Q9):
 *  Only rows where effective_from <= now AND (effective_to IS NULL OR effective_to >= now)
 *  are considered.  Rows with a future effective_from are silently excluded.
 */

// ---- Prisma row shape accepted by PricingLookup (duck-typed for testability) ----

export interface LLMCostRateRow {
  model: string;
  /** Prisma Decimal serialises to a number-or-Decimal; Number() handles both. */
  input_cost_per_1m: number | { toNumber: () => number; toString: () => string };
  output_cost_per_1m: number | { toNumber: () => number; toString: () => string };
  effective_from: Date;
  effective_to: Date | null;
}

export interface PricingPrismaLike {
  lLMCostRate: {
    findMany: (args: {
      where: Record<string, unknown>;
    }) => Promise<LLMCostRateRow[]>;
  };
}

// ---- Logger shape ----
// Kept structurally minimal so both pino loggers and plain test mocks satisfy it.

export interface PricingLogger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn: (msgOrObj: any, ...args: any[]) => void;
}

// ---- Resolved rates (tuple: [inputPerMillion, outputPerMillion]) ----

type Rates = [number, number];

// Fallback rate applied when no DB row is found or the DB throws.
// If you see this in production cost reports, populate the LLMCostRate table.
const FALLBACK_RATES: Rates = [0.15, 0.60]; // per-million USD, economy default

// ---- PricingLookup class ----

export class PricingLookup {
  /**
   * Cache: model name (lower-cased requested key) → resolved rates.
   * Populated after the first resolveRates call for that key.
   */
  private readonly rateCache = new Map<string, Rates>();

  /**
   * All currently-active rows loaded on first use.
   * null = not yet loaded; [] = loaded but table is empty.
   */
  private allRows: LLMCostRateRow[] | null = null;

  constructor(
    private readonly prisma: PricingPrismaLike,
    private readonly logger: PricingLogger,
  ) {}

  /**
   * Compute USD cost for a single LLM node call.
   * Never throws — uses FALLBACK_RATES on any error or DB miss.
   */
  async calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<number> {
    const rates = await this.resolveRates(model);
    return (promptTokens * rates[0] + completionTokens * rates[1]) / 1_000_000;
  }

  // ---- private helpers ----

  private async resolveRates(model: string): Promise<Rates> {
    const key = model.toLowerCase();
    const cached = this.rateCache.get(key);
    if (cached !== undefined) return cached;

    const rates = await this.fetchRates(key);
    this.rateCache.set(key, rates);
    return rates;
  }

  /**
   * Load all currently-active rows on first call (lazy, cached per instance).
   * Then find the best-matching row for the requested model key using JS
   * include-match, preferring the longest (most specific) DB model string.
   */
  private async fetchRates(modelKey: string): Promise<Rates> {
    try {
      const now = new Date();

      // Load all active rows once; subsequent calls use the cached array.
      if (this.allRows === null) {
        this.allRows = await this.prisma.lLMCostRate.findMany({
          where: {
            effective_from: { lte: now },
            OR: [
              { effective_to: null },
              { effective_to: { gte: now } },
            ],
          },
        });
      }

      const nowMs = now.getTime();

      // Q9: filter by effective date range in JS (defensive double-check;
      // guards against mocks and any DB that doesn't honour the where clause).
      const activeRows = this.allRows.filter((r) => {
        if (r.effective_from.getTime() > nowMs) return false; // future row
        if (r.effective_to !== null && r.effective_to.getTime() < nowMs) return false; // expired
        return true;
      });

      // Q4: case-insensitive include-match; longest DB model name wins on tie.
      const candidates = activeRows.filter(
        (r) => modelKey.includes(r.model.toLowerCase()),
      );

      if (candidates.length === 0) {
        this.logger.warn(
          `[PricingLookup] No LLMCostRate row for model "${modelKey}". Using fallback rates. Populate the llm_cost_rates table to get accurate billing.`,
        );
        return FALLBACK_RATES;
      }

      // Pick the most-specific match (longest model key).
      candidates.sort((a, b) => b.model.length - a.model.length);
      const row = candidates[0];

      // Q8: Number() correctly converts both plain JS numbers and Prisma Decimal objects.
      return [Number(row.input_cost_per_1m), Number(row.output_cost_per_1m)];
    } catch (err) {
      // DB unavailability must NOT crash the workflow — cost tracking is non-load-bearing.
      this.logger.warn(
        `[PricingLookup] DB error fetching rates for model "${modelKey}": ${String(err)}. Using fallback rates.`,
      );
      return FALLBACK_RATES;
    }
  }
}
