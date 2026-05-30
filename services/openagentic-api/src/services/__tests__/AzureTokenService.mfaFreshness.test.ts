/**
 * Sev-1 #789 — Azure MFA freshness on cached OBO tokens.
 *
 * Bug:
 *   The first Azure MCP Update/Delete call against ARM works because the
 *   user just signed in (auth_time is fresh). The second/third call uses
 *   the same DB-persisted access_token whose `exp` is still > now but whose
 *   `auth_time` (the moment MFA was last performed) is older than the
 *   Conditional-Access freshness window. AAD returns 401 with a
 *   claims-challenge requiring fresh MFA. Our cache layer treats the token
 *   as valid (because exp hasn't passed) and re-hands the stale token to
 *   mcp-proxy, which then bubbles up "MFA required" / 401 to the chat
 *   pipeline. Blocks U/D after the first action in a session.
 *
 * Decision — Option A: freshness-aware cache.
 *   `getOrRefreshToken` checks BOTH `exp` and `auth_time`. If `auth_time` is
 *   older than `AZURE_OBO_MFA_FRESHNESS_MINUTES` (default 30 min), the token
 *   is treated as expired and a refresh is attempted. If refresh succeeds
 *   the freshly-issued token (with a new `auth_time` if MFA was re-prompted)
 *   is returned; otherwise the stale token is surfaced as expired so the
 *   caller can re-auth instead of failing opaquely at AAD.
 *
 *   30 min is the default because typical Conditional Access MFA-freshness
 *   policies sit at 1-4 hours; 30 min keeps us comfortably inside that
 *   window so the refresh fires BEFORE AAD challenges us, without thrashing
 *   on short admin sessions.
 *
 *   NO MFA BYPASS. The freshness check is in front of `refreshToken()`,
 *   which still goes through MSAL.acquireTokenByRefreshToken — AAD remains
 *   the source of truth for whether the user must re-MFA.
 *
 * Per CLAUDE.md TDD discipline: RED first, GREEN after the AzureTokenService
 * change. Real-provider validation deferred to live verify (mcp-tester →
 * Azure MCP Update calls back-to-back).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const findUniqueMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const upsertMock = vi.hoisted(() => vi.fn());
const deleteManyMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    userAuthToken: {
      findUnique: findUniqueMock,
      update: updateMock,
      upsert: upsertMock,
      deleteMany: deleteManyMock,
    },
  },
}));

vi.mock('../../utils/validateAzureToken.js', () => ({
  validateAzureToken: vi.fn(() => ({ isValid: true, issues: [] })),
  logTokenValidation: vi.fn(() => true),
}));

const acquireTokenByRefreshTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: vi.fn().mockImplementation(() => ({
    acquireTokenByRefreshToken: acquireTokenByRefreshTokenMock,
  })),
}));

// Import after mocks
import { AzureTokenService } from '../AzureTokenService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeLogger() {
  const logger: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  };
  logger.child = () => logger;
  return logger;
}

/**
 * Build a base64url-encoded JWT payload-only token (no signature verification
 * happens here — AzureTokenService only base64-decodes the middle segment).
 */
function makeJwtWithClaims(payload: Record<string, any>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = 'fakesig';
  return `${header}.${body}.${sig}`;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('AzureTokenService — MFA freshness on cached OBO tokens (Sev-1 #789)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AZURE_OBO_MFA_FRESHNESS_MINUTES;
    process.env.AZURE_CLIENT_ID = 'test-client-id';
    process.env.AZURE_CLIENT_SECRET = 'test-client-secret';
    process.env.AZURE_TENANT_ID = 'test-tenant-id';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes when access_token.exp is still future but auth_time is older than the freshness window', async () => {
    // Token was issued 45 min ago (auth_time), expires in 15 min (exp).
    // Default freshness window is 30 min → stale.
    const nowSec = Math.floor(Date.now() / 1000);
    const staleAuthTime = nowSec - 45 * 60;
    const futureExp = nowSec + 15 * 60;

    const staleToken = makeJwtWithClaims({
      aud: 'https://management.azure.com/',
      exp: futureExp,
      iat: staleAuthTime,
      auth_time: staleAuthTime,
      amr: ['pwd', 'mfa'],
    });

    findUniqueMock.mockResolvedValue({
      access_token: staleToken,
      id_token: undefined,
      refresh_token: 'real-refresh-token',
      expires_at: new Date(futureExp * 1000),
      scope: 'https://management.azure.com/.default',
    });

    const freshAuthTime = nowSec;
    const freshExp = nowSec + 60 * 60;
    const freshToken = makeJwtWithClaims({
      aud: 'https://management.azure.com/',
      exp: freshExp,
      iat: freshAuthTime,
      auth_time: freshAuthTime,
      amr: ['pwd', 'mfa'],
    });

    acquireTokenByRefreshTokenMock.mockResolvedValue({
      accessToken: freshToken,
      expiresOn: new Date(freshExp * 1000),
      refreshToken: 'new-refresh-token',
    });

    updateMock.mockResolvedValue({});

    const service = new AzureTokenService(makeLogger() as any);
    const result = await service.getOrRefreshToken('user-123');

    expect(acquireTokenByRefreshTokenMock).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe(freshToken);
    expect(result?.is_expired).toBe(false);
  });

  it('does NOT refresh when both exp AND auth_time are within the freshness window', async () => {
    // Token issued 5 min ago, expires in 55 min — well within default 30-min freshness.
    const nowSec = Math.floor(Date.now() / 1000);
    const freshAuthTime = nowSec - 5 * 60;
    const futureExp = nowSec + 55 * 60;

    const goodToken = makeJwtWithClaims({
      aud: 'https://management.azure.com/',
      exp: futureExp,
      iat: freshAuthTime,
      auth_time: freshAuthTime,
      amr: ['pwd', 'mfa'],
    });

    findUniqueMock.mockResolvedValue({
      access_token: goodToken,
      id_token: undefined,
      refresh_token: 'real-refresh-token',
      expires_at: new Date(futureExp * 1000),
      scope: 'https://management.azure.com/.default',
    });

    const service = new AzureTokenService(makeLogger() as any);
    const result = await service.getOrRefreshToken('user-123');

    expect(acquireTokenByRefreshTokenMock).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe(goodToken);
    expect(result?.is_expired).toBe(false);
  });

  it('honors AZURE_OBO_MFA_FRESHNESS_MINUTES env override', async () => {
    // Token issued 10 min ago. With default 30 min → fresh. With override 5 min → stale.
    process.env.AZURE_OBO_MFA_FRESHNESS_MINUTES = '5';

    const nowSec = Math.floor(Date.now() / 1000);
    const authTime = nowSec - 10 * 60;
    const futureExp = nowSec + 50 * 60;

    const tokenAt10Min = makeJwtWithClaims({
      aud: 'https://management.azure.com/',
      exp: futureExp,
      iat: authTime,
      auth_time: authTime,
      amr: ['pwd', 'mfa'],
    });

    findUniqueMock.mockResolvedValue({
      access_token: tokenAt10Min,
      id_token: undefined,
      refresh_token: 'real-refresh-token',
      expires_at: new Date(futureExp * 1000),
      scope: 'https://management.azure.com/.default',
    });

    const freshExp = nowSec + 60 * 60;
    const freshToken = makeJwtWithClaims({
      aud: 'https://management.azure.com/',
      exp: freshExp,
      iat: nowSec,
      auth_time: nowSec,
      amr: ['pwd', 'mfa'],
    });

    acquireTokenByRefreshTokenMock.mockResolvedValue({
      accessToken: freshToken,
      expiresOn: new Date(freshExp * 1000),
      refreshToken: 'new-refresh-token',
    });
    updateMock.mockResolvedValue({});

    const service = new AzureTokenService(makeLogger() as any);
    const result = await service.getOrRefreshToken('user-123');

    expect(acquireTokenByRefreshTokenMock).toHaveBeenCalledTimes(1);
    expect(result?.access_token).toBe(freshToken);
  });

  it('falls back to iat when auth_time is not in the token payload', async () => {
    // No auth_time claim — common for some AAD flows; we use iat as a proxy.
    const nowSec = Math.floor(Date.now() / 1000);
    const staleIat = nowSec - 60 * 60; // 60 min old
    const futureExp = nowSec + 30 * 60;

    const tokenNoAuthTime = makeJwtWithClaims({
      aud: 'https://management.azure.com/',
      exp: futureExp,
      iat: staleIat,
      // no auth_time
    });

    findUniqueMock.mockResolvedValue({
      access_token: tokenNoAuthTime,
      id_token: undefined,
      refresh_token: 'real-refresh-token',
      expires_at: new Date(futureExp * 1000),
      scope: 'https://management.azure.com/.default',
    });

    const freshToken = makeJwtWithClaims({
      aud: 'https://management.azure.com/',
      exp: nowSec + 60 * 60,
      iat: nowSec,
      auth_time: nowSec,
    });
    acquireTokenByRefreshTokenMock.mockResolvedValue({
      accessToken: freshToken,
      expiresOn: new Date((nowSec + 60 * 60) * 1000),
      refreshToken: 'new-refresh-token',
    });
    updateMock.mockResolvedValue({});

    const service = new AzureTokenService(makeLogger() as any);
    const result = await service.getOrRefreshToken('user-123');

    expect(acquireTokenByRefreshTokenMock).toHaveBeenCalledTimes(1);
    expect(result?.access_token).toBe(freshToken);
  });

  it('does NOT freshness-check service principal tokens (refresh_token === "service_principal")', async () => {
    // Service principal flow has no MFA — these tokens are issued by client_credentials
    // and should never be subject to MFA freshness.
    const nowSec = Math.floor(Date.now() / 1000);
    const oldAuthTime = nowSec - 6 * 60 * 60; // 6 hours old
    const futureExp = nowSec + 30 * 60;

    const spToken = makeJwtWithClaims({
      aud: 'https://management.azure.com/',
      exp: futureExp,
      iat: oldAuthTime,
      // SP tokens may not have auth_time at all
    });

    findUniqueMock.mockResolvedValue({
      access_token: spToken,
      id_token: undefined,
      refresh_token: 'service_principal',
      expires_at: new Date(futureExp * 1000),
      scope: 'https://management.azure.com/.default',
    });

    const service = new AzureTokenService(makeLogger() as any);
    const result = await service.getOrRefreshToken('user-123');

    expect(acquireTokenByRefreshTokenMock).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe(spToken);
    expect(result?.is_expired).toBe(false);
  });

  it('surfaces stale token as expired when refresh fails — caller must re-auth, not silently 401 at AAD', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const staleAuthTime = nowSec - 90 * 60;
    const futureExp = nowSec + 10 * 60;

    const staleToken = makeJwtWithClaims({
      aud: 'https://management.azure.com/',
      exp: futureExp,
      iat: staleAuthTime,
      auth_time: staleAuthTime,
    });

    findUniqueMock.mockResolvedValue({
      access_token: staleToken,
      id_token: undefined,
      refresh_token: 'real-refresh-token',
      expires_at: new Date(futureExp * 1000),
      scope: 'https://management.azure.com/.default',
    });

    // Refresh fails — e.g. AAD requires interactive MFA
    acquireTokenByRefreshTokenMock.mockRejectedValue(new Error('interaction_required'));

    const service = new AzureTokenService(makeLogger() as any);
    const result = await service.getOrRefreshToken('user-123');

    // We return the stale token info marked is_expired=true so callers can
    // detect the need for re-auth instead of silently passing a stale token
    // that AAD will reject at the OBO exchange with an opaque 401.
    expect(result?.is_expired).toBe(true);
  });
});
