/**
 * Sev-0 Bug A — defensive user-upsert in ChatStorageService.createSession.
 *
 * Live symptom: SSO token's `oid` (e.g. `66c199d9-...`) doesn't match any
 * `users.id` in DB, even though there's a user with the same email. The unified
 * auth middleware tries to remap, but only for tokenType='azure-ad' — local
 * tokens with OID-style userIds slip through, and ChatStorageService.createSession
 * throws "User <id> not found in database".
 *
 * Fix: when createSession is given a userEmail option AND the userId lookup
 * misses, defensively fall back to email-keyed lookup; if found, remap. If not
 * found and email is provided, upsert by email — this is a safe operation for
 * an authenticated user whose token has already been validated upstream.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma BEFORE importing ChatStorageService. The service imports
// `prisma` from utils/prisma.js — we replace that module with a vi.fn-backed
// mock so we control findUnique / findFirst / upsert behavior.
const mockUserFindUnique = vi.fn();
const mockUserFindFirst = vi.fn();
const mockUserUpsert = vi.fn();

vi.mock('../../utils/prisma.js', () => {
  const prismaMock = {
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
      findFirst: (...args: any[]) => mockUserFindFirst(...args),
      upsert: (...args: any[]) => mockUserUpsert(...args),
    },
    chatSession: {
      count: vi.fn().mockResolvedValue(0),
    },
    $on: vi.fn(),
  };
  return {
    prisma: prismaMock,
    prismaBase: { $on: vi.fn(), $connect: vi.fn(), $queryRaw: vi.fn() },
  };
});

// Mock the SimpleChatSessionRepository to avoid hitting any real DB plumbing.
vi.mock('../../repositories/SimpleChatSessionRepository.js', () => ({
  SimpleChatSessionRepository: class {
    constructor(_p: any, _l: any, _c: boolean) {}
    create = vi.fn().mockImplementation(async (data: any) => ({
      id: data.id,
      title: data.title,
      user_id: data.userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      message_count: 0,
      is_active: true,
      total_tokens: 0,
      total_cost: 0,
      model: data.model,
    }));
  },
}));

// Mock title generation client (it doesn't matter for this test).
vi.mock('../TitleGenerationClient.js', () => ({
  TitleGenerationClient: class {
    constructor(_l: any, _c: any) {}
  },
}));
vi.mock('../AITitleGenerationService.js', () => ({
  AITitleGenerationService: class {
    constructor(_l: any, _c: any, _t: any) {}
  },
}));

import { ChatStorageService } from '../ChatStorageService.js';

const NOOP_LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => NOOP_LOGGER,
};

describe('Sev-0 A — ChatStorageService.createSession defensive user upsert', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserFindFirst.mockReset();
    mockUserUpsert.mockReset();
  });

  it('upserts user by email when token-oid userId is not in DB but email is given', async () => {
    const TOKEN_OID = '66c199d9-4a52-4f04-a29c-7c02911307d4';
    const DB_USER_ID = '65e27ed0-9069-4ec8-8fb4-e48b5185609e';
    const USER_EMAIL = 'mcp-tester@openagentic.local';

    // findUnique by id MISSES (this is the live bug)
    mockUserFindUnique.mockResolvedValue(null);
    // findFirst by email HITS — we have an existing DB user under a different id
    mockUserFindFirst.mockResolvedValue({
      id: DB_USER_ID,
      email: USER_EMAIL,
    });
    mockUserUpsert.mockResolvedValue({ id: DB_USER_ID, email: USER_EMAIL });

    const svc = new ChatStorageService({}, NOOP_LOGGER);
    // Should NOT throw — should fall back to email lookup.
    const sessionId = await svc.createSession(TOKEN_OID, {
      sessionId: 'sess-1',
      title: 'Test',
      model: 'gpt-5.4',
      userEmail: USER_EMAIL,
    } as any);

    expect(sessionId).toBe('sess-1');
    // Either findFirst-by-email hit OR upsert-by-email was called — both are
    // valid recovery paths; what matters is createSession did NOT throw.
    const recovered =
      mockUserFindFirst.mock.calls.length > 0 || mockUserUpsert.mock.calls.length > 0;
    expect(recovered).toBe(true);
  });

  it('still throws when no userEmail provided and userId is missing (no regression)', async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const svc = new ChatStorageService({}, NOOP_LOGGER);

    await expect(
      svc.createSession('unknown-id', {
        sessionId: 'sess-2',
        title: 'Test',
        model: 'gpt-5.4',
      } as any),
    ).rejects.toThrow(/not found in database/);
  });
});
