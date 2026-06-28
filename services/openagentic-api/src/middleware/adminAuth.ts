/**
 * Admin Authentication Middleware for Fastify
 *
 * Provides admin authentication middleware specifically designed for Fastify routes
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { adminGuard } from './adminGuard.js';

/**
 * Fastify admin authentication middleware
 * Wraps the adminGuard function for use as Fastify preHandler
 */
export const requireAdminFastify = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  return adminGuard(request, reply);
};