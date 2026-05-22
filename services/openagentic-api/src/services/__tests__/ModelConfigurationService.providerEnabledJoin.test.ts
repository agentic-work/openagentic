/**
 * #653 — getDefaultChatModel must skip Registry rows whose backing provider
 * is disabled.
 *
 * Live capture 2026-05-06 23:52Z: dev had `gemini-2.5-pro` row
 * (role=chat, enabled=true) in admin.model_role_assignments, but the
 * Vertex provider serving it had `llm_providers.enabled=false`. The
 * existing query was:
 *   prisma.modelRoleAssignment.findFirst({
 *     where: { role: 'chat', enabled: true },
 *     orderBy: { priority: 'asc' },
 *   })
 * — only checking the assignment's enabled flag, not the provider's.
 * Result: getDefaultChatModel() returned 'gemini-2.5-pro'; ProviderManager
 * then rejected it with "no enabled provider serves it" and every chat
 * turn that resolved to default-chat-model failed. Sub-agents in the
 * cloud-operations path failed 5x retry on every dispatch.
 *
 * Fix: cross-check the assignment's provider name (string column) against
 * the live enabled+non-deleted provider set. Two-step query keeps the
 * Prisma surface simple and works for both legacy rows (provider_id NULL)
 * and new rows (provider_id populated via Phase 1 trigger).
 *
 * The contract: when ALL rows for role='chat' point at disabled providers,
 * getDefaultChatModel must throw the actionable "no chat model configured"
 * error rather than returning a model that will subsequently fail.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/prisma.js', () => {
  const mock = {
    lLMProvider: { findMany: vi.fn() },
    modelRoleAssignment: { findFirst: vi.fn(), findMany: vi.fn() },
  };
  (globalThis as any).__prismaMock = mock;
  return { prisma: mock };
});
import '../../utils/prisma.js';

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

import { ModelConfigurationService } from '../ModelConfigurationService.js';

function prismaMock() {
  return (globalThis as any).__prismaMock as {
    lLMProvider: { findMany: ReturnType<typeof vi.fn> };
    modelRoleAssignment: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
}

describe('ModelConfigurationService.getDefaultChatModel — provider enabled join (#653)', () => {
  const svc = ModelConfigurationService;

  beforeEach(() => {
    const m = prismaMock();
    m.lLMProvider.findMany.mockReset();
    m.modelRoleAssignment.findFirst.mockReset();
    m.modelRoleAssignment.findMany.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it('skips registry rows whose backing provider is disabled', async () => {
    const m = prismaMock();
    // Registry has 2 chat rows: gemini-2.5-pro (Vertex, prio 0) and
    // gpt-5.4 (AIF, prio 1). gemini is the highest-priority "enabled"
    // entry but its provider is disabled live.
    m.modelRoleAssignment.findMany.mockResolvedValue([
      { model: 'gemini-2.5-pro', provider: 'vertex-dev-openagentic-dev-us-central1', priority: 0 },
      { model: 'gpt-5.4', provider: 'aif', priority: 1 },
    ]);
    m.lLMProvider.findMany.mockResolvedValue([
      { name: 'aif' }, // Vertex is NOT in this set — disabled.
    ]);

    const model = await svc.getDefaultChatModel();
    // Must skip gemini-2.5-pro because its provider 'vertex-…' is not in
    // the enabled set, and fall through to gpt-5.4 instead.
    expect(model).toBe('gpt-5.4');
  });

  it('throws when every chat row points at a disabled provider', async () => {
    const m = prismaMock();
    m.modelRoleAssignment.findMany.mockResolvedValue([
      { model: 'gemini-2.5-pro', provider: 'vertex-…', priority: 0 },
    ]);
    m.lLMProvider.findMany.mockResolvedValue([]);
    await expect(svc.getDefaultChatModel()).rejects.toThrow(/No chat model/i);
  });

  it('returns the highest-priority row whose provider is enabled', async () => {
    const m = prismaMock();
    m.modelRoleAssignment.findMany.mockResolvedValue([
      { model: 'a', provider: 'P1', priority: 0 },
      { model: 'b', provider: 'P2', priority: 1 },
      { model: 'c', provider: 'P3', priority: 2 },
    ]);
    m.lLMProvider.findMany.mockResolvedValue([{ name: 'P2' }, { name: 'P3' }]);
    const model = await svc.getDefaultChatModel();
    expect(model).toBe('b'); // P1 disabled → next priority that survives
  });
});
