/**
 * Memory & Vector Services Routes Index
 * 
 * Central registration point for memory and vector database operations.
 * Manages user memories, contextual relationships, and vector management.
 * 
 */

import { FastifyPluginAsync } from 'fastify';
import { memoriesRoutes } from './memories.js';
import { contextsRoutes } from './contexts.js';
import { managementRoutes } from './management.js';

export const memoryVectorPlugin: FastifyPluginAsync = async (fastify) => {
  // Register user memory and vector search routes
  await fastify.register(memoriesRoutes, { prefix: '/' });
  
  // Register enhanced context management routes
  await fastify.register(contextsRoutes, { prefix: '/contexts' });
  
  // Register vector management routes
  await fastify.register(managementRoutes, { prefix: '/management' });
  
  fastify.log.info('Memory & Vector Services routes registered');
};