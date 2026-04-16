/**
 * Data Layer Test Suite
 *
 * Comprehensive validation tests for all data layer components:
 * - PostgreSQL + pgvector
 * - Redis
 * - Milvus
 *
 * Usage:
 *   npm run test:data-layer           # Full validation
 *   npm run test:data-layer:quick     # Quick connectivity check
 *   npm run test:data-layer:postgres  # PostgreSQL only
 *   npm run test:data-layer:redis     # Redis only
 *   npm run test:data-layer:milvus    # Milvus only
 *
 * Or via vitest:
 *   npm test -- src/tests/data-layer/
 */

export * from './setup.js';
export * from './postgres.test.js';
export * from './redis.test.js';
export * from './milvus.test.js';
export { runDataLayerValidation } from './runner.js';
export { DataLayerEvolutionTests, TestResult } from './data-evolution-tests.js';
