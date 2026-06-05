/**
 * Tests for IdentityDirectorySeeder — the boot-time env→DB migration that
 * creates EXACTLY ONE identity-directory row on a fresh SSO deploy.
 *
 * Contract (RUNTIME-IDP-PLAN §6, Phase D task 13):
 *   - AUTH_PROVIDER not SSO-eligible → skip entirely, no writes.
 *   - AUTH_PROVIDER eligible + DB has rows → skip (admin/UI owns the space).
 *   - AUTH_PROVIDER=azure-ad + AZURE_AD_* env present + DB empty → create ONE
 *     azure-ad directory row, clientSecret encrypted on write.
 *   - AUTH_PROVIDER=google + GOOGLE_* env present + DB empty → create ONE
 *     google-oidc row; reads BOTH GOOGLE_CLIENT_ID and GOOGLE_OAUTH_CLIENT_ID.
 *   - AUTH_PROVIDER eligible but env absent → skip (no usable env).
 *   - Second boot (DB now non-empty) → no-op.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/prisma.js', () => {
  const mock = {
    identityDirectory: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
  };
  (globalThis as any).__idpSeederPrismaMock = mock;
  return { prisma: mock };
});

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// encryptAuthConfig is the real one — we assert the secret round-trips to
// ciphertext on write. Stub the vault layer so it works without a real key.
vi.mock('../../vault.service.js', () => {
  const PREFIX = 'local2:';
  return {
    vaultService: {
      encryptLocal: (plaintext: string) => `${PREFIX}${Buffer.from(plaintext).toString('base64')}`,
      decryptLocal: (cipher: string) =>
        Buffer.from(cipher.slice(PREFIX.length), 'base64').toString('utf8'),
    },
  };
});

import { seedIdentityDirectories } from '../IdentityDirectorySeeder.js';

const prismaMock = (globalThis as any).__idpSeederPrismaMock as {
  identityDirectory: { findMany: any; create: any; count: any };
};

describe('seedIdentityDirectories (env→DB migration, Phase D task 13)', () => {
  const origEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...origEnv };
    // Strip any inherited SSO env so each test controls the world.
    for (const k of Object.keys(process.env)) {
      if (
        k.startsWith('AZURE_') ||
        k.startsWith('GOOGLE_') ||
        k === 'AUTH_PROVIDER' ||
        k === 'SKIP_GROUP_VALIDATION' ||
        k === 'EXTERNAL_ADMIN_EMAILS' ||
        k === 'VITE_AZURE_AD_AUTHORIZED_GROUPS'
      ) {
        delete process.env[k];
      }
    }
    prismaMock.identityDirectory.findMany.mockResolvedValue([]);
    prismaMock.identityDirectory.count.mockResolvedValue(0);
    prismaMock.identityDirectory.create.mockImplementation(async (args: any) => ({
      id: 'new-dir-id',
      ...args.data,
    }));
  });

  it('skips entirely when AUTH_PROVIDER is unset (local-only)', async () => {
    await seedIdentityDirectories();
    expect(prismaMock.identityDirectory.count).not.toHaveBeenCalled();
    expect(prismaMock.identityDirectory.create).not.toHaveBeenCalled();
  });

  it('skips entirely when AUTH_PROVIDER is local', async () => {
    process.env.AUTH_PROVIDER = 'local';
    await seedIdentityDirectories();
    expect(prismaMock.identityDirectory.create).not.toHaveBeenCalled();
  });

  it('seeds ONE azure-ad directory from env when DB empty', async () => {
    process.env.AUTH_PROVIDER = 'azure-ad';
    process.env.AZURE_AD_TENANT_ID = 'tenant-abc';
    process.env.AZURE_AD_CLIENT_ID = 'client-xyz';
    process.env.AZURE_AD_CLIENT_SECRET = 'super-secret';
    process.env.AZURE_AD_AUTHORIZED_GROUPS = 'grp-allowed, grp-two';
    process.env.AZURE_ADMIN_GROUPS = 'grp-admin';
    process.env.EXTERNAL_ADMIN_EMAILS = 'boss@corp.com';
    process.env.SKIP_GROUP_VALIDATION = 'false';

    await seedIdentityDirectories();

    expect(prismaMock.identityDirectory.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.identityDirectory.create.mock.calls[0][0].data;
    expect(data.type).toBe('azure-ad');
    expect(data.name).toBe('azure-ad');
    expect(data.tenant_id).toBe('tenant-abc');
    expect(data.authority).toBe('https://login.microsoftonline.com/tenant-abc');
    expect(data.authorized_groups).toEqual(['grp-allowed', 'grp-two']);
    expect(data.admin_groups).toEqual(['grp-admin']);
    expect(data.external_admin_emails).toEqual(['boss@corp.com']);
    expect(data.allow_all_authenticated).toBe(false);
    // clientId is plaintext; clientSecret is encrypted (∈ SENSITIVE_FIELDS).
    expect(data.auth_config.clientId).toBe('client-xyz');
    expect(data.auth_config.clientSecret).not.toBe('super-secret');
    expect(String(data.auth_config.clientSecret).startsWith('local2:')).toBe(true);
  });

  it('maps SKIP_GROUP_VALIDATION=true → allow_all_authenticated=true', async () => {
    process.env.AUTH_PROVIDER = 'azure-ad';
    process.env.AZURE_AD_TENANT_ID = 'tenant-abc';
    process.env.AZURE_AD_CLIENT_ID = 'client-xyz';
    process.env.SKIP_GROUP_VALIDATION = 'true';

    await seedIdentityDirectories();

    const data = prismaMock.identityDirectory.create.mock.calls[0][0].data;
    expect(data.allow_all_authenticated).toBe(true);
  });

  it('skips azure seed when required tenant/client env is absent', async () => {
    process.env.AUTH_PROVIDER = 'azure-ad';
    // No AZURE_AD_TENANT_ID / CLIENT_ID set.
    await seedIdentityDirectories();
    expect(prismaMock.identityDirectory.create).not.toHaveBeenCalled();
  });

  it('seeds ONE google-oidc directory, reading GOOGLE_CLIENT_ID', async () => {
    process.env.AUTH_PROVIDER = 'google';
    process.env.GOOGLE_CLIENT_ID = 'g-client';
    process.env.GOOGLE_CLIENT_SECRET = 'g-secret';
    process.env.GOOGLE_ALLOWED_DOMAINS = 'corp.com, sub.corp.com';
    process.env.GOOGLE_ADMIN_EMAILS = 'admin@corp.com';

    await seedIdentityDirectories();

    expect(prismaMock.identityDirectory.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.identityDirectory.create.mock.calls[0][0].data;
    expect(data.type).toBe('google-oidc');
    expect(data.name).toBe('google');
    expect(data.issuer).toBe('https://accounts.google.com');
    expect(data.allowed_domains).toEqual(['corp.com', 'sub.corp.com']);
    expect(data.external_admin_emails).toEqual(['admin@corp.com']);
    expect(data.auth_config.clientId).toBe('g-client');
    expect(String(data.auth_config.clientSecret).startsWith('local2:')).toBe(true);
  });

  it('reads the GOOGLE_OAUTH_CLIENT_ID/_SECRET compose-name mismatch too', async () => {
    process.env.AUTH_PROVIDER = 'google';
    // Only the compose-style names are set (the pre-existing mismatch).
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'g-oauth-client';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'g-oauth-secret';

    await seedIdentityDirectories();

    expect(prismaMock.identityDirectory.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.identityDirectory.create.mock.calls[0][0].data;
    expect(data.type).toBe('google-oidc');
    expect(data.auth_config.clientId).toBe('g-oauth-client');
    expect(String(data.auth_config.clientSecret).startsWith('local2:')).toBe(true);
  });

  it('hybrid mode prefers Azure when Azure env is present', async () => {
    process.env.AUTH_PROVIDER = 'hybrid';
    process.env.AZURE_AD_TENANT_ID = 'tenant-abc';
    process.env.AZURE_AD_CLIENT_ID = 'client-xyz';
    process.env.GOOGLE_CLIENT_ID = 'g-client';

    await seedIdentityDirectories();

    const data = prismaMock.identityDirectory.create.mock.calls[0][0].data;
    expect(data.type).toBe('azure-ad');
  });

  it('hybrid mode falls back to Google when only Google env is present', async () => {
    process.env.AUTH_PROVIDER = 'both';
    process.env.GOOGLE_CLIENT_ID = 'g-client';
    // No Azure env.
    await seedIdentityDirectories();

    const data = prismaMock.identityDirectory.create.mock.calls[0][0].data;
    expect(data.type).toBe('google-oidc');
  });

  it('skips seed (no-op) when a directory row already exists', async () => {
    process.env.AUTH_PROVIDER = 'azure-ad';
    process.env.AZURE_AD_TENANT_ID = 'tenant-abc';
    process.env.AZURE_AD_CLIENT_ID = 'client-xyz';
    prismaMock.identityDirectory.count.mockResolvedValue(1);

    await seedIdentityDirectories();

    expect(prismaMock.identityDirectory.create).not.toHaveBeenCalled();
  });

  it('is idempotent: second boot (row now present) does not re-create', async () => {
    process.env.AUTH_PROVIDER = 'azure-ad';
    process.env.AZURE_AD_TENANT_ID = 'tenant-abc';
    process.env.AZURE_AD_CLIENT_ID = 'client-xyz';

    // First boot: empty → seeds.
    prismaMock.identityDirectory.count.mockResolvedValueOnce(0);
    await seedIdentityDirectories();
    expect(prismaMock.identityDirectory.create).toHaveBeenCalledTimes(1);

    // Second boot: row now present → no-op.
    prismaMock.identityDirectory.count.mockResolvedValueOnce(1);
    await seedIdentityDirectories();
    expect(prismaMock.identityDirectory.create).toHaveBeenCalledTimes(1);
  });

  it('does not throw when create fails (boots without a directory)', async () => {
    process.env.AUTH_PROVIDER = 'azure-ad';
    process.env.AZURE_AD_TENANT_ID = 'tenant-abc';
    process.env.AZURE_AD_CLIENT_ID = 'client-xyz';
    prismaMock.identityDirectory.create.mockRejectedValue(new Error('db write failed'));

    await expect(seedIdentityDirectories()).resolves.toBeUndefined();
  });
});
