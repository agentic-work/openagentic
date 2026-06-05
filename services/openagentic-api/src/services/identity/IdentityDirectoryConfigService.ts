/**
 * Identity Directory Configuration Service
 *
 * Centralized loader for SSO identity-directory (Azure-AD / Google-OIDC /
 * generic-OIDC) configurations. The 1:1 analogue of
 * services/llm-providers/ProviderConfigService — same "DB is the SINGLE
 * SOURCE OF TRUTH" doctrine, same CredentialEncryptionService reuse.
 *
 * ARCHITECTURE: Database is the SINGLE SOURCE OF TRUTH for all identity
 * directories. Environment variables (AUTH_PROVIDER / AZURE_AD_* / GOOGLE_*)
 * only seed the FIRST directory via IdentityDirectorySeeder at startup.
 * After that, all directory management happens through the database/admin UI
 * and login renders one button per enabled row.
 *
 * SECURITY: clientSecret lives inside auth_config and is already a member of
 * CredentialEncryptionService.SENSITIVE_FIELDS, so it round-trips through
 * encryptAuthConfig/decryptAuthConfig for free — no new crypto here.
 */

import type { Logger } from 'pino';
import { decryptAuthConfig } from '../llm-providers/CredentialEncryptionService.js';
import { isEnterpriseFeatureLicensed, FEATURE_RUNTIME_IDP } from '../../ee/license.js';

/**
 * Decrypted, runtime-ready identity-directory config.
 *
 * Column fields are surfaced flat; the decrypted secret bag (clientId,
 * clientSecret, plus any provider-specific extras the admin stored) is both
 * spread onto the top level AND kept whole on `authConfig` so the strategy
 * constructors can pass the full object (mirroring
 * ProviderConfigService.convertDatabaseProvider stashing `config.authConfig`).
 */
export interface DirectoryConfig {
  id: string;
  name: string;
  displayName: string;
  type: string; // 'azure-ad' | 'google-oidc' | 'generic-oidc'
  enabled: boolean;
  priority: number;

  // Decrypted secret bag (clientSecret decrypted by CredentialEncryptionService)
  clientId?: string;
  clientSecret?: string;
  authConfig: Record<string, any>;

  // OIDC endpoint identity
  tenantId?: string;
  authority?: string;
  issuer?: string;
  redirectUri?: string;
  scopes: string[];
  discovery?: Record<string, any> | null;

  // Group → role mapping
  groupClaim?: string;
  authorizedGroups: string[];
  adminGroups: string[];
  groupRoleMappings: Record<string, string>;
  externalAdminEmails: string[];
  allowedDomains: string[];
  allowAllAuthenticated: boolean;

  status: string;
}

export class IdentityDirectoryConfigService {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Load enabled identity directories from the database ONLY.
   *
   * Mirrors ProviderConfigService.loadProviderConfig() — DB is the single
   * source of truth; env only seeds. Rows are returned in login-button order
   * (priority asc), with sensitive auth_config fields decrypted.
   */
  async loadDirectories(): Promise<DirectoryConfig[]> {
    // ── OpenAgentic Enterprise gate (/ee/LICENSE) ────────────────────────────
    // The runtime, multi-directory identity registry is an Enterprise feature.
    // Without a valid OPENAGENTIC_LICENSE_KEY the registry stays empty — local
    // login and a single env-configured SSO provider keep working; only the
    // DB-driven directories are disabled. Removing this gate breaches /ee/LICENSE §4.
    if (!isEnterpriseFeatureLicensed(FEATURE_RUNTIME_IDP)) {
      this.logger.warn(
        'Runtime identity-directory registry requires an OpenAgentic Enterprise license (set OPENAGENTIC_LICENSE_KEY). Loading no directories — see /ee/LICENSE.',
      );
      return [];
    }

    const directories = await this.loadDatabaseDirectories();

    if (directories.length === 0) {
      this.logger.warn(
        'No identity directories configured in database. Use admin UI to add a directory or ensure IdentityDirectorySeeder ran at startup.',
      );
    }

    this.logger.info(
      {
        directoryCount: directories.length,
        directories: directories.map((d) => ({
          name: d.name,
          type: d.type,
          enabled: d.enabled,
          priority: d.priority,
        })),
      },
      'Loaded identity directory configuration from database (single source of truth)',
    );

    return directories;
  }

  /**
   * Query enabled, non-deleted directories ordered by priority.
   * Failure to reach the DB returns [] (login then shows local-only) rather
   * than throwing — matching ProviderConfigService.loadDatabaseProviders.
   */
  private async loadDatabaseDirectories(): Promise<DirectoryConfig[]> {
    try {
      const { prisma } = await import('../../utils/prisma.js');

      const rows = await prisma.identityDirectory.findMany({
        where: {
          enabled: true,
          deleted_at: null,
        },
        orderBy: {
          priority: 'asc',
        },
      });

      return rows.map((row) => this.convertDatabaseDirectory(row));
    } catch (error) {
      this.logger.warn(
        { error },
        'Failed to load identity directories from database; returning none (local login only)',
      );
      return [];
    }
  }

  /**
   * Convert a database IdentityDirectory row into a runtime DirectoryConfig.
   *
   * Public so callers that want to validate inline admin form-data (without
   * persisting) can build a synthetic row and run it through the same
   * auth-config decryption pipeline as a saved row — mirroring
   * ProviderConfigService.convertDatabaseProvider's "Test Connection" use case.
   */
  convertDatabaseDirectory(row: any): DirectoryConfig {
    // SECURITY: decrypt encrypted credential fields (clientSecret) from auth_config
    const authConfig = decryptAuthConfig((row.auth_config as any) || {}) as Record<string, any>;

    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      type: row.type,
      enabled: row.enabled,
      priority: row.priority,

      clientId: authConfig.clientId,
      clientSecret: authConfig.clientSecret,
      authConfig,

      tenantId: row.tenant_id ?? undefined,
      authority: row.authority ?? undefined,
      issuer: row.issuer ?? undefined,
      redirectUri: row.redirect_uri ?? undefined,
      scopes: (row.scopes as string[]) ?? [],
      discovery: (row.discovery as Record<string, any> | null) ?? null,

      groupClaim: row.group_claim ?? undefined,
      authorizedGroups: (row.authorized_groups as string[]) ?? [],
      adminGroups: (row.admin_groups as string[]) ?? [],
      groupRoleMappings: ((row.group_role_mappings as Record<string, string>) ?? {}),
      externalAdminEmails: (row.external_admin_emails as string[]) ?? [],
      allowedDomains: (row.allowed_domains as string[]) ?? [],
      allowAllAuthenticated: row.allow_all_authenticated ?? false,

      status: row.status ?? 'active',
    };
  }
}
