/**
 * Admin Roles Routes
 *
 * Provides RBAC role management for the admin portal.
 * Currently uses predefined system roles based on the is_admin flag.
 *
 * Note: For custom roles, add Role and UserRole models to Prisma schema.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import type { Logger } from 'pino';

// Predefined system roles (based on is_admin flag in users table)
interface SystemRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
}

const SYSTEM_ROLES: SystemRole[] = [
  {
    id: 'admin',
    name: 'admin',
    description: 'Full system administrator with all permissions',
    permissions: ['*'],
    isSystem: true
  },
  {
    id: 'user',
    name: 'user',
    description: 'Standard user with chat and profile access',
    permissions: ['chat', 'chat:create', 'chat:read', 'chat:delete', 'profile', 'profile:read', 'profile:update'],
    isSystem: true
  },
  {
    id: 'viewer',
    name: 'viewer',
    description: 'Read-only access to chat history',
    permissions: ['chat:read', 'profile:read'],
    isSystem: true
  }
];

const adminRolesRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log.child({ plugin: 'admin-roles' }) as Logger;

  // Middleware to ensure admin access
  fastify.addHook('preHandler', async (request: any, reply) => {
    if (!request.user || !request.user.isAdmin) {
      reply.code(403).send({
        error: 'Admin access required'
      });
      return;
    }
    return;
  });

  /**
   * GET /api/admin/roles
   * List all roles with their permissions and user counts
   */
  fastify.get('/', async (request, reply) => {
    try {
      // Get counts for each role type using Prisma
      const adminCount = await prisma.user.count({
        where: { is_admin: true }
      });

      const userCount = await prisma.user.count({
        where: { is_admin: false }
      });

      // Build roles response with user counts
      const rolesWithCounts = SYSTEM_ROLES.map(role => ({
        ...role,
        userCount: role.id === 'admin' ? adminCount : role.id === 'user' ? userCount : 0,
        createdAt: new Date().toISOString()
      }));

      return reply.send({
        success: true,
        roles: rolesWithCounts,
        total: SYSTEM_ROLES.length,
        note: 'System uses predefined roles. Custom roles require Prisma schema updates.'
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list roles');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch roles'
      });
    }
  });

  /**
   * GET /api/admin/roles/:roleId
   * Get a specific role with its users
   */
  fastify.get<{ Params: { roleId: string } }>('/:roleId', async (request, reply) => {
    try {
      const { roleId } = request.params;

      // Find the system role
      const role = SYSTEM_ROLES.find(r => r.id === roleId);
      if (!role) {
        return reply.code(404).send({
          success: false,
          error: 'Role not found'
        });
      }

      // Get users with this role using Prisma
      let users: Array<{ id: string; email: string; name: string | null }> = [];

      if (roleId === 'admin') {
        users = await prisma.user.findMany({
          where: { is_admin: true },
          select: { id: true, email: true, name: true },
          take: 100
        });
      } else if (roleId === 'user') {
        users = await prisma.user.findMany({
          where: { is_admin: false },
          select: { id: true, email: true, name: true },
          take: 100
        });
      }

      return reply.send({
        success: true,
        role: {
          ...role,
          users,
          userCount: users.length
        }
      });
    } catch (error) {
      logger.error({ error, roleId: request.params.roleId }, 'Failed to get role');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch role'
      });
    }
  });

  /**
   * POST /api/admin/roles
   * Create a new role (placeholder - requires Prisma schema update)
   */
  fastify.post<{
    Body: { name: string; description?: string; permissions?: string[] };
  }>('/', async (request, reply) => {
    const { name } = request.body;

    // Check for reserved names
    if (SYSTEM_ROLES.some(r => r.name.toLowerCase() === name.toLowerCase())) {
      return reply.code(400).send({
        success: false,
        error: 'Cannot create a role with a reserved system name'
      });
    }

    // Return informative message about custom roles
    return reply.code(501).send({
      success: false,
      error: 'Custom role creation not yet implemented',
      message: 'To enable custom roles, add Role and UserRole models to the Prisma schema and run migrations.',
      suggestedSchema: `
model Role {
  id          String     @id @default(uuid())
  name        String     @unique
  description String?
  permissions Json       @default("[]")
  created_at  DateTime   @default(now())
  updated_at  DateTime   @updatedAt
  userRoles   UserRole[]
}

model UserRole {
  id        String   @id @default(uuid())
  user_id   String
  role_id   String
  user      User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
  role      Role     @relation(fields: [role_id], references: [id], onDelete: Cascade)
  @@unique([user_id, role_id])
}`
    });
  });

  /**
   * PUT /api/admin/roles/:roleId
   * Update a role
   */
  fastify.put<{
    Params: { roleId: string };
    Body: { name?: string; description?: string; permissions?: string[] };
  }>('/:roleId', async (request, reply) => {
    const { roleId } = request.params;

    // Check if it's a system role
    if (SYSTEM_ROLES.some(r => r.id === roleId)) {
      return reply.code(400).send({
        success: false,
        error: 'Cannot modify system roles'
      });
    }

    return reply.code(404).send({
      success: false,
      error: 'Role not found (custom roles not yet implemented)'
    });
  });

  /**
   * DELETE /api/admin/roles/:roleId
   * Delete a role
   */
  fastify.delete<{ Params: { roleId: string } }>('/:roleId', async (request, reply) => {
    const { roleId } = request.params;

    // Check if it's a system role
    if (SYSTEM_ROLES.some(r => r.id === roleId)) {
      return reply.code(400).send({
        success: false,
        error: 'Cannot delete system roles'
      });
    }

    return reply.code(404).send({
      success: false,
      error: 'Role not found (custom roles not yet implemented)'
    });
  });

  /**
   * POST /api/admin/roles/assign
   * Assign/remove admin role from a user
   */
  fastify.post<{
    Body: { userId: string; role: 'admin' | 'user' };
  }>('/assign', async (request, reply) => {
    try {
      const { userId, role } = request.body;

      if (!userId || !role) {
        return reply.code(400).send({
          success: false,
          error: 'userId and role are required'
        });
      }

      if (!['admin', 'user'].includes(role)) {
        return reply.code(400).send({
          success: false,
          error: 'role must be "admin" or "user"'
        });
      }

      // Update user's admin status using Prisma
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { is_admin: role === 'admin' },
        select: { id: true, email: true, name: true, is_admin: true }
      });

      logger.info({ userId, role }, 'User role updated');

      return reply.send({
        success: true,
        user: updatedUser,
        message: `User ${updatedUser.email} is now ${role === 'admin' ? 'an admin' : 'a regular user'}`
      });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({
          success: false,
          error: 'User not found'
        });
      }
      logger.error({ error }, 'Failed to assign role');
      return reply.code(500).send({
        success: false,
        error: 'Failed to assign role'
      });
    }
  });

  logger.info('Admin roles routes registered (using predefined system roles)');
};

export default adminRolesRoutes;
