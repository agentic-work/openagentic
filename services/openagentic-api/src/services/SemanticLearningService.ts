/**
 * SemanticLearningService - Learns from verified tool executions using pgvector
 *
 * This service provides ACID-compliant learning from verified tool results:
 * - Stores verified tool results with embeddings in PostgreSQL (pgvector)
 * - Learns from past executions to suggest similar results
 * - Supports user verification and quality scoring
 * - Uses PrismaVectorClient for atomic data+embedding operations
 *
 * Architecture Decision:
 * - Uses pgvector for VERIFIED results (<100K vectors, ACID guarantees needed)
 * - ToolResultCacheService uses Milvus for TEMPORARY caching (scale, no ACID needed)
 * - This separation allows verified knowledge to be persistent and transactional
 *
 * @see DATA_LAYER_EVOLUTION_PLAN.md for architecture decisions
 */

import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { Logger } from 'pino';
import logger from '../utils/logger.js';
import { prisma as globalPrisma } from '../utils/prisma.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { getPrismaVectorClient, type PrismaVectorClient } from './database/PrismaVectorClient.js';

// Constants
const DEFAULT_SIMILARITY_THRESHOLD = 0.85; // Higher than cache (0.90) for verified results
const DEFAULT_TOP_K = 5;
const EMBEDDING_DIMENSION = 1536;

/**
 * Verified tool result for learning
 */
export interface VerifiedResult {
  id: string;
  toolName: string;
  serverId: string;
  inputHash: string;
  inputParams: any;
  result: any;
  resultSummary?: string;
  isVerified: boolean;
  verifiedBy?: string;
  verifiedAt?: Date;
  verificationType?: 'user' | 'admin' | 'auto';
  qualityScore?: number;
  useCount: number;
  lastUsedAt: Date;
  userId?: string;
  sessionId?: string;
  createdAt: Date;
  updatedAt: Date;
  similarity?: number; // Added when returned from similarity search
}

/**
 * Parameters for storing a tool result
 */
export interface StoreResultParams {
  toolName: string;
  serverId: string;
  inputParams: any;
  result: any;
  resultSummary?: string;
  userId?: string;
  sessionId?: string;
}

/**
 * Parameters for finding similar results
 */
export interface FindSimilarParams {
  toolName: string;
  serverId: string;
  inputParams: any;
  queryText?: string;
  topK?: number;
  threshold?: number;
  verifiedOnly?: boolean;
  userId?: string;  // User isolation: restrict to own results + verified shared results
}

/**
 * Parameters for verifying a result
 */
export interface VerifyResultParams {
  resultId: string;
  verifiedBy: string;
  verificationType: 'user' | 'admin' | 'auto';
  qualityScore?: number;
}

/**
 * Learning statistics
 */
export interface LearningStats {
  totalResults: number;
  verifiedResults: number;
  avgQualityScore: number;
  topTools: Array<{ toolName: string; count: number }>;
  recentVerifications: number;
}

/**
 * SemanticLearningService
 * Provides persistent, ACID-compliant learning from verified tool results
 */
export class SemanticLearningService {
  private prisma: PrismaClient;
  private vectorClient: PrismaVectorClient;
  private embeddingService: UniversalEmbeddingService;
  private log: Logger;
  private isInitialized: boolean = false;

  constructor(prisma: PrismaClient, embeddingService?: UniversalEmbeddingService, customLogger?: Logger) {
    this.prisma = prisma;
    this.vectorClient = getPrismaVectorClient(prisma);
    this.log = customLogger || logger.child({ service: 'SemanticLearningService' });

    // Use provided embedding service or create new one
    if (embeddingService) {
      this.embeddingService = embeddingService;
    } else {
      this.embeddingService = new UniversalEmbeddingService(this.log);
    }
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Verify pgvector is available
      const health = await this.vectorClient.healthCheck();
      if (!health.healthy) {
        throw new Error(`pgvector health check failed: ${health.error || 'unknown error'}`);
      }

      // Check embedding service
      const embeddingConfigured = await this.embeddingService.isConfigured();
      if (!embeddingConfigured) {
        this.log.warn('Embedding service not fully configured - some features may be limited');
      }

      // Create HNSW index on verified_tool_results if not exists
      try {
        await this.vectorClient.createHNSWIndex({
          table: 'verified_tool_results',
          embeddingColumn: 'embedding',
          metric: 'cosine',
          m: 16,
          efConstruction: 64
        });
        this.log.info('HNSW index created or already exists on verified_tool_results');
      } catch (error) {
        // Index might already exist
        this.log.debug({ error }, 'HNSW index creation (may already exist)');
      }

      this.isInitialized = true;
      this.log.info({
        pgvectorVersion: health.pgvectorVersion,
        embeddingModel: this.embeddingService.getInfo().model,
        embeddingDimensions: this.embeddingService.getInfo().dimensions
      }, 'SemanticLearningService initialized');
    } catch (error) {
      this.log.error({ error }, 'Failed to initialize SemanticLearningService');
      throw error;
    }
  }

  /**
   * Generate hash for tool input parameters
   */
  private generateInputHash(inputParams: any): string {
    const normalized = JSON.stringify(inputParams || {}, Object.keys(inputParams || {}).sort());
    return createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Generate embedding text from tool execution
   */
  private generateEmbeddingText(toolName: string, serverId: string, inputParams: any, queryText?: string): string {
    const parts = [
      `Tool: ${toolName}`,
      `Server: ${serverId}`,
      `Parameters: ${JSON.stringify(inputParams || {})}`,
    ];

    if (queryText) {
      parts.push(`Query: ${queryText}`);
    }

    return parts.join('\n');
  }

  /**
   * Store a tool result for learning
   */
  async storeResult(params: StoreResultParams): Promise<VerifiedResult> {
    const { toolName, serverId, inputParams, result, resultSummary, userId, sessionId } = params;

    try {
      const inputHash = this.generateInputHash(inputParams);
      const embeddingText = this.generateEmbeddingText(toolName, serverId, inputParams);

      // Generate embedding
      const embeddingResult = await this.embeddingService.generateEmbedding(embeddingText);
      const embedding = embeddingResult.embedding;

      // Check if result already exists (deduplication)
      const existing = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM verified_tool_results
        WHERE tool_name = ${toolName}
        AND server_id = ${serverId}
        AND input_hash = ${inputHash}
        LIMIT 1
      `;

      if (existing.length > 0) {
        // Update existing record
        const existingId = existing[0].id;
        await this.prisma.$executeRaw`
          UPDATE verified_tool_results
          SET result = ${JSON.stringify(result)}::jsonb,
              result_summary = ${resultSummary || null},
              use_count = use_count + 1,
              last_used_at = NOW(),
              updated_at = NOW()
          WHERE id = ${existingId}
        `;

        this.log.info({ toolName, serverId, resultId: existingId }, 'Updated existing tool result');

        // Return the updated record
        return this.getResult(existingId) as Promise<VerifiedResult>;
      }

      // Create new record with embedding
      const id = randomUUID();
      const embeddingStr = `[${embedding.join(',')}]`;

      await this.prisma.$executeRaw`
        INSERT INTO verified_tool_results (
          id, tool_name, server_id, input_hash, input_params, result,
          result_summary, is_verified, quality_score, use_count, last_used_at,
          user_id, session_id, created_at, updated_at, embedding
        ) VALUES (
          ${id}, ${toolName}, ${serverId}, ${inputHash}, ${JSON.stringify(inputParams)}::jsonb,
          ${JSON.stringify(result)}::jsonb, ${resultSummary || null}, false, null, 1, NOW(),
          ${userId || null}, ${sessionId || null}, NOW(), NOW(), ${embeddingStr}::halfvec
        )
      `;

      this.log.info({ toolName, serverId, resultId: id }, 'Stored new tool result for learning');

      return this.getResult(id) as Promise<VerifiedResult>;
    } catch (error) {
      this.log.error({ error, toolName, serverId }, 'Failed to store tool result');
      throw error;
    }
  }

  /**
   * Get a specific result by ID
   */
  async getResult(id: string): Promise<VerifiedResult | null> {
    try {
      const results = await this.prisma.$queryRaw<Array<{
        id: string;
        tool_name: string;
        server_id: string;
        input_hash: string;
        input_params: any;
        result: any;
        result_summary: string | null;
        is_verified: boolean;
        verified_by: string | null;
        verified_at: Date | null;
        verification_type: string | null;
        quality_score: number | null;
        use_count: number;
        last_used_at: Date;
        user_id: string | null;
        session_id: string | null;
        created_at: Date;
        updated_at: Date;
      }>>`
        SELECT id, tool_name, server_id, input_hash, input_params, result,
               result_summary, is_verified, verified_by, verified_at,
               verification_type, quality_score, use_count, last_used_at,
               user_id, session_id, created_at, updated_at
        FROM verified_tool_results
        WHERE id = ${id}
      `;

      if (results.length === 0) return null;

      const r = results[0];
      return {
        id: r.id,
        toolName: r.tool_name,
        serverId: r.server_id,
        inputHash: r.input_hash,
        inputParams: r.input_params,
        result: r.result,
        resultSummary: r.result_summary || undefined,
        isVerified: r.is_verified,
        verifiedBy: r.verified_by || undefined,
        verifiedAt: r.verified_at || undefined,
        verificationType: r.verification_type as 'user' | 'admin' | 'auto' | undefined,
        qualityScore: r.quality_score || undefined,
        useCount: r.use_count,
        lastUsedAt: r.last_used_at,
        userId: r.user_id || undefined,
        sessionId: r.session_id || undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      };
    } catch (error) {
      this.log.error({ error, id }, 'Failed to get result');
      throw error;
    }
  }

  /**
   * Find similar past results using pgvector similarity search
   */
  async findSimilarResults(params: FindSimilarParams): Promise<VerifiedResult[]> {
    const {
      toolName,
      serverId,
      inputParams,
      queryText,
      topK = DEFAULT_TOP_K,
      threshold = DEFAULT_SIMILARITY_THRESHOLD,
      verifiedOnly = false,
      userId
    } = params;

    try {
      // Generate embedding for the query
      const embeddingText = this.generateEmbeddingText(toolName, serverId, inputParams, queryText);
      const embeddingResult = await this.embeddingService.generateEmbedding(embeddingText);
      const embedding = embeddingResult.embedding;
      const embeddingStr = `[${embedding.join(',')}]`;

      // Build WHERE clause with user isolation
      // Users see their own results + verified (org-wide shared) results
      let whereClause = `tool_name = '${toolName}' AND server_id = '${serverId}'`;
      if (userId) {
        whereClause += ` AND (user_id = '${userId}' OR is_verified = true)`;
      }
      if (verifiedOnly) {
        whereClause += ' AND is_verified = true';
      }

      // Perform similarity search using cosine distance
      // Note: pgvector's <=> operator returns distance, not similarity
      // We convert to similarity as 1 - distance
      const results = await this.prisma.$queryRawUnsafe<Array<{
        id: string;
        tool_name: string;
        server_id: string;
        input_hash: string;
        input_params: any;
        result: any;
        result_summary: string | null;
        is_verified: boolean;
        verified_by: string | null;
        verified_at: Date | null;
        verification_type: string | null;
        quality_score: number | null;
        use_count: number;
        last_used_at: Date;
        user_id: string | null;
        session_id: string | null;
        created_at: Date;
        updated_at: Date;
        similarity: number;
      }>>(`
        SELECT id, tool_name, server_id, input_hash, input_params, result,
               result_summary, is_verified, verified_by, verified_at,
               verification_type, quality_score, use_count, last_used_at,
               user_id, session_id, created_at, updated_at,
               1 - (embedding <=> '${embeddingStr}'::halfvec) as similarity
        FROM verified_tool_results
        WHERE ${whereClause}
          AND embedding IS NOT NULL
          AND 1 - (embedding <=> '${embeddingStr}'::halfvec) >= ${threshold}
        ORDER BY embedding <=> '${embeddingStr}'::halfvec
        LIMIT ${topK}
      `);

      this.log.info({
        toolName,
        serverId,
        resultsFound: results.length,
        threshold,
        verifiedOnly
      }, 'Found similar results');

      return results.map(r => ({
        id: r.id,
        toolName: r.tool_name,
        serverId: r.server_id,
        inputHash: r.input_hash,
        inputParams: r.input_params,
        result: r.result,
        resultSummary: r.result_summary || undefined,
        isVerified: r.is_verified,
        verifiedBy: r.verified_by || undefined,
        verifiedAt: r.verified_at || undefined,
        verificationType: r.verification_type as 'user' | 'admin' | 'auto' | undefined,
        qualityScore: r.quality_score || undefined,
        useCount: r.use_count,
        lastUsedAt: r.last_used_at,
        userId: r.user_id || undefined,
        sessionId: r.session_id || undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        similarity: r.similarity
      }));
    } catch (error) {
      this.log.error({ error, toolName, serverId }, 'Failed to find similar results');
      throw error;
    }
  }

  /**
   * Verify a tool result (mark as verified for learning)
   */
  async verifyResult(params: VerifyResultParams): Promise<VerifiedResult | null> {
    const { resultId, verifiedBy, verificationType, qualityScore } = params;

    try {
      await this.prisma.$executeRaw`
        UPDATE verified_tool_results
        SET is_verified = true,
            verified_by = ${verifiedBy},
            verified_at = NOW(),
            verification_type = ${verificationType},
            quality_score = ${qualityScore || null},
            updated_at = NOW()
        WHERE id = ${resultId}
      `;

      this.log.info({ resultId, verifiedBy, verificationType }, 'Result verified');

      return this.getResult(resultId);
    } catch (error) {
      this.log.error({ error, resultId }, 'Failed to verify result');
      throw error;
    }
  }

  /**
   * Record usage of a result (increases use_count)
   */
  async recordUsage(resultId: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE verified_tool_results
        SET use_count = use_count + 1,
            last_used_at = NOW(),
            updated_at = NOW()
        WHERE id = ${resultId}
      `;
    } catch (error) {
      this.log.error({ error, resultId }, 'Failed to record usage');
      // Non-fatal, don't throw
    }
  }

  /**
   * Get the best verified result for a tool execution
   * Returns the highest quality verified result that matches
   */
  async getBestVerifiedResult(toolName: string, serverId: string, inputParams: any): Promise<VerifiedResult | null> {
    const results = await this.findSimilarResults({
      toolName,
      serverId,
      inputParams,
      verifiedOnly: true,
      topK: 1,
      threshold: 0.95 // Very high threshold for "best" match
    });

    if (results.length === 0) return null;

    // Record usage
    await this.recordUsage(results[0].id);

    return results[0];
  }

  /**
   * Get learning statistics
   */
  async getStats(): Promise<LearningStats> {
    try {
      // Get total and verified counts
      const counts = await this.prisma.$queryRaw<[{
        total: bigint;
        verified: bigint;
        avg_quality: number | null;
        recent_verifications: bigint;
      }]>`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE is_verified = true) as verified,
          AVG(quality_score) FILTER (WHERE quality_score IS NOT NULL) as avg_quality,
          COUNT(*) FILTER (WHERE verified_at > NOW() - INTERVAL '7 days') as recent_verifications
        FROM verified_tool_results
      `;

      // Get top tools
      const topTools = await this.prisma.$queryRaw<Array<{
        tool_name: string;
        count: bigint;
      }>>`
        SELECT tool_name, COUNT(*) as count
        FROM verified_tool_results
        GROUP BY tool_name
        ORDER BY count DESC
        LIMIT 10
      `;

      return {
        totalResults: Number(counts[0].total),
        verifiedResults: Number(counts[0].verified),
        avgQualityScore: counts[0].avg_quality || 0,
        topTools: topTools.map(t => ({
          toolName: t.tool_name,
          count: Number(t.count)
        })),
        recentVerifications: Number(counts[0].recent_verifications)
      };
    } catch (error) {
      this.log.error({ error }, 'Failed to get stats');
      throw error;
    }
  }

  /**
   * Delete old, unused results (cleanup)
   */
  async cleanupOldResults(daysUnused: number = 90): Promise<number> {
    try {
      const result = await this.prisma.$executeRaw`
        DELETE FROM verified_tool_results
        WHERE is_verified = false
          AND last_used_at < NOW() - INTERVAL '${daysUnused} days'
      `;

      const deletedCount = Number(result);
      if (deletedCount > 0) {
        this.log.info({ deletedCount, daysUnused }, 'Cleaned up old unused results');
      }

      return deletedCount;
    } catch (error) {
      this.log.error({ error }, 'Failed to cleanup old results');
      throw error;
    }
  }

  /**
   * Health check for the service
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    initialized: boolean;
    pgvectorHealthy: boolean;
    embeddingConfigured: boolean;
    message: string;
  }> {
    try {
      const pgHealth = await this.vectorClient.healthCheck();
      const embeddingConfigured = await this.embeddingService.isConfigured();

      return {
        healthy: this.isInitialized && pgHealth.healthy,
        initialized: this.isInitialized,
        pgvectorHealthy: pgHealth.healthy,
        embeddingConfigured,
        message: pgHealth.healthy ? `pgvector ${pgHealth.pgvectorVersion}` : (pgHealth.error || 'unhealthy')
      };
    } catch (error) {
      return {
        healthy: false,
        initialized: this.isInitialized,
        pgvectorHealthy: false,
        embeddingConfigured: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

// Singleton instance
let instance: SemanticLearningService | null = null;

/**
 * Get or create the SemanticLearningService singleton
 */
export function getSemanticLearningService(
  prisma?: PrismaClient,
  embeddingService?: UniversalEmbeddingService
): SemanticLearningService {
  if (!instance) {
    instance = new SemanticLearningService(prisma || globalPrisma, embeddingService);
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetSemanticLearningService(): void {
  instance = null;
}

export default SemanticLearningService;
