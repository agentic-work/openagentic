/**
 * Admin Teams Routes
 *
 * Endpoints:
 *   GET    /teams                         — list all teams
 *   POST   /teams                         — create team
 *   PUT    /teams/:id                     — update team
 *   DELETE /teams/:id                     — soft-delete team
 *   GET    /teams/:id/members             — list members
 *   POST   /teams/:id/members             — add member
 *   DELETE /teams/:id/members/:user_id    — remove member
 *   GET    /teams/:id/shared-flows        — list shared flows
 *   POST   /teams/:id/shared-flows        — share a flow
 *   DELETE /teams/:id/shared-flows/:share_id — revoke share
 *
 * All routes are expected to be registered under /api/admin prefix
 * with adminMiddleware applied by the parent plugin.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../utils/logger.js';
import { teamsService } from '../services/TeamsService.js';

const logger = loggers.routes.child({ component: 'AdminTeams' });

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['viewer', 'editor', 'executor', 'admin'] as const;

function extractActor(request: any) {
  return {
    userId: request.userId ?? request.user?.id ?? undefined,
    userEmail: request.userEmail ?? request.user?.email ?? undefined,
    ip: request.ip ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const adminTeamsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // ── GET /teams ────────────────────────────────────────────────────────────
  fastify.get('/teams', async (_request, reply) => {
    const teams = await teamsService.listTeams();
    return reply.send({ teams });
  });

  // ── POST /teams ───────────────────────────────────────────────────────────
  fastify.post('/teams', async (request, reply) => {
    const body = request.body as any;
    const { name, display_name, description, parent_group_id, cost_center, billing_contact_email } = body ?? {};

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return reply.status(400).send({ error: 'name is required' });
    }
    if (!display_name || typeof display_name !== 'string' || display_name.trim() === '') {
      return reply.status(400).send({ error: 'display_name is required' });
    }
    if (billing_contact_email && !EMAIL_RE.test(billing_contact_email)) {
      return reply.status(400).send({ error: 'billing_contact_email is invalid' });
    }

    try {
      const team = await teamsService.createTeam(
        { name, display_name, description, parent_group_id, cost_center, billing_contact_email },
        extractActor(request),
      );
      return reply.status(201).send({ team });
    } catch (err: any) {
      if (err?.code === 'TEAM_NAME_CONFLICT') {
        return reply.status(409).send({ error: 'TEAM_NAME_CONFLICT', message: err.message });
      }
      logger.error({ err }, 'createTeam failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ── PUT /teams/:id ────────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/teams/:id', async (request, reply) => {
    const { id } = request.params;
    const body = request.body as any;
    try {
      const team = await teamsService.updateTeam(id, body, extractActor(request));
      return reply.send({ team });
    } catch (err: any) {
      logger.error({ err, id }, 'updateTeam failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ── DELETE /teams/:id ─────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/teams/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      await teamsService.deleteTeam(id, extractActor(request));
      return reply.status(204).send();
    } catch (err: any) {
      logger.error({ err, id }, 'deleteTeam failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ── GET /teams/:id/members ────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/teams/:id/members', async (request, reply) => {
    const { id } = request.params;
    const members = await teamsService.listMembers(id);
    return reply.send({ members });
  });

  // ── POST /teams/:id/members ───────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/teams/:id/members', async (request, reply) => {
    const { id } = request.params;
    const body = request.body as any;
    const { user_email } = body ?? {};

    if (!user_email || typeof user_email !== 'string') {
      return reply.status(400).send({ error: 'user_email is required' });
    }

    try {
      const membership = await teamsService.addMember(id, user_email, extractActor(request));
      return reply.status(201).send({ membership });
    } catch (err: any) {
      if (err?.code === 'USER_NOT_FOUND') {
        return reply.status(404).send({ error: 'USER_NOT_FOUND', message: err.message });
      }
      logger.error({ err, id }, 'addMember failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ── DELETE /teams/:id/members/:user_id ────────────────────────────────────
  fastify.delete<{ Params: { id: string; user_id: string } }>(
    '/teams/:id/members/:user_id',
    async (request, reply) => {
      const { id, user_id } = request.params;
      try {
        await teamsService.removeMember(id, user_id, extractActor(request));
        return reply.status(204).send();
      } catch (err: any) {
        logger.error({ err, id, user_id }, 'removeMember failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    },
  );

  // ── GET /teams/:id/shared-flows ───────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/teams/:id/shared-flows', async (request, reply) => {
    const { id } = request.params;
    const shares = await teamsService.listSharedFlows(id);
    return reply.send({ shares });
  });

  // ── POST /teams/:id/shared-flows ──────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/teams/:id/shared-flows', async (request, reply) => {
    const { id } = request.params;
    const body = request.body as any;
    const { workflow_id, role } = body ?? {};

    if (!workflow_id || typeof workflow_id !== 'string') {
      return reply.status(400).send({ error: 'workflow_id is required' });
    }
    if (!role || !VALID_ROLES.includes(role)) {
      return reply.status(400).send({
        error: 'role must be one of: viewer, editor, executor, admin',
      });
    }

    try {
      const share = await teamsService.shareFlow(id, workflow_id, role, extractActor(request));
      return reply.status(201).send({ share });
    } catch (err: any) {
      logger.error({ err, id }, 'shareFlow failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ── DELETE /teams/:id/shared-flows/:share_id ──────────────────────────────
  fastify.delete<{ Params: { id: string; share_id: string } }>(
    '/teams/:id/shared-flows/:share_id',
    async (request, reply) => {
      const { id, share_id } = request.params;
      try {
        await teamsService.revokeFlowShare(id, share_id, extractActor(request));
        return reply.status(204).send();
      } catch (err: any) {
        logger.error({ err, id, share_id }, 'revokeFlowShare failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    },
  );
};

export default adminTeamsRoutes;
