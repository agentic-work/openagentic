/**
 * Regression tests for the RBAC role-gate factory `authorize`.
 *
 * These tests are security-sensitive: they pin the FAIL-CLOSED behavior of the
 * middleware. The factory must:
 *   - reject when there is no authenticated user (401), never fall through to allow;
 *   - deny (403 'Insufficient permissions') when the user lacks every required role;
 *   - pass (return without sending) only when the user actually holds a required
 *     role, including the case-insensitive `role.toLowerCase()` match;
 *   - treat an empty `requiredRoles` list as role-optional for an authenticated
 *     user, while STILL 401-ing an unauthenticated one;
 *   - fail closed with a 500 on an unexpected throw — never silently allow.
 *
 * If any fail-closed check is flipped to fail-open (e.g. the `!user` guard is
 * dropped, the `!hasRequiredRole` deny is inverted, or the catch block falls
 * through without a reply), the corresponding test here MUST go red.
 *
 * The middleware has no external dependencies (DB/Prisma/redis/network), so the
 * only collaborators are the Fastify `request`/`reply` objects, which we fake
 * with recording spies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authorize } from '../authorization.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { UserContext } from '../../auth/types.js';

/**
 * Build a fake FastifyReply that records every `.code()` / `.send()` call so a
 * test can assert exactly what the middleware emitted (status + body) and that
 * it emitted at most once. `.code()` returns `this` so the real
 * `reply.code(n).send(body)` chain works.
 */
function makeReply() {
  const calls: { code: number | null; body: unknown }[] = [];
  let pendingCode: number | null = null;

  const reply = {
    code: vi.fn((status: number) => {
      pendingCode = status;
      return reply;
    }),
    send: vi.fn(async (body: unknown) => {
      calls.push({ code: pendingCode, body });
      pendingCode = null;
      return reply;
    }),
  };

  return {
    reply: reply as unknown as FastifyReply,
    /** All (code, body) pairs that were actually sent, in order. */
    calls,
    sendSpy: reply.send,
    codeSpy: reply.code,
  };
}

/**
 * Build a fake FastifyRequest carrying an optional `user` (the shape the real
 * token validator attaches) and a `log.error` spy used by the catch branch.
 */
function makeRequest(user: UserContext | undefined) {
  const logError = vi.fn();
  const request = {
    user,
    log: { error: logError },
  };
  return {
    request: request as unknown as FastifyRequest,
    logError,
  };
}

function user(roles?: string[]): UserContext {
  return {
    userId: 'u-1',
    tenantId: 't-1',
    email: 'someone@openagentic.local',
    roles,
  };
}

describe('authorize — RBAC role-gate factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('(1) no request.user → 401, must reject not allow', () => {
    it('sends 401 Unauthorized when no user is attached', async () => {
      const { request } = makeRequest(undefined);
      const { reply, calls } = makeReply();

      const result = await authorize(['admin'])(request, reply);

      // It MUST have sent a 401 — the unauthenticated request is rejected.
      expect(calls).toEqual([
        {
          code: 401,
          body: { error: 'Unauthorized', message: 'User not authenticated' },
        },
      ]);
      // The middleware returns void in all paths; the load-bearing signal is
      // the reply it sent, not the return value.
      expect(result).toBeUndefined();
    });

    it('does NOT fall through to the role check (no 403/allow) for a missing user', async () => {
      // If the `!user` guard were dropped, `user.roles` would throw and we'd
      // hit the 500 catch — OR worse, an empty-roles gate would allow. Pin
      // that a missing user yields EXACTLY one reply and it is the 401.
      const { request } = makeRequest(undefined);
      const { reply, calls, sendSpy } = makeReply();

      await authorize([])(request, reply); // even with no required roles

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([
        {
          code: 401,
          body: { error: 'Unauthorized', message: 'User not authenticated' },
        },
      ]);
    });
  });

  describe('(2) user lacking every required role → 403 Insufficient permissions', () => {
    it('denies with 403 when the user holds none of the required roles', async () => {
      const { request } = makeRequest(user(['viewer', 'editor']));
      const { reply, calls } = makeReply();

      await authorize(['admin', 'superuser'])(request, reply);

      expect(calls).toEqual([
        {
          code: 403,
          body: { error: 'Forbidden', message: 'Insufficient permissions' },
        },
      ]);
    });

    it('denies with 403 when the user has an empty roles array', async () => {
      const { request } = makeRequest(user([]));
      const { reply, calls } = makeReply();

      await authorize(['admin'])(request, reply);

      expect(calls).toEqual([
        {
          code: 403,
          body: { error: 'Forbidden', message: 'Insufficient permissions' },
        },
      ]);
    });

    it('denies with 403 when roles is undefined (defaults to [] then fails the gate)', async () => {
      // user.roles is optional; the middleware coalesces to [] and must then
      // deny rather than throw or allow.
      const { request } = makeRequest(user(undefined));
      const { reply, calls } = makeReply();

      await authorize(['admin'])(request, reply);

      expect(calls).toEqual([
        {
          code: 403,
          body: { error: 'Forbidden', message: 'Insufficient permissions' },
        },
      ]);
    });

    it('case sensitivity is one-directional: a lowercase required role does NOT match an uppercase held role', async () => {
      // The match only lowercases the *required* role, not the *held* role.
      // So required 'admin' vs held 'ADMIN' must NOT match — pin this so the
      // gate is not loosened into a full case-insensitive compare by accident.
      const { request } = makeRequest(user(['ADMIN']));
      const { reply, calls } = makeReply();

      await authorize(['admin'])(request, reply);

      expect(calls).toEqual([
        {
          code: 403,
          body: { error: 'Forbidden', message: 'Insufficient permissions' },
        },
      ]);
    });
  });

  describe('(3) user has at least one required role → passes (no reply sent)', () => {
    it('passes with an exact role match', async () => {
      const { request } = makeRequest(user(['admin']));
      const { reply, sendSpy, codeSpy } = makeReply();

      const result = await authorize(['admin'])(request, reply);

      // PASS = the middleware sent NOTHING (no code, no body); the route runs.
      expect(sendSpy).not.toHaveBeenCalled();
      expect(codeSpy).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('passes when the user holds at least one of several required roles', async () => {
      const { request } = makeRequest(user(['editor']));
      const { reply, sendSpy } = makeReply();

      await authorize(['admin', 'editor', 'superuser'])(request, reply);

      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('passes via the case-insensitive role.toLowerCase() match (held lowercase, required mixed-case)', async () => {
      // Required role 'Admin' is lowercased to 'admin' and matched against the
      // held lowercase role 'admin'. This is the only case-insensitive seam in
      // the gate; if `role.toLowerCase()` were removed, this test goes red.
      const { request } = makeRequest(user(['admin']));
      const { reply, sendSpy, codeSpy } = makeReply();

      await authorize(['Admin'])(request, reply);

      expect(sendSpy).not.toHaveBeenCalled();
      expect(codeSpy).not.toHaveBeenCalled();
    });

    it('passes for a fully upper-cased required role when the held role is lowercase', async () => {
      const { request } = makeRequest(user(['superuser']));
      const { reply, sendSpy } = makeReply();

      await authorize(['SUPERUSER'])(request, reply);

      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('(4) empty requiredRoles [] is role-optional for an authed user but still 401s the unauthed', () => {
    it('an AUTHENTICATED user with no roles passes when requiredRoles is []', async () => {
      const { request } = makeRequest(user([]));
      const { reply, sendSpy, codeSpy } = makeReply();

      await authorize([])(request, reply);

      // No role requirement → the authenticated user is allowed through.
      expect(sendSpy).not.toHaveBeenCalled();
      expect(codeSpy).not.toHaveBeenCalled();
    });

    it('the default (no-arg) factory is also role-optional for an authed user', async () => {
      const { request } = makeRequest(user(['anything']));
      const { reply, sendSpy } = makeReply();

      await authorize()(request, reply); // default requiredRoles = []

      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('an UNAUTHENTICATED request still 401s even with an empty requiredRoles []', async () => {
      // The role-optional path must NOT relax the authentication requirement.
      const { request } = makeRequest(undefined);
      const { reply, calls } = makeReply();

      await authorize([])(request, reply);

      expect(calls).toEqual([
        {
          code: 401,
          body: { error: 'Unauthorized', message: 'User not authenticated' },
        },
      ]);
    });
  });

  describe('(5) unexpected throw → 500, fails closed (never allows)', () => {
    it('sends 500 and never allows when an internal error is thrown after auth', async () => {
      // Force a throw from inside the try block by making `reply.code` throw
      // the FIRST time it is invoked (the 403 deny path), then succeed on the
      // 500 path so we can observe the fail-closed reply. This proves the
      // catch block fails closed: it emits a 500 rather than letting the
      // request proceed.
      const { request, logError } = makeRequest(user(['viewer']));

      const sent: { code: number | null; body: unknown }[] = [];
      let pendingCode: number | null = null;
      let firstCode = true;
      const reply = {
        code: vi.fn((status: number) => {
          if (firstCode) {
            firstCode = false;
            throw new Error('boom — reply.code blew up mid-deny');
          }
          pendingCode = status;
          return reply;
        }),
        send: vi.fn(async (body: unknown) => {
          sent.push({ code: pendingCode, body });
          pendingCode = null;
          return reply;
        }),
      } as any;

      // This routes into the 403 branch (viewer lacks 'admin'), where the
      // FIRST reply.code throws → caught → 500.
      const result = await authorize(['admin'])(request, reply as FastifyReply);

      // It must have logged the error and emitted exactly one reply: the 500.
      expect(logError).toHaveBeenCalledTimes(1);
      expect(sent).toEqual([
        {
          code: 500,
          body: { error: 'Internal Server Error', message: 'Failed to authorize' },
        },
      ]);
      // And it must NOT have silently allowed (no successful 403 was sent, and
      // the function returned void without proceeding past the reply).
      expect(result).toBeUndefined();
    });

    it('the catch block sends a 500 reply rather than throwing out of the middleware', async () => {
      // If the catch were removed / fell through, the rejected promise would
      // propagate and Fastify would have to 500 it — but the middleware must
      // own the fail-closed 500 itself. Make `reply.code` throw on the 401
      // path to drive the catch.
      const { request, logError } = makeRequest(undefined);

      const sent: { code: number | null; body: unknown }[] = [];
      let pendingCode: number | null = null;
      let firstCode = true;
      const reply = {
        code: vi.fn((status: number) => {
          if (firstCode) {
            firstCode = false;
            throw new Error('boom — reply.code blew up on the 401 path');
          }
          pendingCode = status;
          return reply;
        }),
        send: vi.fn(async (body: unknown) => {
          sent.push({ code: pendingCode, body });
          pendingCode = null;
          return reply;
        }),
      } as any;

      // Must resolve (not reject) — the middleware fails closed internally.
      await expect(
        authorize(['admin'])(request, reply as FastifyReply),
      ).resolves.toBeUndefined();

      expect(logError).toHaveBeenCalledTimes(1);
      expect(sent).toEqual([
        {
          code: 500,
          body: { error: 'Internal Server Error', message: 'Failed to authorize' },
        },
      ]);
    });
  });
});
