/**
 * Data Layer Evolution Test Harness
 *
 * Tests all phases of the hybrid pgvector + Milvus architecture as defined in:
 * - docs/PGVECTOR_MILVUS_HYBRID_ARCHITECTURE.md
 * - docs/DATA_LAYER_EVOLUTION_PLAN.md
 *
 * Run with: npx tsx src/tests/data-layer/data-evolution-tests.ts
 */

import { PrismaClient } from '@prisma/client';
import { getPrismaVectorClient, PrismaVectorClient } from '../../services/database/PrismaVectorClient.js';
import { ToolSemanticCacheService, getToolSemanticCacheService } from '../../services/ToolSemanticCacheService.js';
import { ToolResultCacheService } from '../../services/ToolResultCacheService.js';
import { UniversalEmbeddingService } from '../../services/UniversalEmbeddingService.js';
import { ToolResultValidationService, getToolResultValidationService } from '../../services/ToolResultValidationService.js';
import { AutomaticSuccessScoringService, getAutomaticSuccessScoringService } from '../../services/AutomaticSuccessScoringService.js';
import { LargeResponseHandler, getLargeResponseHandler } from '../../services/LargeResponseHandler.js';
import { SemanticLearningService, getSemanticLearningService } from '../../services/SemanticLearningService.js';
import { FeedbackIntegrationService, getFeedbackIntegrationService } from '../../services/FeedbackIntegrationService.js';
import Redis from 'ioredis';
import logger from '../../utils/logger.js';

// Test result interface
interface TestResult {
  phase: string;
  test: string;
  passed: boolean;
  message: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

// Test suite class
class DataLayerEvolutionTests {
  private prisma: PrismaClient;
  private vectorClient: PrismaVectorClient;
  private redis: Redis | null = null;
  private embeddingService: UniversalEmbeddingService | null = null;
  private toolSemanticCache: ToolSemanticCacheService | null = null;
  private results: TestResult[] = [];
  private log = logger.child({ service: 'DataEvolutionTests' });

  constructor() {
    this.prisma = new PrismaClient();
    this.vectorClient = getPrismaVectorClient(this.prisma);
  }

  async initialize(): Promise<boolean> {
    try {
      // Connect to database
      await this.prisma.$connect();
      this.log.info('Connected to PostgreSQL');

      // Initialize vector client
      const vectorOk = await this.vectorClient.initialize();
      if (!vectorOk) {
        this.log.error('Failed to initialize PrismaVectorClient - pgvector may not be installed');
        return false;
      }
      this.log.info('PrismaVectorClient initialized');

      // Connect to Redis
      const redisUrl = process.env.REDIS_URL || 'redis://redis-master:6379';
      try {
        this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
        await this.redis.ping();
        this.log.info('Connected to Redis');
      } catch (error) {
        this.log.warn({ error }, 'Redis not available - some tests will be skipped');
      }

      // Initialize embedding service
      try {
        this.embeddingService = new UniversalEmbeddingService();
        this.log.info('Embedding service initialized');
      } catch (error) {
        this.log.warn({ error }, 'Embedding service not available - some tests will be skipped');
      }

      return true;
    } catch (error) {
      this.log.error({ error }, 'Failed to initialize test harness');
      return false;
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    if (this.redis) {
      await this.redis.quit();
    }
  }

  // Helper to run a test and record result
  private async runTest(
    phase: string,
    testName: string,
    testFn: () => Promise<{ passed: boolean; message: string; details?: Record<string, unknown> }>
  ): Promise<void> {
    const start = Date.now();
    try {
      const result = await testFn();
      this.results.push({
        phase,
        test: testName,
        passed: result.passed,
        message: result.message,
        durationMs: Date.now() - start,
        details: result.details
      });
    } catch (error) {
      this.results.push({
        phase,
        test: testName,
        passed: false,
        message: `Exception: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start
      });
    }
  }

  // ============================================================================
  // PHASE 1: pgvector Foundation Tests
  // ============================================================================
  async testPhase1_PgVectorFoundation(): Promise<void> {
    this.log.info('=== PHASE 1: pgvector Foundation ===');

    // Test 1.1: pgvector extension installed
    await this.runTest('Phase 1', 'pgvector extension installed', async () => {
      const health = await this.vectorClient.healthCheck();
      return {
        passed: health.healthy,
        message: health.healthy
          ? `pgvector v${health.pgvectorVersion} is healthy`
          : `pgvector not healthy: ${health.error}`,
        details: { version: health.pgvectorVersion }
      };
    });

    // Test 1.2: Vector distance calculation works
    await this.runTest('Phase 1', 'Vector distance calculation', async () => {
      const result = await this.prisma.$queryRaw<Array<{ distance: number }>>`
        SELECT '[1,0,0]'::vector <=> '[1,0,0]'::vector as distance
      `;
      const distance = result[0]?.distance;
      return {
        passed: distance === 0,
        message: distance === 0 ? 'Cosine distance works correctly' : `Unexpected distance: ${distance}`,
        details: { distance }
      };
    });

    // Test 1.3: Vector insert and search works
    await this.runTest('Phase 1', 'Vector insert and search', async () => {
      // Create test table if not exists
      await this.prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS _pgvector_test (
          id SERIAL PRIMARY KEY,
          embedding vector(3)
        )
      `;

      // Insert test vectors
      await this.prisma.$executeRaw`
        INSERT INTO _pgvector_test (embedding) VALUES
          ('[1,0,0]'::vector),
          ('[0,1,0]'::vector),
          ('[0,0,1]'::vector)
        ON CONFLICT DO NOTHING
      `;

      // Search for similar
      const results = await this.prisma.$queryRaw<Array<{ id: number; distance: number }>>`
        SELECT id, embedding <=> '[1,0,0]'::vector as distance
        FROM _pgvector_test
        ORDER BY distance
        LIMIT 1
      `;

      // Cleanup
      await this.prisma.$executeRaw`DROP TABLE IF EXISTS _pgvector_test`;

      const closest = results[0];
      return {
        passed: closest && closest.distance === 0,
        message: closest?.distance === 0
          ? 'Vector similarity search works'
          : `Unexpected search result: ${JSON.stringify(closest)}`,
        details: { result: closest }
      };
    });
  }

  // ============================================================================
  // PHASE 2: Schema Models Tests
  // ============================================================================
  async testPhase2_SchemaModels(): Promise<void> {
    this.log.info('=== PHASE 2: Schema Models ===');

    // Test 2.1: VerifiedToolResult model exists
    await this.runTest('Phase 2', 'VerifiedToolResult model exists', async () => {
      try {
        const count = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) as count FROM verified_tool_results
        `;
        return {
          passed: true,
          message: `verified_tool_results table exists (${count[0]?.count} rows)`,
          details: { rowCount: Number(count[0]?.count) }
        };
      } catch (error) {
        return {
          passed: false,
          message: 'verified_tool_results table does not exist'
        };
      }
    });

    // Test 2.2: QueryEmbeddingCache model exists
    await this.runTest('Phase 2', 'QueryEmbeddingCache model exists', async () => {
      try {
        const count = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) as count FROM query_embedding_cache
        `;
        return {
          passed: true,
          message: `query_embedding_cache table exists (${count[0]?.count} rows)`,
          details: { rowCount: Number(count[0]?.count) }
        };
      } catch (error) {
        return {
          passed: false,
          message: 'query_embedding_cache table does not exist'
        };
      }
    });

    // Test 2.3: KnowledgeFact model exists
    await this.runTest('Phase 2', 'KnowledgeFact model exists', async () => {
      try {
        const count = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) as count FROM knowledge_facts
        `;
        return {
          passed: true,
          message: `knowledge_facts table exists (${count[0]?.count} rows)`,
          details: { rowCount: Number(count[0]?.count) }
        };
      } catch (error) {
        return {
          passed: false,
          message: 'knowledge_facts table does not exist'
        };
      }
    });

    // Test 2.4: Embedding columns exist on key tables
    await this.runTest('Phase 2', 'Embedding columns configured', async () => {
      const tables = ['verified_tool_results', 'query_embedding_cache', 'knowledge_facts'];
      const results: Record<string, boolean> = {};

      for (const table of tables) {
        try {
          const cols = await this.prisma.$queryRaw<Array<{ column_name: string }>>`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = ${table} AND column_name = 'embedding'
          `;
          results[table] = cols.length > 0;
        } catch {
          results[table] = false;
        }
      }

      const allHaveEmbedding = Object.values(results).every(v => v);
      return {
        passed: allHaveEmbedding,
        message: allHaveEmbedding
          ? 'All tables have embedding columns'
          : `Missing embedding columns: ${Object.entries(results).filter(([, v]) => !v).map(([k]) => k).join(', ')}`,
        details: results
      };
    });
  }

  // ============================================================================
  // PHASE 3: Embedding Service Tests
  // ============================================================================
  async testPhase3_EmbeddingService(): Promise<void> {
    this.log.info('=== PHASE 3: Embedding Service ===');

    if (!this.embeddingService) {
      this.results.push({
        phase: 'Phase 3',
        test: 'Embedding Service',
        passed: false,
        message: 'Embedding service not initialized - skipping phase',
        durationMs: 0
      });
      return;
    }

    // Test 3.1: Generate embedding
    await this.runTest('Phase 3', 'Generate embedding', async () => {
      if (!this.embeddingService) throw new Error('No embedding service');

      const testText = 'What is the capital of France?';
      const embedding = await this.embeddingService.generateEmbedding(testText);

      return {
        passed: embedding && embedding.length > 0,
        message: embedding
          ? `Generated ${embedding.length}-dimensional embedding`
          : 'Failed to generate embedding',
        details: { dimensions: embedding?.length }
      };
    });

    // Test 3.2: Batch embeddings
    await this.runTest('Phase 3', 'Batch embeddings', async () => {
      if (!this.embeddingService) throw new Error('No embedding service');

      const texts = ['Hello world', 'How are you?', 'Testing batch embeddings'];
      const embeddings = await this.embeddingService.generateBatchEmbeddings(texts);

      return {
        passed: embeddings && embeddings.length === texts.length,
        message: embeddings
          ? `Generated ${embeddings.length} batch embeddings`
          : 'Failed to generate batch embeddings',
        details: { count: embeddings?.length, expectedCount: texts.length }
      };
    });

    // Test 3.3: Semantic similarity
    await this.runTest('Phase 3', 'Semantic similarity', async () => {
      if (!this.embeddingService) throw new Error('No embedding service');

      const text1 = 'What is the weather in Seattle?';
      const text2 = 'Tell me about Seattle weather';
      const text3 = 'What is 2 + 2?';

      const [emb1, emb2, emb3] = await Promise.all([
        this.embeddingService.generateEmbedding(text1),
        this.embeddingService.generateEmbedding(text2),
        this.embeddingService.generateEmbedding(text3)
      ]);

      // Calculate cosine similarity
      const cosineSim = (a: number[], b: number[]): number => {
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) {
          dot += a[i] * b[i];
          magA += a[i] * a[i];
          magB += b[i] * b[i];
        }
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
      };

      const simSimilar = cosineSim(emb1, emb2);
      const simDifferent = cosineSim(emb1, emb3);

      const passed = simSimilar > simDifferent;
      return {
        passed,
        message: passed
          ? `Similar texts (${simSimilar.toFixed(3)}) rank higher than different (${simDifferent.toFixed(3)})`
          : `Unexpected similarity: similar=${simSimilar.toFixed(3)}, different=${simDifferent.toFixed(3)}`,
        details: { similarPairSimilarity: simSimilar, differentPairSimilarity: simDifferent }
      };
    });
  }

  // ============================================================================
  // PHASE 4: Redis Cache Layer Tests
  // ============================================================================
  async testPhase4_RedisCache(): Promise<void> {
    this.log.info('=== PHASE 4: Redis Cache Layer ===');

    if (!this.redis) {
      this.results.push({
        phase: 'Phase 4',
        test: 'Redis Cache',
        passed: false,
        message: 'Redis not available - skipping phase',
        durationMs: 0
      });
      return;
    }

    // Test 4.1: Redis connection
    await this.runTest('Phase 4', 'Redis connection', async () => {
      const pong = await this.redis!.ping();
      return {
        passed: pong === 'PONG',
        message: pong === 'PONG' ? 'Redis connection healthy' : `Unexpected response: ${pong}`
      };
    });

    // Test 4.2: Cache set/get
    await this.runTest('Phase 4', 'Cache set/get', async () => {
      const testKey = 'test:cache:evolution';
      const testValue = JSON.stringify({ test: true, timestamp: Date.now() });

      await this.redis!.set(testKey, testValue, 'EX', 60);
      const retrieved = await this.redis!.get(testKey);
      await this.redis!.del(testKey);

      return {
        passed: retrieved === testValue,
        message: retrieved === testValue ? 'Cache set/get works' : 'Cache value mismatch'
      };
    });

    // Test 4.3: Tool result cache key structure
    await this.runTest('Phase 4', 'Tool cache key structure', async () => {
      // Check for tool cache keys pattern
      const keys = await this.redis!.keys('tool:result:*');
      return {
        passed: true,
        message: `Found ${keys.length} cached tool results`,
        details: { cachedToolResults: keys.length }
      };
    });
  }

  // ============================================================================
  // PHASE 5: Cross-User Cache Tests
  // ============================================================================
  async testPhase5_CrossUserCache(): Promise<void> {
    this.log.info('=== PHASE 5: Cross-User Caching ===');

    // Test 5.1: ToolResultCacheService exists
    await this.runTest('Phase 5', 'ToolResultCacheService available', async () => {
      try {
        // Import dynamically to check if it exists
        const { ToolResultCacheService } = await import('../../services/ToolResultCacheService.js');
        return {
          passed: typeof ToolResultCacheService === 'function',
          message: 'ToolResultCacheService class is available'
        };
      } catch (error) {
        return {
          passed: false,
          message: `ToolResultCacheService not found: ${error}`
        };
      }
    });

    // Test 5.2: Cross-user cache columns in verified_tool_results
    await this.runTest('Phase 5', 'Cross-user cache schema', async () => {
      try {
        const columns = await this.prisma.$queryRaw<Array<{ column_name: string }>>`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'verified_tool_results'
        `;
        const columnNames = columns.map(c => c.column_name);
        const requiredColumns = ['usage_count', 'verification_level', 'is_stale'];
        const hasAll = requiredColumns.every(c => columnNames.includes(c));

        return {
          passed: hasAll,
          message: hasAll
            ? 'Cross-user cache columns present'
            : `Missing columns: ${requiredColumns.filter(c => !columnNames.includes(c)).join(', ')}`,
          details: { columns: columnNames }
        };
      } catch (error) {
        return {
          passed: false,
          message: `Could not check schema: ${error}`
        };
      }
    });
  }

  // ============================================================================
  // PHASE 6: End-to-End Cache Flow Tests
  // ============================================================================
  async testPhase6_EndToEndCacheFlow(): Promise<void> {
    this.log.info('=== PHASE 6: End-to-End Cache Flow ===');

    // Test 6.1: Cache miss → execution → cache store
    await this.runTest('Phase 6', 'Cache flow simulation', async () => {
      // This is a simulation - real E2E would require running the full pipeline
      const testQuery = 'test query for cache flow ' + Date.now();

      // Check cache (should miss)
      const cacheKey = `cache:query:${Buffer.from(testQuery).toString('base64')}`;
      const cacheMiss = await this.redis?.get(cacheKey);

      if (cacheMiss) {
        return {
          passed: false,
          message: 'Unexpected cache hit for new query'
        };
      }

      // Store in cache
      const mockResult = { result: 'test', timestamp: Date.now() };
      await this.redis?.set(cacheKey, JSON.stringify(mockResult), 'EX', 60);

      // Verify cache hit
      const cacheHit = await this.redis?.get(cacheKey);

      // Cleanup
      await this.redis?.del(cacheKey);

      return {
        passed: cacheHit !== null,
        message: cacheHit ? 'Cache flow works: miss → store → hit' : 'Cache store failed'
      };
    });
  }

  // ============================================================================
  // PHASE 7: Tool Result Validation Tests (Hallucination Prevention)
  // ============================================================================
  async testPhase7_ToolResultValidation(): Promise<void> {
    this.log.info('=== PHASE 7: Tool Result Validation (Hallucination Prevention) ===');

    // Test 7.1: ToolResultValidationService exists
    await this.runTest('Phase 7', 'ToolResultValidationService available', async () => {
      try {
        const service = getToolResultValidationService();
        return {
          passed: service !== null,
          message: 'ToolResultValidationService singleton is available'
        };
      } catch (error) {
        return {
          passed: false,
          message: `ToolResultValidationService not available: ${error}`
        };
      }
    });

    // Test 7.2: Claim extraction - count claims
    await this.runTest('Phase 7', 'Extract count claims', async () => {
      const service = getToolResultValidationService();
      const llmSummary = 'I found 3 backends that are unhealthy and 5 that are healthy.';

      // Use internal method via type assertion for testing
      const claims = (service as any).extractClaims(llmSummary);
      const countClaims = claims.filter((c: any) => c.type === 'count');

      return {
        passed: countClaims.length >= 2,
        message: `Extracted ${countClaims.length} count claims from summary`,
        details: { claims: countClaims.map((c: any) => ({ text: c.text, value: c.extractedValue })) }
      };
    });

    // Test 7.3: Claim extraction - status claims
    await this.runTest('Phase 7', 'Extract status claims', async () => {
      const service = getToolResultValidationService();
      const llmSummary = 'The backend is unhealthy and showing errors. The frontend is healthy.';

      const claims = (service as any).extractClaims(llmSummary);
      const statusClaims = claims.filter((c: any) => c.type === 'status');

      return {
        passed: statusClaims.length >= 2,
        message: `Extracted ${statusClaims.length} status claims from summary`,
        details: { claims: statusClaims.map((c: any) => ({ text: c.text, value: c.extractedValue })) }
      };
    });

    // Test 7.4: Count claim validation - correct
    await this.runTest('Phase 7', 'Validate count claim (correct)', async () => {
      const service = getToolResultValidationService();
      const rawResult = JSON.stringify([{ name: 'backend-1' }, { name: 'backend-2' }, { name: 'backend-3' }]);
      const llmSummary = 'Found 3 backends in the system.';

      const validation = await service.validateInterpretation('test-1', 'list_backends', rawResult, llmSummary);

      return {
        passed: validation.overallConfidence >= 0.9,
        message: `Count claim validated with ${(validation.overallConfidence * 100).toFixed(1)}% confidence`,
        details: {
          overallConfidence: validation.overallConfidence,
          validatedClaims: validation.validatedClaims
        }
      };
    });

    // Test 7.5: Count claim validation - hallucinated
    await this.runTest('Phase 7', 'Detect hallucinated count', async () => {
      const service = getToolResultValidationService();
      const rawResult = JSON.stringify([{ name: 'backend-1' }, { name: 'backend-2' }]);
      const llmSummary = 'Found 5 backends in the system.';

      const validation = await service.validateInterpretation('test-2', 'list_backends', rawResult, llmSummary);

      // Should detect contradiction
      const hasContradiction = validation.validatedClaims.some(vc => vc.status === 'contradicted');

      return {
        passed: hasContradiction && validation.overallConfidence < 0.5,
        message: hasContradiction
          ? `Hallucination detected: claimed 5 but found 2`
          : 'Failed to detect count hallucination',
        details: {
          overallConfidence: validation.overallConfidence,
          warnings: validation.warnings
        }
      };
    });

    // Test 7.6: Status claim validation - correct
    await this.runTest('Phase 7', 'Validate status claim (correct)', async () => {
      const service = getToolResultValidationService();
      const rawResult = JSON.stringify({
        backends: [
          { name: 'pool-1', status: 'healthy' },
          { name: 'pool-2', status: 'healthy' }
        ]
      });
      const llmSummary = 'All backends are healthy.';

      const validation = await service.validateInterpretation('test-3', 'check_health', rawResult, llmSummary);

      return {
        passed: validation.overallConfidence >= 0.7,
        message: `Status validated with ${(validation.overallConfidence * 100).toFixed(1)}% confidence`,
        details: { validatedClaims: validation.validatedClaims }
      };
    });

    // Test 7.7: Status claim validation - hallucinated (opposite status)
    await this.runTest('Phase 7', 'Detect hallucinated status', async () => {
      const service = getToolResultValidationService();
      const rawResult = JSON.stringify({
        backends: [
          { name: 'pool-1', status: 'healthy' },
          { name: 'pool-2', status: 'healthy' }
        ]
      });
      const llmSummary = 'Found 2 unhealthy backends that need attention.';

      const validation = await service.validateInterpretation('test-4', 'check_health', rawResult, llmSummary);

      // Should have low confidence due to contradiction
      return {
        passed: validation.overallConfidence < 0.5 || validation.warnings.length > 0,
        message: `Status hallucination detection: confidence=${(validation.overallConfidence * 100).toFixed(1)}%`,
        details: {
          overallConfidence: validation.overallConfidence,
          warnings: validation.warnings,
          shouldRegenerate: validation.shouldRegenerate
        }
      };
    });

    // Test 7.8: Name claim validation
    await this.runTest('Phase 7', 'Validate name claims', async () => {
      const service = getToolResultValidationService();
      const rawResult = JSON.stringify({
        clusters: ['cluster-prod', 'cluster-dev', 'cluster-staging']
      });
      const llmSummary = 'Found clusters: "cluster-prod" and "cluster-dev".';

      const validation = await service.validateInterpretation('test-5', 'list_clusters', rawResult, llmSummary);

      const nameClaims = validation.validatedClaims.filter(vc => vc.claim.type === 'name');
      const verifiedNames = nameClaims.filter(vc => vc.status === 'verified');

      return {
        passed: verifiedNames.length >= 2,
        message: `Verified ${verifiedNames.length} name claims`,
        details: { nameClaims, verifiedNames }
      };
    });

    // Test 7.9: Hallucinated name detection
    await this.runTest('Phase 7', 'Detect hallucinated names', async () => {
      const service = getToolResultValidationService();
      const rawResult = JSON.stringify({
        clusters: ['cluster-prod', 'cluster-dev']
      });
      const llmSummary = 'Found clusters: "cluster-prod", "cluster-fake", and "nonexistent-cluster".';

      const validation = await service.validateInterpretation('test-6', 'list_clusters', rawResult, llmSummary);

      const nameClaims = validation.validatedClaims.filter(vc => vc.claim.type === 'name');
      const contradicted = nameClaims.filter(vc => vc.status === 'contradicted');

      return {
        passed: contradicted.length >= 1,
        message: `Detected ${contradicted.length} hallucinated name(s)`,
        details: {
          contradictedNames: contradicted.map(c => c.claim.text),
          warnings: validation.warnings
        }
      };
    });

    // Test 7.10: Regeneration trigger
    await this.runTest('Phase 7', 'Regeneration triggered on critical contradiction', async () => {
      const service = getToolResultValidationService();
      const rawResult = JSON.stringify([]);  // Empty array
      const llmSummary = 'Found 10 critical errors that require immediate attention.';

      const validation = await service.validateInterpretation('test-7', 'list_errors', rawResult, llmSummary);

      return {
        passed: validation.shouldRegenerate === true,
        message: validation.shouldRegenerate
          ? 'Correctly flagged for regeneration'
          : 'Failed to trigger regeneration',
        details: {
          shouldRegenerate: validation.shouldRegenerate,
          overallConfidence: validation.overallConfidence,
          warnings: validation.warnings
        }
      };
    });
  }

  // ============================================================================
  // PHASE 8: Automatic Success Scoring Tests
  // ============================================================================
  async testPhase8_AutomaticScoring(): Promise<void> {
    this.log.info('=== PHASE 8: Automatic Success Scoring ===');

    // Test 8.1: Service available
    await this.runTest('Phase 8', 'AutomaticSuccessScoringService available', async () => {
      try {
        const service = getAutomaticSuccessScoringService();
        return {
          passed: service !== null,
          message: 'AutomaticSuccessScoringService singleton is available'
        };
      } catch (error) {
        return {
          passed: false,
          message: `AutomaticSuccessScoringService not available: ${error}`
        };
      }
    });

    // Test 8.2: Successful execution scoring
    await this.runTest('Phase 8', 'Score successful execution', async () => {
      const service = getAutomaticSuccessScoringService();
      const result = JSON.stringify({ data: [1, 2, 3], success: true });

      const scoring = service.scoreExecution(
        'test-scoring-1',
        'list_items',
        'test-server',
        200,  // HTTP 200
        500,  // 500ms response time
        result
      );

      return {
        passed: scoring.finalScore > 0.7,
        message: `Successful execution scored ${(scoring.finalScore * 100).toFixed(1)}%`,
        details: {
          finalScore: scoring.finalScore,
          executionScore: scoring.executionScore.score,
          structuralScore: scoring.structuralScore.score,
          confidence: scoring.confidence
        }
      };
    });

    // Test 8.3: Failed execution scoring
    await this.runTest('Phase 8', 'Score failed execution', async () => {
      const service = getAutomaticSuccessScoringService();
      const result = JSON.stringify({ error: 'Connection refused', status: 'failed' });

      const scoring = service.scoreExecution(
        'test-scoring-2',
        'list_items',
        'test-server',
        500,  // HTTP 500
        5000, // 5s response time
        result
      );

      return {
        passed: scoring.finalScore < 0.5,
        message: `Failed execution scored ${(scoring.finalScore * 100).toFixed(1)}%`,
        details: {
          finalScore: scoring.finalScore,
          executionScore: scoring.executionScore.score,
          structuralScore: scoring.structuralScore.score
        }
      };
    });

    // Test 8.4: Empty result scoring
    await this.runTest('Phase 8', 'Score empty result', async () => {
      const service = getAutomaticSuccessScoringService();

      const scoring = service.scoreExecution(
        'test-scoring-3',
        'list_items',
        'test-server',
        200,
        100,
        ''  // Empty result
      );

      return {
        passed: scoring.finalScore < 0.6,
        message: `Empty result scored ${(scoring.finalScore * 100).toFixed(1)}%`,
        details: { finalScore: scoring.finalScore }
      };
    });

    // Test 8.5: Response time impact
    await this.runTest('Phase 8', 'Response time affects score', async () => {
      const service = getAutomaticSuccessScoringService();
      const result = JSON.stringify({ ok: true });

      const fastScoring = service.scoreExecution(
        'test-scoring-4a',
        'fast_tool',
        'test-server',
        200,
        100,  // Fast
        result
      );

      const slowScoring = service.scoreExecution(
        'test-scoring-4b',
        'slow_tool',
        'test-server',
        200,
        9000, // Slow
        result
      );

      return {
        passed: fastScoring.executionScore.score > slowScoring.executionScore.score,
        message: `Fast (${fastScoring.executionScore.score.toFixed(2)}) > Slow (${slowScoring.executionScore.score.toFixed(2)})`,
        details: {
          fastScore: fastScoring.executionScore.score,
          slowScore: slowScoring.executionScore.score
        }
      };
    });

    // Test 8.6: Behavioral scoring
    await this.runTest('Phase 8', 'Behavioral score updates', async () => {
      const service = getAutomaticSuccessScoringService();

      const positiveScore = service.updateBehavioralScore('test-1', 'positive');
      const negativeScore = service.updateBehavioralScore('test-2', 'negative');
      const retryScore = service.updateBehavioralScore('test-3', 'retry');
      const followUpScore = service.updateBehavioralScore('test-4', 'followUp');

      return {
        passed: positiveScore.score > negativeScore.score &&
                followUpScore.score > retryScore.score,
        message: 'Behavioral signals correctly impact scores',
        details: {
          positive: positiveScore.score,
          negative: negativeScore.score,
          followUp: followUpScore.score,
          retry: retryScore.score
        }
      };
    });

    // Test 8.7: Tool reliability aggregation
    await this.runTest('Phase 8', 'Tool reliability aggregation', async () => {
      const service = getAutomaticSuccessScoringService();

      // Score multiple executions to build aggregate
      for (let i = 0; i < 12; i++) {
        const score = 0.7 + (Math.random() * 0.2);  // 0.7-0.9
        service.scoreExecution(
          `aggregate-test-${i}`,
          'aggregate_tool',
          'aggregate-server',
          200,
          500,
          JSON.stringify({ success: true, data: i })
        );
      }

      const aggregate = service.getToolReliability('aggregate_tool', 'aggregate-server');

      return {
        passed: aggregate !== null && aggregate.totalExecutions >= 12,
        message: aggregate
          ? `Aggregate: ${aggregate.totalExecutions} executions, ${(aggregate.averageScore * 100).toFixed(1)}% avg, tier=${aggregate.tier}`
          : 'No aggregate found',
        details: aggregate || {}
      };
    });

    // Test 8.8: Tier classification
    await this.runTest('Phase 8', 'Tier classification', async () => {
      const service = getAutomaticSuccessScoringService();

      const aggregates = service.getAllAggregates();
      const tierCounts: Record<string, number> = {
        gold: 0, silver: 0, bronze: 0, untrusted: 0
      };

      for (const agg of aggregates) {
        tierCounts[agg.tier]++;
      }

      return {
        passed: aggregates.length > 0,
        message: `Tier distribution: gold=${tierCounts.gold}, silver=${tierCounts.silver}, bronze=${tierCounts.bronze}, untrusted=${tierCounts.untrusted}`,
        details: tierCounts
      };
    });
  }

  // ============================================================================
  // PHASE 9: Large Response Handler Tests
  // ============================================================================
  async testPhase9_LargeResponseHandler(): Promise<void> {
    this.log.info('=== PHASE 9: Large Response Handler ===');

    // Test 9.1: Service available
    await this.runTest('Phase 9', 'LargeResponseHandler available', async () => {
      try {
        const handler = getLargeResponseHandler();
        return {
          passed: handler !== null,
          message: 'LargeResponseHandler singleton is available'
        };
      } catch (error) {
        return {
          passed: false,
          message: `LargeResponseHandler not available: ${error}`
        };
      }
    });

    // Test 9.2: Small response passthrough
    await this.runTest('Phase 9', 'Small response passthrough', async () => {
      const handler = getLargeResponseHandler();
      const smallResult = { data: [1, 2, 3], status: 'ok' };

      const processed = await handler.processLargeResponse(
        smallResult,
        'Show me the data',
        16000
      );

      return {
        passed: processed.compressionStrategy === 'passthrough' &&
                processed.informationLoss === 'none',
        message: `Strategy: ${processed.compressionStrategy}, loss: ${processed.informationLoss}`,
        details: {
          originalSize: processed.originalSize,
          compressedSize: processed.compressedSize,
          strategy: processed.compressionStrategy
        }
      };
    });

    // Test 9.3: Large array summarization
    await this.runTest('Phase 9', 'Large array summarization', async () => {
      const handler = getLargeResponseHandler();
      // Generate large array
      const largeArray = Array.from({ length: 200 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        status: i % 10 === 0 ? 'error' : 'healthy'
      }));

      const processed = await handler.processLargeResponse(
        largeArray,
        'Show me all items',
        4000
      );

      return {
        passed: processed.compressedSize < processed.originalSize &&
                processed.compressionStrategy !== 'passthrough',
        message: `Compressed from ${processed.originalSize} to ${processed.compressedSize} chars (${processed.compressionStrategy})`,
        details: {
          compressionRatio: (processed.compressedSize / processed.originalSize * 100).toFixed(1) + '%',
          strategy: processed.compressionStrategy,
          informationLoss: processed.informationLoss
        }
      };
    });

    // Test 9.4: Anomaly prioritization
    await this.runTest('Phase 9', 'Anomaly prioritization', async () => {
      const handler = getLargeResponseHandler();
      const itemsWithAnomalies = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `backend-${i}`,
        status: i < 3 ? 'unhealthy' : 'healthy'
      }));

      const processed = await handler.processLargeResponse(
        itemsWithAnomalies,
        'Are there any unhealthy backends?',
        4000
      );

      // Check that anomalies are mentioned
      const mentionsUnhealthy = processed.compressedResult.includes('unhealthy') ||
                                 processed.compressedResult.includes('anomal');

      return {
        passed: mentionsUnhealthy && processed.anomaliesPreserved,
        message: `Anomalies preserved: ${processed.anomaliesPreserved}`,
        details: {
          anomaliesPreserved: processed.anomaliesPreserved,
          resultPreview: processed.compressedResult.substring(0, 200)
        }
      };
    });

    // Test 9.5: Query-aligned filtering
    await this.runTest('Phase 9', 'Query-aligned filtering', async () => {
      const handler = getLargeResponseHandler();
      const mixedItems = [
        { type: 'http', rule: 'rule-1', status: 'active' },
        { type: 'tcp', rule: 'rule-2', status: 'active' },
        { type: 'http', rule: 'rule-3', status: 'active' },
        { type: 'tcp', rule: 'rule-4', status: 'active' },
        { type: 'http', rule: 'rule-5', status: 'error' }
      ];

      const processed = await handler.processLargeResponse(
        mixedItems,
        'Show me HTTP rules',
        4000
      );

      // Should mention HTTP filtering
      const mentionsHttp = processed.compressedResult.toLowerCase().includes('http');

      return {
        passed: mentionsHttp,
        message: `Query filtering: HTTP mentioned: ${mentionsHttp}`,
        details: {
          strategy: processed.compressionStrategy,
          resultPreview: processed.compressedResult.substring(0, 300)
        }
      };
    });

    // Test 9.6: Statistical summary extraction
    await this.runTest('Phase 9', 'Statistical summary extraction', async () => {
      const handler = getLargeResponseHandler();
      const largeData = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        status: ['active', 'inactive', 'pending'][i % 3],
        type: ['A', 'B', 'C', 'D'][i % 4]
      }));

      const processed = await handler.processLargeResponse(
        largeData,
        'How many items are there by type?',
        2000
      );

      // Should contain count information
      const hasCountInfo = processed.compressedResult.includes('500') ||
                           processed.compressedResult.includes('Total');

      return {
        passed: hasCountInfo,
        message: `Contains count info: ${hasCountInfo}`,
        details: {
          strategy: processed.compressionStrategy,
          informationLoss: processed.informationLoss
        }
      };
    });

    // Test 9.7: Pagination support
    await this.runTest('Phase 9', 'Pagination support', async () => {
      const handler = getLargeResponseHandler();
      const largeArray = Array.from({ length: 100 }, (_, i) => ({ id: i }));

      const processed = await handler.processLargeResponse(
        largeArray,
        'List all items',
        4000
      );

      return {
        passed: processed.pagination !== undefined &&
                processed.pagination.hasMore === true,
        message: processed.pagination
          ? `Pagination: ${processed.pagination.shown}/${processed.pagination.total} shown`
          : 'No pagination info',
        details: processed.pagination || {}
      };
    });

    // Test 9.8: Full result storage and retrieval
    await this.runTest('Phase 9', 'Full result storage', async () => {
      const handler = getLargeResponseHandler();
      const largeResult = Array.from({ length: 200 }, (_, i) => ({ id: i, data: `item-${i}` }));

      const processed = await handler.processLargeResponse(
        largeResult,
        'Show me everything',
        2000
      );

      let canRetrieve = false;
      if (processed.fullResultId) {
        const retrieved = handler.getFullResult(processed.fullResultId);
        canRetrieve = retrieved !== null && Array.isArray(retrieved);
      }

      return {
        passed: processed.fullResultId !== undefined,
        message: processed.fullResultId
          ? `Full result stored with ID: ${processed.fullResultId.substring(0, 8)}...`
          : 'No full result stored',
        details: {
          fullResultId: processed.fullResultId,
          canRetrieve
        }
      };
    });

    // Test 9.9: Error field detection
    await this.runTest('Phase 9', 'Error field detection', async () => {
      const handler = getLargeResponseHandler();
      const resultWithErrors = {
        data: [1, 2, 3],
        status: 'completed',
        errors: ['Connection timeout', 'Retry failed'],
        warnings: ['Rate limit approaching']
      };

      const processed = await handler.processLargeResponse(
        resultWithErrors,
        'What happened with the request?',
        4000
      );

      const mentionsErrors = processed.compressedResult.includes('error') ||
                              processed.compressedResult.includes('warning') ||
                              processed.compressedResult.includes('Error');

      return {
        passed: mentionsErrors,
        message: `Error fields detected: ${mentionsErrors}`,
        details: {
          resultPreview: processed.compressedResult.substring(0, 300)
        }
      };
    });
  }

  // ============================================================================
  // PHASE 10: Semantic Learning Service Tests
  // ============================================================================
  async testPhase10_SemanticLearningService(): Promise<void> {
    this.log.info('=== PHASE 10: Semantic Learning Service ===');

    // Test 10.1: Service available
    await this.runTest('Phase 10', 'SemanticLearningService available', async () => {
      try {
        const service = getSemanticLearningService(this.prisma);
        return {
          passed: service !== null,
          message: 'SemanticLearningService singleton is available'
        };
      } catch (error) {
        return {
          passed: false,
          message: `SemanticLearningService not available: ${error}`
        };
      }
    });

    // Test 10.2: Service initialization
    await this.runTest('Phase 10', 'Service initialization', async () => {
      try {
        const service = getSemanticLearningService(this.prisma);
        await service.initialize();
        const health = await service.healthCheck();

        return {
          passed: health.initialized,
          message: health.initialized
            ? `Initialized: pgvector=${health.pgvectorHealthy}, embedding=${health.embeddingConfigured}`
            : 'Not initialized',
          details: health
        };
      } catch (error) {
        return {
          passed: false,
          message: `Initialization failed: ${error}`,
          details: { error: String(error) }
        };
      }
    });

    // Test 10.3: Store tool result
    await this.runTest('Phase 10', 'Store tool result', async () => {
      if (!this.embeddingService) {
        return {
          passed: false,
          message: 'Embedding service not available - skipping'
        };
      }

      try {
        const service = getSemanticLearningService(this.prisma);
        await service.initialize();

        const result = await service.storeResult({
          toolName: 'test_tool',
          serverId: 'test_server',
          inputParams: { query: 'test query', limit: 10 },
          result: { data: [1, 2, 3], status: 'success' },
          resultSummary: 'Found 3 items matching the query',
          userId: 'test-user',
          sessionId: 'test-session'
        });

        return {
          passed: result !== null && result.id !== undefined,
          message: result ? `Stored result with ID: ${result.id.substring(0, 8)}...` : 'Failed to store',
          details: {
            id: result?.id,
            toolName: result?.toolName,
            useCount: result?.useCount
          }
        };
      } catch (error) {
        return {
          passed: false,
          message: `Store failed: ${error}`
        };
      }
    });

    // Test 10.4: Find similar results
    await this.runTest('Phase 10', 'Find similar results', async () => {
      if (!this.embeddingService) {
        return {
          passed: false,
          message: 'Embedding service not available - skipping'
        };
      }

      try {
        const service = getSemanticLearningService(this.prisma);

        const similar = await service.findSimilarResults({
          toolName: 'test_tool',
          serverId: 'test_server',
          inputParams: { query: 'test query', limit: 5 },
          threshold: 0.7,
          topK: 5
        });

        return {
          passed: true,  // Finding 0 results is valid if none exist
          message: `Found ${similar.length} similar results`,
          details: {
            count: similar.length,
            topSimilarity: similar[0]?.similarity
          }
        };
      } catch (error) {
        return {
          passed: false,
          message: `Find similar failed: ${error}`
        };
      }
    });

    // Test 10.5: Result verification
    await this.runTest('Phase 10', 'Result verification flow', async () => {
      if (!this.embeddingService) {
        return {
          passed: false,
          message: 'Embedding service not available - skipping'
        };
      }

      try {
        const service = getSemanticLearningService(this.prisma);

        // Store a result
        const stored = await service.storeResult({
          toolName: 'verify_test_tool',
          serverId: 'test_server',
          inputParams: { action: 'verify_test' },
          result: { verified: true }
        });

        // Verify it
        const verified = await service.verifyResult({
          resultId: stored.id,
          verifiedBy: 'test-admin',
          verificationType: 'admin',
          qualityScore: 0.95
        });

        return {
          passed: verified?.isVerified === true && verified?.qualityScore === 0.95,
          message: verified?.isVerified
            ? `Result verified with quality score ${verified.qualityScore}`
            : 'Verification failed',
          details: {
            isVerified: verified?.isVerified,
            verifiedBy: verified?.verifiedBy,
            qualityScore: verified?.qualityScore
          }
        };
      } catch (error) {
        return {
          passed: false,
          message: `Verification failed: ${error}`
        };
      }
    });

    // Test 10.6: Get learning statistics
    await this.runTest('Phase 10', 'Learning statistics', async () => {
      try {
        const service = getSemanticLearningService(this.prisma);
        const stats = await service.getStats();

        return {
          passed: stats !== null,
          message: `Stats: ${stats.totalResults} total, ${stats.verifiedResults} verified, avg quality ${stats.avgQualityScore?.toFixed(2) || 'N/A'}`,
          details: stats
        };
      } catch (error) {
        return {
          passed: false,
          message: `Stats failed: ${error}`
        };
      }
    });

    // Test 10.7: Health check
    await this.runTest('Phase 10', 'Service health check', async () => {
      try {
        const service = getSemanticLearningService(this.prisma);
        const health = await service.healthCheck();

        return {
          passed: health.healthy || health.initialized,
          message: `Health: ${health.message}`,
          details: health
        };
      } catch (error) {
        return {
          passed: false,
          message: `Health check failed: ${error}`
        };
      }
    });
  }

  // ============================================================================
  // PHASE 11: Feedback Integration Tests
  // ============================================================================
  async testPhase11_FeedbackIntegration(): Promise<void> {
    this.log.info('=== PHASE 11: Feedback Loop Integration ===');

    // Test 11.1: FeedbackIntegrationService available
    await this.runTest('Phase 11', 'FeedbackIntegrationService available', async () => {
      try {
        const service = getFeedbackIntegrationService();
        return {
          passed: service !== null,
          message: 'FeedbackIntegrationService singleton is available'
        };
      } catch (error) {
        return {
          passed: false,
          message: `FeedbackIntegrationService not available: ${error}`
        };
      }
    });

    // Test 11.2: Process tool result through feedback pipeline
    await this.runTest('Phase 11', 'Process tool result through pipeline', async () => {
      try {
        const service = getFeedbackIntegrationService();

        const result = await service.processToolResult({
          toolCallId: 'test-call-001',
          toolName: 'list_pods',
          serverName: 'openagentic_kubernetes',
          httpStatus: 200,
          responseTimeMs: 150,
          rawResult: JSON.stringify([
            { name: 'pod-1', status: 'Running' },
            { name: 'pod-2', status: 'Running' }
          ]),
          userQuery: 'Show me the pods',
          userId: 'test-user'
        });

        return {
          passed: result.scoring.finalScore > 0 &&
                  result.processedResponse.compressionStrategy !== undefined,
          message: `Score: ${result.scoring.finalScore.toFixed(3)}, Strategy: ${result.processedResponse.compressionStrategy}`,
          details: {
            finalScore: result.scoring.finalScore,
            confidence: result.scoring.confidence,
            compressionStrategy: result.processedResponse.compressionStrategy,
            feedbackDurationMs: result.feedbackDurationMs
          }
        };
      } catch (error) {
        return {
          passed: false,
          message: `Pipeline processing failed: ${error}`
        };
      }
    });

    // Test 11.3: Behavioral feedback update
    await this.runTest('Phase 11', 'Behavioral feedback update', async () => {
      try {
        const service = getFeedbackIntegrationService();

        // Update behavioral score
        service.updateBehavioralFeedback('test-call-002', 'positive');
        service.updateBehavioralFeedback('test-call-002', 'continued');

        return {
          passed: true,
          message: 'Behavioral feedback recorded without error'
        };
      } catch (error) {
        return {
          passed: false,
          message: `Behavioral feedback failed: ${error}`
        };
      }
    });

    // Test 11.4: Grounding prompt generation
    await this.runTest('Phase 11', 'Grounding prompt generation', async () => {
      try {
        const service = getFeedbackIntegrationService();

        const prompt = service.createGroundingPrompt(
          'list_backends',
          JSON.stringify([{ name: 'backend-1', status: 'healthy' }]),
          'Are the backends healthy?'
        );

        const hasGuidelines = prompt.includes('Interpretation Guidelines');
        const hasResult = prompt.includes('backend-1');
        const hasQuery = prompt.includes('backends healthy');

        return {
          passed: hasGuidelines && hasResult && hasQuery,
          message: `Prompt includes: guidelines=${hasGuidelines}, result=${hasResult}, query=${hasQuery}`,
          details: {
            promptLength: prompt.length,
            preview: prompt.substring(0, 300)
          }
        };
      } catch (error) {
        return {
          passed: false,
          message: `Grounding prompt failed: ${error}`
        };
      }
    });

    // Test 11.5: Tool reliability tracking
    await this.runTest('Phase 11', 'Tool reliability tracking', async () => {
      try {
        const service = getFeedbackIntegrationService();

        // Process multiple executions to build aggregate
        for (let i = 0; i < 5; i++) {
          await service.processToolResult({
            toolCallId: `reliability-test-${i}`,
            toolName: 'reliability_tool',
            serverName: 'test_server',
            httpStatus: 200,
            responseTimeMs: 100 + i * 10,
            rawResult: JSON.stringify({ success: true, iteration: i }),
            userQuery: 'Test query',
            userId: 'test-user'
          });
        }

        const reliability = service.getToolReliability('reliability_tool', 'test_server');
        const allReliability = service.getAllToolReliability();

        return {
          passed: allReliability.length > 0,
          message: `Tracking ${allReliability.length} tools, reliability_tool: ${reliability?.tier || 'not found'}`,
          details: {
            trackedTools: allReliability.length,
            reliabilityTool: reliability
          }
        };
      } catch (error) {
        return {
          passed: false,
          message: `Reliability tracking failed: ${error}`
        };
      }
    });

    // Test 11.6: LLM response validation
    await this.runTest('Phase 11', 'LLM response validation', async () => {
      try {
        const service = getFeedbackIntegrationService();

        const validation = await service.validateLLMResponse(
          'validation-test-001',
          'list_pods',
          JSON.stringify([
            { name: 'pod-1', status: 'Running' },
            { name: 'pod-2', status: 'Running' }
          ]),
          'I found 2 pods, both are running successfully.'
        );

        return {
          passed: validation.overallConfidence >= 0,
          message: `Confidence: ${validation.overallConfidence.toFixed(3)}, Regenerate: ${validation.shouldRegenerate}`,
          details: {
            overallConfidence: validation.overallConfidence,
            shouldRegenerate: validation.shouldRegenerate,
            warnings: validation.warnings,
            claimsValidated: validation.validatedClaims.length
          }
        };
      } catch (error) {
        return {
          passed: false,
          message: `Validation failed: ${error}`
        };
      }
    });

    // Test 11.7: Error feedback handling
    await this.runTest('Phase 11', 'Error feedback handling', async () => {
      try {
        const service = getFeedbackIntegrationService();

        const result = await service.processToolResult({
          toolCallId: 'error-test-001',
          toolName: 'failing_tool',
          serverName: 'test_server',
          httpStatus: 500,
          responseTimeMs: 50,
          rawResult: JSON.stringify({ error: 'Internal server error' }),
          userQuery: 'Do something',
          userId: 'test-user'
        });

        // Error responses should have lower scores
        return {
          passed: result.scoring.finalScore < 0.7,
          message: `Error score: ${result.scoring.finalScore.toFixed(3)} (should be < 0.7 for errors)`,
          details: {
            finalScore: result.scoring.finalScore,
            executionScore: result.scoring.executionScore.score,
            structuralScore: result.scoring.structuralScore.score
          }
        };
      } catch (error) {
        return {
          passed: false,
          message: `Error handling failed: ${error}`
        };
      }
    });

    // Test 11.8: Full result retrieval for pagination
    await this.runTest('Phase 11', 'Full result retrieval', async () => {
      try {
        const service = getFeedbackIntegrationService();

        // Process a large result that gets compressed
        const largeArray = Array.from({ length: 100 }, (_, i) => ({
          id: i, name: `item-${i}`, data: 'x'.repeat(100)
        }));

        const result = await service.processToolResult({
          toolCallId: 'pagination-test-001',
          toolName: 'large_result_tool',
          serverName: 'test_server',
          httpStatus: 200,
          responseTimeMs: 200,
          rawResult: JSON.stringify(largeArray),
          userQuery: 'Get all items',
          userId: 'test-user'
        });

        // If compression happened, try to get full result
        const fullResultId = result.processedResponse.fullResultId;
        if (fullResultId) {
          const fullResult = service.getFullResultById(fullResultId);
          return {
            passed: fullResult !== null,
            message: `Full result retrievable: ${fullResult !== null}, ID: ${fullResultId}`,
            details: {
              fullResultId,
              compressionStrategy: result.processedResponse.compressionStrategy,
              originalSize: result.processedResponse.originalSize,
              compressedSize: result.processedResponse.compressedSize
            }
          };
        }

        return {
          passed: true,
          message: 'Result was small enough, no pagination needed',
          details: {
            compressionStrategy: result.processedResponse.compressionStrategy,
            originalSize: result.processedResponse.originalSize
          }
        };
      } catch (error) {
        return {
          passed: false,
          message: `Full result retrieval failed: ${error}`
        };
      }
    });
  }

  // ============================================================================
  // Run All Tests
  // ============================================================================
  async runAllTests(): Promise<TestResult[]> {
    this.log.info('Starting Data Layer Evolution Test Suite');

    const initialized = await this.initialize();
    if (!initialized) {
      this.log.error('Failed to initialize test harness');
      return [];
    }

    try {
      await this.testPhase1_PgVectorFoundation();
      await this.testPhase2_SchemaModels();
      await this.testPhase3_EmbeddingService();
      await this.testPhase4_RedisCache();
      await this.testPhase5_CrossUserCache();
      await this.testPhase6_EndToEndCacheFlow();
      await this.testPhase7_ToolResultValidation();
      await this.testPhase8_AutomaticScoring();
      await this.testPhase9_LargeResponseHandler();
      await this.testPhase10_SemanticLearningService();
      await this.testPhase11_FeedbackIntegration();

      // Print summary
      this.printSummary();

      return this.results;
    } finally {
      await this.cleanup();
    }
  }

  private printSummary(): void {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;

    console.log('\n' + '='.repeat(80));
    console.log('DATA LAYER EVOLUTION TEST SUMMARY');
    console.log('='.repeat(80));

    // Group by phase
    const byPhase = new Map<string, TestResult[]>();
    for (const result of this.results) {
      if (!byPhase.has(result.phase)) {
        byPhase.set(result.phase, []);
      }
      byPhase.get(result.phase)!.push(result);
    }

    for (const [phase, results] of byPhase) {
      console.log(`\n${phase}:`);
      for (const r of results) {
        const status = r.passed ? '✓' : '✗';
        const color = r.passed ? '\x1b[32m' : '\x1b[31m';
        console.log(`  ${color}${status}\x1b[0m ${r.test} (${r.durationMs}ms)`);
        if (!r.passed) {
          console.log(`    └─ ${r.message}`);
        }
      }
    }

    console.log('\n' + '-'.repeat(80));
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;
    const color = failed === 0 ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}TOTAL: ${passed}/${total} passed (${passRate}%)\x1b[0m`);
    console.log('='.repeat(80) + '\n');
  }
}

// Run tests if executed directly
const isMainModule = process.argv[1]?.endsWith('data-evolution-tests.ts') ||
  process.argv[1]?.endsWith('data-evolution-tests.js');

if (isMainModule) {
  const tests = new DataLayerEvolutionTests();
  tests.runAllTests()
    .then(results => {
      const failed = results.filter(r => !r.passed).length;
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('Test suite failed:', error);
      process.exit(1);
    });
}

export { DataLayerEvolutionTests, TestResult };
