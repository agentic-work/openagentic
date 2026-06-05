/**
 * Identity Directory Management API Routes
 *
 * Admin CRUD for the runtime SSO identity-directory registry — the 1:1
 * structural clone of routes/admin/llm-providers.ts, applied to the
 * `identity_directories` table. Same doctrine: DB is the SINGLE SOURCE OF TRUTH,
 * sensitive fields (clientSecret) are encrypted via the SAME
 * CredentialEncryptionService (clientSecret ∈ SENSITIVE_FIELDS — no new crypto),
 * every write triggers a hot-reload of the IdentityDirectoryService registry
 * (atomic-swap, no API restart), and every write is audited.
 *
 * Routes (mounted under /api/admin by the admin plugin — these declare the
 * sub-path only, matching llm-providers.ts which declares `/llm-providers`):
 *   GET    /identity-directories            list (clientSecret REDACTED → hasSecret)
 *   GET    /identity-directories/:id        single (redacted)
 *   POST   /identity-directories            create (validate discovery → encrypt → reload → audit)
 *   PUT    /identity-directories/:id        update (re-encrypt only if a new secret supplied)
 *   PATCH  /identity-directories/:id        partial update (enabled/priority/etc.)
 *   DELETE /identity-directories/:id        soft delete (deleted_at) → reload
 *   POST   /identity-directories/:id/test   validate discovery + token-endpoint probe (no code exchange)
 *   GET    /identity-directories/:id/callback-url   the exact redirect_uri to register
 *
 * SECURITY: admin-gating is applied at the PLUGIN level — the admin plugin
 * registers these behind the `adminMiddleware` preHandler (the same way
 * llm-providers.ts is gated). This file does NOT add its own admin gate, exactly
 * like llm-providers.ts. It is NOT registered yet (the next agent wires it into
 * admin.plugin.ts / routes/admin.ts).
 */

import { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';
import { isEnterpriseFeatureLicensed, FEATURE_RUNTIME_IDP } from '../../ee/license.js';
import {
  encryptAuthConfig,
  decryptAuthConfig,
} from '../../services/llm-providers/CredentialEncryptionService.js';
import { AuditTrail, AuditEventType, AuditSeverity } from '../../utils/auditTrail.js';
import {
  getIdentityDirectoryService,
  invalidateIdentityDirectories,
  IdentityDirectoryService,
} from '../../services/identity/IdentityDirectoryService.js';

/** Recognized directory discriminators. */
const DIRECTORY_TYPES = new Set(['azure-ad', 'google-oidc', 'google', 'generic-oidc']);

/**
 * Shape a DB row into the redacted API view. NEVER returns clientSecret — only
 * a `hasSecret` flag (mirrors the provider route returning `hasApiKey`). clientId
 * is also withheld from the list/detail body since the browser never needs it
 * (the whole handshake is server-initiated); the admin form treats it as
 * write-mostly, surfacing only `hasClientId`.
 */
function toRedactedView(row: any) {
  const auth = (row.auth_config as Record<string, any>) || {};
  // auth_config is stored ENCRYPTED; decrypt only to test presence, never to
  // return the value. (decrypt is cheap + the secret stays server-side.)
  let decrypted: Record<string, any> = {};
  try {
    decrypted = decryptAuthConfig(auth) || {};
  } catch {
    decrypted = {};
  }
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    type: row.type,
    enabled: row.enabled,
    priority: row.priority,
    tenantId: row.tenant_id ?? null,
    authority: row.authority ?? null,
    issuer: row.issuer ?? null,
    redirectUri: row.redirect_uri ?? null,
    scopes: row.scopes ?? [],
    groupClaim: row.group_claim ?? null,
    authorizedGroups: row.authorized_groups ?? [],
    adminGroups: row.admin_groups ?? [],
    groupRoleMappings: row.group_role_mappings ?? {},
    externalAdminEmails: row.external_admin_emails ?? [],
    allowedDomains: row.allowed_domains ?? [],
    allowAllAuthenticated: row.allow_all_authenticated ?? false,
    status: row.status,
    // Discovery is cached metadata; safe to surface the endpoints (no secrets).
    hasDiscovery: !!row.discovery,
    discovery: (row.discovery as Record<string, any> | null) ?? null,
    // REDACTION FLAGS — never the values themselves.
    hasSecret: !!decrypted.clientSecret,
    hasClientId: !!decrypted.clientId,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
  };
}

/** Derive the callback URL that must be registered with the IdP. */
function deriveCallbackUrl(directoryId: string, override?: string | null): string {
  if (override) return override;
  const base = (process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  return `${base}/api/auth/sso/${directoryId}/callback`;
}

/**
 * The discovery base for a directory: Azure → authority (or derived from
 * tenant), generic-oidc → issuer. Google needs no discovery (the
 * google-auth-library validates against Google's well-known JWKS internally).
 */
function discoveryBaseFor(input: {
  type: string;
  authority?: string | null;
  tenantId?: string | null;
  issuer?: string | null;
}): string | null {
  if (input.type === 'azure-ad') {
    if (input.authority) return input.authority;
    if (input.tenantId) return `https://login.microsoftonline.com/${input.tenantId}`;
    return null;
  }
  if (input.type === 'generic-oidc') {
    return input.issuer || input.authority || null;
  }
  // google / google-oidc → no discovery base required
  return null;
}

const identityDirectoryRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log as Logger;
  const auditTrail = new AuditTrail();

  // ── OpenAgentic Enterprise gate (/ee/LICENSE) ──────────────────────────────
  // Creating / editing / deleting / testing identity directories is an Enterprise
  // feature. Reads (GET) stay open (the list is empty without a license, since the
  // registry loads nothing); mutations require a valid OPENAGENTIC_LICENSE_KEY.
  // Removing this gate is a breach of /ee/LICENSE §4.
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'GET' && !isEnterpriseFeatureLicensed(FEATURE_RUNTIME_IDP)) {
      await reply.code(402).send({
        error: 'enterprise_license_required',
        feature: FEATURE_RUNTIME_IDP,
        message:
          'The runtime Identity Directory registry is an OpenAgentic Enterprise feature. ' +
          'Set OPENAGENTIC_LICENSE_KEY with a valid license. See /ee/LICENSE.',
        licensing: 'licensing@agenticwork.io',
      });
    }
  });

  /** Lazily get the live registry singleton (boot wires it). */
  function svc(): IdentityDirectoryService | null {
    return getIdentityDirectoryService();
  }

  // -------------------------------------------------------------------------
  // GET /identity-directories — list (redacted)
  // -------------------------------------------------------------------------
  fastify.get('/identity-directories', async (_request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');
      const rows = await prisma.identityDirectory.findMany({
        where: { deleted_at: null },
        orderBy: [{ priority: 'asc' }, { created_at: 'desc' }],
      });
      return reply.send({
        directories: rows.map(toRedactedView),
        total: rows.length,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list identity directories');
      return reply.code(500).send({
        error: 'Failed to list identity directories',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /identity-directories/:id — single (redacted)
  // -------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>('/identity-directories/:id', async (request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');
      const row = await prisma.identityDirectory.findFirst({
        where: { id: request.params.id, deleted_at: null },
      });
      if (!row) {
        return reply.code(404).send({ error: 'Identity directory not found' });
      }
      return reply.send({ directory: toRedactedView(row) });
    } catch (error) {
      logger.error({ error, id: request.params.id }, 'Failed to get identity directory');
      return reply.code(500).send({
        error: 'Failed to get identity directory',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /identity-directories/:id/callback-url — the redirect_uri to register
  // -------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>(
    '/identity-directories/:id/callback-url',
    async (request, reply) => {
      try {
        const { prisma } = await import('../../utils/prisma.js');
        const row = await prisma.identityDirectory.findFirst({
          where: { id: request.params.id, deleted_at: null },
          select: { id: true, redirect_uri: true, type: true },
        });
        if (!row) {
          return reply.code(404).send({ error: 'Identity directory not found' });
        }
        const callbackUrl = deriveCallbackUrl(row.id, row.redirect_uri);
        return reply.send({
          callbackUrl,
          // Provider-specific registration hint for the admin UI.
          instructions:
            row.type === 'azure-ad'
              ? 'Azure: App Registration → Authentication → Redirect URIs (Web). Required permissions: openid profile email offline_access + a "groups" optional claim.'
              : row.type === 'google' || row.type === 'google-oidc'
                ? 'Google: OAuth client → Authorized redirect URIs. Scopes: openid email profile.'
                : 'Generic OIDC: register this URL as an Authorized Redirect URI in your IdP.',
        });
      } catch (error) {
        logger.error({ error, id: request.params.id }, 'Failed to derive callback URL');
        return reply.code(500).send({
          error: 'Failed to derive callback URL',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /identity-directories/:id/test — discovery + token-endpoint probe
  //   NEVER exchanges a real authorization code. Validates the OIDC discovery
  //   doc and dry-checks that the token endpoint is reachable.
  // -------------------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    '/identity-directories/:id/test',
    async (request, reply) => {
      try {
        const { prisma } = await import('../../utils/prisma.js');
        const row = await prisma.identityDirectory.findFirst({
          where: { id: request.params.id, deleted_at: null },
        });
        if (!row) {
          return reply.code(404).send({ error: 'Identity directory not found' });
        }

        const results: Record<string, any> = {
          id: row.id,
          type: row.type,
          timestamp: new Date().toISOString(),
          checks: {},
        };

        const base = discoveryBaseFor({
          type: row.type,
          authority: row.authority,
          tenantId: row.tenant_id,
          issuer: row.issuer,
        });

        if (!base && (row.type === 'google' || row.type === 'google-oidc')) {
          // Google: no discovery base; the library validates against Google's
          // own JWKS. Report a pass with a note instead of failing.
          results.checks.discovery = {
            success: true,
            note: 'Google uses a fixed well-known configuration — no per-directory discovery required.',
          };
          results.overall = 'pass';
          return reply.send(results);
        }

        if (!base) {
          results.checks.discovery = {
            success: false,
            error: 'No authority/issuer configured to run discovery against.',
          };
          results.overall = 'fail';
          return reply.send(results);
        }

        const service = svc();
        // Use the registry's validator when available (it caches); otherwise
        // construct a throwaway instance just for the probe.
        const validator = service ?? new IdentityDirectoryService(logger);
        let discovery: any;
        try {
          discovery = await validator.validateOidcDiscovery(base);
          results.checks.discovery = {
            success: true,
            issuer: discovery.issuer,
            authorizationEndpoint: discovery.authorization_endpoint,
            tokenEndpoint: discovery.token_endpoint,
            jwksUri: discovery.jwks_uri,
          };
        } catch (err) {
          results.checks.discovery = {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
          results.overall = 'fail';
          return reply.send(results);
        }

        // Token-endpoint reachability probe — a dry GET/HEAD that NEVER sends a
        // real code. A 200/400/405 all prove reachability (most token endpoints
        // 405 a GET, which is a perfectly good "endpoint exists" signal).
        try {
          const probe = await fetch(discovery.token_endpoint, { method: 'GET' });
          results.checks.tokenEndpoint = {
            success: probe.status > 0,
            status: probe.status,
            note: 'Reachability probe only — no authorization code was exchanged.',
          };
        } catch (err) {
          results.checks.tokenEndpoint = {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }

        results.overall = results.checks.tokenEndpoint?.success ? 'pass' : 'partial';
        return reply.send(results);
      } catch (error) {
        logger.error({ error, id: request.params.id }, 'Identity directory test failed');
        return reply.code(500).send({
          error: 'Test failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /identity-directories — create
  //   validate discovery → encryptAuthConfig → persist → hot-reload → audit
  // -------------------------------------------------------------------------
  fastify.post<{
    Body: {
      name: string;
      displayName: string;
      type: string;
      enabled?: boolean;
      priority?: number;
      clientId?: string;
      clientSecret?: string;
      authConfig?: Record<string, any>;
      tenantId?: string;
      authority?: string;
      issuer?: string;
      redirectUri?: string;
      scopes?: string[];
      groupClaim?: string;
      authorizedGroups?: string[];
      adminGroups?: string[];
      groupRoleMappings?: Record<string, string>;
      externalAdminEmails?: string[];
      allowedDomains?: string[];
      allowAllAuthenticated?: boolean;
    };
  }>('/identity-directories', async (request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');
      const b = request.body;

      if (!b.name || !b.displayName || !b.type) {
        return reply.code(400).send({
          error: 'Missing required fields',
          required: ['name', 'displayName', 'type'],
        });
      }
      if (!DIRECTORY_TYPES.has(b.type)) {
        return reply.code(400).send({
          error: 'Unsupported directory type',
          message: `type must be one of: ${Array.from(DIRECTORY_TYPES).join(', ')}`,
        });
      }

      // Validate OIDC discovery FIRST (mirrors the provider route's "test before
      // save" intent). Skipped for Google (fixed well-known) and tolerated as a
      // soft-fail for Azure so an admin can still save and fix endpoints later;
      // generic-oidc REQUIRES a valid discovery doc.
      const base = discoveryBaseFor({
        type: b.type,
        authority: b.authority,
        tenantId: b.tenantId,
        issuer: b.issuer,
      });
      let discoveryDoc: any = null;
      if (base) {
        try {
          const service = svc() ?? new IdentityDirectoryService(logger);
          discoveryDoc = await service.validateOidcDiscovery(base);
        } catch (err) {
          if (b.type === 'generic-oidc') {
            return reply.code(400).send({
              error: 'OIDC discovery validation failed',
              message: err instanceof Error ? err.message : String(err),
            });
          }
          logger.warn(
            { error: err instanceof Error ? err.message : err, base },
            '[identity-directories] discovery validation soft-failed on create (non-generic) — saving anyway',
          );
        }
      } else if (b.type === 'generic-oidc') {
        return reply.code(400).send({
          error: 'Missing issuer',
          message: 'generic-oidc directories require an `issuer` to run discovery against.',
        });
      }

      // Build the secret bag and ENCRYPT (clientSecret auto-encrypts because it
      // is in SENSITIVE_FIELDS).
      const authConfig: Record<string, any> = {
        ...(b.authConfig || {}),
        ...(b.clientId ? { clientId: b.clientId } : {}),
        ...(b.clientSecret ? { clientSecret: b.clientSecret } : {}),
      };
      const encryptedAuthConfig = encryptAuthConfig(authConfig);

      // Clear any soft-deleted ghost holding this name so re-add works (the
      // `name` unique constraint spans soft-deleted rows — mirrors #289 in the
      // provider route).
      try {
        await prisma.identityDirectory.deleteMany({
          where: { name: b.name, deleted_at: { not: null } },
        });
      } catch {
        // proceed — a duplicate-name error will surface below if it matters
      }

      const created = await prisma.identityDirectory.create({
        data: {
          name: b.name,
          display_name: b.displayName,
          type: b.type,
          enabled: b.enabled ?? true,
          priority: b.priority ?? 1,
          auth_config: encryptedAuthConfig,
          tenant_id: b.tenantId ?? null,
          authority: b.authority ?? null,
          issuer: b.issuer ?? null,
          redirect_uri: b.redirectUri ?? null,
          scopes: b.scopes ?? [],
          discovery: discoveryDoc ?? undefined,
          group_claim: b.groupClaim ?? 'groups',
          authorized_groups: b.authorizedGroups ?? [],
          admin_groups: b.adminGroups ?? [],
          group_role_mappings: b.groupRoleMappings ?? {},
          external_admin_emails: b.externalAdminEmails ?? [],
          allowed_domains: b.allowedDomains ?? [],
          allow_all_authenticated: b.allowAllAuthenticated ?? false,
          status: 'active',
          created_by: (request as any).user?.id ?? null,
        },
      });

      logger.info({ id: created.id, name: created.name, type: created.type }, 'Identity directory created');

      auditTrail
        .log({
          timestamp: new Date(),
          eventType: AuditEventType.CREDENTIAL_CREATE,
          severity: AuditSeverity.INFO,
          userId: (request as any).user?.id,
          userEmail: (request as any).user?.email,
          action: 'CREATE_IDENTITY_DIRECTORY',
          resource: 'IdentityDirectory',
          resourceId: created.id,
          details: { name: created.name, type: created.type },
          success: true,
          ipAddress: request.ip,
        })
        .catch(() => {});

      // Hot-reload the live registry (atomic swap) + broadcast to peers.
      await invalidateIdentityDirectories(logger).catch((err) =>
        logger.warn({ err }, '[identity-directories] post-create reload failed (DB row written)'),
      );

      return reply.code(201).send({
        directory: toRedactedView(created),
        callbackUrl: deriveCallbackUrl(created.id, created.redirect_uri),
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const target = Array.isArray(error?.meta?.target)
          ? error.meta.target.join(', ')
          : String(error?.meta?.target ?? 'name');
        return reply.code(409).send({
          error: 'A directory with this name already exists',
          message: `Field "${target}" must be unique.`,
          field: target,
        });
      }
      logger.error({ error }, 'Failed to create identity directory');
      return reply.code(500).send({
        error: 'Failed to create identity directory',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // -------------------------------------------------------------------------
  // Shared update applier — used by both PUT and PATCH. Re-encrypts the secret
  // bag ONLY if a new clientSecret/clientId/authConfig was supplied, MERGING
  // onto the existing decrypted bag so a blank secret never wipes the stored one
  // (mirrors the provider route's "keep existing secret if blank").
  // -------------------------------------------------------------------------
  async function applyUpdate(
    id: string,
    b: Record<string, any>,
    request: any,
    reply: any,
  ) {
    const { prisma } = await import('../../utils/prisma.js');
    const existing = await prisma.identityDirectory.findFirst({
      where: { id, deleted_at: null },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'Identity directory not found' });
    }

    if (b.type !== undefined && !DIRECTORY_TYPES.has(b.type)) {
      return reply.code(400).send({
        error: 'Unsupported directory type',
        message: `type must be one of: ${Array.from(DIRECTORY_TYPES).join(', ')}`,
      });
    }

    const data: any = {};
    if (b.displayName !== undefined) data.display_name = b.displayName;
    if (b.type !== undefined) data.type = b.type;
    if (b.enabled !== undefined) data.enabled = b.enabled;
    if (b.priority !== undefined) data.priority = b.priority;
    if (b.tenantId !== undefined) data.tenant_id = b.tenantId;
    if (b.authority !== undefined) data.authority = b.authority;
    if (b.issuer !== undefined) data.issuer = b.issuer;
    if (b.redirectUri !== undefined) data.redirect_uri = b.redirectUri;
    if (b.scopes !== undefined) data.scopes = b.scopes;
    if (b.groupClaim !== undefined) data.group_claim = b.groupClaim;
    if (b.authorizedGroups !== undefined) data.authorized_groups = b.authorizedGroups;
    if (b.adminGroups !== undefined) data.admin_groups = b.adminGroups;
    if (b.groupRoleMappings !== undefined) data.group_role_mappings = b.groupRoleMappings;
    if (b.externalAdminEmails !== undefined) data.external_admin_emails = b.externalAdminEmails;
    if (b.allowedDomains !== undefined) data.allowed_domains = b.allowedDomains;
    if (b.allowAllAuthenticated !== undefined) data.allow_all_authenticated = b.allowAllAuthenticated;
    if (b.status !== undefined) data.status = b.status;

    // Re-encrypt the secret bag only when something credential-bearing was sent.
    const hasNewSecretMaterial =
      b.clientSecret !== undefined ||
      b.clientId !== undefined ||
      b.authConfig !== undefined;
    if (hasNewSecretMaterial) {
      const existingAuth =
        (decryptAuthConfig(existing.auth_config as any) as Record<string, any>) || {};
      const merged: Record<string, any> = { ...existingAuth };
      // Apply authConfig bag first, then explicit clientId/clientSecret wins.
      if (b.authConfig && typeof b.authConfig === 'object') {
        for (const [k, v] of Object.entries(b.authConfig)) {
          if (v !== undefined && v !== null && v !== '') merged[k] = v;
        }
      }
      // Only overwrite clientSecret when a non-blank one is supplied (blank =
      // "keep existing" — the redacted GET means the edit form starts empty).
      if (b.clientId !== undefined && b.clientId !== '') merged.clientId = b.clientId;
      if (b.clientSecret !== undefined && b.clientSecret !== '') merged.clientSecret = b.clientSecret;
      data.auth_config = encryptAuthConfig(merged);
    }

    // Re-validate discovery when an endpoint-affecting field changed.
    const endpointChanged =
      b.authority !== undefined || b.issuer !== undefined || b.tenantId !== undefined;
    if (endpointChanged) {
      const effectiveType = b.type ?? existing.type;
      const base = discoveryBaseFor({
        type: effectiveType,
        authority: b.authority ?? existing.authority,
        tenantId: b.tenantId ?? existing.tenant_id,
        issuer: b.issuer ?? existing.issuer,
      });
      if (base) {
        try {
          const service = svc() ?? new IdentityDirectoryService(logger);
          data.discovery = await service.validateOidcDiscovery(base);
        } catch (err) {
          if (effectiveType === 'generic-oidc') {
            return reply.code(400).send({
              error: 'OIDC discovery validation failed',
              message: err instanceof Error ? err.message : String(err),
            });
          }
          logger.warn(
            { error: err instanceof Error ? err.message : err, base },
            '[identity-directories] discovery re-validation soft-failed on update — saving anyway',
          );
        }
      }
    }

    data.updated_by = request?.user?.id ?? null;

    const updated = await prisma.identityDirectory.update({ where: { id }, data });

    logger.info({ id: updated.id, name: updated.name }, 'Identity directory updated');

    auditTrail
      .log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_UPDATE,
        severity: AuditSeverity.INFO,
        userId: request?.user?.id,
        userEmail: request?.user?.email,
        action: 'UPDATE_IDENTITY_DIRECTORY',
        resource: 'IdentityDirectory',
        resourceId: updated.id,
        details: { name: updated.name, fields: Object.keys(data) },
        success: true,
        ipAddress: request.ip,
      })
      .catch(() => {});

    await invalidateIdentityDirectories(logger).catch((err) =>
      logger.warn({ err }, '[identity-directories] post-update reload failed (DB row updated)'),
    );

    return reply.send({ directory: toRedactedView(updated) });
  }

  // -------------------------------------------------------------------------
  // PUT /identity-directories/:id — update
  // -------------------------------------------------------------------------
  fastify.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/identity-directories/:id',
    async (request, reply) => {
      try {
        return await applyUpdate(request.params.id, request.body || {}, request, reply);
      } catch (error) {
        logger.error({ error, id: request.params.id }, 'Failed to update identity directory');
        return reply.code(500).send({
          error: 'Failed to update identity directory',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /identity-directories/:id — partial update (same applier)
  // -------------------------------------------------------------------------
  fastify.patch<{ Params: { id: string }; Body: Record<string, any> }>(
    '/identity-directories/:id',
    async (request, reply) => {
      try {
        return await applyUpdate(request.params.id, request.body || {}, request, reply);
      } catch (error) {
        logger.error({ error, id: request.params.id }, 'Failed to patch identity directory');
        return reply.code(500).send({
          error: 'Failed to patch identity directory',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /identity-directories/:id — SOFT delete + reload
  // -------------------------------------------------------------------------
  fastify.delete<{ Params: { id: string } }>(
    '/identity-directories/:id',
    async (request, reply) => {
      try {
        const { prisma } = await import('../../utils/prisma.js');
        const { id } = request.params;
        const existing = await prisma.identityDirectory.findFirst({
          where: { id, deleted_at: null },
        });
        if (!existing) {
          return reply.code(404).send({ error: 'Identity directory not found' });
        }

        const deleted = await prisma.identityDirectory.update({
          where: { id },
          data: {
            deleted_at: new Date(),
            enabled: false,
            status: 'disabled',
            updated_by: (request as any).user?.id ?? null,
          },
        });

        logger.info({ id: deleted.id, name: deleted.name }, 'Identity directory soft-deleted');

        auditTrail
          .log({
            timestamp: new Date(),
            eventType: AuditEventType.CREDENTIAL_DELETE,
            severity: AuditSeverity.WARNING,
            userId: (request as any).user?.id,
            userEmail: (request as any).user?.email,
            action: 'DELETE_IDENTITY_DIRECTORY',
            resource: 'IdentityDirectory',
            resourceId: deleted.id,
            details: { name: deleted.name, type: deleted.type },
            success: true,
            ipAddress: request.ip,
          })
          .catch(() => {});

        await invalidateIdentityDirectories(logger).catch((err) =>
          logger.warn({ err }, '[identity-directories] post-delete reload failed (DB row soft-deleted)'),
        );

        return reply.send({ message: 'Identity directory deleted successfully', id });
      } catch (error) {
        logger.error({ error, id: request.params.id }, 'Failed to delete identity directory');
        return reply.code(500).send({
          error: 'Failed to delete identity directory',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  fastify.log.info('Identity directory admin routes registered');
};

export default identityDirectoryRoutes;
