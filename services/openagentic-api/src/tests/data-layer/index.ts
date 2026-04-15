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
