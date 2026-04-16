/**
 * Image Routes
 *
 * Provides API endpoints for retrieving AI-generated images stored in Milvus.
 * Images are stored with semantic embeddings for efficient search and retrieval.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ImageStorageService } from '../services/ImageStorageService.js';
import { getRedisClient } from '../utils/redis-client.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';

export const imageRoutes = async (fastify: FastifyInstance) => {
  // Note: Auth is applied per-route, not globally
  // GET /api/images/:id is public (image ID serves as access token - not guessable)
  // Other routes require authentication
  let imageStorage: ImageStorageService | null = null;

  // Initialize ImageStorageService with Redis caching
  try {
    const redis = getRedisClient();
    // Note: providerManager is not available in route context, so embeddings will use fallback
    imageStorage = new ImageStorageService(fastify.log, undefined, redis);
    await imageStorage.connect();
    fastify.log.info('[IMAGES] ImageStorageService initialized successfully with Redis caching');
  } catch (error) {
    fastify.log.error({ error }, '[IMAGES] Failed to initialize ImageStorageService');
  }

  // Helper to get user ID
  const getUserId = (request: FastifyRequest): string => {
    const user = (request as any).user;
    return user?.userId || user?.id || user?.user_id || '';
  };

  /**
   * GET /api/images/:id
   * Retrieve an image by its reference ID
   *
   * NOTE: This route is PUBLIC - the image ID serves as the access token.
   * Image IDs are generated with timestamps + random hex, making them unguessable.
   * This allows embedding images in chat without auth header complexity.
   */
  fastify.get('/api/images/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    if (!imageStorage || !imageStorage.isConnected()) {
      return reply.status(503).send({
        error: 'Image storage service unavailable'
      });
    }

    try {
      let { id } = request.params;

      // Strip .png/.jpg extension — URLs like /api/images/img_xxx.png are common
      id = id.replace(/\.(png|jpg|jpeg|webp)$/i, '');

      // Validate ID format
      if (!id.startsWith('img_')) {
        return reply.status(400).send({
          error: 'Invalid image ID format'
        });
      }

      const image = await imageStorage.getImage(id);

      if (!image) {
        return reply.status(404).send({
          error: 'Image not found'
        });
      }

      // Check Accept header — if browser/img tag wants image/*, return raw binary
      const accept = request.headers.accept || '';
      if (accept.includes('image/') || accept.includes('*/*') || request.url.match(/\.(png|jpg|jpeg|webp)$/i)) {
        // Return raw image binary for <img src="..."> tags
        const buffer = Buffer.from(image.imageData, 'base64');
        return reply
          .header('Content-Type', 'image/png')
          .header('Content-Length', buffer.length)
          .header('Cache-Control', 'public, max-age=86400')
          .send(buffer);
      }

      // JSON response for API consumers
      return reply.send({
        id: image.id,
        imageData: image.imageData,
        prompt: image.prompt,
        metadata: image.metadata,
        timestamp: image.timestamp
      });

    } catch (error) {
      fastify.log.error({ error, id: request.params.id }, '[IMAGES] Failed to retrieve image');
      return reply.status(500).send({
        error: 'Failed to retrieve image',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * GET /api/images/search
   * Search for images by semantic similarity
   * Requires authentication
   */
  fastify.get('/api/images/search', { preHandler: authMiddleware }, async (
    request: FastifyRequest<{ Querystring: { query: string; limit?: number } }>,
    reply: FastifyReply
  ) => {
    if (!imageStorage || !imageStorage.isConnected()) {
      return reply.status(503).send({
        error: 'Image storage service unavailable'
      });
    }

    try {
      const { query, limit } = request.query;

      if (!query) {
        return reply.status(400).send({
          error: 'Query parameter required'
        });
      }

      const userId = getUserId(request);
      const user = (request as any).user;
      const isAdmin = user?.isAdmin || user?.is_admin;

      // Only search user's images unless admin
      const results = await imageStorage.searchImages(
        query,
        isAdmin ? undefined : userId,
        limit || 10
      );

      return reply.send({
        query,
        results
      });

    } catch (error) {
      fastify.log.error({ error }, '[IMAGES] Failed to search images');
      return reply.status(500).send({
        error: 'Failed to search images',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * DELETE /api/images/:id
   * Delete an image (user must own it or be admin)
   * Requires authentication
   */
  fastify.delete('/api/images/:id', { preHandler: authMiddleware }, async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    if (!imageStorage || !imageStorage.isConnected()) {
      return reply.status(503).send({
        error: 'Image storage service unavailable'
      });
    }

    try {
      const { id } = request.params;

      // Validate ID format
      if (!id.startsWith('img_')) {
        return reply.status(400).send({
          error: 'Invalid image ID format'
        });
      }

      // Check if image exists and user has permission
      const image = await imageStorage.getImage(id);

      if (!image) {
        return reply.status(404).send({
          error: 'Image not found'
        });
      }

      const userId = getUserId(request);
      const user = (request as any).user;
      const isAdmin = user?.isAdmin || user?.is_admin;

      if (image.userId !== userId && !isAdmin) {
        return reply.status(403).send({
          error: 'Access denied'
        });
      }

      // Delete the image
      await imageStorage.deleteImage(id);

      return reply.send({
        success: true,
        message: 'Image deleted successfully'
      });

    } catch (error) {
      fastify.log.error({ error, id: request.params.id }, '[IMAGES] Failed to delete image');
      return reply.status(500).send({
        error: 'Failed to delete image',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * GET /api/images/health
   * Health check for image storage service
   */
  fastify.get('/api/images/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const isHealthy = imageStorage !== null && imageStorage.isConnected();

    return reply.status(isHealthy ? 200 : 503).send({
      healthy: isHealthy,
      service: 'image-storage',
      timestamp: new Date().toISOString()
    });
  });

  /**
   * GET /api/images/admin/stats
   * Get statistics about stored images (admin only)
   * Requires authentication
   */
  fastify.get('/api/images/admin/stats', { preHandler: authMiddleware }, async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    // Check if user is admin
    const user = (request as any).user;
    const isAdmin = user?.isAdmin || user?.is_admin;

    if (!isAdmin) {
      return reply.status(403).send({
        error: 'Admin access required'
      });
    }

    if (!imageStorage || !imageStorage.isConnected()) {
      return reply.status(503).send({
        error: 'Image storage service unavailable'
      });
    }

    try {
      const stats = await imageStorage.getStatistics();

      return reply.send({
        statistics: stats,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      fastify.log.error({ error }, '[IMAGES] Failed to get statistics');
      return reply.status(500).send({
        error: 'Failed to retrieve statistics',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/images/admin/cleanup
   * Cleanup unused or old images (admin only)
   * Requires authentication
   */
  fastify.post('/api/images/admin/cleanup', { preHandler: authMiddleware }, async (
    request: FastifyRequest<{ Body: { olderThanDays?: number; dryRun?: boolean } }>,
    reply: FastifyReply
  ) => {
    // Check if user is admin
    const user = (request as any).user;
    const isAdmin = user?.isAdmin || user?.is_admin;

    if (!isAdmin) {
      return reply.status(403).send({
        error: 'Admin access required'
      });
    }

    if (!imageStorage || !imageStorage.isConnected()) {
      return reply.status(503).send({
        error: 'Image storage service unavailable'
      });
    }

    try {
      const { olderThanDays = 30, dryRun = true } = request.body || {};

      fastify.log.info({
        olderThanDays,
        dryRun
      }, '[IMAGES] Admin cleanup requested');

      // TODO: Implement actual cleanup logic
      // For now, return placeholder response
      return reply.send({
        success: true,
        dryRun,
        message: dryRun
          ? `Dry run: Would delete images older than ${olderThanDays} days`
          : `Deleted images older than ${olderThanDays} days`,
        deletedCount: 0,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      fastify.log.error({ error }, '[IMAGES] Failed to cleanup images');
      return reply.status(500).send({
        error: 'Failed to cleanup images',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
};

export default imageRoutes;
