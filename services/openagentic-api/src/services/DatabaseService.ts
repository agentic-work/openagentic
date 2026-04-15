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
 * Database Service
 * 
 * Centralized database operations and initialization using Prisma ORM. Handles
 * database setup, migrations, health checks, and provides high-level database
 * operations with comprehensive error handling and logging.
 * 
 * Features:
 * - Complete database initialization and migration management
 * - Prisma schema validation and deployment
 * - Database health monitoring and connection management
 * - Centralized database operations with error handling
 * - Transaction support and query optimization
 * - Database backup and maintenance utilities
 */

import { PrismaClient, Prisma } from '@prisma/client';
import type { User, ChatSession, ChatMessage } from '@prisma/client';
import pino, { Logger } from 'pino';
import { exec } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../utils/prisma.js';
import { autoMigrationService } from './AutoMigrationService.js';

const logger: Logger = (pino as any).default ? (pino as any).default({ name: 'database-service' }) : (pino as any)({ name: 'database-service' });
const execAsync = promisify(exec);

export class DatabaseService {

  // ============================================================================
  // DATABASE INITIALIZATION
  // ============================================================================

  /**
   * Complete database initialization - replaces docker entrypoint logic
   */
  static async initialize(): Promise<void> {
    try {
      logger.info('🔄 Starting comprehensive database initialization...');

      // Step 1: Create and initialize MCP Proxy database (separate from our app)
      await DatabaseService.setupMCPProxyDatabase();

      // Step 2: Validate Prisma schema
      await DatabaseService.validatePrismaSchema();

      // Step 3: Handle duplicate cleanup before schema push
      await DatabaseService.cleanupDuplicates();

      // Step 4: Apply schema changes safely
      await DatabaseService.applySchema();

      // Step 5: Install required database extensions
      await DatabaseService.installExtensions();

      // Step 6: Verify critical tables and columns
      await DatabaseService.verifyDatabaseStructure();

      // Step 7: Create performance indexes
      await DatabaseService.createPerformanceIndexes();

      // Step 8: Initialize secure storage
      await DatabaseService.initializeSecureStorage();

      // Step 9: Initialize Vault connection if available
      await DatabaseService.initializeVault();

      // Step 10: Migrate old storage tokens to secure storage
      await DatabaseService.migrateOldStorageTokens();

      // Step 11: Prompt templates are seeded by InitializationService.initializePromptTemplates()
      // await DatabaseService.seedPromptTemplates();

      logger.info('✅ Database initialization completed successfully');
    } catch (error) {
      logger.error({ err: error }, '🚨 CRITICAL: Database initialization failed');
      throw error;
    }
  }

  /**
   * Setup MCP Proxy database - just create the database, MCP Proxy handles its own schema
   */
  private static async setupMCPProxyDatabase(): Promise<void> {
    logger.info('🗄️ Creating MCP Proxy database...');
    try {
      // Get connection details from environment - all required
      const host = process.env.POSTGRES_HOST;
      const port = process.env.POSTGRES_PORT;
      const user = process.env.POSTGRES_USER;
      const password = process.env.POSTGRES_PASSWORD;

      if (!host || !port || !user || !password) {
        throw new Error('Database configuration required: POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD');
      }

      // Connect to postgres database to create mcp_proxy database
      const adminDbUrl = `postgresql://${user}:${password}@${host}:${port}/postgres`;

      // Create a temporary Prisma client for admin operations
      const { PrismaClient: AdminPrismaClient } = await import('@prisma/client');
      const adminPrisma = new AdminPrismaClient({
        datasources: {
          db: {
            url: adminDbUrl
          }
        }
      });

      // Check if mcp_proxy database exists
      const dbExists = await adminPrisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_database WHERE datname = 'mcp_proxy'
        ) as exists
      `;

      if (!dbExists[0]?.exists) {
        logger.info('  Creating mcp_proxy database...');
        await adminPrisma.$executeRawUnsafe(`CREATE DATABASE mcp_proxy`);
        logger.info('  ✅ MCP Proxy database created');
        logger.info('  ℹ️  MCP Proxy will handle its own schema migrations on startup');
      } else {
        logger.info('  MCP Proxy database already exists');
      }

      await adminPrisma.$disconnect();

      logger.info('✅ MCP Proxy database ready');
    } catch (error) {
      logger.error({ err: error }, '❌ MCP Proxy database creation failed');
      // Don't throw - MCP Proxy database is optional
      logger.warn('⚠️ Continuing without MCP Proxy database - proxy features may be limited');
    }
  }

  /**
   * Validate Prisma schema before applying changes
   */
  private static async validatePrismaSchema(): Promise<void> {
    logger.info('📋 Validating Prisma schema...');
    try {
      const { stdout, stderr } = await execAsync('npx prisma validate');
      // Filter out npm notices and warnings from stderr
      if (stderr && !stderr.includes('warning') && !stderr.includes('npm notice')) {
        throw new Error(`Schema validation failed: ${stderr}`);
      }
      logger.info('✅ Prisma schema is valid');
    } catch (error) {
      logger.error({ err: error }, '❌ Prisma schema validation failed');
      throw error;
    }
  }

  /**
   * Clean up duplicate prompt template names before applying unique constraint
   */
  private static async cleanupDuplicates(): Promise<void> {
    logger.info('🧹 Checking for duplicate prompt template names...');
    try {
      // Check if admin.prompt_templates table exists
      const tableExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'admin' 
          AND table_name = 'prompt_templates'
        ) as exists
      `;

      if (tableExists[0]?.exists) {
        logger.info('  Found existing prompt_templates table, checking for duplicates...');
        
        // Count duplicates
        const duplicates = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) as count FROM (
            SELECT name, COUNT(*) as cnt
            FROM admin.prompt_templates 
            GROUP BY name 
            HAVING COUNT(*) > 1
          ) duplicates
        `;

        const duplicateCount = Number(duplicates[0]?.count || 0);
        
        if (duplicateCount > 0) {
          logger.info(`  Found ${duplicateCount} duplicate names, cleaning up...`);
          
          // Remove duplicates keeping the oldest (MIN id)
          await prisma.$executeRaw`
            DELETE FROM admin.prompt_templates pt1
            WHERE EXISTS (
              SELECT 1 FROM admin.prompt_templates pt2
              WHERE pt2.name = pt1.name 
              AND pt2.id < pt1.id
            )
          `;
          
          logger.info('  ✅ Duplicates cleaned up successfully');
        } else {
          logger.info('  No duplicates found');
        }
      } else {
        logger.info('  No existing prompt_templates table found');
      }
    } catch (error) {
      logger.warn({ err: error }, 'Failed to cleanup duplicates - continuing with schema push');
    }
  }

  /**
   * Apply Prisma schema changes safely using AutoMigrationService
   * This NEVER drops data unless ALLOW_UNSAFE_MIGRATIONS=true
   */
  private static async applySchema(): Promise<void> {
    logger.info('📊 Applying Prisma schema changes safely...');
    try {
      // Drop legacy MCP Proxy views that might block schema changes
      await DatabaseService.dropLegacyMCPViews();

      // Migrate the old mcp_server_status table if it exists
      await DatabaseService.migrateMCPServerStatus();

      // CRITICAL: Create admin schema if it doesn't exist
      // Prisma multi-schema requires schemas to exist before db push
      logger.info('  Creating admin schema if not exists...');
      await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS admin');
      logger.info('  ✅ Admin schema ready');

      // Use AutoMigrationService for safe, incremental migrations
      // This will:
      // 1. Detect schema drift
      // 2. Apply ONLY safe changes (new tables, columns, indexes)
      // 3. Skip unsafe changes unless ALLOW_UNSAFE_MIGRATIONS=true
      // 4. Create backup checkpoint before changes
      const migrationResult = await autoMigrationService.runAutoMigration();

      if (!migrationResult.success) {
        logger.warn({
          errors: migrationResult.errors,
          skipped: migrationResult.skippedChanges.length,
        }, '⚠️ Auto-migration completed with issues');
      }

      if (migrationResult.skippedChanges.length > 0) {
        logger.warn({
          skippedChanges: migrationResult.skippedChanges.map(c => c.description),
        }, '⚠️ UNSAFE MIGRATIONS SKIPPED - Set ALLOW_UNSAFE_MIGRATIONS=true to apply');
      }

      logger.info({
        applied: migrationResult.appliedChanges.length,
        skipped: migrationResult.skippedChanges.length,
        backupCreated: migrationResult.backupCreated,
      }, '✅ Database schema migration completed');

      // Verify critical admin schema tables were created
      await DatabaseService.verifyAdminSchemaTables();
    } catch (error) {
      logger.error({ err: error }, '❌ Database schema migration failed');
      throw error;
    }
  }

  /**
   * Verify critical admin schema tables exist after schema push
   */
  private static async verifyAdminSchemaTables(): Promise<void> {
    logger.info('🔍 Verifying admin schema tables...');

    const criticalAdminTables = [
      'llm_request_logs',
      'llm_cost_rates',
      'prompt_templates',
      'token_usage'
    ];

    for (const tableName of criticalAdminTables) {
      const tableExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = ${tableName}
          AND table_schema = 'admin'
        ) as exists
      `;

      if (!tableExists[0]?.exists) {
        logger.warn(`  ⚠️ Admin table '${tableName}' not found - may need manual creation`);
      } else {
        logger.info(`  ✅ Admin table '${tableName}' verified`);
      }
    }
  }

  /**
   * Install required database extensions
   */
  private static async installExtensions(): Promise<void> {
    logger.info('🔧 Installing required database extensions...');
    try {
      // pgvector: Vector similarity search for ACID-compliant transactional embeddings
      // Used for transactional data (<100K vectors), Milvus for scale (millions)
      logger.info('  Installing pgvector extension...');
      await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
      const pgvectorVersion = await prisma.$queryRaw<Array<{ extversion: string }>>`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `;
      logger.info({ version: pgvectorVersion[0]?.extversion }, '  ✅ pgvector extension installed');

      // Install pg_trgm for text similarity search
      logger.info('  Installing pg_trgm extension...');
      await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      logger.info('  ✅ pg_trgm extension installed');

      // Install btree_gin for composite indexes
      logger.info('  Installing btree_gin extension...');
      await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS btree_gin`);
      logger.info('  ✅ btree_gin extension installed');

      // Install uuid-ossp for UUID generation
      logger.info('  Installing uuid-ossp extension...');
      await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
      logger.info('  ✅ uuid-ossp extension installed');

      // Verify extensions are installed
      const extensions = await prisma.$queryRaw<Array<{ extname: string }>>`
        SELECT extname FROM pg_extension
        WHERE extname IN ('vector', 'pg_trgm', 'btree_gin', 'uuid-ossp')
        ORDER BY extname
      `;

      logger.info({ extensions: extensions.map(e => e.extname) }, '✅ Database extensions installed');

      // =====================================================================
      // Ensure embedding columns have the correct halfvec dimension for the
      // currently-active embedding provider.
      //
      // Why dynamic: the prisma schema declares columns as Unsupported("halfvec")
      // (no dim) so the same codebase runs on local k3s with nomic-embed-text
      // (768), CDC dev/stg with text-embedding-3-large (3072), and whatever
      // else a customer might configure. See docs/rules/no-hardcoded-models.md.
      //
      // Runs AFTER prisma db push (in initialize()) so columns exist; resolves
      // the target dim from UniversalEmbeddingService; ALTERs any column whose
      // typmod doesn't match; drops + recreates HNSW indexes.
      //
      // Idempotent — safe to run on every pod start.
      // =====================================================================
      await DatabaseService.ensureEmbeddingDimensions();

    } catch (error) {
      logger.error({ err: error }, '❌ Failed to install database extensions');
      throw error;
    }
  }

  /**
   * Resolve the active embedding dimension from the configured provider.
   *
   * Priority:
   *   1. EMBEDDING_DIMENSIONS env var (deploy-time override)
   *   2. UniversalEmbeddingService.getInfo().dimensions (DB/env-auto)
   *   3. Probe a 1-token embedding call and measure the response
   *
   * Returns null if nothing works — caller logs and skips the migration so
   * the API can still boot on a DB that doesn't have an embedding provider
   * configured yet.
   */
  private static async resolveActiveEmbeddingDim(): Promise<number | null> {
    // 1. Explicit env override (escape hatch for ops — deploy config, not source)
    const envDim = parseInt(process.env.EMBEDDING_DIMENSIONS || '', 10);
    if (envDim > 0) {
      logger.info({ dim: envDim, source: 'EMBEDDING_DIMENSIONS env' }, '  resolved embedding dim from env override');
      return envDim;
    }

    // 2. Service getInfo
    try {
      const { UniversalEmbeddingService } = await import('./UniversalEmbeddingService.js');
      const svc = new UniversalEmbeddingService(logger);
      const info = svc.getInfo?.();
      if (info?.dimensions && info.dimensions > 0) {
        logger.info({ dim: info.dimensions, source: 'UniversalEmbeddingService.getInfo()' }, '  resolved embedding dim from service');
        return info.dimensions;
      }
      // 3. Probe fallback
      try {
        const probe = await svc.generateEmbedding('dim-probe');
        const vec = Array.isArray(probe) ? probe : (probe as any)?.embedding;
        if (Array.isArray(vec) && vec.length > 0) {
          logger.info({ dim: vec.length, source: 'probe' }, '  resolved embedding dim from probe call');
          return vec.length;
        }
      } catch (probeErr: any) {
        logger.warn({ err: probeErr.message }, '  embedding probe failed');
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, '  could not instantiate UniversalEmbeddingService for dim resolution');
    }
    return null;
  }

  /**
   * Ensure all 14 embedding columns are typed halfvec(N) where N matches the
   * active embedding provider's dimensions. Recreates HNSW indexes.
   *
   * Handles all transition cases:
   *   - Legacy `vector(N)` → `halfvec(N)`
   *   - Untyped `halfvec` (from the new Prisma schema) → `halfvec(N)`
   *   - Wrong-dim `halfvec(M)` → `halfvec(N)` (provider change)
   *
   * Safe on every boot. Non-fatal: errors are logged + swallowed so the API
   * still starts if pgvector < 0.7 or if the embedding provider isn't
   * configured yet; in that case semantic search falls back to Milvus
   * primary path and Postgres pgvector stays dormant.
   */
  private static async ensureEmbeddingDimensions(): Promise<void> {
    logger.info('🔄 Ensuring embedding columns match active provider dimensions...');

    // Check pgvector supports halfvec (0.7.0+)
    try {
      const result = await prisma.$queryRaw<Array<{ extversion: string }>>`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `;
      const version = result[0]?.extversion || '0.0.0';
      const [maj, min] = version.split('.').map((s) => parseInt(s, 10));
      if (!(maj > 0 || (maj === 0 && min >= 7))) {
        logger.warn({ version }, '⚠️ pgvector version too old for halfvec — skipping (needs 0.7.0+)');
        return;
      }
      logger.info({ version }, '  pgvector version supports halfvec');
    } catch (err) {
      logger.warn({ err }, '  could not check pgvector version — skipping');
      return;
    }

    // Resolve target dim
    const targetDim = await DatabaseService.resolveActiveEmbeddingDim();
    if (!targetDim || targetDim < 1) {
      logger.warn('⚠️ Could not resolve active embedding dimension — skipping column migration');
      return;
    }
    logger.info({ targetDim }, '  target dimension resolved');

    // Each tuple: schema.table.column → HNSW index name.
    // Includes both Prisma-managed tables and runtime-created tables
    // (ModuleEmbeddingService, SemanticResponseCache, shared_kb_*).
    const embeddingColumns: Array<{ schema: string; table: string; column: string; idx: string }> = [
      { schema: 'admin', table: 'prompt_templates',  column: 'embedding',             idx: 'prompt_templates_embedding_idx' },
      { schema: 'admin', table: 'prompt_templates',  column: 'search_embedding',      idx: 'prompt_templates_search_embedding_idx' },
      { schema: 'public', table: 'mcp_tools',        column: 'description_embedding', idx: 'mcp_tools_desc_embedding_idx' },
      { schema: 'public', table: 'mcp_tools',        column: 'search_embedding',      idx: 'mcp_tools_search_embedding_idx' },
      { schema: 'public', table: 'mcp_tool_capabilities', column: 'description_embedding', idx: 'mcp_capabilities_embedding_idx' },
      { schema: 'public', table: 'chat_sessions',    column: 'summary_embedding',     idx: 'chat_sessions_summary_embedding_idx' },
      { schema: 'public', table: 'chat_sessions',    column: 'title_embedding',       idx: 'chat_sessions_title_embedding_idx' },
      { schema: 'public', table: 'query_embedding_cache', column: 'query_embedding',  idx: 'query_cache_embedding_idx' },
      { schema: 'public', table: 'users',            column: 'preference_embedding',  idx: 'users_preference_embedding_idx' },
      // Runtime-created tables (may not exist yet — skip-on-missing is handled below)
      { schema: 'public', table: 'prompt_module_embeddings', column: 'embedding',     idx: 'idx_pme_embedding_hnsw' },
      { schema: 'public', table: 'semantic_response_cache',  column: 'embedding',     idx: 'idx_src_embedding_hnsw' },
      { schema: 'public', table: 'shared_kb_chunks',         column: 'embedding',     idx: 'idx_skb_chunks_embedding_hnsw' },
    ];

    for (const c of embeddingColumns) {
      try {
        // Inspect current type + dimension using pg_attribute (format_type
        // returns the fully-decorated type string, including "halfvec(N)"
        // when typmod is set).
        const colInfo = await prisma.$queryRawUnsafe<Array<{ full_type: string; udt_name: string }>>(`
          SELECT format_type(a.atttypid, a.atttypmod) AS full_type,
                 t.typname AS udt_name
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_type t ON t.oid = a.atttypid
          WHERE n.nspname = $1 AND c.relname = $2 AND a.attname = $3 AND NOT a.attisdropped
        `, c.schema, c.table, c.column);

        if (colInfo.length === 0) {
          logger.debug({ ...c }, '  column not found — skipping');
          continue;
        }

        const fullType = colInfo[0].full_type;       // e.g. "halfvec", "halfvec(3072)", "vector(1536)"
        const udtName = colInfo[0].udt_name;          // "halfvec" or "vector"

        // Parse dim out of full_type if present
        const dimMatch = fullType.match(/\((\d+)\)/);
        const currentDim = dimMatch ? parseInt(dimMatch[1], 10) : null;
        const isHalfvec = udtName === 'halfvec';
        const isVector = udtName === 'vector';

        if (isHalfvec && currentDim === targetDim) {
          // Already correct — just verify the index
          const idxCheck = await prisma.$queryRawUnsafe<Array<{ indisvalid: boolean }>>(`
            SELECT indisvalid FROM pg_index
            WHERE indexrelid = ($1 || '.' || $2)::regclass
          `, c.schema, c.idx).catch(() => []);
          if (idxCheck.length > 0 && idxCheck[0].indisvalid) {
            logger.debug({ ...c, dim: currentDim }, '  halfvec + HNSW valid — skip');
            continue;
          }
          // Index missing or invalid — fall through to recreate
        } else if (!isHalfvec && !isVector) {
          logger.warn({ ...c, udtName }, '  unexpected column type — skipping');
          continue;
        }

        // Drop index before ALTER (ALTER TYPE is blocked by HNSW indexes)
        await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS ${c.schema}.${c.idx}`);

        // If existing data has a different dim, we truncate (can't re-cast
        // 768-dim data to halfvec(3072)). Embedding columns are regenerable:
        // the next ingestion cycle (MCP indexing, doc RAG ingest, etc.) will
        // backfill. This is the only safe option when the embedding provider
        // has actually changed across deploys.
        const dimMismatch = isHalfvec && currentDim !== null && currentDim !== targetDim;
        const legacyVectorWithWrongDim = isVector && currentDim !== null && currentDim !== targetDim;
        if (dimMismatch || legacyVectorWithWrongDim) {
          await prisma.$executeRawUnsafe(
            `UPDATE ${c.schema}.${c.table} SET ${c.column} = NULL WHERE ${c.column} IS NOT NULL`
          );
          logger.info({ ...c, oldDim: currentDim, targetDim }, '  ⚠️  cleared mismatched embeddings (provider dim changed)');
        }

        // ALTER to halfvec(N). If source was `vector` or untyped `halfvec`,
        // USING-cast does the conversion; if source was halfvec(M) it's a
        // no-op cast (data was just nulled above anyway).
        await prisma.$executeRawUnsafe(
          `ALTER TABLE ${c.schema}.${c.table} ` +
          `ALTER COLUMN ${c.column} TYPE halfvec(${targetDim}) ` +
          `USING (${c.column}::halfvec(${targetDim}))`
        );
        logger.info({ ...c, dim: targetDim, from: fullType }, '  ✅ column → halfvec(N)');

        // HNSW index recreation was removed here 2026-04-11 after a
        // pgvector 0.8.2 SIGILL crash on empty-column HNSW builds took
        // down the entire postgres backend (signal 4, illegal instruction).
        //
        // Indexes are now lazily created by the services that populate
        // each column (MCPToolIndexingService, DocsRAGService,
        // SharedKBService, etc.) after there's actual data to index.
        // See DatabaseService.tryCreateHnswIndexIfReady() below for
        // the shared helper those services call.
      } catch (err: any) {
        // Non-fatal — log + continue
        logger.warn({ ...c, err: err.message }, '  failed to migrate column — continuing');
      }
    }

    logger.info({ targetDim }, '✅ embedding dimension migration complete');
  }

  /**
   * Create an HNSW index on a halfvec column IF the column has at least
   * one non-null row. pgvector 0.8.2 has an empty-column HNSW build crash
   * (SIGILL) that takes down the postgres backend, so services must defer
   * index creation until data is present.
   *
   * Idempotent (uses IF NOT EXISTS). Non-fatal on any error.
   */
  static async tryCreateHnswIndexIfReady(
    schema: string,
    table: string,
    column: string,
    indexName: string,
  ): Promise<boolean> {
    // Respect global disable flag (e.g. for local k3s where CPU lacks
    // the SIMD instructions pgvector halfvec index builds require).
    if (process.env.DISABLE_VECTOR_INDEXES === 'true') {
      logger.debug({ schema, table, column, indexName }, '  HNSW skip: DISABLE_VECTOR_INDEXES=true');
      return false;
    }
    try {
      // Only build the index if there's data — empty halfvec HNSW builds
      // hit an illegal-instruction bug in pgvector 0.8.2.
      const countRows = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
        `SELECT COUNT(*) AS c FROM ${schema}.${table} WHERE ${column} IS NOT NULL LIMIT 1`,
      );
      const hasData = Number(countRows[0]?.c || 0) > 0;
      if (!hasData) {
        logger.debug({ schema, table, column, indexName }, '  HNSW defer: no data yet');
        return false;
      }
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS ${indexName} ` +
        `ON ${schema}.${table} ` +
        `USING hnsw (${column} halfvec_cosine_ops) ` +
        `WITH (m = 16, ef_construction = 64)`,
      );
      logger.info({ schema, table, column, indexName }, '  ✅ HNSW index created (data present)');
      return true;
    } catch (err: any) {
      logger.warn({ schema, table, column, indexName, err: err.message }, '  HNSW index creation failed (non-fatal)');
      return false;
    }
  }

  /**
   * Drop legacy MCP Proxy views that might interfere with schema migration
   */
  private static async dropLegacyMCPViews(): Promise<void> {
    logger.info('🧹 Checking for legacy MCP Proxy views to drop...');
    try {
      // List of known legacy views that might exist from old architecture
      const legacyViews = [
        'MonthlyGlobalSpend',
        'Last30dKeysBySpend',
        'Last30dModelsBySpend',
        'MonthlyGlobalSpendPerKey',
        'MonthlyGlobalSpendPerUserPerKey',
        'DailyTagSpend',
        'Last30dTopEndUsersSpend',
        'VerificationTokenView'
      ];

      for (const viewName of legacyViews) {
        try {
          await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS "${viewName}" CASCADE`);
          logger.info(`  Dropped view: ${viewName}`);
        } catch (err) {
          // Ignore errors - view might not exist
          logger.debug(`  View ${viewName} does not exist or already dropped`);
        }
      }

      logger.info('  ✅ Legacy views cleaned up');
    } catch (error) {
      logger.warn({ err: error }, 'Could not drop legacy views - continuing');
    }
  }


  /**
   * Migrate old mcp_server_status table data if it exists
   */
  private static async migrateMCPServerStatus(): Promise<void> {
    try {
      // Check if old table exists
      const tableExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = 'mcp_server_status' 
          AND table_schema = 'public'
        ) as exists
      `;

      if (tableExists[0]?.exists) {
        logger.info('  Found old mcp_server_status table, migrating data...');
        
        // Copy data to new table structure if needed
        // For now, we'll just acknowledge it exists and let Prisma handle the migration
        const rowCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) as count FROM mcp_server_status
        `;
        
        logger.info(`  Old mcp_server_status table has ${rowCount[0]?.count || 0} rows - will be migrated by Prisma`);
      }
    } catch (error) {
      logger.warn({ err: error }, 'Could not check/migrate mcp_server_status table - continuing');
    }
  }

  /**
   * Verify critical database structure exists
   */
  private static async verifyDatabaseStructure(): Promise<void> {
    logger.info('🔍 Verifying critical database structure...');
    
    // Critical tables to verify (only our application tables)
    const criticalTables = [
      'users', 
      'chat_sessions', 
      'chat_messages', 
      'user_azure_tokens'
    ];
    
    for (const tableName of criticalTables) {
      const tableExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = ${tableName} 
          AND table_schema = 'public'
        ) as exists
      `;
      
      if (!tableExists[0]?.exists) {
        throw new Error(`Critical table '${tableName}' is missing from database`);
      }
      logger.info(`  ✅ Table '${tableName}' verified`);
    }

    // Critical columns on users table
    const criticalColumns = [
      'id', 'email', 'name', 'password_hash', 'is_admin', 'groups', 
      'azure_oid', 'azure_tenant_id', 'force_password_change', 
      'last_login_at', 'created_at', 'updated_at'
    ];

    for (const columnName of criticalColumns) {
      const columnExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' 
          AND column_name = ${columnName}
          AND table_schema = 'public'
        ) as exists
      `;
      
      if (!columnExists[0]?.exists) {
        logger.warn(`Column '${columnName}' missing from users table - this may cause issues`);
      } else {
        logger.info(`  ✅ Column 'users.${columnName}' verified`);
      }
    }

    logger.info('✅ Database structure verification completed');
  }

  /**
   * Create performance indexes to optimize query patterns
   * Addresses N+1 queries and improves overall performance
   */
  private static async createPerformanceIndexes(): Promise<void> {
    logger.info('📊 Creating performance indexes...');
    
    const indexes = [
      // Session indexes for user queries
      { name: 'idx_sessions_user_id', table: 'sessions', columns: ['user_id'] },
      { name: 'idx_sessions_created_at', table: 'sessions', columns: ['created_at DESC'] },
      { name: 'idx_sessions_user_created', table: 'sessions', columns: ['user_id', 'created_at DESC'] },
      
      // Message indexes for session queries
      { name: 'idx_messages_session_id', table: 'messages', columns: ['session_id'] },
      { name: 'idx_messages_created_at', table: 'messages', columns: ['created_at DESC'] },
      { name: 'idx_messages_session_created', table: 'messages', columns: ['session_id', 'created_at DESC'] },
      
      // User lookup indexes
      { name: 'idx_users_email', table: 'users', columns: ['email'] },
      { name: 'idx_users_azure_oid', table: 'users', columns: ['azure_oid'] },
      
      // MCP server indexes
      { name: 'idx_mcp_servers_user_id', table: 'mcp_servers', columns: ['user_id'] },
      { name: 'idx_mcp_servers_active', table: 'mcp_servers', columns: ['user_id', 'is_active'] },
      
      // Token usage tracking (admin schema)
      { name: 'idx_token_usage_user_id', table: 'admin.token_usage', columns: ['user_id'] },
      { name: 'idx_token_usage_session_id', table: 'admin.token_usage', columns: ['session_id'] },
      { name: 'idx_token_usage_user_timestamp', table: 'admin.token_usage', columns: ['user_id', 'timestamp DESC'] }
    ];
    
    for (const index of indexes) {
      try {
        // Check if index exists
        const indexExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE indexname = ${index.name}
          ) as exists
        `;
        
        if (!indexExists[0]?.exists) {
          // Create the index
          const columns = index.columns.join(', ');
          // Handle schema-qualified table names (e.g., "admin.token_usage")
          const tableRef = index.table.includes('.')
            ? index.table.split('.').map(part => `"${part}"`).join('.')
            : `"${index.table}"`;
          await prisma.$executeRawUnsafe(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${index.name}" ON ${tableRef} (${columns})`
          );
          logger.info(`  ✅ Created index: ${index.name}`);
        } else {
          logger.info(`  ⏭️  Index already exists: ${index.name}`);
        }
      } catch (error) {
        // Log warning but don't fail - indexes are for performance only
        logger.warn({ error, index: index.name }, `  ⚠️  Failed to create index: ${index.name}`);
      }
    }
    
    // Create partial indexes for common query patterns
    const partialIndexes = [
      {
        name: 'idx_prompt_templates_default',
        sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_prompt_templates_default" ON "admin"."prompt_templates" ("is_default") WHERE "is_default" = true'
      },
      {
        name: 'idx_prompt_templates_active',
        sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_prompt_templates_active" ON "admin"."prompt_templates" ("is_active") WHERE "is_active" = true'
      },
      {
        name: 'idx_chat_sessions_active',
        sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_chat_sessions_active" ON "chat_sessions" ("user_id", "updated_at" DESC) WHERE "deleted_at" IS NULL'
      }
    ];
    
    for (const pIndex of partialIndexes) {
      try {
        await prisma.$executeRawUnsafe(pIndex.sql);
        logger.info(`  ✅ Created partial index: ${pIndex.name}`);
      } catch (error: any) {
        if (error.message?.includes('already exists')) {
          logger.info(`  ⏭️  Partial index already exists: ${pIndex.name}`);
        } else {
          logger.warn({ error, index: pIndex.name }, `  ⚠️  Failed to create partial index`);
        }
      }
    }
    
    // Update statistics for query planner
    try {
      await prisma.$executeRawUnsafe('ANALYZE sessions');
      await prisma.$executeRawUnsafe('ANALYZE messages');
      await prisma.$executeRawUnsafe('ANALYZE users');
      logger.info('  ✅ Updated table statistics for query planner');
    } catch (error) {
      logger.warn({ error }, '  ⚠️  Failed to update table statistics');
    }
    
    logger.info('✅ Performance index creation completed');
  }


  /**
   * Initialize secure storage table if not exists
   */
  private static async initializeSecureStorage(): Promise<void> {
    logger.info('🔐 Initializing secure storage...');
    
    try {
      // Check if secure_storage table exists
      const tableExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = 'secure_storage' 
          AND table_schema = 'public'
        ) as exists
      `;
      
      if (!tableExists[0]?.exists) {
        logger.info('  Creating secure_storage table...');
        
        // Create the table using raw SQL since it might not be in schema yet
        await prisma.$executeRaw`
          CREATE TABLE IF NOT EXISTS secure_storage (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            key VARCHAR(255) UNIQUE NOT NULL,
            value TEXT NOT NULL,
            encrypted BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP,
            metadata JSONB DEFAULT '{}'::jsonb
          )
        `;
        
        logger.info('  ✅ Secure storage table created');
      } else {
        logger.info('  Secure storage table already exists');
      }
    } catch (error) {
      logger.warn({ err: error }, 'Could not initialize secure storage - continuing');
    }
  }

  /**
   * Initialize Vault connection if available
   */
  private static async initializeVault(): Promise<void> {
    logger.info('🔒 Initializing Vault connection...');
    
    const vaultAddr = process.env.VAULT_ADDR || 'http://vault:8200';
    const vaultToken = process.env.VAULT_TOKEN || process.env.VAULT_DEV_ROOT_TOKEN_ID;
    
    if (!vaultToken) {
      logger.info('  No Vault token configured, skipping Vault initialization');
      return;
    }
    
    try {
      const fetch = await import('node-fetch').then(m => m.default);
      
      // Check Vault health
      const healthResponse = await fetch(`${vaultAddr}/v1/sys/health`);
      
      if (healthResponse.ok) {
        logger.info('  Vault is healthy, initializing secrets engines...');
        
        // Enable transit engine for encryption
        await fetch(`${vaultAddr}/v1/sys/mounts/transit`, {
          method: 'POST',
          headers: {
            'X-Vault-Token': vaultToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ type: 'transit' })
        }).catch(() => {
          logger.info('  Transit engine already enabled or error enabling');
        });
        
        // Enable KV v2 secrets engine
        await fetch(`${vaultAddr}/v1/sys/mounts/secret`, {
          method: 'POST',
          headers: {
            'X-Vault-Token': vaultToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            type: 'kv',
            options: { version: '2' }
          })
        }).catch(() => {
          logger.info('  KV v2 engine already enabled or error enabling');
        });
        
        // Create encryption key for transit
        await fetch(`${vaultAddr}/v1/transit/keys/openagentic`, {
          method: 'POST',
          headers: {
            'X-Vault-Token': vaultToken,
            'Content-Type': 'application/json'
          }
        }).catch(() => {
          logger.info('  Encryption key already exists or error creating');
        });
        
        logger.info('  ✅ Vault initialized successfully');
      } else {
        logger.warn('  Vault is not healthy, skipping initialization');
      }
    } catch (error) {
      logger.warn({ err: error }, 'Could not initialize Vault - continuing without Vault');
    }
  }

  /**
   * Migrate old storage tokens to secure storage
   */
  private static async migrateOldStorageTokens(): Promise<void> {
    logger.info('📦 Checking for old storage tokens to migrate...');
    
    try {
      // Check users table for any tokens stored in columns
      const usersWithTokens = await prisma.$queryRaw<Array<{ id: string, email: string }>>`
        SELECT id, email FROM users 
        WHERE password_hash IS NOT NULL 
        LIMIT 10
      `;
      
      if (usersWithTokens.length > 0) {
        logger.info(`  Found ${usersWithTokens.length} users with potential tokens to secure`);
        
        // Note: Actual migration would happen at runtime when users access their data
        // We just log that migration is available
        logger.info('  Token migration will happen automatically as users access the system');
      } else {
        logger.info('  No old tokens found to migrate');
      }
      
      // Set a flag in system configuration that migration check has been done
      await prisma.systemConfiguration.upsert({
        where: { key: 'storage_migration_checked' },
        update: { 
          value: { value: true, timestamp: new Date().toISOString() },
          updated_at: new Date()
        },
        create: { 
          key: 'storage_migration_checked', 
          value: { value: true, timestamp: new Date().toISOString() },
          description: 'Indicates that old storage tokens have been checked for migration'
        }
      });
      
      logger.info('  ✅ Storage migration check completed');
    } catch (error) {
      logger.warn({ err: error }, 'Could not check for old storage tokens - continuing');
    }
  }

  // ============================================================================
  // USER MANAGEMENT
  // ============================================================================

  async createUser(userData: {
    email: string;
    name?: string;
    isAdmin?: boolean;
    groups?: string[];
  }): Promise<User> {
    try {
      return await prisma.user.create({
        data: {
          email: userData.email,
          name: userData.name,
          is_admin: userData.isAdmin || false,
          groups: userData.groups || []
        }
      });
    } catch (error) {
      logger.error({ error, userData }, 'Failed to create user');
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    try {
      return await prisma.user.findUnique({
        where: { email }
      });
    } catch (error) {
      logger.error({ error, email }, 'Failed to get user by email');
      throw error;
    }
  }

  async getUserById(id: string): Promise<User | null> {
    try {
      return await prisma.user.findUnique({
        where: { id }
      });
    } catch (error) {
      logger.error({ error, id }, 'Failed to get user by ID');
      throw error;
    }
  }

  async updateUser(id: string, userData: Partial<User>): Promise<User> {
    try {
      return await prisma.user.update({
        where: { id },
        data: {
          ...userData,
          updated_at: new Date()
        }
      });
    } catch (error) {
      logger.error({ error, id, userData }, 'Failed to update user');
      throw error;
    }
  }

  async updateUserLastLogin(id: string): Promise<User> {
    try {
      return await prisma.user.update({
        where: { id },
        data: { 
          last_login_at: new Date(),
          updated_at: new Date() 
        }
      });
    } catch (error) {
      logger.error({ error, id }, 'Failed to update user last login');
      throw error;
    }
  }

  // ============================================================================
  // AUTHENTICATION TOKENS
  // ============================================================================

  async upsertUserAuthToken(tokenData: {
    userId: string;
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt: Date;
  }) {
    try {
      return await prisma.userAuthToken.upsert({
        where: { user_id: tokenData.userId },
        update: {
          access_token: tokenData.accessToken,
          refresh_token: tokenData.refreshToken,
          id_token: tokenData.idToken,
          expires_at: tokenData.expiresAt,
          updated_at: new Date()
        },
        create: {
          user_id: tokenData.userId,
          access_token: tokenData.accessToken,
          refresh_token: tokenData.refreshToken,
          id_token: tokenData.idToken,
          expires_at: tokenData.expiresAt
        }
      });
    } catch (error) {
      logger.error({ error, userId: tokenData.userId }, 'Failed to upsert user auth token');
      throw error;
    }
  }

  async getUserAuthToken(userId: string) {
    try {
      return await prisma.userAuthToken.findUnique({
        where: { user_id: userId }
      });
    } catch (error) {
      logger.error({ error, userId }, 'Failed to get user auth token');
      throw error;
    }
  }

  async deleteUserAuthToken(userId: string): Promise<void> {
    try {
      await prisma.userAuthToken.delete({
        where: { user_id: userId }
      });
    } catch (error) {
      logger.error({ error, userId }, 'Failed to delete user auth token');
      throw error;
    }
  }

  // ============================================================================
  // CHAT MANAGEMENT
  // ============================================================================

  async createChatSession(sessionData: {
    id: string;
    userId: string;
    title: string;
  }): Promise<ChatSession> {
    try {
      return await prisma.chatSession.create({
        data: {
          id: sessionData.id,
          user_id: sessionData.userId,
          title: sessionData.title
        }
      });
    } catch (error) {
      logger.error({ error, sessionData }, 'Failed to create chat session');
      throw error;
    }
  }

  async getChatSession(id: string): Promise<ChatSession | null> {
    try {
      return await prisma.chatSession.findUnique({
        where: { id },
        include: {
          messages: {
            orderBy: { created_at: 'asc' }
          }
        }
      });
    } catch (error) {
      logger.error({ error, id }, 'Failed to get chat session');
      throw error;
    }
  }

  async getUserChatSessions(userId: string, limit = 50): Promise<ChatSession[]> {
    try {
      return await prisma.chatSession.findMany({
        where: { 
          user_id: userId,
          is_active: true,
          deleted_at: null
        },
        orderBy: { updated_at: 'desc' },
        take: limit,
        include: {
          _count: {
            select: { messages: true }
          }
        }
      });
    } catch (error) {
      logger.error({ error, userId }, 'Failed to get user chat sessions');
      throw error;
    }
  }

  async updateChatSession(id: string, updates: Partial<ChatSession>): Promise<ChatSession> {
    try {
      return await prisma.chatSession.update({
        where: { id },
        data: {
          ...updates,
          updated_at: new Date()
        }
      });
    } catch (error) {
      logger.error({ error, id, updates }, 'Failed to update chat session');
      throw error;
    }
  }

  async deleteChatSession(id: string): Promise<void> {
    try {
      await prisma.chatSession.update({
        where: { id },
        data: { 
          deleted_at: new Date(),
          is_active: false 
        }
      });
    } catch (error) {
      logger.error({ error, id }, 'Failed to delete chat session');
      throw error;
    }
  }

  // ============================================================================
  // MESSAGE MANAGEMENT
  // ============================================================================

  async createChatMessage(messageData: {
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    parentId?: string;
    tokenUsage?: any;
    model?: string; // The actual model used (e.g., 'gpt-4.1-mini-2025-04-14')
    toolCalls?: any[];
    mcpCalls?: any[];
    visualizations?: any[];
  }): Promise<ChatMessage> {
    try {
      const message = await prisma.chatMessage.create({
        data: {
          session_id: messageData.sessionId,
          role: messageData.role,
          content: messageData.content,
          parent_id: messageData.parentId,
          token_usage: messageData.tokenUsage,
          model: messageData.model,
          tool_calls: messageData.toolCalls,
          mcp_calls: messageData.mcpCalls,
          visualizations: messageData.visualizations
        }
      });

      // Update session message count and last activity
      await prisma.chatSession.update({
        where: { id: messageData.sessionId },
        data: {
          message_count: { increment: 1 },
          updated_at: new Date()
        }
      });

      return message;
    } catch (error) {
      logger.error({ error, messageData }, 'Failed to create chat message');
      throw error;
    }
  }

  async getChatMessage(id: string): Promise<ChatMessage | null> {
    try {
      return await prisma.chatMessage.findUnique({
        where: { id }
      });
    } catch (error) {
      logger.error({ error, id }, 'Failed to get chat message');
      throw error;
    }
  }

  async getSessionMessages(sessionId: string, limit = 100): Promise<ChatMessage[]> {
    try {
      return await prisma.chatMessage.findMany({
        where: { 
          session_id: sessionId,
          deleted_at: null
        },
        orderBy: { created_at: 'asc' },
        take: limit
      });
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to get session messages');
      throw error;
    }
  }

  async updateChatMessage(id: string, updates: Prisma.ChatMessageUpdateInput): Promise<ChatMessage> {
    try {
      return await prisma.chatMessage.update({
        where: { id },
        data: {
          ...updates,
          updated_at: new Date()
        }
      });
    } catch (error) {
      logger.error({ error, id, updates }, 'Failed to update chat message');
      throw error;
    }
  }

  async deleteChatMessage(id: string): Promise<void> {
    try {
      await prisma.chatMessage.update({
        where: { id },
        data: { deleted_at: new Date() }
      });
    } catch (error) {
      logger.error({ error, id }, 'Failed to delete chat message');
      throw error;
    }
  }


  // ============================================================================
  // SETTINGS MANAGEMENT
  // ============================================================================

  async getSystemSetting(key: string) {
    try {
      // Check database first
      const setting = await prisma.promptingSettings.findFirst({
        where: {
          setting_key: key,
          is_global: true,
          user_id: null
        }
      });
      
      if (setting) {
        return setting.setting_value;
      }
      
      // Fallback to environment variables
      return process.env[key] || null;
    } catch (error) {
      logger.error({ error, key }, 'Failed to get system setting');
      throw error;
    }
  }

  async setSystemSetting(key: string, value: any, category: string, description?: string, updatedBy?: string) {
    try {
      const setting = await prisma.promptingSettings.upsert({
        where: {
          user_id_setting_key: {
            user_id: null,
            setting_key: key
          }
        },
        update: {
          setting_value: value,
          updated_at: new Date()
        },
        create: {
          setting_key: key,
          setting_value: value,
          is_global: true,
          user_id: null
        }
      });
      
      return { key, value: setting.setting_value, category, description, updatedBy };
    } catch (error) {
      logger.error({ error, key, value }, 'Failed to set system setting');
      throw error;
    }
  }

  async getUserSetting(userId: string, key: string) {
    try {
      const setting = await prisma.userSetting.findUnique({
        where: {
          user_id_setting_key: {
            user_id: userId,
            setting_key: key
          }
        }
      });
      
      return setting ? setting.setting_value : null;
    } catch (error) {
      logger.error({ error, userId, key }, 'Failed to get user setting');
      throw error;
    }
  }

  async setUserSetting(userId: string, key: string, value: any, category: string) {
    try {
      const setting = await prisma.userSetting.upsert({
        where: {
          user_id_setting_key: {
            user_id: userId,
            setting_key: key
          }
        },
        update: {
          setting_value: value,
          updated_at: new Date()
        },
        create: {
          user_id: userId,
          setting_key: key,
          setting_value: value
        }
      });
      
      return { userId, [key]: setting.setting_value };
    } catch (error) {
      logger.error({ error, userId, key, value }, 'Failed to set user setting');
      throw error;
    }
  }

  // ============================================================================
  // ANALYTICS & MONITORING
  // ============================================================================

  async recordUsageAnalytics(data: {
    userId: string;
    sessionId?: string;
    eventType: string;
    eventData?: any;
  }) {
    try {
      return await prisma.usageAnalytics.create({
        data: {
          user_id: data.userId,
          session_id: data.sessionId,
          event_type: data.eventType,
          event_data: data.eventData || {}
        }
      });
    } catch (error) {
      logger.error({ error, data }, 'Failed to record usage analytics');
      throw error;
    }
  }

  async logAdminAction(data: {
    adminUserId: string;
    adminEmail: string;
    action: string;
    resourceType: string;
    resourceId: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
  }) {
    try {
      const logEntry = await prisma.adminAuditLog.create({
        data: {
          admin_user_id: data.adminUserId,
          admin_email: data.adminEmail,
          action: data.action,
          resource_type: data.resourceType,
          resource_id: data.resourceId,
          details: data.details || {},
          ip_address: data.ipAddress || null
        }
      });
      
      logger.info({ logEntry }, 'Admin action logged to database');
      return logEntry;
    } catch (error) {
      logger.error({ error, data }, 'Failed to log admin action');
      throw error;
    }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  async healthCheck(): Promise<boolean> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      logger.error({ error }, 'Database health check failed');
      return false;
    }
  }

  async getStats() {
    try {
      const [userCount, sessionCount, messageCount] = await Promise.all([
        prisma.user.count(),
        prisma.chatSession.count(),
        prisma.chatMessage.count({ where: { deleted_at: null } })
      ]);

      return {
        users: userCount,
        sessions: sessionCount,
        messages: messageCount
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get database stats');
      throw error;
    }
  }
}

export const databaseService = new DatabaseService();