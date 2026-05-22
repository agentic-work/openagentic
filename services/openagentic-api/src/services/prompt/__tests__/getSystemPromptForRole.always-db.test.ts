/**
 * W.1.b — useDbPrompt escape hatch rip (Sprint W.1, 2026-05-19).
 *
 * After the full rip:
 *   1. rbacService injected + healthy  → body comes from DB, NOT from disk
 *   2. rbacService throws              → falls through to disk + logs CRITICAL warn
 *   3. rbacService missing             → falls through to disk (no crash)
 *   4. No env var (USE_DB_PROMPT gone), no deps flag (useDbPrompt gone).
 *      DB is always tried when rbacService is wired. No opt-out.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSystemPromptForRole } from '../getSystemPromptForRole.js';
import { __clearPromptCache } from '../RoleKeyedSystemPrompt.js';

const minCtx = {
  userId: 'u-w1',
  sessionId: 's-w1',
  tenantId: 't-w1',
  modelInUse: 'some-model',
  userMessage: 'hello',
  priorTurnCount: 0,
};

describe('W.1 — getSystemPromptForRole always-DB (USE_DB_PROMPT ripped)', () => {
  beforeEach(() => __clearPromptCache());

  it('rbacService injected → body comes from DB regardless of env (no useDbPrompt flag needed)', async () => {
    const dbBody = '[W1-DB] always-DB body.';
    const fakeService = { getActiveTemplate: vi.fn(async () => dbBody) };

    // No useDbPrompt flag — should hit DB unconditionally after the rip.
    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      rbacService: fakeService,
      // NOTE: useDbPrompt is intentionally omitted
    });

    expect(fakeService.getActiveTemplate).toHaveBeenCalledWith('admin');
    expect(out.startsWith(dbBody)).toBe(true);
  });

  it('rbacService injects DB body; no env var consulted (USE_DB_PROMPT ripped)', async () => {
    // Sprint W.1: USE_DB_PROMPT env var is gone entirely — no branch reads it.
    const dbBody = '[W1-ENV-ABSENT] DB should win anyway.';
    const fakeService = { getActiveTemplate: vi.fn(async () => dbBody) };

    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      rbacService: fakeService,
    });

    expect(fakeService.getActiveTemplate).toHaveBeenCalled();
    expect(out).toContain('[W1-ENV-ABSENT]');
  });

  it('rbacService throws → falls through to disk file (emergency fallback)', async () => {
    const fakeService = {
      getActiveTemplate: vi.fn(async () => {
        throw new Error('db down');
      }),
    };

    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      rbacService: fakeService,
    });

    // Failure mode must fall through to disk; static admin body is intact.
    expect(fakeService.getActiveTemplate).toHaveBeenCalled();
    expect(out).toMatch(/^You are OpenAgentic.*platform administrator/);
  });

  it('rbacService missing → falls through to disk file (no crash)', async () => {
    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      // rbacService deliberately absent
    });

    // File-based fallback should still produce a valid system prompt.
    expect(out).toMatch(/^You are OpenAgentic.*platform administrator/);
  });

  it('DB throws → emergency disk-file fallback; no escape hatch needed or available', async () => {
    // Sprint W.1: useDbPrompt: false escape hatch is GONE.
    // The only path to disk is a genuine DB error. Test the error path directly.
    const fakeService = {
      getActiveTemplate: vi.fn(async () => {
        throw new Error('simulated DB outage');
      }),
    };

    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      rbacService: fakeService,
    });

    // DB was attempted (no bypass), then fell through to disk.
    expect(fakeService.getActiveTemplate).toHaveBeenCalled();
    expect(out).toMatch(/^You are OpenAgentic.*platform administrator/);
  });
});
