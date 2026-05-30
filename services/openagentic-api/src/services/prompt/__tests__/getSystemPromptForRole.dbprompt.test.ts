/**
 * getSystemPromptForRole — DB-backed RBAC body path (Sprint W: always-DB).
 *
 * Sprint W (2026-05-19): USE_DB_PROMPT env-gate ripped. DB is ALWAYS the
 * primary source when rbacService is injected; disk file remains the emergency
 * fallback on DB failure. File path remains the default when rbacService is absent.
 *
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-prompts-db-editable.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSystemPromptForRole } from '../getSystemPromptForRole.js';
import { __clearPromptCache } from '../RoleKeyedSystemPrompt.js';

const minCtx = {
  userId: 'u-test',
  sessionId: 's-test',
  tenantId: 't-test',
  modelInUse: 'some-model',
  userMessage: 'hello',
  priorTurnCount: 0,
};

describe('getSystemPromptForRole — P-Live-4 DB-backed body', () => {
  beforeEach(() => __clearPromptCache());

  it('rbacService injected → body comes from DB, NOT from disk (always-DB after Sprint W rip)', async () => {
    const dbBody = '[DB-ADMIN] You are the live-edited admin prompt body.';
    const fakeService = {
      getActiveTemplate: vi.fn(async () => dbBody),
    };

    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      rbacService: fakeService,
    });

    expect(fakeService.getActiveTemplate).toHaveBeenCalledWith('admin');
    expect(out.startsWith(dbBody)).toBe(true);
    expect(out).toContain('<session-facts>');
  });

  it('rbacService missing → falls back to file path', async () => {
    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
    });
    // File body is the unchanged admin prompt.
    expect(out).toMatch(/^You are OpenAgentic.*platform administrator/);
  });

  it('rbacService throws → emergency disk-file fallback fires (DB-failure path)', async () => {
    // Sprint W.1: the escape hatch (useDbPrompt: false) is GONE.
    // The only way to reach the disk fallback now is a real DB error.
    // Inject a service that throws and assert disk content is returned.
    const fakeService = {
      getActiveTemplate: vi.fn(async () => {
        throw new Error('simulated DB down');
      }),
    };

    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      rbacService: fakeService,
    });

    // getActiveTemplate was called (DB was tried), then fell through to disk.
    expect(fakeService.getActiveTemplate).toHaveBeenCalled();
    expect(out).toMatch(/^You are OpenAgentic.*platform administrator/);
  });

  it('rbacService throws → falls back to file path (chat keeps working)', async () => {
    const fakeService = {
      getActiveTemplate: vi.fn(async () => {
        throw new Error('db down');
      }),
    };

    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      rbacService: fakeService,
    });

    expect(fakeService.getActiveTemplate).toHaveBeenCalled();
    // Failure-mode falls through to disk; admin static body is intact.
    expect(out).toMatch(/^You are OpenAgentic.*platform administrator/);
  });

  it('member role: DB path resolves the member template, not admin', async () => {
    const fakeService = {
      getActiveTemplate: vi.fn(async (role: string) =>
        role === 'admin'
          ? '[DB-ADMIN] admin body'
          : '[DB-MEMBER] member body',
      ),
    };

    const memberOut = await getSystemPromptForRole('member', minCtx, {
      memoryRecall: async () => [],
      rbacService: fakeService,
    });

    expect(memberOut.startsWith('[DB-MEMBER] member body')).toBe(true);
    expect(memberOut).not.toContain('[DB-ADMIN]');
    expect(fakeService.getActiveTemplate).toHaveBeenCalledWith('member');
  });

  it('subsequent edits to the DB body propagate (no per-process file cache lock-in)', async () => {
    let body = '[v1] initial';
    const fakeService = {
      getActiveTemplate: vi.fn(async () => body),
    };
    const out1 = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      rbacService: fakeService,
    });
    expect(out1).toContain('[v1] initial');

    body = '[v2] edited at admin UI';
    const out2 = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      rbacService: fakeService,
    });
    expect(out2).toContain('[v2] edited at admin UI');
    expect(out2).not.toContain('[v1] initial');
  });

  // AC-7 rip (2026-05-10) — P-Live-5 composer integration tests REMOVED.
  // The composer-was-called and composer-throws-gracefully tests pinned
  // behavior that violated spec §50 ("Three plain functions. No composer.")
  // and the 5,000-token cap (live: 8768 tokens). The composer call site
  // in getSystemPromptForRole is now gone; full PromptComposer file
  // deletion is Phase E.3.

  it('post-rip: composer dep is IGNORED (spec §50: "No registry. No composer.")', async () => {
    const fakeService = {
      getActiveTemplate: vi.fn(async () => '[DB-ADMIN] base body'),
    };

    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      rbacService: fakeService,
    });

    expect(out).toContain('[DB-ADMIN] base body');
    expect(out).toContain('<session-facts>');
    expect(out).not.toContain('<dynamic-modules>');
  });

  it('Sprint W.1 — no env var, no escape hatch: rbacService always hits DB', async () => {
    // Sprint W.1 (2026-05-19): USE_DB_PROMPT env var AND useDbPrompt flag are
    // both gone. DB is ALWAYS queried when rbacService is injected, period.
    const fakeService = {
      getActiveTemplate: vi.fn(async () => '[DB-ADMIN] always-queried'),
    };

    const out = await getSystemPromptForRole('admin', minCtx, {
      memoryRecall: async () => [],
      rbacService: fakeService,
    });

    expect(fakeService.getActiveTemplate).toHaveBeenCalledWith('admin');
    expect(out.startsWith('[DB-ADMIN] always-queried')).toBe(true);
  });
});
