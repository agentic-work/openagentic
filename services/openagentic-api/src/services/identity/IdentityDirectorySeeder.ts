/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  OpenAgentic Enterprise — Runtime Identity Directory (SSO) registry
 *  Copyright © Agenticwork™ LLC. All rights reserved.
 *
 *  ENTERPRISE SOFTWARE — licensed ONLY under the OpenAgentic Enterprise License
 *  (/ee/LICENSE), NOT the repository's Apache-2.0 license. A paid Agenticwork LLC
 *  subscription is required to use this in production. Reading the source grants no
 *  license. Using, selling, hosting as a service, redistributing, or modifying it
 *  without a subscription — or removing the license gate — is a breach of
 *  /ee/LICENSE §4 and an infringement of Agenticwork's copyright.
 *  Licensing: licensing@agenticwork.io
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
/**
 * Identity Directory Seeder — graceful env→DB migration for SSO directories.
 *
 * The 1:1 analogue of LLMProviderSeeder for the runtime-IDP registry
 * (RUNTIME-IDP-PLAN §6, Phase D task 13). Doctrine, copied verbatim from
 * ProviderConfigService / IdentityDirectoryConfigService:
 *
 *   "Database is the SINGLE SOURCE OF TRUTH for all identity directories.
 *    Environment variables (AUTH_PROVIDER / AZURE_AD_* / GOOGLE_*) only seed
 *    the FIRST directory via this seeder at startup. After that, all directory
 *    management happens through the database/admin UI."
 *
 * Behavior (idempotent, gated by SEEDER_VERSION):
 *   - admin.identity_directories has ANY row → skip entirely (admin/UI wins,
 *     just like LLMProviderSeeder skips when admin.llm_providers is non-empty).
 *   - AUTH_PROVIDER ∉ {azure-ad, google, hybrid, both, all} → skip (local-only
 *     deploy, nothing to migrate).
 *   - AUTH_PROVIDER selects azure-ad but AZURE_AD_* env is absent → skip.
 *   - AUTH_PROVIDER selects google but GOOGLE_* env is absent → skip.
 *   - Otherwise seed EXACTLY ONE directory row from env, encrypting the
 *     clientSecret on write (clientSecret ∈ CredentialEncryptionService
 *     SENSITIVE_FIELDS, so encryptAuthConfig handles it for free).
 *
 * After seeding, an existing env-configured deployment logs in UNCHANGED with
 * zero manual steps; the admin can then edit/add directories in the UI and the
 * DB wins. The legacy /api/auth/microsoft/* + /api/auth/google/* routes alias
 * to the seeded directory so already-registered redirect URIs keep resolving.
 *
 * Wired into the boot path in src/startup/04-providers.ts, next to
 * seedLLMProviders().
 */

import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { encryptAuthConfig } from '../llm-providers/CredentialEncryptionService.js';

/**
 * Seeder version — stamped onto the seeded row's auth_config so operators can
 * tell when (and at what schema) the boot path last created the directory.
 * Bump when the seed-row shape itself changes. Mirrors LLMProviderSeeder's
 * SEEDER_VERSION constant.
 */
const SEEDER_VERSION = 1; // v1 = initial identity-directory env→DB migration

/** AUTH_PROVIDER values for which the seeder attempts an env→DB migration. */
const SEED_ELIGIBLE_PROVIDERS = new Set(['azure-ad', 'google', 'hybrid', 'both', 'all']);

/** Parse a comma-separated env list into a trimmed, de-blanked string[]. */
function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse the group→role mapping env (AZURE_GROUP_ROLE_MAPPINGS, JSON object of
 * { "<groupIdOrName>": "role" }). Graceful: returns {} on absent/invalid JSON
 * rather than throwing — a bad mapping must not block first-boot login.
 */
function parseGroupRoleMappings(raw: string | undefined): Record<string, string> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Build the Azure-AD seed-row data from env, or null when the required env
 * (tenant + client id) is absent.
 */
function buildAzureSeed(): { create: Record<string, any>; logCtx: Record<string, any> } | null {
  const tenantId = (process.env.AZURE_AD_TENANT_ID ?? '').trim();
  const clientId = (process.env.AZURE_AD_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.AZURE_AD_CLIENT_SECRET ?? '').trim();

  // tenant + clientId are the minimum to mint an auth URL + validate a token.
  if (!tenantId || !clientId) return null;

  // Mirror azureADAuth.ts env reads: VITE_AZURE_AD_AUTHORIZED_GROUPS ||
  // AZURE_AD_AUTHORIZED_GROUPS for the login gate; AZURE_ADMIN_GROUPS for
  // isAdmin; EXTERNAL_ADMIN_EMAILS for the external-admin bypass.
  const authorizedGroups = parseList(
    process.env.VITE_AZURE_AD_AUTHORIZED_GROUPS || process.env.AZURE_AD_AUTHORIZED_GROUPS,
  );
  const adminGroups = parseList(process.env.AZURE_ADMIN_GROUPS);
  const externalAdminEmails = parseList(process.env.EXTERNAL_ADMIN_EMAILS);
  const groupRoleMappings = parseGroupRoleMappings(process.env.AZURE_GROUP_ROLE_MAPPINGS);
  // Per-row replacement for the legacy SKIP_GROUP_VALIDATION env.
  const allowAllAuthenticated = process.env.SKIP_GROUP_VALIDATION === 'true';
  const groupClaim = (process.env.AZURE_GROUP_CLAIM ?? '').trim() || 'groups';

  return {
    create: {
      name: 'azure-ad',
      display_name: 'Microsoft Entra ID',
      type: 'azure-ad',
      enabled: true,
      priority: 1,
      // clientSecret auto-encrypts (∈ SENSITIVE_FIELDS); stamp the seeder
      // version inside auth_config (non-sensitive → passes through plaintext).
      auth_config: encryptAuthConfig({
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
        seeder_managed: true,
        seeder_version: SEEDER_VERSION,
      }),
      tenant_id: tenantId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      scopes: [],
      group_claim: groupClaim,
      authorized_groups: authorizedGroups,
      admin_groups: adminGroups,
      group_role_mappings: groupRoleMappings,
      external_admin_emails: externalAdminEmails,
      allowed_domains: [],
      allow_all_authenticated: allowAllAuthenticated,
      status: 'active',
    },
    logCtx: {
      tenantId,
      authorizedGroups: authorizedGroups.length,
      adminGroups: adminGroups.length,
      externalAdminEmails: externalAdminEmails.length,
      allowAllAuthenticated,
    },
  };
}

/**
 * Build the Google-OIDC seed-row data from env, or null when the required env
 * (client id) is absent.
 *
 * IMPORTANT: read BOTH GOOGLE_CLIENT_ID and GOOGLE_OAUTH_CLIENT_ID (and the
 * matching _SECRET pair). The code (googleAuth.ts) reads GOOGLE_CLIENT_ID while
 * docker-compose passes GOOGLE_OAUTH_CLIENT_ID — a pre-existing name mismatch
 * (RUNTIME-IDP-PLAN risk note §7). The seeder reads both so the Google
 * passthrough actually seeds regardless of which name the deploy set.
 */
function buildGoogleSeed(): { create: Record<string, any>; logCtx: Record<string, any> } | null {
  const clientId =
    (process.env.GOOGLE_CLIENT_ID ?? '').trim() ||
    (process.env.GOOGLE_OAUTH_CLIENT_ID ?? '').trim();
  const clientSecret =
    (process.env.GOOGLE_CLIENT_SECRET ?? '').trim() ||
    (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '').trim();

  if (!clientId) return null;

  const allowedDomains = parseList(process.env.GOOGLE_ALLOWED_DOMAINS);
  const externalAdminEmails = parseList(process.env.GOOGLE_ADMIN_EMAILS);

  return {
    create: {
      name: 'google',
      display_name: 'Google',
      type: 'google-oidc',
      enabled: true,
      priority: 1,
      auth_config: encryptAuthConfig({
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
        seeder_managed: true,
        seeder_version: SEEDER_VERSION,
      }),
      issuer: 'https://accounts.google.com',
      scopes: [],
      group_claim: 'groups',
      authorized_groups: [],
      admin_groups: [],
      group_role_mappings: {},
      external_admin_emails: externalAdminEmails,
      allowed_domains: allowedDomains,
      // Google has no group gate in the env model; admin is by email and the
      // hd/domain gate is allowed_domains. Login is open to authenticated
      // users in an allowed domain.
      allow_all_authenticated: true,
      status: 'active',
    },
    logCtx: {
      allowedDomains: allowedDomains.length,
      externalAdminEmails: externalAdminEmails.length,
    },
  };
}

/**
 * Entry point — called once from src/startup/04-providers.ts at API startup.
 * Idempotent: safe to call N times, state only changes on the fresh-install
 * leg (zero existing identity_directories rows + eligible env present).
 */
export async function seedIdentityDirectories(): Promise<void> {
  const log = logger.child({ service: 'IdentityDirectorySeeder' });

  const authProvider = (process.env.AUTH_PROVIDER || '').trim().toLowerCase();

  if (!SEED_ELIGIBLE_PROVIDERS.has(authProvider)) {
    log.info(
      { authProvider: authProvider || '<unset>' },
      '[IdP] AUTH_PROVIDER not SSO-eligible (local-only or unset) — skipping identity-directory seeder (admin UI owns directory CRUD)',
    );
    return;
  }

  try {
    // Admin ownership check — if ANY directory row exists, admin/UI has taken
    // ownership. Don't clobber. Mirrors LLMProviderSeeder's existingCount gate.
    let existingCount = 0;
    try {
      existingCount = (await (prisma as any).identityDirectory?.count?.()) ?? 0;
      if (typeof existingCount !== 'number') {
        existingCount = (existingCount as any).count ?? 0;
      }
    } catch {
      const rows = await prisma.identityDirectory.findMany({});
      existingCount = rows.length;
    }

    if (existingCount > 0) {
      log.info(
        { existingDirectories: existingCount },
        '[IdP] admin.identity_directories has existing rows — skipping seed (admin/UI wins)',
      );
      return;
    }

    // Pick which directory to seed based on AUTH_PROVIDER.
    //   - 'google'                       → Google only.
    //   - 'azure-ad'                     → Azure only.
    //   - 'hybrid' / 'both' / 'all'      → prefer Azure (the historical default
    //     — featureFlags.authProvider defaults to azure-ad), fall back to
    //     Google when only the Google env is present. The admin can add the
    //     other directory via the UI afterward.
    const wantsAzure = authProvider !== 'google'; // azure-ad + hybrid/both/all
    const wantsGoogle = authProvider !== 'azure-ad'; // google + hybrid/both/all

    let seed = wantsAzure ? buildAzureSeed() : null;
    let kind = 'azure-ad';

    if (!seed && wantsGoogle) {
      seed = buildGoogleSeed();
      kind = 'google-oidc';
    }

    if (!seed) {
      log.info(
        { authProvider },
        '[IdP] AUTH_PROVIDER is SSO-eligible but no usable AZURE_AD_*/GOOGLE_* env present — skipping seed (admin can add a directory via UI)',
      );
      return;
    }

    const created = await prisma.identityDirectory.create({ data: seed.create as any });

    log.info(
      { kind, name: seed.create.name, directoryId: created?.id, ...seed.logCtx },
      '[IdP] seeded the first identity directory from env — env→DB migration complete; DB is now SoT for SSO',
    );
  } catch (err) {
    log.error(
      {
        error: err instanceof Error ? err.message : err,
        stack: err instanceof Error ? err.stack : undefined,
        authProvider,
      },
      '[IdP] identity-directory seed failed — API boots without a seeded directory; admin can create one via UI',
    );
  }
}
