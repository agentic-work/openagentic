/**
 * Admin Auth Access Control Routes
 *
 * Manage allowed users, admins, and domains for OAuth login.
 * These settings override environment variables when database entries exist.
 *
 * Routes:
 *   GET  /api/admin/auth/users         - List all allowed users
 *   POST /api/admin/auth/users         - Add allowed user
 *   PUT  /api/admin/auth/users/:id     - Update allowed user
 *   DELETE /api/admin/auth/users/:id   - Remove allowed user
 *
 *   GET  /api/admin/auth/domains       - List all allowed domains
 *   POST /api/admin/auth/domains       - Add allowed domain
 *   PUT  /api/admin/auth/domains/:id   - Update allowed domain
 *   DELETE /api/admin/auth/domains/:id - Remove allowed domain
 *
 *   GET  /api/admin/auth/access-requests - List pending access requests
 *   POST /api/admin/auth/access-requests/:id/approve - Approve request
 *   POST /api/admin/auth/access-requests/:id/deny    - Deny request
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../utils/prisma.js';

interface AllowedUserBody {
  email: string;
  is_admin?: boolean;
  display_name?: string;
  notes?: string;
}

interface AllowedDomainBody {
  domain: string;
  is_admin_domain?: boolean;
  notes?: string;
}

interface UserIdParams {
  id: string;
}

export const authAccessRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;

  // ============================================
  // ALLOWED USERS
  // ============================================

  /**
   * List all allowed users
   */
  fastify.get('/users', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const users = await prisma.authAllowedUser.findMany({
        orderBy: { created_at: 'desc' }
      });

      return reply.send({
        users,
        count: users.length
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[AUTH-ACCESS] Failed to list allowed users');
      return reply.code(500).send({ error: 'Failed to list allowed users' });
    }
  });

  /**
   * Add a new allowed user
   */
  fastify.post('/users', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as AllowedUserBody;
      const adminUser = (request as any).user;

      if (!body.email) {
        return reply.code(400).send({ error: 'Email is required' });
      }

      // Normalize email
      const email = body.email.toLowerCase().trim();

      // Check if user already exists
      const existing = await prisma.authAllowedUser.findUnique({
        where: { email }
      });

      if (existing) {
        return reply.code(409).send({ error: 'User already exists in allowed list' });
      }

      const user = await prisma.authAllowedUser.create({
        data: {
          email,
          is_admin: body.is_admin || false,
          display_name: body.display_name,
          notes: body.notes,
          added_by: adminUser?.userId || adminUser?.id
        }
      });

      logger.info({
        email: user.email,
        is_admin: user.is_admin,
        added_by: adminUser?.email
      }, '[AUTH-ACCESS] User added to allowed list');

      return reply.code(201).send({ user });
    } catch (error: any) {
      logger.error({ error: error.message }, '[AUTH-ACCESS] Failed to add allowed user');
      return reply.code(500).send({ error: 'Failed to add allowed user' });
    }
  });

  /**
   * Update an allowed user
   */
  fastify.put('/users/:id', async (request: FastifyRequest<{ Params: UserIdParams }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const body = request.body as Partial<AllowedUserBody> & { is_active?: boolean };

      const user = await prisma.authAllowedUser.update({
        where: { id },
        data: {
          ...(body.email && { email: body.email.toLowerCase().trim() }),
          ...(typeof body.is_admin === 'boolean' && { is_admin: body.is_admin }),
          ...(body.display_name !== undefined && { display_name: body.display_name }),
          ...(body.notes !== undefined && { notes: body.notes }),
          ...(typeof body.is_active === 'boolean' && { is_active: body.is_active })
        }
      });

      logger.info({ userId: id, email: user.email }, '[AUTH-ACCESS] User updated');

      return reply.send({ user });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: 'User not found' });
      }
      logger.error({ error: error.message }, '[AUTH-ACCESS] Failed to update allowed user');
      return reply.code(500).send({ error: 'Failed to update allowed user' });
    }
  });

  /**
   * Delete an allowed user
   */
  fastify.delete('/users/:id', async (request: FastifyRequest<{ Params: UserIdParams }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;

      const user = await prisma.authAllowedUser.delete({
        where: { id }
      });

      logger.info({ email: user.email }, '[AUTH-ACCESS] User removed from allowed list');

      return reply.send({ success: true, deleted: user });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: 'User not found' });
      }
      logger.error({ error: error.message }, '[AUTH-ACCESS] Failed to delete allowed user');
      return reply.code(500).send({ error: 'Failed to delete allowed user' });
    }
  });

  // ============================================
  // ALLOWED DOMAINS
  // ============================================

  /**
   * List all allowed domains
   */
  fastify.get('/domains', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const domains = await prisma.authAllowedDomain.findMany({
        orderBy: { created_at: 'desc' }
      });

      return reply.send({
        domains,
        count: domains.length
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[AUTH-ACCESS] Failed to list allowed domains');
      return reply.code(500).send({ error: 'Failed to list allowed domains' });
    }
  });

  /**
   * Add a new allowed domain
   */
  fastify.post('/domains', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as AllowedDomainBody;
      const adminUser = (request as any).user;

      if (!body.domain) {
        return reply.code(400).send({ error: 'Domain is required' });
      }

      // Normalize domain
      const domain = body.domain.toLowerCase().trim();

      // Validate domain format
      if (!/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/.test(domain)) {
        return reply.code(400).send({ error: 'Invalid domain format' });
      }

      // Check if domain already exists
      const existing = await prisma.authAllowedDomain.findUnique({
        where: { domain }
      });

      if (existing) {
        return reply.code(409).send({ error: 'Domain already exists in allowed list' });
      }

      const domainRecord = await prisma.authAllowedDomain.create({
        data: {
          domain,
          is_admin_domain: body.is_admin_domain || false,
          notes: body.notes,
          added_by: adminUser?.userId || adminUser?.id
        }
      });

      logger.info({
        domain: domainRecord.domain,
        is_admin_domain: domainRecord.is_admin_domain,
        added_by: adminUser?.email
      }, '[AUTH-ACCESS] Domain added to allowed list');

      return reply.code(201).send({ domain: domainRecord });
    } catch (error: any) {
      logger.error({ error: error.message }, '[AUTH-ACCESS] Failed to add allowed domain');
      return reply.code(500).send({ error: 'Failed to add allowed domain' });
    }
  });

  /**
   * Update an allowed domain
   */
  fastify.put('/domains/:id', async (request: FastifyRequest<{ Params: UserIdParams }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const body = request.body as Partial<AllowedDomainBody> & { is_active?: boolean };

      const domain = await prisma.authAllowedDomain.update({
        where: { id },
        data: {
          ...(body.domain && { domain: body.domain.toLowerCase().trim() }),
          ...(typeof body.is_admin_domain === 'boolean' && { is_admin_domain: body.is_admin_domain }),
          ...(body.notes !== undefined && { notes: body.notes }),
          ...(typeof body.is_active === 'boolean' && { is_active: body.is_active })
        }
      });

      logger.info({ domainId: id, domain: domain.domain }, '[AUTH-ACCESS] Domain updated');

      return reply.send({ domain });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: 'Domain not found' });
      }
      logger.error({ error: error.message }, '[AUTH-ACCESS] Failed to update allowed domain');
      return reply.code(500).send({ error: 'Failed to update allowed domain' });
    }
  });

  /**
   * Delete an allowed domain
   */
  fastify.delete('/domains/:id', async (request: FastifyRequest<{ Params: UserIdParams }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;

      const domain = await prisma.authAllowedDomain.delete({
        where: { id }
      });

      logger.info({ domain: domain.domain }, '[AUTH-ACCESS] Domain removed from allowed list');

      return reply.send({ success: true, deleted: domain });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: 'Domain not found' });
      }
      logger.error({ error: error.message }, '[AUTH-ACCESS] Failed to delete allowed domain');
      return reply.code(500).send({ error: 'Failed to delete allowed domain' });
    }
  });

  // ============================================
  // ACCESS REQUESTS
  // ============================================

  /**
   * List access requests
   */
  fastify.get('/access-requests', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { status } = request.query as { status?: string };

      const requests = await prisma.accessRequest.findMany({
        where: status ? { status } : undefined,
        orderBy: { created_at: 'desc' },
        take: 100
      });

      return reply.send({
        requests,
        count: requests.length
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[AUTH-ACCESS] Failed to list access requests');
      return reply.code(500).send({ error: 'Failed to list access requests' });
    }
  });

  /**
   * Approve an access request (adds user to allowed list)
   */
  fastify.post('/access-requests/:id/approve', async (request: FastifyRequest<{ Params: UserIdParams }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const body = request.body as { is_admin?: boolean; notes?: string };
      const adminUser = (request as any).user;

      // Get the request
      const accessRequest = await prisma.accessRequest.findUnique({
        where: { id }
      });

      if (!accessRequest) {
        return reply.code(404).send({ error: 'Access request not found' });
      }

      if (accessRequest.status !== 'pending') {
        return reply.code(400).send({ error: 'Access request already processed' });
      }

      // Add user to allowed list
      const allowedUser = await prisma.authAllowedUser.upsert({
        where: { email: accessRequest.email.toLowerCase() },
        create: {
          email: accessRequest.email.toLowerCase(),
          display_name: accessRequest.name,
          is_admin: body.is_admin || false,
          notes: body.notes,
          added_by: adminUser?.userId || adminUser?.id
        },
        update: {
          is_active: true,
          is_admin: body.is_admin || false,
          notes: body.notes
        }
      });

      // Update access request status
      await prisma.accessRequest.update({
        where: { id },
        data: {
          status: 'approved',
          reviewed_by: adminUser?.userId || adminUser?.id,
          reviewed_at: new Date(),
          review_notes: body.notes
        }
      });

      logger.info({
        email: accessRequest.email,
        approvedBy: adminUser?.email
      }, '[AUTH-ACCESS] Access request approved');

      return reply.send({
        success: true,
        user: allowedUser,
        message: `User ${accessRequest.email} has been approved and can now log in`
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[AUTH-ACCESS] Failed to approve access request');
      return reply.code(500).send({ error: 'Failed to approve access request' });
    }
  });

  /**
   * Deny an access request
   */
  fastify.post('/access-requests/:id/deny', async (request: FastifyRequest<{ Params: UserIdParams }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const body = request.body as { notes?: string };
      const adminUser = (request as any).user;

      const accessRequest = await prisma.accessRequest.update({
        where: { id },
        data: {
          status: 'denied',
          reviewed_by: adminUser?.userId || adminUser?.id,
          reviewed_at: new Date(),
          review_notes: body.notes
        }
      });

      logger.info({
        email: accessRequest.email,
        deniedBy: adminUser?.email
      }, '[AUTH-ACCESS] Access request denied');

      return reply.send({
        success: true,
        message: `Access request from ${accessRequest.email} has been denied`
      });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: 'Access request not found' });
      }
      logger.error({ error: error.message }, '[AUTH-ACCESS] Failed to deny access request');
      return reply.code(500).send({ error: 'Failed to deny access request' });
    }
  });

  // ============================================
  // SYNC/IMPORT HELPERS
  // ============================================

  /**
   * Import users from environment variables (one-time migration)
   */
  fastify.post('/sync-from-env', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const adminUser = (request as any).user;
      const results = {
        users: { added: 0, skipped: 0 },
        domains: { added: 0, skipped: 0 }
      };

      // Import allowed users from env
      const allowedUsersEnv = process.env.GOOGLE_ALLOWED_USERS || '';
      const adminEmailsEnv = process.env.GOOGLE_ADMIN_EMAILS || '';

      const adminEmails = new Set(
        adminEmailsEnv.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      );

      const allUsers = new Set([
        ...allowedUsersEnv.split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
        ...adminEmails
      ]);

      for (const email of allUsers) {
        const existing = await prisma.authAllowedUser.findUnique({ where: { email } });
        if (existing) {
          results.users.skipped++;
          continue;
        }

        await prisma.authAllowedUser.create({
          data: {
            email,
            is_admin: adminEmails.has(email),
            notes: 'Imported from environment variables',
            added_by: adminUser?.userId || adminUser?.id
          }
        });
        results.users.added++;
      }

      // Import allowed domains from env
      const allowedDomainsEnv = process.env.GOOGLE_ALLOWED_DOMAINS || '';
      const domains = allowedDomainsEnv.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

      for (const domain of domains) {
        const existing = await prisma.authAllowedDomain.findUnique({ where: { domain } });
        if (existing) {
          results.domains.skipped++;
          continue;
        }

        await prisma.authAllowedDomain.create({
          data: {
            domain,
            is_admin_domain: false,
            notes: 'Imported from environment variables',
            added_by: adminUser?.userId || adminUser?.id
          }
        });
        results.domains.added++;
      }

      logger.info(results, '[AUTH-ACCESS] Synced from environment variables');

      return reply.send({
        success: true,
        results,
        message: `Imported ${results.users.added} users and ${results.domains.added} domains`
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[AUTH-ACCESS] Failed to sync from env');
      return reply.code(500).send({ error: 'Failed to sync from environment variables' });
    }
  });
};

export default authAccessRoutes;
