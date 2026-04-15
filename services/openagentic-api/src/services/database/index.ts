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
