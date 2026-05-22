/**
 * Registry pricing-columns schema contract (task #342, step 2).
 *
 * Verifies that `schema.prisma` has the 8 dynamic-pricing columns the
 * BedrockPricingFetcher (and its sibling fetchers) will write to, and
 * that every LLM call will read to compute cost without a network hop.
 *
 * This test is pure Prisma metadata introspection — it does NOT touch
 * the live DB. It asserts against:
 *   1. `Prisma.dmmf.datamodel.models` — the compile-time schema shape
 *      baked into the generated client at `prisma generate` time.
 *   2. The TypeScript `ModelRoleAssignment` row type's field names.
 *
 * Both gates must agree: if a column is missing from `schema.prisma`
 * and the client is regenerated, #1 fails at test-run and #2 fails at
 * tsc-run. That is the RED→GREEN transition for this task.
 */

import { describe, it, expect, expectTypeOf, beforeAll, afterAll, afterEach } from 'vitest';
import type { ModelRoleAssignment } from '@prisma/client';
import { Prisma, PrismaClient } from '@prisma/client';

/** Every pricing column the Registry row must expose, post-migration. */
const REQUIRED_PRICING_COLUMNS = [
  'cost_per_input_token_usd',
  'cost_per_output_token_usd',
  'cost_per_cache_read_usd',
  'cost_per_cache_write_usd',
  'cost_per_thinking_token_usd',
  'cost_per_embedding_token_usd',
  'pricing_source',
  'pricing_fetched_at',
] as const;

describe('ModelRoleAssignment — dynamic pricing columns (task #342)', () => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'ModelRoleAssignment');

  it('resolves the ModelRoleAssignment DMMF entry', () => {
    expect(model).toBeDefined();
  });

  it.each(REQUIRED_PRICING_COLUMNS)(
    'declares column `%s` on ModelRoleAssignment',
    (colName) => {
      const field = model?.fields.find((f) => f.name === colName);
      expect(field, `schema.prisma is missing column ${colName}`).toBeDefined();
      expect(field?.isRequired, `${colName} must be nullable (isRequired=false)`).toBe(false);
    },
  );

  it('types the 6 USD rate columns as Decimal(14, 10)', () => {
    const rateCols = REQUIRED_PRICING_COLUMNS.filter((c) => c.startsWith('cost_per_'));
    for (const colName of rateCols) {
      const field = model?.fields.find((f) => f.name === colName);
      expect(field?.type, `${colName} must be Decimal`).toBe('Decimal');
      // Prisma DMMF stores the native @db type in `nativeType` as
      // `[typeName, args[]]` — e.g. `['Decimal', ['14', '10']]`.
      const nativeType = (field as { nativeType?: [string, string[]] } | undefined)?.nativeType;
      expect(nativeType?.[0], `${colName} must use @db.Decimal`).toBe('Decimal');
      expect(nativeType?.[1], `${colName} must be Decimal(14, 10)`).toEqual(['14', '10']);
    }
  });

  it('types pricing_source as String and pricing_fetched_at as DateTime', () => {
    const sourceField = model?.fields.find((f) => f.name === 'pricing_source');
    const fetchedField = model?.fields.find((f) => f.name === 'pricing_fetched_at');
    expect(sourceField?.type).toBe('String');
    expect(fetchedField?.type).toBe('DateTime');
  });

  it('type-gates the 6 Decimal rate columns as `Prisma.Decimal | null`', () => {
    // Pure compile-time assertion — fails to TypeScript-compile if the
    // regenerated client is missing any of these columns. Kept alongside
    // the DMMF checks so a missed `prisma generate` catches at both
    // layers.
    expectTypeOf<ModelRoleAssignment['cost_per_input_token_usd']>().toEqualTypeOf<
      Prisma.Decimal | null
    >();
    expectTypeOf<ModelRoleAssignment['cost_per_output_token_usd']>().toEqualTypeOf<
      Prisma.Decimal | null
    >();
    expectTypeOf<ModelRoleAssignment['cost_per_cache_read_usd']>().toEqualTypeOf<
      Prisma.Decimal | null
    >();
    expectTypeOf<ModelRoleAssignment['cost_per_cache_write_usd']>().toEqualTypeOf<
      Prisma.Decimal | null
    >();
    expectTypeOf<ModelRoleAssignment['cost_per_thinking_token_usd']>().toEqualTypeOf<
      Prisma.Decimal | null
    >();
    expectTypeOf<ModelRoleAssignment['cost_per_embedding_token_usd']>().toEqualTypeOf<
      Prisma.Decimal | null
    >();
  });

  it('type-gates pricing_source as `string | null` and pricing_fetched_at as `Date | null`', () => {
    expectTypeOf<ModelRoleAssignment['pricing_source']>().toEqualTypeOf<string | null>();
    expectTypeOf<ModelRoleAssignment['pricing_fetched_at']>().toEqualTypeOf<Date | null>();
  });
});

/**
 * DB-level CHECK constraint: the audit invariant that any stored rate
 * must carry BOTH pricing_source and pricing_fetched_at. This block
 * requires a live Postgres (the same pattern used by RegistryUpsertService
 * integration specs) and the 20260423 migration to be applied.
 *
 * Gate: src/test/setup.ts unconditionally stubs DATABASE_URL to
 * `postgresql://test:test@localhost:5432/test` so the unit-only default
 * run doesn't need to unset it. We treat that stub as "no live DB" and
 * skip, while any real DSN (pointing at a reachable Postgres with the
 * migration applied) exercises the full constraint battery. The CI
 * live-DB job overrides DATABASE_URL to the agentic-dev Postgres where
 * these cases act as a red/green gate for the migration itself.
 */
const STUB_DB_URL = 'postgresql://test:test@localhost:5432/test';
const hasLiveDb =
  Boolean(process.env.DATABASE_URL) && process.env.DATABASE_URL !== STUB_DB_URL;
describe.skipIf(!hasLiveDb)(
  'ModelRoleAssignment — pricing audit-trail CHECK constraint (integration)',
  () => {
    let prisma: PrismaClient;
    let testUserId: string;
    const providerName = `pricing-ck-test-${Date.now()}`;

    beforeAll(async () => {
      prisma = new PrismaClient({
        datasources: { db: { url: process.env.DATABASE_URL } },
        log: ['error'],
      });
      const anyUser = await prisma.user.findFirst({ select: { id: true } });
      if (!anyUser)
        throw new Error('No seed user — integration test requires user table populated');
      testUserId = anyUser.id;
    });

    afterAll(async () => {
      await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
      await prisma.$disconnect();
    });

    afterEach(async () => {
      await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    });

    it('rejects a row with rate set but pricing_source NULL (CHECK violation)', async () => {
      await expect(
        prisma.modelRoleAssignment.create({
          data: {
            role: 'chat',
            model: 'ck-violation-input-only',
            provider: providerName,
            created_by: testUserId,
            cost_per_input_token_usd: new Prisma.Decimal('15.00'),
            // deliberately leaving pricing_source / pricing_fetched_at NULL
          },
        }),
      ).rejects.toThrow(/check|constraint|model_role_assignments_pricing_source_ck/i);
    });

    it('accepts a row with all 6 rates set + pricing_source + pricing_fetched_at', async () => {
      const row = await prisma.modelRoleAssignment.create({
        data: {
          role: 'chat',
          model: 'ck-happy-all-rates',
          provider: providerName,
          created_by: testUserId,
          cost_per_input_token_usd: new Prisma.Decimal('15.00'),
          cost_per_output_token_usd: new Prisma.Decimal('75.00'),
          cost_per_cache_read_usd: new Prisma.Decimal('1.5'),
          cost_per_cache_write_usd: new Prisma.Decimal('18.75'),
          cost_per_thinking_token_usd: new Prisma.Decimal('75.00'),
          cost_per_embedding_token_usd: new Prisma.Decimal('0.02'),
          pricing_source: 'bedrock-pricing-sdk',
          pricing_fetched_at: new Date(),
        },
      });
      expect(row.id).toBeDefined();
      expect(row.pricing_source).toBe('bedrock-pricing-sdk');
      expect(row.pricing_fetched_at).toBeInstanceOf(Date);
    });

    it('accepts a "not yet fetched" row with ALL pricing columns NULL', async () => {
      const row = await prisma.modelRoleAssignment.create({
        data: {
          role: 'chat',
          model: 'ck-happy-all-null',
          provider: providerName,
          created_by: testUserId,
          // every pricing column intentionally omitted — "not yet fetched"
        },
      });
      expect(row.id).toBeDefined();
      expect(row.cost_per_input_token_usd).toBeNull();
      expect(row.cost_per_output_token_usd).toBeNull();
      expect(row.cost_per_cache_read_usd).toBeNull();
      expect(row.cost_per_cache_write_usd).toBeNull();
      expect(row.cost_per_thinking_token_usd).toBeNull();
      expect(row.cost_per_embedding_token_usd).toBeNull();
      expect(row.pricing_source).toBeNull();
      expect(row.pricing_fetched_at).toBeNull();
    });
  },
);
