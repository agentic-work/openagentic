/**
 * Database Services - Centralized exports for data layer operations
 *
 * This module provides access to:
 * - PrismaVectorClient: Type-safe pgvector operations for transactional data
 * - SchemaVersionService: Migration tracking for zero-downtime upgrades
 *
 * @see DATA_LAYER_EVOLUTION_PLAN.md for architecture decisions
 */

export {
  PrismaVectorClient,
  getPrismaVectorClient,
  resetPrismaVectorClient,
  type DistanceMetric,
  type SimilarityResult,
  type FindSimilarParams,
  type UpdateEmbeddingParams,
  type BatchUpdateEmbeddingParams,
  type CreateHNSWIndexParams,
  type VectorTableStats
} from './PrismaVectorClient.js';

export {
  SchemaVersionService,
  getSchemaVersionService,
  resetSchemaVersionService,
  type SchemaVersionRecord,
  type VersionCompareResult,
  type MigrationResult
} from './SchemaVersionService.js';
