/**
 * Credential Exchange API (v1)
 *
 * Exchanges an authenticated user's platform token for scoped cloud provider tokens
 * using OAuth On-Behalf-Of (OBO) flows. This enables synthesized code (OAT/Synth)
 * to run AS the authenticated user with their actual cloud permissions.
 *
 * Flow:
 *   1. Client authenticates with awc_ API key or Azure AD token
 *   2. POST /api/v1/credentials/exchange with { provider, scopes }
 *   3. API validates user, checks scope authorization
 *   4. Performs OBO token exchange with cloud provider (Azure AD)
 *   5. Returns short-lived scoped access token
 *
 * FedRAMP High: All exchanges are audit-logged with user, scopes, IP, and timestamp.
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { AzureOBOService } from '../../services/AzureOBOService.js';
import { authMiddleware } from '../../middleware/unifiedAuth.js';
import { loggers } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';

// Supported providers and their default scopes
const PROVIDER_SCOPES: Record<string, string[]> = {
  azure_management: ['https://management.azure.com/.default'],
  azure_graph: ['https://graph.microsoft.com/.default'],
  azure_keyvault: ['https://vault.azure.net/.default'],
  azure_storage: ['https://storage.azure.com/.default'],
  azure_custom: [], // User provides scopes
};

// Maximum TTL for exchanged tokens (1 hour)
const MAX_TTL_SECONDS = 3600;
const DEFAULT_TTL_SECONDS = 900; // 15 minutes

interface ExchangeRequestBody {
  provider: string;
  scopes?: string[];
  ttl_seconds?: number;
}

interface ExchangeResponse {
  token_type: string;
  access_token: string;
  expires_in: number;
  provider: string;
  scopes_granted: string[];
  issued_at: string;
}

/**
 * Credential Exchange Routes
 */
export const credentialRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  // Auth middleware on all routes
  fastify.addHook('preHandler', authMiddleware);

  // Initialize OBO service
  const oboService = new AzureOBOService(logger);

  // Ensure audit table exists (idempotent)
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS credential_exchange_audit (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        provider VARCHAR(100) NOT NULL,
        scopes TEXT,
        expires_in_seconds INT DEFAULT 0,
        client_ip VARCHAR(45),
        user_agent TEXT,
        duration_ms INT DEFAULT 0,
        success BOOLEAN DEFAULT false,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_cred_audit_user_id ON credential_exchange_audit(user_id)
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_cred_audit_created ON credential_exchange_audit(created_at)
    `);
    logger.info('Credential exchange audit table ready');
  } catch (err) {
    logger.warn({ err }, 'Could not ensure credential exchange audit table (non-fatal)');
  }

  /**
   * POST /api/v1/credentials/exchange
   *
   * Exchange authenticated user's token for a scoped cloud provider token.
   * The user must have an Azure AD access token (from SSO or linked account).
   */
  fastify.post<{ Body: ExchangeRequestBody }>('/exchange', {
    schema: {
      tags: ['Credentials'],
      summary: 'Exchange token for scoped cloud credentials',
      description: `
Exchange your authenticated session for a short-lived, scoped cloud provider token.
The returned token inherits YOUR permissions from the identity provider (Azure AD).
This enables OAT/Synth synthesized code to run AS you with your actual cloud access.

Supported providers:
- azure_management: Azure Resource Manager (ARM) API
- azure_graph: Microsoft Graph API
- azure_keyvault: Azure Key Vault
- azure_storage: Azure Storage
- azure_custom: Custom Azure scopes (provide in 'scopes' array)
      `,
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['provider'],
        properties: {
          provider: {
            type: 'string',
            description: 'Cloud provider scope identifier',
            enum: Object.keys(PROVIDER_SCOPES),
          },
          scopes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Custom scopes (required for azure_custom provider)',
          },
          ttl_seconds: {
            type: 'number',
            minimum: 60,
            maximum: MAX_TTL_SECONDS,
            default: DEFAULT_TTL_SECONDS,
            description: 'Requested token lifetime in seconds (max 3600)',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            token_type: { type: 'string' },
            access_token: { type: 'string' },
            expires_in: { type: 'number' },
            provider: { type: 'string' },
            scopes_granted: { type: 'array', items: { type: 'string' } },
            issued_at: { type: 'string' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
        401: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            required_scopes: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = request.body as ExchangeRequestBody;
    const startTime = Date.now();

    if (!user) {
      return reply.code(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    // Validate provider
    if (!PROVIDER_SCOPES[body.provider]) {
      return reply.code(400).send({
        error: `Unsupported provider: ${body.provider}. Supported: ${Object.keys(PROVIDER_SCOPES).join(', ')}`,
        code: 'INVALID_PROVIDER',
      });
    }

    // Resolve scopes
    let scopes: string[];
    if (body.provider === 'azure_custom') {
      if (!body.scopes || body.scopes.length === 0) {
        return reply.code(400).send({
          error: 'Custom scopes are required when provider is azure_custom',
          code: 'SCOPES_REQUIRED',
        });
      }
      scopes = body.scopes;
    } else {
      scopes = PROVIDER_SCOPES[body.provider];
    }

    // Check user has an Azure AD access token
    const userAccessToken = user.accessToken;
    if (!userAccessToken || userAccessToken === 'internal-service-token') {
      return reply.code(403).send({
        error: 'Azure AD SSO token required for credential exchange. Log in via Microsoft SSO to use this feature.',
        code: 'SSO_TOKEN_REQUIRED',
      });
    }

    // Perform OBO exchange
    logger.info({
      userId: user.id,
      provider: body.provider,
      scopes,
      ip: request.ip,
    }, 'Credential exchange requested');

    try {
      const oboResult = await oboService.acquireTokenOnBehalfOf({
        userAccessToken,
        scopes,
      });

      if (!oboResult) {
        logger.error({
          userId: user.id,
          provider: body.provider,
        }, 'OBO token exchange returned null');

        return reply.code(403).send({
          error: 'Token exchange failed. Your Azure AD session may have expired, or you may not have permission for the requested scopes.',
          code: 'EXCHANGE_FAILED',
          required_scopes: scopes,
        });
      }

      // Calculate TTL (use lesser of requested and actual expiry)
      const requestedTtl = body.ttl_seconds || DEFAULT_TTL_SECONDS;
      const actualExpiresIn = Math.floor((oboResult.expiresOn.getTime() - Date.now()) / 1000);
      const expiresIn = Math.min(requestedTtl, actualExpiresIn, MAX_TTL_SECONDS);

      // Audit log the exchange
      const duration = Date.now() - startTime;
      logger.info({
        userId: user.id,
        email: user.email,
        provider: body.provider,
        scopes: oboResult.scopes,
        expiresIn,
        durationMs: duration,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      }, 'Credential exchange successful');

      // Persist audit trail
      try {
        await prisma.$executeRaw`
          INSERT INTO credential_exchange_audit (
            user_id, email, provider, scopes, expires_in_seconds,
            client_ip, user_agent, duration_ms, success, created_at
          ) VALUES (
            ${user.id}, ${user.email}, ${body.provider}, ${scopes.join(',')},
            ${expiresIn}, ${request.ip}, ${request.headers['user-agent'] || 'unknown'},
            ${duration}, true, NOW()
          )
        `;
      } catch (auditErr) {
        // Don't fail the exchange if audit logging fails
        logger.warn({ err: auditErr }, 'Failed to persist credential exchange audit log');
      }

      const response: ExchangeResponse = {
        token_type: 'Bearer',
        access_token: oboResult.accessToken,
        expires_in: expiresIn,
        provider: body.provider,
        scopes_granted: oboResult.scopes,
        issued_at: new Date().toISOString(),
      };

      return response;

    } catch (error) {
      logger.error({
        error,
        userId: user.id,
        provider: body.provider,
      }, 'Credential exchange error');

      // Audit failed attempt
      try {
        await prisma.$executeRaw`
          INSERT INTO credential_exchange_audit (
            user_id, email, provider, scopes, expires_in_seconds,
            client_ip, user_agent, duration_ms, success, error_message, created_at
          ) VALUES (
            ${user.id}, ${user.email}, ${body.provider}, ${scopes.join(',')},
            0, ${request.ip}, ${request.headers['user-agent'] || 'unknown'},
            ${Date.now() - startTime}, false, ${error instanceof Error ? error.message : 'Unknown error'}, NOW()
          )
        `;
      } catch (auditErr) {
        logger.warn({ err: auditErr }, 'Failed to persist failed exchange audit');
      }

      return reply.code(500).send({
        error: 'Internal error during token exchange',
        code: 'EXCHANGE_ERROR',
      });
    }
  });

  /**
   * GET /api/v1/credentials/providers
   *
   * List available credential exchange providers and their scopes.
   */
  fastify.get('/providers', {
    schema: {
      tags: ['Credentials'],
      summary: 'List available credential providers',
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const hasAzureToken = !!(user?.accessToken && user.accessToken !== 'internal-service-token');

    return {
      providers: Object.entries(PROVIDER_SCOPES).map(([name, scopes]) => ({
        name,
        scopes,
        available: hasAzureToken,
        description: getProviderDescription(name),
      })),
      user_has_sso_token: hasAzureToken,
      hint: hasAzureToken
        ? 'Your Azure AD SSO session is active. You can exchange credentials.'
        : 'Sign in via Microsoft SSO to enable credential exchange.',
    };
  });

  /**
   * GET /api/v1/credentials/me
   *
   * Returns the current user's identity and available credential scopes.
   */
  fastify.get('/me', {
    schema: {
      tags: ['Credentials'],
      summary: 'Current user credential info',
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest) => {
    const user = (request as any).user;
    const hasAzureToken = !!(user?.accessToken && user.accessToken !== 'internal-service-token');

    return {
      user_id: user.id,
      email: user.email,
      name: user.name,
      azure_oid: user.azureOid || user.oid,
      sso_active: hasAzureToken,
      local_account: user.localAccount,
      available_providers: hasAzureToken ? Object.keys(PROVIDER_SCOPES) : [],
    };
  });

  /**
   * GET /api/v1/credentials/audit
   *
   * Returns recent credential exchange audit log for the authenticated user.
   */
  fastify.get('/audit', {
    schema: {
      tags: ['Credentials'],
      summary: 'Credential exchange audit log',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 25, maximum: 100 },
        },
      },
    },
  }, async (request: FastifyRequest) => {
    const user = (request as any).user;
    const { limit = 25 } = request.query as { limit?: number };

    try {
      const auditEntries = await prisma.$queryRaw<any[]>`
        SELECT id, provider, scopes, expires_in_seconds, client_ip,
               duration_ms, success, error_message, created_at
        FROM credential_exchange_audit
        WHERE user_id = ${user.id}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

      return {
        audit: auditEntries,
        total: auditEntries.length,
      };
    } catch (error) {
      // Table may not exist yet
      logger.warn({ err: error }, 'Credential exchange audit table not available');
      return { audit: [], total: 0, note: 'Audit table not yet provisioned' };
    }
  });

  logger.info('Credential exchange routes registered');
};

function getProviderDescription(name: string): string {
  const descriptions: Record<string, string> = {
    azure_management: 'Azure Resource Manager (ARM) - manage subscriptions, resource groups, VMs, etc.',
    azure_graph: 'Microsoft Graph - users, groups, mail, calendar, Teams, SharePoint',
    azure_keyvault: 'Azure Key Vault - secrets, keys, and certificates',
    azure_storage: 'Azure Storage - blobs, queues, tables, files',
    azure_custom: 'Custom Azure AD scopes - provide your own scope URIs',
  };
  return descriptions[name] || name;
}

export default credentialRoutes;
