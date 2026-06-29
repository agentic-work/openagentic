/**
 * #508 Phase 2 — RegistryReader is the single read SoT for model availability.
 *
 * Contract:
 *   - getDefaultModel(role) returns the highest-priority enabled+active row
 *     for that role. Throws RegistryEmptyError if no such row exists.
 *   - listAvailable(role) returns all enabled+active rows for that role,
 *     ordered by priority asc.
 *   - get(id) returns a row by id (admin only; throws NotFoundError).
 *   - search(filter) admin-facing; returns deprecated/disposed for review.
 *
 * Crucially: RegistryReader does NOT fall back to llm_providers.model_config
 * fields. That fallback is the parallel-SoT bug (#504 self-heal). Once the
 * Phase 1 cascade trigger guarantees the registry can never go empty while
 * a provider exists, the fallback becomes dead code.
 *
 * Filter: state='active' AND enabled=true AND provider.deleted_at IS NULL
 *         AND provider.enabled=true.
 *
 * Provider table is joined via the new provider_id FK (Phase 1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  modelRoleAssignment: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
};

vi.mock('../../../utils/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { RegistryReader, RegistryEmptyError, RegistryRowNotFoundError } from '../RegistryReader.js';

describe('RegistryReader — #508 Phase 2 single read SoT', () => {
  let reader: RegistryReader;

  beforeEach(() => {
    prismaMock.modelRoleAssignment.findFirst.mockReset();
    prismaMock.modelRoleAssignment.findMany.mockReset();
    prismaMock.modelRoleAssignment.findUnique.mockReset();
    reader = new RegistryReader();
  });

  describe('getDefaultModel', () => {
    it('returns the highest-priority active enabled row for the role', async () => {
      prismaMock.modelRoleAssignment.findFirst.mockResolvedValueOnce({
        id: 'r1',
        model: 'us.anthropic.claude-sonnet-4-6',
        provider: 'aws-bedrock',
        role: 'chat',
        priority: 1,
        enabled: true,
        state: 'active',
        capabilities: { chat: true, tools: true },
      });

      const row = await reader.getDefaultModel('chat');

      expect(row.model).toBe('us.anthropic.claude-sonnet-4-6');
      expect(row.provider).toBe('aws-bedrock');
      expect(row.role).toBe('chat');
      expect(prismaMock.modelRoleAssignment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: 'chat',
            enabled: true,
            state: 'active',
          }),
          orderBy: { priority: 'asc' },
        }),
      );
    });

    it('throws RegistryEmptyError when no active enabled row exists for the role', async () => {
      prismaMock.modelRoleAssignment.findFirst.mockResolvedValueOnce(null);

      await expect(reader.getDefaultModel('chat')).rejects.toBeInstanceOf(RegistryEmptyError);
    });

    it('does NOT fall back to llm_providers.model_config (the #504 anti-pattern)', async () => {
      // Even with a missing chat row, RegistryReader does NOT consult llm_providers.
      // The cascade trigger (Phase 1) guarantees this can't happen while a provider exists.
      prismaMock.modelRoleAssignment.findFirst.mockResolvedValueOnce(null);

      await expect(reader.getDefaultModel('chat')).rejects.toBeInstanceOf(RegistryEmptyError);

      // Verify lLMProvider.findFirst was NOT called even if it were exposed on the mock.
      // The mock object literally does not include lLMProvider — test passes if RegistryReader
      // doesn't try to access it.
    });

    it('filters out rows whose provider is soft-deleted', async () => {
      // Behavior expressed via the where clause on the joined provider_ref.
      prismaMock.modelRoleAssignment.findFirst.mockResolvedValueOnce(null);
      await reader.getDefaultModel('chat').catch(() => undefined);

      const call = prismaMock.modelRoleAssignment.findFirst.mock.calls[0][0];
      expect(call.where.provider_ref).toEqual(
        expect.objectContaining({ deleted_at: null, enabled: true }),
      );
    });

    it('filters out rows whose provider is disabled', async () => {
      prismaMock.modelRoleAssignment.findFirst.mockResolvedValueOnce(null);
      await reader.getDefaultModel('chat').catch(() => undefined);

      const call = prismaMock.modelRoleAssignment.findFirst.mock.calls[0][0];
      expect(call.where.provider_ref.enabled).toBe(true);
    });
  });

  describe('listAvailable', () => {
    it('returns all enabled active rows for the role, ordered by priority asc', async () => {
      prismaMock.modelRoleAssignment.findMany.mockResolvedValueOnce([
        { id: 'r1', model: 'sonnet-4', provider: 'bedrock', priority: 1, enabled: true, state: 'active' },
        { id: 'r2', model: 'gpt-oss', provider: 'ollama', priority: 100, enabled: true, state: 'active' },
      ]);

      const rows = await reader.listAvailable('chat');

      expect(rows).toHaveLength(2);
      expect(rows[0].model).toBe('sonnet-4');
      expect(rows[1].model).toBe('gpt-oss');
      expect(prismaMock.modelRoleAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: 'chat', enabled: true, state: 'active' }),
          orderBy: { priority: 'asc' },
        }),
      );
    });

    it('returns empty array (no throw) when nothing is available', async () => {
      prismaMock.modelRoleAssignment.findMany.mockResolvedValueOnce([]);
      const rows = await reader.listAvailable('chat');
      expect(rows).toEqual([]);
    });
  });

  describe('get', () => {
    it('returns the row by id', async () => {
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce({
        id: 'row-1', model: 'sonnet', provider: 'bedrock', role: 'chat',
        state: 'active', enabled: true, priority: 1,
      });

      const row = await reader.get('row-1');
      expect(row.id).toBe('row-1');
      expect(prismaMock.modelRoleAssignment.findUnique).toHaveBeenCalledWith({
        where: { id: 'row-1' },
      });
    });

    it('throws RegistryRowNotFoundError when id missing', async () => {
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(null);
      await expect(reader.get('missing')).rejects.toBeInstanceOf(RegistryRowNotFoundError);
    });
  });

  describe('search (admin-facing — sees all states)', () => {
    it('returns rows including deprecated and disposed when no state filter', async () => {
      prismaMock.modelRoleAssignment.findMany.mockResolvedValueOnce([
        { id: 'r1', state: 'active' },
        { id: 'r2', state: 'deprecated' },
        { id: 'r3', state: 'disposed' },
      ]);

      const rows = await reader.search({});
      expect(rows).toHaveLength(3);
    });

    it('respects state filter when provided', async () => {
      prismaMock.modelRoleAssignment.findMany.mockResolvedValueOnce([
        { id: 'r1', state: 'deprecated' },
      ]);

      await reader.search({ state: 'deprecated' });
      const call = prismaMock.modelRoleAssignment.findMany.mock.calls[0][0];
      expect(call.where.state).toBe('deprecated');
    });

    it('respects role filter when provided', async () => {
      prismaMock.modelRoleAssignment.findMany.mockResolvedValueOnce([]);
      await reader.search({ role: 'embeddings' });
      const call = prismaMock.modelRoleAssignment.findMany.mock.calls[0][0];
      expect(call.where.role).toBe('embeddings');
    });
  });
});
