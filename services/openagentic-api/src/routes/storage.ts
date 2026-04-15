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
 * File and Data Storage Routes
 * 
 * Provides secure storage operations including token management, encrypted data storage,
 * and integration with HashiCorp Vault and Azure Key Vault services.
 * 
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { vaultService } from '../services/vault.service.js';
import { loggers } from '../utils/logger.js';
import crypto from 'crypto';
import { authMiddleware, adminMiddleware } from '../middleware/unifiedAuth.js';

// JSON Schema definitions
const TokenStorageSchema = {
  type: 'object',
  required: ['access_token'],
  properties: {
    access_token: { type: 'string' },
    refresh_token: { type: 'string' },
    expires_at: { type: 'number' },
    token_type: { type: 'string' },
    scope: { type: 'string' }
  }
};

const SecureDataSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: { type: 'object' },
    key: { type: 'string' },
    ttl: { type: 'number' }
  }
};

export const storageRoutes = async (fastify: FastifyInstance) => {
  // Helper to get user ID
  const getUserId = (request: FastifyRequest): string => {
    const user = (request as any).user;
    return user?.userId || user?.id || user?.user_id || request.headers['x-user-id'] as string;
  };

  // Store authentication token securely
  fastify.post('/api/storage/token', {
    preHandler: authMiddleware,
    schema: {
      body: TokenStorageSchema
    }
  }, async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const { access_token, refresh_token, expires_at, token_type, scope } = request.body as any;

      // Store token in Vault
      await vaultService.storeUserToken(userId, {
        access_token,
        refresh_token,
        expires_at: expires_at || Date.now() + 3600000, // Default 1 hour
        token_type: token_type || 'Bearer',
        scope
      });

      // Generate a reference ID for the client
      const reference = crypto.randomBytes(32).toString('hex');
      
      // Store reference mapping in Redis or memory cache
      const { createRedisService } = await import('../services/redis.js');
      const redis = createRedisService(request.log as any);
      await redis.set(`token_ref:${reference}`, userId, 3600);

      return reply.send({ 
        success: true, 
        reference,
        expires_at: expires_at || Date.now() + 3600000
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to store token');
      return reply.status(500).send({ 
        error: 'Failed to store token',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Retrieve authentication token
  fastify.get('/api/storage/token', {
    preHandler: authMiddleware,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          reference: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Querystring: { reference?: string } }>, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      const { reference } = request.query;

      if (!userId && !reference) {
        return reply.status(401).send({ error: 'Authentication required' });
      }

      let targetUserId = userId;

      // If reference provided, validate it
      if (reference) {
        const { createRedisService } = await import('../services/redis.js');
        const redis = createRedisService(request.log as any);
        const refUserId = await redis.get(`token_ref:${reference}`);
        
        if (!refUserId) {
          return reply.status(404).send({ error: 'Invalid or expired reference' });
        }

        // Ensure the reference belongs to the authenticated user
        if (userId && refUserId !== userId) {
          return reply.status(403).send({ error: 'Access denied' });
        }

        targetUserId = refUserId;
      }

      const tokenData = await vaultService.getUserToken(targetUserId);
      
      if (!tokenData) {
        return reply.status(404).send({ error: 'Token not found' });
      }

      return reply.send(tokenData);
    } catch (error) {
      request.log.error({ error }, 'Failed to retrieve token');
      return reply.status(500).send({ 
        error: 'Failed to retrieve token',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Delete authentication token
  fastify.delete('/api/storage/token', {
    preHandler: authMiddleware,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          reference: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Querystring: { reference?: string } }>, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      const { reference } = request.query;

      if (!userId && !reference) {
        return reply.status(401).send({ error: 'Authentication required' });
      }

      let targetUserId = userId;

      if (reference) {
        const { createRedisService } = await import('../services/redis.js');
        const redis = createRedisService(request.log as any);
        const refUserId = await redis.get(`token_ref:${reference}`);
        
        if (refUserId) {
          if (userId && refUserId !== userId) {
            return reply.status(403).send({ error: 'Access denied' });
          }
          targetUserId = refUserId;
          await redis.del(`token_ref:${reference}`);
        }
      }

      await vaultService.deleteUserToken(targetUserId);
      return reply.send({ success: true });
    } catch (error) {
      request.log.error({ error }, 'Failed to delete token');
      return reply.status(500).send({ 
        error: 'Failed to delete token',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Store secure data
  fastify.post('/api/storage/secure', {
    preHandler: authMiddleware,
    schema: {
      body: {
        type: 'object',
        required: ['key', 'value'],
        properties: {
          key: { type: 'string' },
          value: {},
          encrypted: { type: 'boolean' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { key: string; value: any; encrypted?: boolean } }>, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const { key, value, encrypted } = request.body;

      // Prefix key with user ID to ensure isolation
      const userKey = `user/${userId}/${key}`;

      await vaultService.storeSecret(userKey, {
        value,
        encrypted: encrypted !== false,
        user_id: userId,
        created_at: new Date().toISOString()
      });

      return reply.send({ success: true });
    } catch (error) {
      request.log.error({ error }, 'Failed to store secure data');
      return reply.status(500).send({ 
        error: 'Failed to store secure data',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Retrieve secure data
  fastify.get('/api/storage/secure', {
    preHandler: authMiddleware,
    schema: {
      querystring: {
        type: 'object',
        required: ['key'],
        properties: {
          key: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Querystring: { key: string } }>, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const { key } = request.query;

      // Prefix key with user ID to ensure isolation
      const userKey = `user/${userId}/${key}`;

      const data = await vaultService.getSecret(userKey);
      
      if (!data) {
        return reply.status(404).send({ error: 'Data not found' });
      }

      // Only return the value, not metadata
      return reply.send({ value: data.value });
    } catch (error) {
      request.log.error({ error }, 'Failed to retrieve secure data');
      return reply.status(500).send({ 
        error: 'Failed to retrieve secure data',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Delete secure data
  fastify.delete('/api/storage/secure', {
    preHandler: authMiddleware,
    schema: {
      querystring: {
        type: 'object',
        required: ['key'],
        properties: {
          key: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Querystring: { key: string } }>, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const { key } = request.query;

      // Prefix key with user ID to ensure isolation
      const userKey = `user/${userId}/${key}`;

      // Note: Vault doesn't have a direct delete for KV v2, we overwrite with empty
      await vaultService.storeSecret(userKey, {
        deleted: true,
        deleted_at: new Date().toISOString()
      });

      return reply.send({ success: true });
    } catch (error) {
      request.log.error({ error }, 'Failed to delete secure data');
      return reply.status(500).send({ 
        error: 'Failed to delete secure data',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Health check for storage service
  fastify.get('/api/storage/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const vaultHealthy = await vaultService.healthCheck();
      
      // Check database connectivity
      const { prisma } = await import('../utils/prisma.js');
      const dbHealthy = await prisma.$queryRaw`SELECT 1`
        .then(() => true)
        .catch(() => false);

      // Check Redis connectivity
      const { createRedisService } = await import('../services/redis.js');
      const redis = createRedisService(request.log as any);
      const redisHealthy = await redis.get('health_check')
        .then(() => true)
        .catch(() => false);

      const allHealthy = dbHealthy && redisHealthy; // Vault is optional

      return reply.status(allHealthy ? 200 : 503).send({
        healthy: allHealthy,
        vault_connected: vaultHealthy,
        database_connected: dbHealthy,
        redis_connected: redisHealthy,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      request.log.error({ error }, 'Health check failed');
      return reply.status(503).send({ 
        healthy: false,
        error: 'Health check failed'
      });
    }
  });

  // Get Azure Key Vault secret (admin only)
  fastify.get('/api/storage/azure-secret/:vaultName/:secretName', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest<{ Params: { vaultName: string; secretName: string } }>, reply: FastifyReply) => {
    try {

      const { vaultName, secretName } = request.params;

      const secret = await vaultService.getAzureSecret(vaultName, secretName);
      
      if (!secret) {
        return reply.status(404).send({ error: 'Secret not found' });
      }

      return reply.send({ value: secret });
    } catch (error) {
      request.log.error({ error }, 'Failed to get Azure secret');
      return reply.status(500).send({ 
        error: 'Failed to retrieve secret',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Encrypt data using Transit engine
  fastify.post('/api/storage/encrypt', {
    preHandler: authMiddleware,
    schema: {
      body: {
        type: 'object',
        required: ['plaintext'],
        properties: {
          plaintext: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { plaintext: string } }>, reply: FastifyReply) => {
    try {
      const { plaintext } = request.body;

      const ciphertext = await vaultService.encryptTransit(plaintext);
      return reply.send({ ciphertext });
    } catch (error) {
      request.log.error({ error }, 'Failed to encrypt data');
      return reply.status(500).send({ 
        error: 'Failed to encrypt data',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Decrypt data using Transit engine
  fastify.post('/api/storage/decrypt', {
    preHandler: authMiddleware,
    schema: {
      body: {
        type: 'object',
        required: ['ciphertext'],
        properties: {
          ciphertext: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { ciphertext: string } }>, reply: FastifyReply) => {
    try {
      const { ciphertext } = request.body;

      const plaintext = await vaultService.decryptTransit(ciphertext);
      return reply.send({ plaintext });
    } catch (error) {
      request.log.error({ error }, 'Failed to decrypt data');
      return reply.status(500).send({ 
        error: 'Failed to decrypt data',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // ===== Object Storage Browsing (MinIO) =====

  fastify.get('/api/storage/buckets', {
    preHandler: authMiddleware,
    schema: {
      tags: ['Storage'],
      summary: 'List MinIO buckets',
      description: 'List all object storage buckets visible to the service credentials',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { BlobStorageService } = await import('../services/BlobStorageService.js');
      const blobService = new BlobStorageService(loggers.services);
      await blobService.init();
      const buckets = await blobService.listBuckets();
      return reply.send(buckets);
    } catch (error) {
      loggers.routes.error({ error }, '[STORAGE] Failed to list buckets');
      return reply.status(500).send({ error: 'Failed to list buckets' });
    }
  });

  fastify.get('/api/storage/objects', {
    preHandler: authMiddleware,
    schema: {
      tags: ['Storage'],
      summary: 'List objects in a bucket',
      description: 'Browse objects in a bucket with folder-like navigation using prefix/delimiter',
      querystring: {
        type: 'object',
        properties: {
          bucket: { type: 'string', description: 'Bucket name' },
          prefix: { type: 'string', description: 'Object key prefix for folder navigation' },
          delimiter: { type: 'string', description: 'Delimiter for folder grouping (default /)' },
        },
        required: ['bucket'],
      },
    },
  }, async (request: FastifyRequest<{ Querystring: { bucket: string; prefix?: string; delimiter?: string } }>, reply: FastifyReply) => {
    try {
      const { bucket, prefix = '', delimiter = '/' } = request.query;
      const { BlobStorageService } = await import('../services/BlobStorageService.js');
      const blobService = new BlobStorageService(loggers.services);
      await blobService.init();
      const result = await blobService.listObjects(bucket, prefix, delimiter);
      return reply.send(result);
    } catch (error) {
      loggers.routes.error({ error, bucket: (request.query as any).bucket }, '[STORAGE] Failed to list objects');
      return reply.status(500).send({ error: 'Failed to list objects' });
    }
  });
};

export default storageRoutes;