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