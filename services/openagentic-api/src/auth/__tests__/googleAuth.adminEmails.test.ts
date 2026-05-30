/**
 * Security gate — GoogleAuthService GOOGLE_ADMIN_EMAILS fallback removed.
 *
 * Regression pin: the constructor previously defaulted GOOGLE_ADMIN_EMAILS to
 * a hardcoded maintainer address when the env var was unset, which silently
 * granted admin to that address on every OSS deployment that omitted the env
 * var. This test asserts the fail-closed contract:
 *
 *   - GOOGLE_ADMIN_EMAILS unset → adminEmails is empty → isAdmin() returns false
 *     for any email (including the old hardcoded address).
 *   - GOOGLE_ADMIN_EMAILS set → only those emails are admins.
 *   - A warning must be logged (not suppressed) when the env var is missing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We test GoogleAuthService's admin-check logic in isolation.
// The constructor attempts to create a RedisService; mock it out.
vi.mock('../../services/redis.js', () => ({
  createRedisService: () => ({ isConnected: false, quit: vi.fn() }),
}));

// Silence google-auth-library network activity.
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    generateAuthUrl: vi.fn(() => 'https://accounts.google.com/o/oauth2/auth?mock'),
    getToken: vi.fn(),
    verifyIdToken: vi.fn(),
  })),
}));

const OLD_ENV = process.env;

describe('GoogleAuthService — GOOGLE_ADMIN_EMAILS fail-closed contract', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.GOOGLE_ADMIN_EMAILS;
    delete process.env.GOOGLE_ADMIN_DOMAINS;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
  });

  afterEach(() => {
    process.env = OLD_ENV;
    vi.clearAllMocks();
  });

  it('grants NO admin when GOOGLE_ADMIN_EMAILS is unset', async () => {
    const { GoogleAuthService } = await import('../googleAuth.js');
    const warnSpy = vi.fn();
    const svc = new GoogleAuthService(
      { clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost/cb' },
      { warn: warnSpy, info: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    );

    // Any email — including the previously-hardcoded address — must not be admin
    expect((svc as any).isAdmin('alice@example.com')).toBe(false);
    expect((svc as any).isAdmin('oncall@example.com')).toBe(false);
  });

  it('logs a warning when GOOGLE_ADMIN_EMAILS is unset', async () => {
    const { GoogleAuthService } = await import('../googleAuth.js');
    const warnSpy = vi.fn();
    new GoogleAuthService(
      { clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost/cb' },
      { warn: warnSpy, info: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('GOOGLE_ADMIN_EMAILS is not set'),
    );
  });

  it('grants admin only to the configured addresses when GOOGLE_ADMIN_EMAILS is set', async () => {
    process.env.GOOGLE_ADMIN_EMAILS = 'admin@example.com, ops@example.com';
    const { GoogleAuthService } = await import('../googleAuth.js');
    const svc = new GoogleAuthService(
      { clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost/cb' },
      { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    );

    expect((svc as any).isAdmin('admin@example.com')).toBe(true);
    expect((svc as any).isAdmin('ops@example.com')).toBe(true);
    expect((svc as any).isAdmin('other@example.com')).toBe(false);
  });

  it('is case-insensitive for admin email matching', async () => {
    process.env.GOOGLE_ADMIN_EMAILS = 'Admin@Example.com';
    const { GoogleAuthService } = await import('../googleAuth.js');
    const svc = new GoogleAuthService(
      { clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost/cb' },
      { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    );

    expect((svc as any).isAdmin('admin@example.com')).toBe(true);
    expect((svc as any).isAdmin('ADMIN@EXAMPLE.COM')).toBe(true);
  });
});
