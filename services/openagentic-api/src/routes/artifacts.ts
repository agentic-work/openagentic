/**
 * Chat Artifacts and Outputs Routes
 * 
 * Manages document, image, and file artifacts generated during chat sessions.
 * Provides vector-enhanced storage, search, and retrieval capabilities.
 * 
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ArtifactService, UploadArtifactRequest, SearchArtifactsRequest, ArtifactType } from '../services/ArtifactService.js';
import { loggers } from '../utils/logger.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { MultipartFile } from '@fastify/multipart';
import { getDLPScanner, DLPScanContext } from '../services/DLPScannerService.js';
import { KnowledgeIngestionService } from '../services/KnowledgeIngestionService.js';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

// JSON Schema definitions
const UploadArtifactSchema = {
  type: 'object',
  required: ['file'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    tags: {
      type: 'array',
      items: { type: 'string' }
    },
    isPublic: { type: 'boolean' }
  }
};

const SearchArtifactsSchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string' },
    type: { 
      type: 'string',
      enum: Object.values(ArtifactType)
    },
    tags: {
      type: 'array',
      items: { type: 'string' }
    },
    limit: { type: 'number', minimum: 1, maximum: 100 },
    threshold: { type: 'number', minimum: 0, maximum: 1 },
    includePublic: { type: 'boolean' }
  }
};

const ArtifactListSchema = {
  type: 'object',
  properties: {
    type: { 
      type: 'string',
      enum: Object.values(ArtifactType)
    },
    tags: {
      type: 'array',
      items: { type: 'string' }
    },
    limit: { type: 'number', minimum: 1, maximum: 100 },
    offset: { type: 'number', minimum: 0 },
    sortBy: {
      type: 'string',
      enum: ['created', 'accessed', 'title']
    },
    sortOrder: {
      type: 'string',
      enum: ['asc', 'desc']
    }
  }
};

export const artifactsRoutes = async (fastify: FastifyInstance) => {
  // Initialize Artifact Service
  const artifactService = new ArtifactService(loggers.services);

  // Helper to get user ID
  const getUserId = (request: FastifyRequest): string => {
    const user = (request as any).user;
    return user?.userId || user?.id || request.headers['x-user-id'] as string;
  };
  // Upload artifact endpoint
  fastify.post('/api/artifacts/upload', {
    preHandler: authMiddleware,
    schema: {
      // consumes: ['multipart/form-data'], // Not supported in Fastify schema
      body: UploadArtifactSchema
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      // Handle multipart file upload
      const data = await (request as any).file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const buffer = await data.toBuffer();
      const uploadRequest: UploadArtifactRequest = {
        file: buffer,
        filename: data.filename || 'unknown',
        mimeType: data.mimetype || 'application/octet-stream',
        title: (data.fields as any)?.title?.value,
        description: (data.fields as any)?.description?.value,
        tags: (data.fields as any)?.tags?.value ? JSON.parse((data.fields as any).tags.value) : [],
        isPublic: (data.fields as any)?.isPublic?.value === 'true'
      };

      const result = await artifactService.uploadArtifact(userId, uploadRequest);
      return reply.send(result);
    } catch (error) {
      request.log.error({ error }, 'Failed to upload artifact');
      return reply.status(500).send({ 
        error: 'Failed to upload artifact',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Search artifacts endpoint
  fastify.post('/api/artifacts/search', {
    preHandler: authMiddleware,
    schema: {
      body: SearchArtifactsSchema
    }
  }, async (request: FastifyRequest<{ Body: SearchArtifactsRequest }>, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      const result = await artifactService.searchArtifacts(userId, request.body);
      return reply.send(result);
    } catch (error) {
      request.log.error({ error }, 'Failed to search artifacts');
      return reply.status(500).send({ 
        error: 'Failed to search artifacts',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // List artifacts endpoint
  fastify.get('/api/artifacts', {
    preHandler: authMiddleware,
    schema: {
      querystring: ArtifactListSchema
    }
  }, async (request: FastifyRequest<{ Querystring: any }>, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      const options = {
        type: (request.query as any).type,
        tags: (request.query as any).tags,
        limit: (request.query as any).limit ? parseInt((request.query as any).limit) : undefined,
        offset: (request.query as any).offset ? parseInt((request.query as any).offset) : undefined,
        sortBy: (request.query as any).sortBy,
        sortOrder: (request.query as any).sortOrder
      };

      const result = await artifactService.listArtifacts(userId, options);
      return reply.send(result);
    } catch (error) {
      request.log.error({ error }, 'Failed to list artifacts');
      return reply.status(500).send({ 
        error: 'Failed to list artifacts',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Delete artifact endpoint
  fastify.delete('/api/artifacts/:id', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      await artifactService.deleteArtifact(userId, request.params.id);
      return reply.send({ message: 'Artifact deleted successfully' });
    } catch (error) {
      request.log.error({ error }, 'Failed to delete artifact');
      
      if (error instanceof Error && error.message.includes('not found')) {
        return reply.status(404).send({ error: 'Artifact not found' });
      }
      
      return reply.status(500).send({ 
        error: 'Failed to delete artifact',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get single artifact metadata
  fastify.get('/api/artifacts/:id', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) return reply.status(401).send({ error: 'User authentication required' });
      const artifact = await artifactService.getArtifact(userId, request.params.id);
      if (!artifact) return reply.status(404).send({ error: 'Artifact not found' });
      return reply.send(artifact);
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to get artifact' });
    }
  });

  // Download artifact file
  fastify.get('/api/artifacts/:id/download', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) return reply.status(401).send({ error: 'User authentication required' });

      const result = await artifactService.downloadArtifact(userId, request.params.id);
      if (!result) return reply.status(404).send({ error: 'Artifact not found or no file data available' });

      reply.header('Content-Type', result.mimeType);
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
      reply.header('Content-Length', result.buffer.length);
      return reply.send(result.buffer);
    } catch (error) {
      request.log.error({ error }, 'Failed to download artifact');
      return reply.status(500).send({ error: 'Failed to download artifact' });
    }
  });

  // Get artifact statistics endpoint
  fastify.get('/api/artifacts/stats', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      const stats = await artifactService.getArtifactStats(userId);
      return reply.send(stats);
    } catch (error) {
      request.log.error({ error }, 'Failed to get artifact stats');
      return reply.status(500).send({ 
        error: 'Failed to get artifact stats',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // ── Upload artifact to knowledge base (with DLP gate) ──
  fastify.post<{
    Params: { id: string };
    Body: { target: 'personal' | 'global'; title?: string; tags?: string[] };
  }>('/api/artifacts/:id/to-knowledge-base', {
    preHandler: authMiddleware,
  }, async (request: FastifyRequest<{
    Params: { id: string };
    Body: { target: 'personal' | 'global'; title?: string; tags?: string[] };
  }>, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      const { id: artifactId } = request.params;
      const { target = 'personal', title, tags } = request.body || {};

      // 1. Fetch artifact content from DB
      const prisma = (fastify as any).prisma;
      const artifact = await prisma.artifactFile.findFirst({
        where: { id: artifactId, userId },
      });
      if (!artifact) {
        return reply.status(404).send({ error: 'Artifact not found' });
      }

      const content = artifact.extractedText || artifact.originalName || '';
      if (!content || content.length < 10) {
        return reply.status(400).send({ error: 'Artifact has no meaningful content to ingest' });
      }

      // 2. DLP scan — ALWAYS required before knowledge base ingestion
      const dlpScanner = getDLPScanner(loggers.services);
      const dlpContext: DLPScanContext = {
        userId,
        scanPoint: 'workflow_data',
      };
      const dlpResult = dlpScanner.scanAndAct(content, dlpContext);

      if (dlpResult.blocked) {
        return reply.status(403).send({
          error: 'DLP policy blocked this content from entering the knowledge base',
          findings: dlpResult.result.findings.map(f => ({
            rule: f.ruleName,
            category: f.category,
            severity: f.severity,
          })),
          severity: dlpResult.result.severity,
        });
      }

      // 3. Use redacted text if DLP found issues but didn't block
      const safeContent = dlpResult.text;
      const hasRedactions = dlpResult.result.findings.length > 0;

      // 4. Ingest into knowledge base via KnowledgeIngestionService
      const milvus = new MilvusClient({
        address: process.env.MILVUS_HOST || 'localhost:19530',
        username: process.env.MILVUS_USERNAME,
        password: process.env.MILVUS_PASSWORD,
      });
      const ingestionService = new KnowledgeIngestionService(
        milvus,
        (fastify as any).prisma,
        loggers.services as any,
      );

      const collectionName = target === 'global' ? 'app_documentation' : `user_${userId}_knowledge`;
      const docTitle = title || artifact.originalName || `Artifact ${artifactId}`;

      const ingestResult = await ingestionService.ingestContent({
        content: safeContent,
        title: docTitle,
        source: `artifact:${artifactId}`,
        collectionName,
        metadata: {
          userId: target === 'personal' ? userId : undefined,
          tags: tags || [],
          isPrivate: target === 'personal',
        },
      });

      return reply.send({
        success: true,
        target,
        title: docTitle,
        contentLength: safeContent.length,
        chunks: ingestResult.chunks,
        hasRedactions,
        dlpFindings: hasRedactions ? dlpResult.result.findings.length : 0,
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to upload artifact to knowledge base');
      return reply.status(500).send({ error: 'Failed to ingest artifact into knowledge base' });
    }
  });

  // Health check endpoint
  fastify.get('/api/artifacts/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = await artifactService.healthCheck();
      return reply.send(health);
    } catch (error) {
      request.log.error({ error }, 'Artifact service health check failed');
      return reply.status(500).send({ 
        healthy: false,
        error: 'Health check failed' 
      });
    }
  });
};

export default artifactsRoutes;