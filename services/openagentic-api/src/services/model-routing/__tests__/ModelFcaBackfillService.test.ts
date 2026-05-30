/**
 * ModelFcaBackfillService — boot-time classification of the first-class
 * function_calling_accuracy column for every registry row where it's NULL.
 *
 * Uses classifyModelFca: MCR benchmark when known, else a structural
 * tier-default — so NO model is left at 0/NULL (which would filter it out of
 * every router pool + the Live Scoring Lab). Idempotent (NULL-only). Stamps
 * capabilities.fcaSource so the UI can label estimated vs measured.
 */
import { describe, test, expect, vi } from 'vitest';
import { ModelFcaBackfillService } from '../ModelFcaBackfillService.js';

const SILENT_LOGGER: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => SILENT_LOGGER };

function buildFakePrisma(rows: Array<{ id: string; model: string; provider: string; capabilities?: any; function_calling_accuracy: number | null }>) {
  const updates: Array<{ id: string; value: number; fcaSource: string }> = [];
  return {
    updates,
    prisma: {
      modelRoleAssignment: {
        findMany: vi.fn().mockResolvedValue(rows),
        update: vi.fn().mockImplementation(async (args: any) => {
          updates.push({ id: args.where.id, value: args.data.function_calling_accuracy, fcaSource: args.data.capabilities?.fcaSource });
          return { id: args.where.id };
        }),
      },
    },
  };
}

describe('ModelFcaBackfillService', () => {
  test('MCR-known rows get the benchmark value (source mcr-benchmark)', async () => {
    const { prisma, updates } = buildFakePrisma([
      { id: 'r1', model: 'gpt-oss:20b', provider: 'hal-ollama', capabilities: {}, function_calling_accuracy: null },
    ]);
    const mcrLookup = (id: string) => (id.includes('gpt-oss') ? 0.87 : null);

    const svc = new ModelFcaBackfillService(prisma as any, SILENT_LOGGER, mcrLookup);
    const result = await svc.backfill();

    const findManyArgs = (prisma.modelRoleAssignment.findMany as any).mock.calls[0][0];
    expect(findManyArgs.where).toMatchObject({ function_calling_accuracy: null });
    expect(updates).toContainEqual({ id: 'r1', value: 0.87, fcaSource: 'mcr-benchmark' });
    expect(result.updated).toBe(1);
  });

  test('UNKNOWN cloud model is classified to a tier-default (never left NULL)', async () => {
    const { prisma, updates } = buildFakePrisma([
      // not in MCR (lookup returns null), large context → 0.90 tier-default
      { id: 'x1', model: 'nvidia.nemotron-nano-12b-v2', provider: 'bedrock-dev', capabilities: { contextWindowTokens: 128000 }, function_calling_accuracy: null },
    ]);
    const mcrLookup = (): number | null => null;

    const svc = new ModelFcaBackfillService(prisma as any, SILENT_LOGGER, mcrLookup);
    const result = await svc.backfill();

    expect(updates).toEqual([{ id: 'x1', value: 0.90, fcaSource: 'tier-default' }]);
    expect(result.updated).toBe(1);
  });

  test('UNKNOWN local model → 0.85 tier-default', async () => {
    const { prisma, updates } = buildFakePrisma([
      { id: 'l1', model: 'brand-new-local', provider: 'hal-ollama', capabilities: {}, function_calling_accuracy: null },
    ]);
    const svc = new ModelFcaBackfillService(prisma as any, SILENT_LOGGER, () => null);
    await svc.backfill();
    expect(updates).toEqual([{ id: 'l1', value: 0.85, fcaSource: 'tier-default' }]);
  });

  test('no NULL rows → no updates (idempotent steady state)', async () => {
    const { prisma, updates } = buildFakePrisma([]);
    const svc = new ModelFcaBackfillService(prisma as any, SILENT_LOGGER, () => 0.9);
    const result = await svc.backfill();
    expect(updates).toHaveLength(0);
    expect(result.updated).toBe(0);
  });
});
