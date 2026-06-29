/**
 * Regression tests for the Row-Level Security context middleware
 * (src/middleware/rls-context.ts → rlsContextHook).
 *
 * RLS context (NIST 800-53 AC-4) is a fail-CLOSED, defense-in-depth seam: it
 * stamps `app.current_user_id` on the connection so the DB enforces per-user
 * isolation even if app-level authz is bypassed. These tests pin the
 * security-load-bearing branches so the suite FAILS if any of them regress:
 *
 *   (1) No request.user / missing userId  -> early return no-op. An
 *       unauthenticated request (health check) MUST NOT set any RLS context.
 *       If this regressed to setting a context, an unauthenticated request
 *       could leak the wrong user's rows.
 *   (2) Admin user -> rlsUserId === '__system__' (the RLS bypass). A NON-admin
 *       must NEVER be mapped to '__system__' (that would be a full RLS bypass
 *       / privilege escalation). Both branches are pinned.
 *   (3) Quote-escaping: a userId containing a single quote must be doubled
 *       ('' ) so the emitted `SET LOCAL` is injection-safe. We assert the
 *       EXACT string handed to $executeRawUnsafe.
 *   (4) $executeRawUnsafe throws -> the hook catches, logs a warn, and does
 *       NOT rethrow. The request proceeds and the DB denies-by-default
 *       (fail-closed). If this regressed to rethrowing, every request would
 *       500 when the DB hiccuped; if it regressed to NOT logging, the failure
 *       would be silent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- Mock the DB seam: prisma.$executeRawUnsafe -------------------------
// We never touch a live database; the mock lets us assert the exact SQL
// string and simulate throws.
const executeRawUnsafeMock = vi.fn<(sql: string) => Promise<unknown>>();

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    $executeRawUnsafe: (...args: unknown[]) =>
      executeRawUnsafeMock(args[0] as string),
  },
}));

// ---- Mock the logger seam: loggers.auth.warn ----------------------------
const warnMock = vi.fn();

vi.mock('../../utils/logger.js', () => ({
  loggers: {
    auth: {
      warn: (...args: unknown[]) => warnMock(...args),
    },
  },
}));

// Import AFTER the mocks are registered (hoisted by vitest, but keep the
// import below for clarity / ordering intent).
import { rlsContextHook } from '../rls-context.js';

// Minimal Fastify request/reply doubles. The hook only reads request.user.
function makeRequest(user: unknown): any {
  return { user };
}
const reply: any = {};

beforeEach(() => {
  executeRawUnsafeMock.mockReset();
  executeRawUnsafeMock.mockResolvedValue(1);
  warnMock.mockReset();
});

describe('rlsContextHook — unauthenticated / no userId (fail-closed no-op)', () => {
  it('does NOT set any RLS context when request.user is undefined (health check)', async () => {
    await rlsContextHook(makeRequest(undefined), reply);
    // The whole point: an unauthenticated request must never stamp a context.
    expect(executeRawUnsafeMock).not.toHaveBeenCalled();
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('does NOT set any RLS context when request.user has no userId', async () => {
    // A user object that lacks userId (e.g. a partial/anonymous principal)
    // must be treated as unauthenticated — NOT silently mapped to anything.
    await rlsContextHook(makeRequest({ isAdmin: true, email: 'x@y.z' }), reply);
    expect(executeRawUnsafeMock).not.toHaveBeenCalled();
  });

  it('treats an empty-string userId as unauthenticated (no context set)', async () => {
    // '' is falsy — the optional-chain `user?.userId` guard must reject it so
    // we never emit `SET LOCAL ... = ''` which would map to a degenerate
    // empty principal.
    await rlsContextHook(makeRequest({ userId: '' }), reply);
    expect(executeRawUnsafeMock).not.toHaveBeenCalled();
  });
});

describe('rlsContextHook — admin bypass vs non-admin isolation', () => {
  it('maps an admin user to the __system__ RLS-bypass context', async () => {
    await rlsContextHook(
      makeRequest({ userId: 'admin-123', isAdmin: true }),
      reply,
    );
    expect(executeRawUnsafeMock).toHaveBeenCalledTimes(1);
    const sql = executeRawUnsafeMock.mock.calls[0][0];
    expect(sql).toBe(`SET LOCAL "app.current_user_id" = '__system__'`);
  });

  it('NEVER maps a non-admin user to __system__ — uses their own userId', async () => {
    // Privilege-escalation guard: a regular user must get THEIR id, not the
    // admin bypass token. If the isAdmin check were dropped/flipped, this fails.
    await rlsContextHook(
      makeRequest({ userId: 'user-456', isAdmin: false }),
      reply,
    );
    expect(executeRawUnsafeMock).toHaveBeenCalledTimes(1);
    const sql = executeRawUnsafeMock.mock.calls[0][0];
    expect(sql).toBe(`SET LOCAL "app.current_user_id" = 'user-456'`);
    expect(sql).not.toContain('__system__');
  });

  it('treats a missing isAdmin flag as non-admin (no implicit bypass)', async () => {
    // Absence of isAdmin must default to the user's own scope, never the
    // bypass. `undefined` is falsy, so rlsUserId === userId.
    await rlsContextHook(makeRequest({ userId: 'user-789' }), reply);
    const sql = executeRawUnsafeMock.mock.calls[0][0];
    expect(sql).toBe(`SET LOCAL "app.current_user_id" = 'user-789'`);
    expect(sql).not.toContain('__system__');
  });

  it('does NOT treat a truthy-but-non-true isAdmin as admin only by coercion (string "true")', async () => {
    // Document the JS truthiness contract the hook relies on: any truthy
    // isAdmin yields the bypass. This pins that the bypass is gated on
    // truthiness of isAdmin and on nothing else (e.g. not on email/role).
    await rlsContextHook(
      makeRequest({ userId: 'u-1', isAdmin: 'true', role: 'user' }),
      reply,
    );
    const sql = executeRawUnsafeMock.mock.calls[0][0];
    expect(sql).toBe(`SET LOCAL "app.current_user_id" = '__system__'`);
  });
});

describe('rlsContextHook — SQL injection safety (quote escaping)', () => {
  it("doubles single quotes in the userId so the SET LOCAL is injection-safe", async () => {
    // Classic injection payload smuggled into the principal id. The hook must
    // double every single quote (' -> '') so the value stays a single string
    // literal and the trailing `DROP` text is inert.
    const malicious = "a'; DROP TABLE users; --";
    await rlsContextHook(
      makeRequest({ userId: malicious, isAdmin: false }),
      reply,
    );

    expect(executeRawUnsafeMock).toHaveBeenCalledTimes(1);
    const sql = executeRawUnsafeMock.mock.calls[0][0];

    // Exact, fully-escaped string. Every ' in the payload is doubled.
    const expected =
      `SET LOCAL "app.current_user_id" = 'a''; DROP TABLE users; --'`;
    expect(sql).toBe(expected);

    // Defense-in-depth assertion: there must be NO un-doubled single quote
    // that would terminate the literal early. After removing all doubled
    // quotes, only the opening and closing literal quotes remain (2 total).
    const withoutDoubled = sql.replace(/''/g, '');
    const strayQuotes = (withoutDoubled.match(/'/g) || []).length;
    expect(strayQuotes).toBe(2);
  });

  it('escapes multiple/consecutive single quotes correctly', async () => {
    await rlsContextHook(
      makeRequest({ userId: "o''Brien'", isAdmin: false }),
      reply,
    );
    const sql = executeRawUnsafeMock.mock.calls[0][0];
    // Each of the 3 source quotes is independently doubled.
    expect(sql).toBe(`SET LOCAL "app.current_user_id" = 'o''''Brien'''`);
  });

  it('leaves a quote-free userId unchanged', async () => {
    await rlsContextHook(
      makeRequest({ userId: 'normal-user-id', isAdmin: false }),
      reply,
    );
    const sql = executeRawUnsafeMock.mock.calls[0][0];
    expect(sql).toBe(`SET LOCAL "app.current_user_id" = 'normal-user-id'`);
  });
});

describe('rlsContextHook — fail-closed error handling (swallow, do not rethrow)', () => {
  it('does NOT rethrow when $executeRawUnsafe throws — the request proceeds', async () => {
    executeRawUnsafeMock.mockRejectedValueOnce(
      new Error('connection terminated unexpectedly'),
    );

    // The hook MUST resolve (not reject). If it rethrew, every request would
    // 500 on a transient DB error instead of relying on RLS deny-by-default.
    await expect(
      rlsContextHook(makeRequest({ userId: 'user-456' }), reply),
    ).resolves.toBeUndefined();
  });

  it('logs a warn (with userId + error message) when the SET LOCAL fails', async () => {
    executeRawUnsafeMock.mockRejectedValueOnce(
      new Error('connection terminated unexpectedly'),
    );

    await rlsContextHook(makeRequest({ userId: 'user-456' }), reply);

    // The failure must be observable — a silent swallow would hide a
    // fail-closed event that operators need to see.
    expect(warnMock).toHaveBeenCalledTimes(1);
    const [meta, msg] = warnMock.mock.calls[0];
    expect(meta).toMatchObject({
      userId: 'user-456',
      error: 'connection terminated unexpectedly',
    });
    expect(String(msg)).toContain('[RLS]');
  });

  it('still swallows the error when an admin context fails to set', async () => {
    // The fail-closed contract holds for admins too — a failed __system__
    // set must not 500 the admin request.
    executeRawUnsafeMock.mockRejectedValueOnce(new Error('db down'));

    await expect(
      rlsContextHook(makeRequest({ userId: 'admin-1', isAdmin: true }), reply),
    ).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledTimes(1);
  });
});
