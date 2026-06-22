/**
 * Admin Workflow Secrets Routes
 *
 * Provides endpoints for managing workflow secrets with AES-256-GCM
 * encryption and ESO (External Secrets Operator) integration.
 *
 * Endpoints:
 *   GET    /            - List secrets (metadata only, never raw values)
 *   GET    /stores      - List ESO secret stores
 *   GET    /:id         - Get single secret metadata
 *   POST   /            - Create a new secret (encrypts the value)
 *   PUT    /:id         - Update a secret
 *   DELETE /:id         - Delete a secret
 *   POST   /:id/test    - Test secret resolution
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../utils/logger.js';
import { workflowSecretService } from '../services/WorkflowSecretService.js';

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

interface IdParams {
  id: string;
}

interface ListQuery {
  scope?: string;
  workflowId?: string;
  groupId?: string;
  search?: string;
}

interface CreateBody {
  name: string;
  description?: string;
  value: string;
  scope: 'global' | 'group' | 'workflow';
  workflowId?: string;
  groupId?: string;
  allowedNodeTypes?: string[];
  allowedUsers?: string[];
  allowedGroups?: string[];
  esoEnabled?: boolean;
  esoSecretStore?: string;
  esoSecretStoreKind?: string;
  esoRemoteRef?: Record<string, any>;
  k8sSecretName?: string;
  k8sSecretNamespace?: string;
  k8sSecretKey?: string;
  rotationSchedule?: string;
  expiresAt?: string;
}

interface UpdateBody {
  name?: string;
  description?: string;
  value?: string;
  scope?: 'global' | 'group' | 'workflow';
  workflowId?: string;
  groupId?: string;
  allowedNodeTypes?: string[];
  allowedUsers?: string[];
  allowedGroups?: string[];
  esoEnabled?: boolean;
  esoSecretStore?: string;
  esoSecretStoreKind?: string;
  esoRemoteRef?: Record<string, any>;
  k8sSecretName?: string;
  k8sSecretNamespace?: string;
  k8sSecretKey?: string;
  rotationSchedule?: string;
  expiresAt?: string;
}

interface TestBody {
  workflowId?: string;
  groupId?: string;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const adminWorkflowSecretsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  // -------------------------------------------------------------------------
  // GET / - List secrets (metadata only)
  // -------------------------------------------------------------------------
  fastify.get<{ Querystring: ListQuery }>('/', async (request, reply) => {
    try {
      const { scope, workflowId, groupId, search } = request.query;

      const secrets = await workflowSecretService.list({
        scope,
        workflowId,
        groupId,
        search,
      });

      return reply.send({
        secrets,
        total: secrets.length,
      });
    } catch (error: any) {
      logger.error({ error }, '[WorkflowSecrets] Failed to list secrets');
      return reply.code(500).send({
        error: 'Failed to list workflow secrets',
        message: error.message,
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /stores - List ESO secret stores
  // -------------------------------------------------------------------------
  fastify.get('/stores', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stores = await workflowSecretService.listESOStores();
      return reply.send({
        stores,
        total: stores.length,
      });
    } catch (error: any) {
      logger.error({ error }, '[WorkflowSecrets] Failed to list ESO stores');
      return reply.code(500).send({
        error: 'Failed to list ESO secret stores',
        message: error.message,
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /:id - Get single secret metadata (never raw value)
  // -------------------------------------------------------------------------
  fastify.get<{ Params: IdParams }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const secret = await workflowSecretService.getById(id);

      if (!secret) {
        return reply.code(404).send({
          error: 'Secret not found',
          message: `Workflow secret '${id}' does not exist`,
        });
      }

      return reply.send({ secret });
    } catch (error: any) {
      logger.error({ error }, '[WorkflowSecrets] Failed to get secret');
      return reply.code(500).send({
        error: 'Failed to get workflow secret',
        message: error.message,
      });
    }
  });

  // -------------------------------------------------------------------------
  // POST / - Create a new secret
  // -------------------------------------------------------------------------
  fastify.post<{ Body: CreateBody }>('/', async (request, reply) => {
    try {
      const body = request.body;
      const user = (request as any).user;

      // Validate required fields
      if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
        return reply.code(400).send({
          error: 'Validation error',
          message: 'name is required and must be a non-empty string',
        });
      }

      if (!body.value || typeof body.value !== 'string' || body.value.trim().length === 0) {
        return reply.code(400).send({
          error: 'Validation error',
          message: 'value is required and must be a non-empty string',
        });
      }

      const validScopes = ['global', 'group', 'workflow'];
      if (!body.scope || !validScopes.includes(body.scope)) {
        return reply.code(400).send({
          error: 'Validation error',
          message: `scope must be one of: ${validScopes.join(', ')}`,
        });
      }

      if (body.scope === 'workflow' && !body.workflowId) {
        return reply.code(400).send({
          error: 'Validation error',
          message: 'workflowId is required when scope is "workflow"',
        });
      }

      if (body.scope === 'group' && !body.groupId) {
        return reply.code(400).send({
          error: 'Validation error',
          message: 'groupId is required when scope is "group"',
        });
      }

      const secret = await workflowSecretService.create({
        name: body.name.trim(),
        description: body.description,
        value: body.value,
        scope: body.scope,
        workflowId: body.workflowId,
        groupId: body.groupId,
        allowedNodeTypes: body.allowedNodeTypes,
        allowedUsers: body.allowedUsers,
        allowedGroups: body.allowedGroups,
        esoEnabled: body.esoEnabled,
        esoSecretStore: body.esoSecretStore,
        esoSecretStoreKind: body.esoSecretStoreKind,
        esoRemoteRef: body.esoRemoteRef,
        k8sSecretName: body.k8sSecretName,
        k8sSecretNamespace: body.k8sSecretNamespace,
        k8sSecretKey: body.k8sSecretKey,
        rotationSchedule: body.rotationSchedule,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        createdBy: user?.id || null,
      });

      logger.info({ secretId: secret.id, name: secret.name, adminEmail: user?.email }, '[WorkflowSecrets] Secret created by admin');

      return reply.code(201).send({
        success: true,
        secret,
        message: 'Workflow secret created successfully',
      });
    } catch (error: any) {
      // Handle unique constraint violation
      if (error.code === 'P2002') {
        return reply.code(409).send({
          error: 'Duplicate secret',
          message: 'A secret with this name, scope, and group/workflow already exists',
        });
      }

      logger.error({ error }, '[WorkflowSecrets] Failed to create secret');
      return reply.code(500).send({
        error: 'Failed to create workflow secret',
        message: error.message,
      });
    }
  });

  // -------------------------------------------------------------------------
  // PUT /:id - Update a secret
  // -------------------------------------------------------------------------
  fastify.put<{ Params: IdParams; Body: UpdateBody }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const body = request.body;
      const user = (request as any).user;

      // Validate scope if provided
      if (body.scope) {
        const validScopes = ['global', 'group', 'workflow'];
        if (!validScopes.includes(body.scope)) {
          return reply.code(400).send({
            error: 'Validation error',
            message: `scope must be one of: ${validScopes.join(', ')}`,
          });
        }

        if (body.scope === 'workflow' && !body.workflowId) {
          return reply.code(400).send({
            error: 'Validation error',
            message: 'workflowId is required when scope is "workflow"',
          });
        }

        if (body.scope === 'group' && !body.groupId) {
          return reply.code(400).send({
            error: 'Validation error',
            message: 'groupId is required when scope is "group"',
          });
        }
      }

      const secret = await workflowSecretService.update(
        id,
        {
          name: body.name,
          description: body.description,
          value: body.value,
          scope: body.scope,
          workflowId: body.workflowId,
          groupId: body.groupId,
          allowedNodeTypes: body.allowedNodeTypes,
          allowedUsers: body.allowedUsers,
          allowedGroups: body.allowedGroups,
          esoEnabled: body.esoEnabled,
          esoSecretStore: body.esoSecretStore,
          esoSecretStoreKind: body.esoSecretStoreKind,
          esoRemoteRef: body.esoRemoteRef,
          k8sSecretName: body.k8sSecretName,
          k8sSecretNamespace: body.k8sSecretNamespace,
          k8sSecretKey: body.k8sSecretKey,
          rotationSchedule: body.rotationSchedule,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        },
        user?.id
      );

      if (!secret) {
        return reply.code(404).send({
          error: 'Secret not found',
          message: `Workflow secret '${id}' does not exist`,
        });
      }

      logger.info({ secretId: id, name: secret.name, adminEmail: user?.email }, '[WorkflowSecrets] Secret updated by admin');

      return reply.send({
        success: true,
        secret,
        message: 'Workflow secret updated successfully',
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        return reply.code(409).send({
          error: 'Duplicate secret',
          message: 'A secret with this name, scope, and group/workflow already exists',
        });
      }

      logger.error({ error }, '[WorkflowSecrets] Failed to update secret');
      return reply.code(500).send({
        error: 'Failed to update workflow secret',
        message: error.message,
      });
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /:id - Delete a secret
  // -------------------------------------------------------------------------
  fastify.delete<{ Params: IdParams }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;

      const deleted = await workflowSecretService.delete(id);
      if (!deleted) {
        return reply.code(404).send({
          error: 'Secret not found',
          message: `Workflow secret '${id}' does not exist`,
        });
      }

      logger.info({ secretId: id, adminEmail: user?.email }, '[WorkflowSecrets] Secret deleted by admin');

      return reply.send({
        success: true,
        message: 'Workflow secret deleted successfully',
      });
    } catch (error: any) {
      logger.error({ error }, '[WorkflowSecrets] Failed to delete secret');
      return reply.code(500).send({
        error: 'Failed to delete workflow secret',
        message: error.message,
      });
    }
  });

  // -------------------------------------------------------------------------
  // POST /:id/test - Test secret resolution
  // -------------------------------------------------------------------------
  fastify.post<{ Params: IdParams; Body: TestBody }>('/:id/test', async (request, reply) => {
    try {
      const { id } = request.params;
      const body = request.body || {};
      const user = (request as any).user;

      const result = await workflowSecretService.testSecret(id, {
        workflowId: body.workflowId,
        groupId: body.groupId,
      });

      logger.info({ secretId: id, success: result.success, adminEmail: user?.email }, '[WorkflowSecrets] Secret test executed');

      return reply.send(result);
    } catch (error: any) {
      logger.error({ error }, '[WorkflowSecrets] Failed to test secret');
      return reply.code(500).send({
        success: false,
        message: `Secret test failed: ${error.message}`,
      });
    }
  });

  logger.info('Admin Workflow Secrets routes registered');
};

export default adminWorkflowSecretsRoutes;
