/**
 * PrismaVectorClient - Type-safe pgvector operations via Prisma
 *
 * Provides a wrapper around Prisma for vector similarity search using pgvector.
 * Used for transactional data (<100K vectors) that requires ACID guarantees.
 *
 * For scale data (millions of vectors), use MilvusService instead.
 *
 * @see DATA_LAYER_EVOLUTION_PLAN.md for architecture decisions
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { Logger } from 'pino';
import logger from '../../utils/logger.js';

// pgvector helper functions
function vectorToSql(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

function sqlToVector(sql: string): number[] {
  // Parse "[1,2,3]" format back to array
  return sql.replace(/[\[\]]/g, '').split(',').map(Number);
}

// Distance metric types supported by pgvector
export type DistanceMetric = 'cosine' | 'l2' | 'inner_product';

// Result from similarity search
export interface SimilarityResult<T = Record<string, unknown>> {
  id: string;
  distance: number;
  similarity: number;  // 1 - distance for cosine, normalized for others
  data: T;
}

// Parameters for finding similar vectors
export interface FindSimilarParams {
  table: string;
  embeddingColumn?: string;  // defaults to 'embedding'
  queryEmbedding: number[];
  limit?: number;
  threshold?: number;  // minimum similarity threshold (0-1)
  metric?: DistanceMetric;
  additionalColumns?: string[];  // columns to return besides id
  whereClause?: string;  // additional SQL WHERE conditions
}

// Parameters for updating embeddings
export interface UpdateEmbeddingParams {
  table: string;
  id: string;
  embeddingColumn?: string;
  embedding: number[];
}

// Parameters for batch embedding updates
export interface BatchUpdateEmbeddingParams {
  table: string;
  embeddingColumn?: string;
  updates: Array<{
    id: string;
    embedding: number[];
  }>;
}

// Parameters for creating HNSW index
export interface CreateHNSWIndexParams {
  table: string;
  embeddingColumn?: string;
  indexName?: string;
  m?: number;  // max connections per layer (default: 16)
  efConstruction?: number;  // size of dynamic candidate list (default: 64)
  metric?: DistanceMetric;
}

// Stats about vector data in a table
export interface VectorTableStats {
  table: string;
  totalRows: number;
  rowsWithEmbeddings: number;
  rowsWithoutEmbeddings: number;
  embeddingDimension: number | null;
  hasHNSWIndex: boolean;
  indexName?: string;
}

export class PrismaVectorClient {
  private prisma: PrismaClient;
  private log: Logger;
  private initialized: boolean = false;
  private pgvectorVersion: string | null = null;

  constructor(prisma: PrismaClient, customLogger?: Logger) {
    this.prisma = prisma;
    this.log = customLogger || logger.child({ service: 'PrismaVectorClient' });
  }

  /**
   * Initialize the client and verify pgvector is available
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      // Check if pgvector extension is installed
      const result = await this.prisma.$queryRaw<Array<{ extversion: string }>>`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `;

      if (result.length === 0) {
        this.log.error('pgvector extension is not installed');
        return false;
      }

      this.pgvectorVersion = result[0].extversion;
      this.initialized = true;
      this.log.info({ version: this.pgvectorVersion }, 'PrismaVectorClient initialized');
      return true;
    } catch (error) {
      this.log.error({ error }, 'Failed to initialize PrismaVectorClient');
      return false;
    }
  }

  /**
   * Ensure client is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      const success = await this.initialize();
      if (!success) {
        throw new Error('PrismaVectorClient failed to initialize - pgvector may not be installed');
      }
    }
  }

  /**
   * Convert number array to pgvector SQL format
   */
  toVectorSql(vector: number[]): string {
    return vectorToSql(vector);
  }

  /**
   * Parse pgvector SQL format to number array
   */
  fromVectorSql(vectorStr: string): number[] {
    return sqlToVector(vectorStr);
  }

  /**
   * Get the distance operator for the given metric
   */
  private getDistanceOperator(metric: DistanceMetric): string {
    switch (metric) {
      case 'cosine':
        return '<=>';  // cosine distance
      case 'l2':
        return '<->';  // Euclidean distance
      case 'inner_product':
        return '<#>';  // inner product (negative)
      default:
        return '<=>';
    }
  }

  /**
   * Find similar vectors using the specified distance metric
   */
  async findSimilar<T = Record<string, unknown>>(
    params: FindSimilarParams
  ): Promise<SimilarityResult<T>[]> {
    await this.ensureInitialized();

    const {
      table,
      embeddingColumn = 'embedding',
      queryEmbedding,
      limit = 10,
      threshold,
      metric = 'cosine',
      additionalColumns = [],
      whereClause
    } = params;

    const operator = this.getDistanceOperator(metric);
    const vectorSql = this.toVectorSql(queryEmbedding);

    // Build column selection
    const columns = ['id', ...additionalColumns].join(', ');

    // Build distance expression
    const distanceExpr = `"${embeddingColumn}" ${operator} '${vectorSql}'::halfvec AS distance`;

    // Build WHERE clause
    let where = `"${embeddingColumn}" IS NOT NULL`;
    if (threshold !== undefined) {
      // For cosine distance, lower is better (0 = identical, 2 = opposite)
      // Threshold is similarity (0-1), so we convert: distance < (1 - similarity) * 2
      const maxDistance = metric === 'cosine' ? (1 - threshold) * 2 : (1 - threshold);
      where += ` AND "${embeddingColumn}" ${operator} '${vectorSql}'::halfvec < ${maxDistance}`;
    }
    if (whereClause) {
      where += ` AND (${whereClause})`;
    }

    // Build and execute query
    const query = `
      SELECT ${columns}, ${distanceExpr}
      FROM "${table}"
      WHERE ${where}
      ORDER BY "${embeddingColumn}" ${operator} '${vectorSql}'::halfvec
      LIMIT ${limit}
    `;

    try {
      const results = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown> & { distance: number }>>(query);

      return results.map((row) => {
        const { distance, id, ...data } = row;
        // Convert distance to similarity (0-1 scale)
        let similarity: number;
        if (metric === 'cosine') {
          // Cosine distance is 0-2, where 0 = identical
          similarity = 1 - (distance / 2);
        } else if (metric === 'inner_product') {
          // Inner product is unbounded, normalize to 0-1
          similarity = Math.max(0, Math.min(1, 1 + distance)); // negative distance = higher similarity
        } else {
          // L2 distance: use inverse
          similarity = 1 / (1 + distance);
        }

        return {
          id: String(id),
          distance,
          similarity,
          data: data as T
        };
      });
    } catch (error) {
      this.log.error({ error, table, limit }, 'Failed to find similar vectors');
      throw error;
    }
  }

  /**
   * Update embedding for a single record
   */
  async updateEmbedding(params: UpdateEmbeddingParams): Promise<void> {
    await this.ensureInitialized();

    const {
      table,
      id,
      embeddingColumn = 'embedding',
      embedding
    } = params;

    const vectorSql = this.toVectorSql(embedding);

    try {
      await this.prisma.$executeRawUnsafe(`
        UPDATE "${table}"
        SET "${embeddingColumn}" = '${vectorSql}'::halfvec
        WHERE id = '${id}'
      `);

      this.log.debug({ table, id, dimensions: embedding.length }, 'Updated embedding');
    } catch (error) {
      this.log.error({ error, table, id }, 'Failed to update embedding');
      throw error;
    }
  }

  /**
   * Batch update embeddings for multiple records
   */
  async batchUpdateEmbeddings(params: BatchUpdateEmbeddingParams): Promise<number> {
    await this.ensureInitialized();

    const {
      table,
      embeddingColumn = 'embedding',
      updates
    } = params;

    if (updates.length === 0) return 0;

    try {
      // Use a transaction for batch updates
      let updatedCount = 0;

      await this.prisma.$transaction(async (tx) => {
        for (const update of updates) {
          const vectorSql = this.toVectorSql(update.embedding);
          await tx.$executeRawUnsafe(`
            UPDATE "${table}"
            SET "${embeddingColumn}" = '${vectorSql}'::halfvec
            WHERE id = '${update.id}'
          `);
          updatedCount++;
        }
      });

      this.log.info({ table, count: updatedCount }, 'Batch updated embeddings');
      return updatedCount;
    } catch (error) {
      this.log.error({ error, table, count: updates.length }, 'Failed to batch update embeddings');
      throw error;
    }
  }

  /**
   * Create an HNSW index for efficient similarity search.
   *
   * Respects DISABLE_VECTOR_INDEXES env var. Some CPU/pgvector combos
   * SIGILL on halfvec HNSW/ivfflat index builds (observed on local k3s
   * with pgvector 0.8.2). When DISABLE_VECTOR_INDEXES=true, this returns
   * without creating the index — the distance operator `<=>` still works
   * on halfvec columns, search just uses seq scan instead of HNSW.
   * Functionally correct, just slower on large collections.
   */
  async createHNSWIndex(params: CreateHNSWIndexParams): Promise<string> {
    if (process.env.DISABLE_VECTOR_INDEXES === 'true') {
      const name = params.indexName || `${params.table}_${params.embeddingColumn || 'embedding'}_hnsw_idx`;
      this.log.info({ indexName: name }, 'DISABLE_VECTOR_INDEXES=true — skipping index creation (seq scan will be used)');
      return name;
    }
    await this.ensureInitialized();

    const {
      table,
      embeddingColumn = 'embedding',
      indexName = `${table}_${embeddingColumn}_hnsw_idx`,
      m = 16,
      efConstruction = 64,
      metric = 'cosine'
    } = params;

    // Map metric to pgvector halfvec ops class. halfvec is our default
    // storage type (4000-dim HNSW ceiling vs 2000 for plain vector) —
    // all embedding columns in schema.prisma are Unsupported("halfvec(3072)").
    const opsClass = metric === 'cosine' ? 'halfvec_cosine_ops'
      : metric === 'l2' ? 'halfvec_l2_ops'
      : 'halfvec_ip_ops';

    try {
      // Check if index already exists
      const existingIndex = await this.prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = ${table}
        AND indexname = ${indexName}
      `;

      if (existingIndex.length > 0) {
        this.log.info({ indexName }, 'HNSW index already exists');
        return indexName;
      }

      // Create the index (CONCURRENTLY to avoid blocking)
      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS "${indexName}"
        ON "${table}" USING hnsw ("${embeddingColumn}" ${opsClass})
        WITH (m = ${m}, ef_construction = ${efConstruction})
      `);

      this.log.info({ indexName, table, m, efConstruction, metric }, 'Created HNSW index');
      return indexName;
    } catch (error) {
      this.log.error({ error, table, indexName }, 'Failed to create HNSW index');
      throw error;
    }
  }

  /**
   * Get statistics about vector data in a table
   */
  async getTableStats(table: string, embeddingColumn = 'embedding'): Promise<VectorTableStats> {
    await this.ensureInitialized();

    try {
      // Get row counts
      const countResult = await this.prisma.$queryRawUnsafe<Array<{
        total: bigint;
        with_embedding: bigint;
      }>>(`
        SELECT
          COUNT(*) as total,
          COUNT("${embeddingColumn}") as with_embedding
        FROM "${table}"
      `);

      const total = Number(countResult[0]?.total || 0);
      const withEmbedding = Number(countResult[0]?.with_embedding || 0);

      // Get embedding dimension from first non-null embedding
      let dimension: number | null = null;
      if (withEmbedding > 0) {
        const dimResult = await this.prisma.$queryRawUnsafe<Array<{ dim: number }>>(`
          SELECT vector_dims("${embeddingColumn}") as dim
          FROM "${table}"
          WHERE "${embeddingColumn}" IS NOT NULL
          LIMIT 1
        `);
        dimension = dimResult[0]?.dim || null;
      }

      // Check for HNSW index
      const indexResult = await this.prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = ${table}
        AND indexdef LIKE '%hnsw%'
      `;

      return {
        table,
        totalRows: total,
        rowsWithEmbeddings: withEmbedding,
        rowsWithoutEmbeddings: total - withEmbedding,
        embeddingDimension: dimension,
        hasHNSWIndex: indexResult.length > 0,
        indexName: indexResult[0]?.indexname
      };
    } catch (error) {
      this.log.error({ error, table }, 'Failed to get table stats');
      throw error;
    }
  }

  /**
   * Verify vector dimension matches expected size
   */
  async verifyVectorDimension(table: string, expectedDimension: number, embeddingColumn = 'embedding'): Promise<boolean> {
    const stats = await this.getTableStats(table, embeddingColumn);

    if (stats.embeddingDimension === null) {
      this.log.warn({ table }, 'No embeddings found to verify dimension');
      return true; // No embeddings yet, assume OK
    }

    if (stats.embeddingDimension !== expectedDimension) {
      this.log.error({
        table,
        expected: expectedDimension,
        actual: stats.embeddingDimension
      }, 'Vector dimension mismatch');
      return false;
    }

    return true;
  }

  /**
   * Calculate average distance between random samples (for quality monitoring)
   */
  async calculateAverageDistance(
    table: string,
    embeddingColumn = 'embedding',
    sampleSize = 100
  ): Promise<{ avgDistance: number; stdDev: number } | null> {
    await this.ensureInitialized();

    try {
      const result = await this.prisma.$queryRawUnsafe<Array<{
        avg_distance: number;
        std_dev: number;
      }>>(`
        WITH sample AS (
          SELECT "${embeddingColumn}"
          FROM "${table}"
          WHERE "${embeddingColumn}" IS NOT NULL
          ORDER BY RANDOM()
          LIMIT ${sampleSize}
        ),
        pairs AS (
          SELECT a."${embeddingColumn}" <=> b."${embeddingColumn}" as dist
          FROM sample a, sample b
          WHERE a."${embeddingColumn}" != b."${embeddingColumn}"
        )
        SELECT
          AVG(dist) as avg_distance,
          STDDEV(dist) as std_dev
        FROM pairs
      `);

      if (!result[0]?.avg_distance) return null;

      return {
        avgDistance: result[0].avg_distance,
        stdDev: result[0].std_dev || 0
      };
    } catch (error) {
      this.log.error({ error, table }, 'Failed to calculate average distance');
      return null;
    }
  }

  /**
   * Health check for vector operations
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    pgvectorVersion: string | null;
    error?: string;
  }> {
    try {
      await this.ensureInitialized();

      // Test basic halfvec distance operator (not a real embedding —
      // just confirming pgvector extension is installed and the halfvec
      // type + <=> operator work end-to-end). halfvec can take any
      // dimension at cast time; the test literal is intentionally tiny.
      const testResult = await this.prisma.$queryRaw<Array<{ distance: number }>>`
        SELECT '[1,2,3]'::halfvec <=> '[1,2,3]'::halfvec as distance
      `;

      return {
        healthy: testResult[0]?.distance === 0,
        pgvectorVersion: this.pgvectorVersion
      };
    } catch (error) {
      return {
        healthy: false,
        pgvectorVersion: this.pgvectorVersion,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

// Singleton instance
let instance: PrismaVectorClient | null = null;

/**
 * Get or create the PrismaVectorClient singleton
 */
export function getPrismaVectorClient(prisma: PrismaClient): PrismaVectorClient {
  if (!instance) {
    instance = new PrismaVectorClient(prisma);
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetPrismaVectorClient(): void {
  instance = null;
}

export default PrismaVectorClient;
