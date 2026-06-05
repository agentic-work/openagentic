/**
 * IdentityDirectoryConfigService — DB-as-SoT loader.
 *
 * Contract (RUNTIME-IDP-PLAN §3a, Phase B task 3):
 *  - loadDirectories() reads ONLY from the DB, filtered to
 *    { enabled: true, deleted_at: null } and ordered by priority asc.
 *  - row.auth_config is decrypted via the existing
 *    CredentialEncryptionService — so an encrypted clientSecret comes back
 *    in plaintext on the returned DirectoryConfig.
 *  - column fields (tenant_id / group_claim / admin_groups / …) are surfaced
 *    as their camelCase runtime names with sane defaults.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';

vi.mock('../../../utils/prisma.js', () => {
  const mock = {
    identityDirectory: {
      findMany: vi.fn(),
    },
  };
  (globalThis as any).__idpPrismaMock = mock;
  return { prisma: mock };
});

// Stub the vault layer so encrypt/decrypt round-trips deterministically
// without needing a real LOCAL_ENCRYPTION_KEY. The `local2:` prefix is what
// CredentialEncryptionService.isEncrypted() keys on.
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

// Force mock registration (service imports prisma dynamically inside the method)
import '../../../utils/prisma.js';

import { IdentityDirectoryConfigService } from '../IdentityDirectoryConfigService.js';
import { encryptAuthConfig } from '../../llm-providers/CredentialEncryptionService.js';

function prismaMock() {
  return (globalThis as any).__idpPrismaMock as {
    identityDirectory: { findMany: ReturnType<typeof vi.fn> };
  };
}

const silentLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as Logger;

describe('IdentityDirectoryConfigService — DB is SoT', () => {
  beforeEach(() => {
    prismaMock().identityDirectory.findMany.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('queries only enabled, non-deleted rows ordered by priority asc', async () => {
    prismaMock().identityDirectory.findMany.mockResolvedValue([]);

    const svc = new IdentityDirectoryConfigService(silentLogger);
    await svc.loadDirectories();

    expect(prismaMock().identityDirectory.findMany).toHaveBeenCalledWith({
      where: { enabled: true, deleted_at: null },
      orderBy: { priority: 'asc' },
    });
  });

  it('decrypts the clientSecret in auth_config via CredentialEncryptionService', async () => {
    // Encrypt the secret the same way the admin CRUD route persists it.
    const encrypted = encryptAuthConfig({
      clientId: 'app-1234',
      clientSecret: 'super-secret-value',
    });
    // Sanity: the stored value really is ciphertext (not plaintext).
    expect(encrypted.clientSecret).not.toBe('super-secret-value');
    expect(encrypted.clientSecret.startsWith('local2:')).toBe(true);

    prismaMock().identityDirectory.findMany.mockResolvedValue([
      {
        id: 'dir-azure',
        name: 'corp-entra',
        display_name: 'Corp Entra',
        type: 'azure-ad',
        enabled: true,
        priority: 1,
        deleted_at: null,
        auth_config: encrypted,
        tenant_id: 'tenant-abc',
        authority: 'https://login.microsoftonline.com/tenant-abc',
        issuer: null,
        redirect_uri: null,
        scopes: [],
        discovery: null,
        group_claim: 'groups',
        authorized_groups: ['grp-allowed'],
        admin_groups: ['grp-admin'],
        group_role_mappings: { 'grp-ops': 'operator' },
        external_admin_emails: ['boss@corp.com'],
        allowed_domains: [],
        allow_all_authenticated: false,
        status: 'active',
      },
    ]);

    const svc = new IdentityDirectoryConfigService(silentLogger);
    const dirs = await svc.loadDirectories();

    expect(dirs).toHaveLength(1);
    const d = dirs[0];

    // The secret is decrypted back to plaintext on the runtime config.
    expect(d.clientSecret).toBe('super-secret-value');
    expect(d.clientId).toBe('app-1234');
    // And it is NOT still ciphertext.
    expect(d.clientSecret?.startsWith('local2:')).toBe(false);

    // Column fields surfaced with camelCase runtime names.
    expect(d.id).toBe('dir-azure');
    expect(d.name).toBe('corp-entra');
    expect(d.displayName).toBe('Corp Entra');
    expect(d.type).toBe('azure-ad');
    expect(d.tenantId).toBe('tenant-abc');
    expect(d.authority).toBe('https://login.microsoftonline.com/tenant-abc');
    expect(d.groupClaim).toBe('groups');
    expect(d.authorizedGroups).toEqual(['grp-allowed']);
    expect(d.adminGroups).toEqual(['grp-admin']);
    expect(d.groupRoleMappings).toEqual({ 'grp-ops': 'operator' });
    expect(d.externalAdminEmails).toEqual(['boss@corp.com']);
    expect(d.allowAllAuthenticated).toBe(false);
    // Full decrypted secret bag preserved for strategy constructors.
    expect(d.authConfig.clientSecret).toBe('super-secret-value');
  });

  it('returns rows in the priority order the DB hands back (loader does not re-sort)', async () => {
    prismaMock().identityDirectory.findMany.mockResolvedValue([
      {
        id: 'dir-1',
        name: 'first',
        display_name: 'First',
        type: 'azure-ad',
        enabled: true,
        priority: 1,
        deleted_at: null,
        auth_config: {},
        scopes: [],
        authorized_groups: [],
        admin_groups: [],
        group_role_mappings: {},
        external_admin_emails: [],
        allowed_domains: [],
        allow_all_authenticated: false,
      },
      {
        id: 'dir-2',
        name: 'second',
        display_name: 'Second',
        type: 'google-oidc',
        enabled: true,
        priority: 5,
        deleted_at: null,
        auth_config: {},
        scopes: [],
        authorized_groups: [],
        admin_groups: [],
        group_role_mappings: {},
        external_admin_emails: [],
        allowed_domains: [],
        allow_all_authenticated: false,
      },
    ]);

    const svc = new IdentityDirectoryConfigService(silentLogger);
    const dirs = await svc.loadDirectories();

    expect(dirs.map((d) => d.name)).toEqual(['first', 'second']);
  });

  it('returns [] (local-only login) when the DB read fails', async () => {
    prismaMock().identityDirectory.findMany.mockRejectedValue(new Error('db down'));

    const svc = new IdentityDirectoryConfigService(silentLogger);
    const dirs = await svc.loadDirectories();

    expect(dirs).toEqual([]);
  });

  it('applies safe defaults when nullable columns are absent', async () => {
    prismaMock().identityDirectory.findMany.mockResolvedValue([
      {
        id: 'dir-min',
        name: 'minimal',
        display_name: 'Minimal',
        type: 'generic-oidc',
        enabled: true,
        priority: 1,
        deleted_at: null,
        auth_config: {},
        // nullable columns omitted entirely
      },
    ]);

    const svc = new IdentityDirectoryConfigService(silentLogger);
    const [d] = await svc.loadDirectories();

    expect(d.scopes).toEqual([]);
    expect(d.authorizedGroups).toEqual([]);
    expect(d.adminGroups).toEqual([]);
    expect(d.groupRoleMappings).toEqual({});
    expect(d.externalAdminEmails).toEqual([]);
    expect(d.allowedDomains).toEqual([]);
    expect(d.allowAllAuthenticated).toBe(false);
    expect(d.discovery).toBeNull();
    expect(d.status).toBe('active');
    expect(d.tenantId).toBeUndefined();
  });
});
