/**
 * Regression coverage for tokenValidator.ts — the SECURITY branches.
 *
 * Companion to tokenValidator-jwt-secret.test.ts (which only pins the
 * module-load JWT_SECRET policy). This file exercises the actual
 * validateAnyToken / validateApiKey decision logic, with a strong bias
 * toward the FAIL-CLOSED negative branches: every test below is written so
 * that flipping a fail-closed check to fail-open (or dropping an auth gate)
 * turns the test RED.
 *
 * External deps are mocked — no live DB / bcrypt-against-real-hash / network:
 *   - ../../utils/prisma.js  → prisma.apiKey.{findMany,update}
 *   - bcrypt                 → bcrypt.compare
 *
 * jsonwebtoken is REAL: the HS256 algorithm pin and signature verification
 * are the security property under test, so we sign real tokens with the
 * known test JWT_SECRET and let jwt.verify do its real work.
 *
 * NOTE on the env: src/test/setup.ts forces NODE_ENV='test'. tokenValidator
 * resolves JWT_SECRET at module-load: a non-production env with no real
 * JWT_SECRET falls back to a random ephemeral secret, which we could never
 * sign against. So we set a KNOWN JWT_SECRET *before* the module is imported
 * (the import is awaited inside beforeAll after stubbing the env).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const TEST_JWT_SECRET = 'tokenvalidator-coverage-known-secret-deadbeef0123456789';

// ---- prisma mock -----------------------------------------------------------
vi.mock('../../utils/prisma.js', () => {
  const mock = {
    apiKey: {
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  (globalThis as any).__prismaMock = mock;
  return { prisma: mock, prismaBase: mock, default: mock };
});

// ---- bcrypt mock -----------------------------------------------------------
// Default: every compare is a miss. Individual tests opt-in a match.
vi.mock('bcrypt', () => {
  const compare = vi.fn().mockResolvedValue(false);
  return { default: { compare }, compare };
});

import bcrypt from 'bcrypt';
const prismaMock = () => (globalThis as any).__prismaMock as {
  apiKey: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};
const bcryptCompare = bcrypt.compare as unknown as ReturnType<typeof vi.fn>;

// Imported in beforeAll AFTER the env is set so JWT_SECRET resolves to ours.
let validateAnyToken: typeof import('../tokenValidator.js')['validateAnyToken'];

beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
  vi.resetModules();
  const mod = await import('../tokenValidator.js');
  validateAnyToken = mod.validateAnyToken;
});

beforeEach(() => {
  vi.clearAllMocks();
  // re-establish post-clear defaults
  bcryptCompare.mockResolvedValue(false);
  prismaMock().apiKey.update.mockResolvedValue({});
});

// A valid baseline local-JWT user (so positive controls confirm our secret works).
const signLocal = (payload: Record<string, any>) =>
  jwt.sign(payload, TEST_JWT_SECRET, { algorithm: 'HS256' });

describe('validateAnyToken — local JWT security branches', () => {
  it('positive control: a properly HS256-signed token with userId validates', async () => {
    const token = signLocal({ userId: 'u1', email: 'u1@local' });
    const res = await validateAnyToken(token);
    expect(res.isValid).toBe(true);
    expect(res.tokenType).toBe('local');
    expect(res.user?.userId).toBe('u1');
  });

  // (1) algorithms:['HS256'] pin — alg:'none' must be REJECTED.
  it('(1a) rejects an unsigned alg:none token (HS256 pin, not fail-open)', async () => {
    // jwt.sign with algorithm:'none' produces header {"alg":"none"} and empty sig.
    const noneToken = jwt.sign(
      { userId: 'attacker', isAdmin: true },
      '',
      { algorithm: 'none' },
    );
    const res = await validateAnyToken(noneToken);
    expect(res.isValid).toBe(false);
    expect(res.user).toBeUndefined();
  });

  // (1) algorithms:['HS256'] pin — an RS256-shaped token must be REJECTED,
  //     NOT silently accepted via algorithm confusion.
  it('(1b) rejects an RS256 token — algorithm not in the HS256 allow-list', async () => {
    // Forge a token whose header claims RS256. Crucially we do NOT provide an
    // RSA key; the point is that even a *validly* RS256-signed token is barred
    // because the verifier pins algorithms:['HS256']. We hand-craft an RS256
    // header so jwt.verify rejects on the algorithm mismatch.
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ userId: 'attacker', isAdmin: true })).toString('base64url');
    // Sign the RS256-headered content with the HS256 secret bytes — a classic
    // algorithm-confusion forgery. With the HS256 pin this MUST be rejected.
    const crypto = await import('crypto');
    const sig = crypto
      .createHmac('sha256', TEST_JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');
    const confusedToken = `${header}.${body}.${sig}`;

    const res = await validateAnyToken(confusedToken);
    expect(res.isValid).toBe(false);
    expect(res.user).toBeUndefined();
  });

  // (2) payload missing userId -> {isValid:false, 'missing userId'}.
  it('(2) rejects a validly-signed token that has NO userId claim', async () => {
    const token = signLocal({ email: 'no-id@local', isAdmin: true });
    const res = await validateAnyToken(token);
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/missing userId/i);
    expect(res.tokenType).toBe('local');
    expect(res.user).toBeUndefined();
  });

  // (3) requireAdmin:true with a non-admin user -> blocked (privilege-escalation gate).
  it('(3) requireAdmin blocks a valid NON-admin local user (no privilege escalation)', async () => {
    const token = signLocal({ userId: 'plain-user', isAdmin: false });
    const res = await validateAnyToken(token, { requireAdmin: true });
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/Administrator access required/i);
    // And without requireAdmin the very same token IS valid — proves the gate
    // is what blocked it, not a broken token.
    const open = await validateAnyToken(token);
    expect(open.isValid).toBe(true);
    expect(open.user?.isAdmin).toBe(false);
  });

  // (4) is_admin (snake_case) AND isAdmin (camelCase) both -> roles:['admin'].
  it('(4a) snake_case is_admin:true maps to isAdmin + roles:[admin] and passes requireAdmin', async () => {
    const token = signLocal({ userId: 'admin-snake', is_admin: true });
    const res = await validateAnyToken(token, { requireAdmin: true });
    expect(res.isValid).toBe(true);
    expect(res.user?.isAdmin).toBe(true);
    expect(res.user?.roles).toEqual(['admin']);
  });

  it('(4b) camelCase isAdmin:true maps to isAdmin + roles:[admin] and passes requireAdmin', async () => {
    const token = signLocal({ userId: 'admin-camel', isAdmin: true });
    const res = await validateAnyToken(token, { requireAdmin: true });
    expect(res.isValid).toBe(true);
    expect(res.user?.isAdmin).toBe(true);
    expect(res.user?.roles).toEqual(['admin']);
  });

  it('(4c) neither admin flag -> roles:[] (no accidental admin grant)', async () => {
    const token = signLocal({ userId: 'nobody' });
    const res = await validateAnyToken(token);
    expect(res.isValid).toBe(true);
    expect(res.user?.isAdmin).toBe(false);
    expect(res.user?.roles).toEqual([]);
  });

  // (5) jwt.verify throw (expired / tampered sig) -> fail-closed {isValid:false}.
  it('(5a) an EXPIRED token fails closed (jwt.verify throws TokenExpiredError)', async () => {
    const expired = jwt.sign(
      { userId: 'u-exp' },
      TEST_JWT_SECRET,
      { algorithm: 'HS256', expiresIn: -10 }, // already expired
    );
    const res = await validateAnyToken(expired);
    expect(res.isValid).toBe(false);
    expect(res.tokenType).toBe('local');
    expect(res.user).toBeUndefined();
  });

  it('(5b) a token signed with the WRONG secret fails closed (tampered/invalid signature)', async () => {
    const forged = jwt.sign({ userId: 'u-forged', isAdmin: true }, 'a-different-secret', {
      algorithm: 'HS256',
    });
    const res = await validateAnyToken(forged);
    expect(res.isValid).toBe(false);
    expect(res.user).toBeUndefined();
  });

  it('(5c) garbage / malformed token fails closed (no throw escapes)', async () => {
    const res = await validateAnyToken('not.a.jwt');
    expect(res.isValid).toBe(false);
    expect(res.user).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// API-KEY path (oa_ prefix routes to validateApiKey).
// ---------------------------------------------------------------------------

// Build a fake DB row in the include-shape the validator expects.
const dbKeyRow = (over: Partial<any> = {}) => ({
  id: over.id ?? 'key-1',
  name: over.name ?? 'ci-key',
  key_hash: over.key_hash ?? '$2b$10$fakehashfakehashfakehashfakehashfakehashfa',
  is_active: over.is_active ?? true,
  expires_at: over.expires_at ?? null,
  last_used_at: over.last_used_at ?? null,
  user: over.user ?? {
    id: 'owner-1',
    email: 'owner@local',
    name: 'Owner',
    is_admin: false,
    groups: [],
  },
});

describe('validateApiKey — API-key security branches', () => {
  it('positive control: an oa_ key whose bcrypt hash matches returns a valid user', async () => {
    prismaMock().apiKey.findMany.mockResolvedValue([dbKeyRow()]);
    bcryptCompare.mockResolvedValue(true);

    const res = await validateAnyToken('oa_validlookingkeyvalidlookingkeyvalidlookingkey');
    expect(res.isValid).toBe(true);
    expect(res.tokenType).toBe('api-key');
    expect(res.apiKeyId).toBe('key-1');
    expect(res.user?.userId).toBe('owner-1');
    // last_used_at bookkeeping happened on the matched key.
    expect(prismaMock().apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'key-1' } }),
    );
  });

  // (6) expired key (expires_at < now) excluded by the OR filter — and
  // (7) is_active:false excluded — both enforced at the QUERY layer. We assert
  // the findMany WHERE clause carries the exclusion so a regression that drops
  // it (returning expired/inactive keys) fails here.
  it('(6+7) findMany WHERE pins is_active:true AND (expires_at null OR > now) — excludes expired+inactive', async () => {
    prismaMock().apiKey.findMany.mockResolvedValue([]);
    bcryptCompare.mockResolvedValue(true); // even if compare would match, no rows are returned

    const before = new Date();
    await validateAnyToken('oa_somekeysomekeysomekeysomekeysomekeysome');
    const after = new Date();

    expect(prismaMock().apiKey.findMany).toHaveBeenCalledTimes(1);
    const arg = prismaMock().apiKey.findMany.mock.calls[0][0];
    // is_active gate
    expect(arg.where.is_active).toBe(true);
    // expiry OR gate: one branch null, one branch gt:<a Date ~ now>
    expect(Array.isArray(arg.where.OR)).toBe(true);
    expect(arg.where.OR).toEqual(
      expect.arrayContaining([{ expires_at: null }]),
    );
    const gtBranch = arg.where.OR.find((c: any) => c.expires_at && c.expires_at.gt);
    expect(gtBranch).toBeTruthy();
    expect(gtBranch.expires_at.gt instanceof Date).toBe(true);
    // the gt boundary is "now" — i.e. expired keys (expires_at < now) cannot pass
    const gt = gtBranch.expires_at.gt.getTime();
    expect(gt).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(gt).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it('(7b) an is_active:false / expired row never matched (empty result set) -> Invalid or inactive', async () => {
    // Simulate the DB having ONLY excluded rows: the filter returns [].
    prismaMock().apiKey.findMany.mockResolvedValue([]);
    const res = await validateAnyToken('oa_inactiveorexpiredkeyinactiveorexpiredkey');
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/Invalid or inactive API key/i);
    expect(res.user).toBeUndefined();
    // never wrote last_used_at for a non-match
    expect(prismaMock().apiKey.update).not.toHaveBeenCalled();
  });

  // (8) bcrypt.compare mismatch across ALL keys -> 'Invalid or inactive API key'.
  it('(8) bcrypt mismatch on every candidate key -> Invalid or inactive (fail-closed, not first-row accept)', async () => {
    prismaMock().apiKey.findMany.mockResolvedValue([
      dbKeyRow({ id: 'k-a' }),
      dbKeyRow({ id: 'k-b' }),
      dbKeyRow({ id: 'k-c' }),
    ]);
    bcryptCompare.mockResolvedValue(false); // miss on all

    const res = await validateAnyToken('oa_doesnotmatchanykeydoesnotmatchanykey');
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/Invalid or inactive API key/i);
    expect(res.user).toBeUndefined();
    // compared against EVERY stored hash (no early accept)
    expect(bcryptCompare).toHaveBeenCalledTimes(3);
    expect(prismaMock().apiKey.update).not.toHaveBeenCalled();
  });

  // (9) requireAdmin on a non-admin API-key user -> blocked.
  it('(9) requireAdmin blocks an API key whose owner is NOT admin', async () => {
    prismaMock().apiKey.findMany.mockResolvedValue([
      dbKeyRow({ user: { id: 'u', email: 'u@local', name: 'U', is_admin: false, groups: [] } }),
    ]);
    bcryptCompare.mockResolvedValue(true);

    const res = await validateAnyToken('oa_nonadminkeynonadminkeynonadminkeynonadmin', {
      requireAdmin: true,
    });
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/Administrator access required/i);
    expect(res.user).toBeUndefined();
  });

  it('(9b) requireAdmin ALLOWS an API key whose owner IS admin (gate is owner-driven)', async () => {
    prismaMock().apiKey.findMany.mockResolvedValue([
      dbKeyRow({
        id: 'k-admin',
        user: { id: 'a', email: 'a@local', name: 'A', is_admin: true, groups: [] },
      }),
    ]);
    bcryptCompare.mockResolvedValue(true);

    const res = await validateAnyToken('oa_adminkeyadminkeyadminkeyadminkeyadminkey', {
      requireAdmin: true,
    });
    expect(res.isValid).toBe(true);
    expect(res.user?.isAdmin).toBe(true);
    expect(res.user?.roles).toEqual(['admin']);
  });

  // (10) DB throw -> fail-closed catch, NOT allow.
  it('(10) a DB/Prisma throw fails CLOSED (catch returns isValid:false, never allow)', async () => {
    prismaMock().apiKey.findMany.mockRejectedValue(new Error('connection refused'));
    bcryptCompare.mockResolvedValue(true); // would have matched — must not matter

    const res = await validateAnyToken('oa_anykeyanykeyanykeyanykeyanykeyanykeyany');
    expect(res.isValid).toBe(false);
    expect(res.user).toBeUndefined();
    expect(res.tokenType).toBe('api-key');
    expect(res.error).toMatch(/API key validation failed/i);
  });

  it('(routing) oa_sys_ inter-service prefix also routes to the API-key path', async () => {
    prismaMock().apiKey.findMany.mockResolvedValue([dbKeyRow({ id: 'sys-key' })]);
    bcryptCompare.mockResolvedValue(true);

    const res = await validateAnyToken('oa_sys_internalsysinternalsysinternalsysintern');
    expect(res.tokenType).toBe('api-key');
    expect(res.isValid).toBe(true);
    expect(res.apiKeyId).toBe('sys-key');
  });
});
