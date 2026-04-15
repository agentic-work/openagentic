/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * AI Technique Management Routes
 * 
 * Administrative endpoints for managing AI prompting techniques,
 * user preferences, and usage statistics across the platform.
 * 
 */

import { FastifyPluginAsync } from 'fastify';
import { pino } from 'pino';
// import { PromptTechniqueService } from '../services/PromptTechniqueService.js'; // REMOVED: Prompt techniques disabled
import { loggers } from '../utils/logger.js';

const logger = pino({
  name: 'admin-techniques',
  level: process.env.LOG_LEVEL || 'info' });

// REMOVED: PromptTechniqueService initialization - prompt techniques disabled per user directive
// const techniqueService = new PromptTechniqueService(loggers.services);

// Admin auth middleware
// SECURITY: AUTH_MODE=development bypass removed in v0.5.0 FedRAMP hardening (Bolt 01)
// All admin access requires proper JWT authentication via Azure AD.
const requireAdmin = async (request: any, reply: any) => {
  const user = request.user;

  if (!user || (!user.isAdmin && !user.groups?.includes('admin'))) {
    return reply.code(403).send({ error: 'Admin access required' });
  }
};

const adminTechniqueRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Get all available prompt techniques
   * DISABLED: Prompt techniques removed per user directive
   */
  fastify.get('/techniques', { preHandler: requireAdmin }, async (request, reply) => {
    return reply.send({
      techniques: [],
      message: 'Prompt techniques have been disabled'
    });
  });

  /**
   * Get a specific technique by ID
   * DISABLED: Prompt techniques removed per user directive
   */
  fastify.get('/techniques/:id', { preHandler: requireAdmin }, async (request, reply) => {
    return reply.code(404).send({
      error: 'Prompt techniques have been disabled'
    });
  });

  /**
   * Create or update a technique configuration
   * DISABLED: Prompt techniques removed per user directive
   */
  fastify.put('/techniques/:id', { preHandler: requireAdmin }, async (request, reply) => {
    return reply.code(403).send({
      error: 'Prompt techniques have been disabled'
    });
  });

  /**
   * Delete a technique configuration
   * DISABLED: Prompt techniques removed per user directive
   */
  fastify.delete('/techniques/:id', { preHandler: requireAdmin }, async (request, reply) => {
    return reply.code(403).send({
      error: 'Prompt techniques have been disabled'
    });
  });

  /**
   * Get user's technique preferences
   * DISABLED: Prompt techniques removed per user directive
   */
  fastify.get('/techniques/preferences/:userId', { preHandler: requireAdmin }, async (request, reply) => {
    return reply.send({
      preferences: {},
      message: 'Prompt techniques have been disabled'
    });
  });

  /**
   * Update user's technique preferences
   * DISABLED: Prompt techniques removed per user directive
   */
  fastify.put('/techniques/preferences/:userId', { preHandler: requireAdmin }, async (request, reply) => {
    return reply.code(403).send({
      error: 'Prompt techniques have been disabled'
    });
  });

  /**
   * Get technique usage statistics
   * DISABLED: Prompt techniques removed per user directive
   */
  fastify.get('/techniques/statistics', { preHandler: requireAdmin }, async (request, reply) => {
    return reply.send({
      statistics: [],
      message: 'Prompt techniques have been disabled'
    });
  });

  /**
   * Test technique application
   * DISABLED: Prompt techniques removed per user directive
   */
  fastify.post('/techniques/test', { preHandler: requireAdmin }, async (request, reply) => {
    return reply.code(403).send({
      error: 'Prompt techniques have been disabled'
    });
  });
};

export default adminTechniqueRoutes;
