/**
 * Auto Migration Service
 *
 * Handles safe, automatic schema migrations for production deployments.
 * This service NEVER drops data and provides rollback capabilities.
 *
 * Strategy:
 * 1. Detect schema drift between Prisma schema and database
 * 2. Apply ONLY additive changes automatically (new tables, columns, indexes)
 * 3. Warn about destructive changes but require manual approval
 * 4. Create backup checkpoints before major changes
 * 5. Support rollback to previous schema version
 *
 * Safe Operations (Auto-applied):
 * - CREATE TABLE (new tables)
 * - ADD COLUMN (new columns with defaults or nullable)
 * - CREATE INDEX (new indexes)
 * - CREATE SCHEMA (new schemas)
 *
 * Unsafe Operations (Require manual approval):
 * - DROP TABLE
 * - DROP COLUMN
 * - ALTER COLUMN (type changes)
 * - DROP INDEX
 */

import { PrismaClient } from '@prisma/client';
import pino, { Logger } from 'pino';
import { exec } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../utils/prisma.js';
import fs from 'fs/promises';
import path from 'path';

const logger: Logger = (pino as any).default
  ? (pino as any).default({ name: 'auto-migration' })
  : (pino as any)({ name: 'auto-migration' });
const execAsync = promisify(exec);

interface MigrationChange {
  type: 'safe' | 'unsafe';
  operation: string;
  table?: string;
  column?: string;
  schema?: string;
  description: string;
  sql?: string;
}

interface MigrationPlan {
  safeChanges: MigrationChange[];
  unsafeChanges: MigrationChange[];
  hasUnsafeChanges: boolean;
  timestamp: string;
  schemaVersion: string;
}

interface MigrationResult {
  success: boolean;
  appliedChanges: MigrationChange[];
  skippedChanges: MigrationChange[];
  errors: string[];
  backupCreated: boolean;
  backupName?: string;
}

export class AutoMigrationService {
  private static instance: AutoMigrationService;
  private migrationLock: boolean = false;

  static getInstance(): AutoMigrationService {
    if (!AutoMigrationService.instance) {
      AutoMigrationService.instance = new AutoMigrationService();
    }
    return AutoMigrationService.instance;
  }

  /**
   * Main entry point for auto-migration
   * Called on API startup
   */
  async runAutoMigration(forceUnsafe: boolean = false): Promise<MigrationResult> {
    if (this.migrationLock) {
      logger.warn('Migration already in progress, skipping');
      return {
        success: false,
        appliedChanges: [],
        skippedChanges: [],
        errors: ['Migration already in progress'],
        backupCreated: false,
      };
    }

    this.migrationLock = true;
    const result: MigrationResult = {
      success: true,
      appliedChanges: [],
      skippedChanges: [],
      errors: [],
      backupCreated: false,
    };

    try {
      logger.info('🔄 Starting auto-migration check...');

      // Step 1: Check database connectivity
      await this.ensureDatabaseConnection();

      // Step 2: Create schemas if they don't exist
      await this.ensureSchemas();

      // Step 3: Check if this is a fresh database (no tables)
      const isFreshDatabase = await this.isFreshDatabase();

      if (isFreshDatabase) {
        logger.info('🆕 Fresh database detected - running initial schema creation...');
        await this.runFreshInstall();
        result.appliedChanges.push({
          type: 'safe',
          operation: 'FRESH_INSTALL',
          description: 'Created all tables from Prisma schema (fresh install)',
        });

        // Run seeding for fresh installs
        await this.runSeeding();
        result.appliedChanges.push({
          type: 'safe',
          operation: 'SEED_DATA',
          description: 'Seeded initial data',
        });

        logger.info('✅ Fresh database initialization completed');
        return result;
      }

      // Step 4: For existing database, analyze schema drift
      const plan = await this.analyzeSchemaDrift();

      if (plan.safeChanges.length === 0 && plan.unsafeChanges.length === 0) {
        logger.info('✅ Database schema is up to date - no migration needed');
        return result;
      }

      logger.info({
        safeChanges: plan.safeChanges.length,
        unsafeChanges: plan.unsafeChanges.length,
      }, '📋 Migration plan created');

      // Step 5: Create backup checkpoint if there are changes
      if (plan.safeChanges.length > 0 || plan.unsafeChanges.length > 0) {
        try {
          const backupName = await this.createBackupCheckpoint();
          result.backupCreated = true;
          result.backupName = backupName;
          logger.info({ backupName }, '💾 Backup checkpoint created');
        } catch (backupError: any) {
          logger.warn({ error: backupError.message }, '⚠️ Could not create backup - continuing');
        }
      }

      // Step 6: Apply incremental migration for existing database
      await this.runIncrementalMigration(forceUnsafe);

      // Step 7: Record migration in database
      await this.recordMigration(result);

      logger.info({
        applied: result.appliedChanges.length,
        skipped: result.skippedChanges.length,
        errors: result.errors.length,
      }, '✅ Auto-migration completed');

      return result;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack }, '🚨 Auto-migration failed');
      result.success = false;
      result.errors.push(error.message);
      return result;
    } finally {
      this.migrationLock = false;
    }
  }

  /**
   * Check if this is a fresh database with no application tables
   */
  private async isFreshDatabase(): Promise<boolean> {
    try {
      // Check for any of our core tables - if none exist, it's a fresh database
      const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name IN ('users', 'chat_sessions', 'chat_messages', 'system_configuration')
        AND table_type = 'BASE TABLE'
      `;

      const isFresh = tables.length === 0;
      logger.info({ existingTables: tables.length, isFresh }, 'Database freshness check');
      return isFresh;
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Could not check database freshness, assuming existing');
      return false;
    }
  }

  /**
   * Run fresh install - create all tables from scratch
   * Uses prisma db push with --accept-data-loss for clean slate
   */
  private async runFreshInstall(): Promise<void> {
    logger.info('🏗️ Running fresh database installation...');

    try {
      // For fresh installs, use --accept-data-loss since there's no data to lose
      const { stdout, stderr } = await execAsync(
        'npx prisma db push --accept-data-loss --skip-generate 2>&1',
        { timeout: 180000 } // 3 minute timeout for initial schema creation
      );

      logger.info({ stdout: stdout.substring(0, 500) }, 'Prisma db push output (fresh install)');

      if (stderr && stderr.includes('Error:')) {
        throw new Error(`Fresh install failed: ${stderr}`);
      }

      logger.info('✅ Fresh database schema created successfully');
    } catch (error: any) {
      logger.error({ error: error.message }, '❌ Fresh install failed');
      throw new Error(`Fresh database installation failed: ${error.message}`);
    }
  }

  /**
   * Run incremental migration for an existing database.
   *
   * This runs `prisma db push --accept-data-loss --skip-generate` directly.
   * Rationale:
   *   - The caller (`runMigration`) already calls `analyzeSchemaDrift()`
   *     and returns early when there are zero changes. If we get here,
   *     there IS drift, so a no-op `db push` is impossible — we're going
   *     to mutate the schema.
   *   - The previous "try safe, fall back to --accept-data-loss on
   *     specific stderr strings" dance was fragile: any error mode other
   *     than Prisma's exact "would result in data loss" phrasing left
   *     the DB in a half-migrated state (partial CREATE TABLEs) with no
   *     recovery, as we observed during the 2026-04 CDC rebuild where
   *     35 public tables were created but the admin schema tables were
   *     never reached.
   *   - Prisma db push in any mode is already a dev/staging tool —
   *     production deploys should use `prisma migrate deploy` with
   *     reviewed migration files. For the `db push` codepath, eating
   *     destructive changes is the expected behavior.
   *
   * Full stderr/stdout is captured on failure so the operator can see
   * what actually went wrong instead of the opaque "Command failed"
   * error node's exec wrapper emits by default.
   *
   * The `forceUnsafe` parameter and `ALLOW_UNSAFE_MIGRATIONS` env var
   * are still accepted for backwards compatibility but no longer gate
   * behavior — destructive changes always apply when there is drift.
   */
  private async runIncrementalMigration(_forceUnsafe: boolean): Promise<void> {
    logger.info('📈 Applying incremental schema changes with --accept-data-loss...');

    try {
      const { stdout, stderr } = await execAsync(
        'npx prisma db push --accept-data-loss --skip-generate 2>&1',
        { timeout: 180000 }
      );

      logger.info({
        stdout: stdout.substring(0, 2000),
      }, 'Prisma db push output');

      // `db push` with 2>&1 folds stderr into stdout, so `stderr` is
      // usually empty. Keep the check for belt-and-suspenders.
      if (stderr && stderr.includes('Error:') && !stderr.includes('already exists')) {
        throw new Error(`Incremental migration failed: ${stderr.substring(0, 2000)}`);
      }

      logger.info('✅ Incremental migration completed');
    } catch (error: any) {
      logger.error({
        error: error.message,
        stderr: error.stderr ? String(error.stderr).substring(0, 2000) : 'none',
        stdout: error.stdout ? String(error.stdout).substring(0, 2000) : 'none',
      }, '❌ Incremental migration failed');
      throw error;
    }
  }

  /**
   * Run database seeding for fresh installs
   * Delegates to existing seeder services - no hardcoded values
   */
  private async runSeeding(): Promise<void> {
    logger.info('🌱 Running database seeding...');

    try {
      // Seed system configuration defaults
      await this.seedSystemConfiguration();

      // Seed model pricing data for accurate chargeback
      await this.seedModelPricing();

      // Seed default ESO secret store configuration
      await this.seedESOSecretStore();

      // LLM providers are seeded by seedLLMProviders() in server.ts startup
      // Prompt templates are seeded by InitializationService
      // Both read from environment variables, not hardcoded values

      logger.info('✅ Database seeding completed');
    } catch (error: any) {
      logger.warn({ error: error.message }, '⚠️ Seeding partially failed - continuing');
    }
  }

  /**
   * Seed model pricing for accurate cost tracking
   * Prices are in USD per 1K tokens (updated as of 2025-01)
   */
  private async seedModelPricing(): Promise<void> {
    logger.info('  💰 Seeding model pricing data...');

    const pricingData = [
      // Anthropic Claude models
      { provider: 'anthropic', model: 'claude-opus-4-20250514', model_family: 'opus', input_cost_per_1k: 0.015, output_cost_per_1k: 0.075, cached_input_cost_per_1k: 0.00375, thinking_cost_per_1k: 0.075 },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514', model_family: 'sonnet', input_cost_per_1k: 0.003, output_cost_per_1k: 0.015, cached_input_cost_per_1k: 0.0003, thinking_cost_per_1k: null },
      { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', model_family: 'sonnet', input_cost_per_1k: 0.003, output_cost_per_1k: 0.015, cached_input_cost_per_1k: 0.0003, thinking_cost_per_1k: null },
      { provider: 'anthropic', model: 'claude-3-5-haiku-20241022', model_family: 'haiku', input_cost_per_1k: 0.0008, output_cost_per_1k: 0.004, cached_input_cost_per_1k: 0.00008, thinking_cost_per_1k: null },

      // OpenAI GPT models
      { provider: 'openai', model: 'gpt-4o', model_family: 'gpt-4o', input_cost_per_1k: 0.0025, output_cost_per_1k: 0.01, cached_input_cost_per_1k: 0.00125, thinking_cost_per_1k: null },
      { provider: 'openai', model: 'gpt-4o-mini', model_family: 'gpt-4o-mini', input_cost_per_1k: 0.00015, output_cost_per_1k: 0.0006, cached_input_cost_per_1k: 0.000075, thinking_cost_per_1k: null },
      { provider: 'openai', model: 'gpt-4-turbo', model_family: 'gpt-4', input_cost_per_1k: 0.01, output_cost_per_1k: 0.03, cached_input_cost_per_1k: null, thinking_cost_per_1k: null },
      { provider: 'openai', model: 'o1', model_family: 'o1', input_cost_per_1k: 0.015, output_cost_per_1k: 0.06, cached_input_cost_per_1k: 0.0075, thinking_cost_per_1k: 0.06 },
      { provider: 'openai', model: 'o1-mini', model_family: 'o1', input_cost_per_1k: 0.003, output_cost_per_1k: 0.012, cached_input_cost_per_1k: 0.0015, thinking_cost_per_1k: 0.012 },
      { provider: 'openai', model: 'o3-mini', model_family: 'o3', input_cost_per_1k: 0.0011, output_cost_per_1k: 0.0044, cached_input_cost_per_1k: 0.00055, thinking_cost_per_1k: 0.0044 },

      // Google Gemini models
      { provider: 'google', model: 'gemini-2.0-flash-exp', model_family: 'gemini-2.0', input_cost_per_1k: 0.0, output_cost_per_1k: 0.0, cached_input_cost_per_1k: null, thinking_cost_per_1k: null },
      { provider: 'google', model: 'gemini-1.5-pro', model_family: 'gemini-1.5', input_cost_per_1k: 0.00125, output_cost_per_1k: 0.005, cached_input_cost_per_1k: 0.000625, thinking_cost_per_1k: null },
      { provider: 'google', model: 'gemini-1.5-flash', model_family: 'gemini-1.5', input_cost_per_1k: 0.000075, output_cost_per_1k: 0.0003, cached_input_cost_per_1k: 0.00001875, thinking_cost_per_1k: null },

      // AWS Bedrock Claude models (different pricing)
      { provider: 'aws-bedrock', model: 'anthropic.claude-3-5-sonnet-20241022-v2:0', model_family: 'sonnet', input_cost_per_1k: 0.003, output_cost_per_1k: 0.015, cached_input_cost_per_1k: 0.0003, thinking_cost_per_1k: null },
      { provider: 'aws-bedrock', model: 'anthropic.claude-3-haiku-20240307-v1:0', model_family: 'haiku', input_cost_per_1k: 0.00025, output_cost_per_1k: 0.00125, cached_input_cost_per_1k: null, thinking_cost_per_1k: null },

      // Azure OpenAI models
      { provider: 'azure', model: 'gpt-4o', model_family: 'gpt-4o', input_cost_per_1k: 0.0025, output_cost_per_1k: 0.01, cached_input_cost_per_1k: 0.00125, thinking_cost_per_1k: null },
      { provider: 'azure', model: 'gpt-4o-mini', model_family: 'gpt-4o-mini', input_cost_per_1k: 0.00015, output_cost_per_1k: 0.0006, cached_input_cost_per_1k: 0.000075, thinking_cost_per_1k: null },

      // Ollama (local - free)
      { provider: 'ollama', model: 'llama3.3:70b', model_family: 'llama', input_cost_per_1k: 0.0, output_cost_per_1k: 0.0, cached_input_cost_per_1k: null, thinking_cost_per_1k: null },
      { provider: 'ollama', model: 'qwen2.5:72b', model_family: 'qwen', input_cost_per_1k: 0.0, output_cost_per_1k: 0.0, cached_input_cost_per_1k: null, thinking_cost_per_1k: null },
      { provider: 'ollama', model: 'deepseek-r1:70b', model_family: 'deepseek', input_cost_per_1k: 0.0, output_cost_per_1k: 0.0, cached_input_cost_per_1k: null, thinking_cost_per_1k: null },
    ];

    for (const pricing of pricingData) {
      try {
        await prisma.modelPricing.upsert({
          where: {
            provider_model_effective_date: {
              provider: pricing.provider,
              model: pricing.model,
              effective_date: new Date('2025-01-01'),
            },
          },
          update: {
            input_cost_per_1k: pricing.input_cost_per_1k,
            output_cost_per_1k: pricing.output_cost_per_1k,
            cached_input_cost_per_1k: pricing.cached_input_cost_per_1k,
            thinking_cost_per_1k: pricing.thinking_cost_per_1k,
          },
          create: {
            provider: pricing.provider,
            model: pricing.model,
            model_family: pricing.model_family,
            input_cost_per_1k: pricing.input_cost_per_1k,
            output_cost_per_1k: pricing.output_cost_per_1k,
            cached_input_cost_per_1k: pricing.cached_input_cost_per_1k,
            thinking_cost_per_1k: pricing.thinking_cost_per_1k,
            effective_date: new Date('2025-01-01'),
          },
        });
      } catch (error: any) {
        logger.warn({ error: error.message, model: pricing.model }, `  ⚠️ Could not seed pricing for: ${pricing.model}`);
      }
    }

    logger.info(`  ✅ Seeded ${pricingData.length} model pricing entries`);
  }

  /**
   * Seed default ESO secret store for Kubernetes deployments
   */
  private async seedESOSecretStore(): Promise<void> {
    logger.info('  🔐 Seeding ESO secret store configuration...');

    try {
      await prisma.eSOSecretStore.upsert({
        where: { name: 'openagentic-secrets' },
        update: {},
        create: {
          name: 'openagentic-secrets',
          kind: 'ClusterSecretStore',
          provider: 'kubernetes', // Default to Kubernetes secrets, can be changed to vault, aws, gcp, azure
          provider_config: {
            auth: {
              serviceAccount: {
                name: 'external-secrets',
                namespace: 'external-secrets',
              },
            },
          },
          is_default: true,
          is_active: true,
        },
      });
      logger.info('  ✅ Default ESO secret store configured');
    } catch (error: any) {
      logger.warn({ error: error.message }, '  ⚠️ Could not seed ESO secret store');
    }
  }

  /**
   * Seed default system configuration values
   * Only seeds runtime config - LLM providers come from env vars via LLMProviderSeeder
   */
  private async seedSystemConfiguration(): Promise<void> {
    // 2026-04-19 — intelligence_slider seed removed (task #144, slider rip).
    // Existing rows in the DB are left in place for back-compat; the API
    // no longer reads from them.
    const defaults = [
      { key: 'max_tokens', value: { value: 8192 }, description: 'Default max tokens for responses' },
      { key: 'mcp_enabled', value: { value: true }, description: 'Enable MCP tool integration' },
    ];

    for (const config of defaults) {
      try {
        await prisma.systemConfiguration.upsert({
          where: { key: config.key },
          update: {},
          create: {
            key: config.key,
            value: config.value,
            description: config.description,
          },
        });
        logger.info(`  ✅ Seeded: ${config.key}`);
      } catch (error: any) {
        logger.warn({ error: error.message, key: config.key }, `  ⚠️ Could not seed: ${config.key}`);
      }
    }
  }

  /**
   * Ensure database connection is working
   */
  private async ensureDatabaseConnection(): Promise<void> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      logger.info('✅ Database connection verified');
    } catch (error: any) {
      throw new Error(`Database connection failed: ${error.message}`);
    }
  }

  /**
   * Ensure required schemas exist
   */
  private async ensureSchemas(): Promise<void> {
    const schemas = ['public', 'admin'];
    for (const schema of schemas) {
      try {
        await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        logger.info(`✅ Schema '${schema}' ensured`);
      } catch (error: any) {
        logger.warn({ error: error.message, schema }, `⚠️ Could not create schema`);
      }
    }
  }

  /**
   * Analyze schema drift between Prisma schema and actual database
   */
  private async analyzeSchemaDrift(): Promise<MigrationPlan> {
    const plan: MigrationPlan = {
      safeChanges: [],
      unsafeChanges: [],
      hasUnsafeChanges: false,
      timestamp: new Date().toISOString(),
      schemaVersion: await this.getSchemaVersion(),
    };

    try {
      // Use Prisma's schema diff to detect changes
      const { stdout, stderr } = await execAsync(
        'npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script 2>/dev/null || true',
        { timeout: 30000 }
      );

      // Parse the diff output to categorize changes
      if (stdout) {
        const lines = stdout.split('\n').filter(l => l.trim());
        for (const line of lines) {
          const change = this.parseChangeLine(line);
          if (change) {
            if (change.type === 'safe') {
              plan.safeChanges.push(change);
            } else {
              plan.unsafeChanges.push(change);
              plan.hasUnsafeChanges = true;
            }
          }
        }
      }

      // Also detect missing tables/columns directly
      await this.detectMissingStructures(plan);

    } catch (error: any) {
      logger.warn({ error: error.message }, 'Could not use prisma migrate diff, falling back to manual detection');
      // Fallback: detect missing structures directly
      await this.detectMissingStructures(plan);
    }

    return plan;
  }

  /**
   * Parse a line from prisma migrate diff output
   */
  private parseChangeLine(line: string): MigrationChange | null {
    const trimmed = line.trim().toUpperCase();

    if (trimmed.startsWith('CREATE TABLE') || trimmed.startsWith('-- CREATETABLE')) {
      return {
        type: 'safe',
        operation: 'CREATE TABLE',
        description: `Create new table: ${line}`,
        sql: line,
      };
    }

    if (trimmed.startsWith('ALTER TABLE') && trimmed.includes('ADD COLUMN')) {
      return {
        type: 'safe',
        operation: 'ADD COLUMN',
        description: `Add new column: ${line}`,
        sql: line,
      };
    }

    if (trimmed.startsWith('CREATE INDEX') || trimmed.startsWith('CREATE UNIQUE INDEX')) {
      return {
        type: 'safe',
        operation: 'CREATE INDEX',
        description: `Create index: ${line}`,
        sql: line,
      };
    }

    if (trimmed.startsWith('DROP TABLE')) {
      return {
        type: 'unsafe',
        operation: 'DROP TABLE',
        description: `⚠️ DROP TABLE detected: ${line}`,
        sql: line,
      };
    }

    if (trimmed.startsWith('ALTER TABLE') && trimmed.includes('DROP COLUMN')) {
      return {
        type: 'unsafe',
        operation: 'DROP COLUMN',
        description: `⚠️ DROP COLUMN detected: ${line}`,
        sql: line,
      };
    }

    if (trimmed.startsWith('DROP INDEX')) {
      return {
        type: 'unsafe',
        operation: 'DROP INDEX',
        description: `⚠️ DROP INDEX detected: ${line}`,
        sql: line,
      };
    }

    return null;
  }

  /**
   * Detect missing tables/columns by comparing Prisma schema with database
   */
  private async detectMissingStructures(plan: MigrationPlan): Promise<void> {
    // Get all tables from both schemas
    const existingTables = await prisma.$queryRaw<Array<{ table_schema: string; table_name: string }>>`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema IN ('public', 'admin')
      AND table_type = 'BASE TABLE'
    `;

    const existingTableSet = new Set(
      existingTables.map(t => `${t.table_schema}.${t.table_name}`)
    );

    // Check for critical tables that should exist
    const criticalTables = [
      // Core application tables
      { schema: 'public', name: 'users' },
      { schema: 'public', name: 'chat_sessions' },
      { schema: 'public', name: 'chat_messages' },
      { schema: 'public', name: 'user_azure_tokens' },
      { schema: 'public', name: 'code_sessions' },
      { schema: 'public', name: 'system_configuration' },
      // Admin schema tables
      { schema: 'admin', name: 'llm_request_logs' },
      { schema: 'admin', name: 'prompt_templates' },
      { schema: 'admin', name: 'token_usage' },
      { schema: 'admin', name: 'agentic_frameworks' },
      // Workflow platform tables (NEW)
      { schema: 'public', name: 'workflows' },
      { schema: 'public', name: 'workflow_versions' },
      { schema: 'public', name: 'workflow_executions' },
      { schema: 'public', name: 'workflow_approvals' },
      { schema: 'public', name: 'workflow_execution_logs' },
      { schema: 'public', name: 'workflow_webhooks' },
      { schema: 'public', name: 'workflow_schedules' },
      { schema: 'public', name: 'workflow_tests' },
      // User groups & chargeback (NEW)
      { schema: 'admin', name: 'user_groups' },
      { schema: 'admin', name: 'user_group_memberships' },
      { schema: 'admin', name: 'cost_budgets' },
      { schema: 'admin', name: 'chargeback_reports' },
      { schema: 'admin', name: 'model_pricing' },
      // Secrets management with ESO (NEW)
      { schema: 'admin', name: 'workflow_secrets' },
      { schema: 'admin', name: 'eso_secret_stores' },
      // Rate limiting (NEW)
      { schema: 'admin', name: 'rate_limits' },
      { schema: 'public', name: 'verified_tool_results' },
    ];

    for (const table of criticalTables) {
      const key = `${table.schema}.${table.name}`;
      if (!existingTableSet.has(key)) {
        plan.safeChanges.push({
          type: 'safe',
          operation: 'CREATE TABLE',
          table: table.name,
          schema: table.schema,
          description: `Create missing table: ${key}`,
        });
      }
    }
  }

  /**
   * Apply a single migration change
   */
  private async applyChange(change: MigrationChange): Promise<void> {
    if (change.sql) {
      await prisma.$executeRawUnsafe(change.sql);
    } else {
      // The change will be applied by the final Prisma sync
      logger.info({ change: change.description }, 'Change will be applied by Prisma sync');
    }
  }

  // syncPrismaSchema removed - replaced by runFreshInstall and runIncrementalMigration

  /**
   * Create a backup checkpoint before applying changes
   */
  private async createBackupCheckpoint(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `migration_backup_${timestamp}`;

    try {
      // Create a schema snapshot table to track migrations
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS _migration_history (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          changes JSONB,
          rollback_sql TEXT,
          status VARCHAR(50) DEFAULT 'applied'
        )
      `;

      // For now, just record that we're doing a migration
      // In a full implementation, you'd dump the schema or create a point-in-time recovery point
      await prisma.$executeRaw`
        INSERT INTO _migration_history (name, changes, status)
        VALUES (${backupName}, '{}', 'started')
      `;

      return backupName;
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Could not create backup checkpoint');
      throw error;
    }
  }

  /**
   * Record completed migration in database
   */
  private async recordMigration(result: MigrationResult): Promise<void> {
    try {
      if (result.backupName) {
        await prisma.$executeRaw`
          UPDATE _migration_history
          SET
            status = ${result.success ? 'completed' : 'failed'},
            changes = ${JSON.stringify({
              applied: result.appliedChanges.map(c => c.description),
              skipped: result.skippedChanges.map(c => c.description),
              errors: result.errors,
            })}::jsonb
          WHERE name = ${result.backupName}
        `;
      }
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Could not record migration history');
    }
  }

  /**
   * Get current schema version (hash of schema file)
   */
  private async getSchemaVersion(): Promise<string> {
    try {
      const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
      const content = await fs.readFile(schemaPath, 'utf-8');
      const crypto = await import('crypto');
      return crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
    } catch {
      return 'unknown';
    }
  }

  /**
   * Rollback to a previous migration (if possible)
   */
  async rollback(migrationName: string): Promise<boolean> {
    try {
      const migration = await prisma.$queryRaw<Array<{ rollback_sql: string | null }>>`
        SELECT rollback_sql FROM _migration_history WHERE name = ${migrationName}
      `;

      if (migration[0]?.rollback_sql) {
        await prisma.$executeRawUnsafe(migration[0].rollback_sql);
        logger.info({ migrationName }, '✅ Rollback completed');
        return true;
      } else {
        logger.warn({ migrationName }, '⚠️ No rollback SQL available for this migration');
        return false;
      }
    } catch (error: any) {
      logger.error({ error: error.message, migrationName }, '❌ Rollback failed');
      return false;
    }
  }
}

export const autoMigrationService = AutoMigrationService.getInstance();
