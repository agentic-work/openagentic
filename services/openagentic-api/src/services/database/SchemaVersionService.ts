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
 * SchemaVersionService - Tracks schema migrations for zero-downtime upgrades
 *
 * Provides version tracking for database schema changes, supporting:
 * - Safe migration tracking with rollback support
 * - Version comparison for upgrade paths
 * - Checksum validation for schema integrity
 *
 * @see DATA_LAYER_EVOLUTION_PLAN.md for architecture decisions
 */

import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { Logger } from 'pino';
import { readFileSync } from 'fs';
import { join } from 'path';
import logger from '../../utils/logger.js';

// Schema version record
export interface SchemaVersionRecord {
  id: number;
  version: string;
  description: string | null;
  checksum: string;
  appliedAt: Date;
  appliedBy: string | null;
  rollbackSql: string | null;
  isCurrent: boolean;
}

// Schema version comparison result
export interface VersionCompareResult {
  current: string | null;
  target: string;
  isUpgrade: boolean;
  isDowngrade: boolean;
  isSame: boolean;
  missingVersions: string[];
}

// Schema migration result
export interface MigrationResult {
  success: boolean;
  fromVersion: string | null;
  toVersion: string;
  appliedAt: Date;
  error?: string;
}

export class SchemaVersionService {
  private prisma: PrismaClient;
  private log: Logger;
  private schemaPath: string;

  constructor(prisma: PrismaClient, customLogger?: Logger, schemaPath?: string) {
    this.prisma = prisma;
    this.log = customLogger || logger.child({ service: 'SchemaVersionService' });
    this.schemaPath = schemaPath || join(process.cwd(), 'prisma', 'schema.prisma');
  }

  /**
   * Calculate SHA256 checksum of the current schema file
   */
  calculateSchemaChecksum(): string {
    try {
      const schemaContent = readFileSync(this.schemaPath, 'utf-8');
      // Normalize line endings and remove comments for consistent checksums
      const normalized = schemaContent
        .replace(/\r\n/g, '\n')
        .replace(/\/\/.*$/gm, '') // Remove single-line comments
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
      return createHash('sha256').update(normalized).digest('hex');
    } catch (error) {
      this.log.error({ error }, 'Failed to calculate schema checksum');
      throw error;
    }
  }

  /**
   * Get the current schema version from the database
   */
  async getCurrentVersion(): Promise<SchemaVersionRecord | null> {
    try {
      // Check if table exists
      const tableExists = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'schema_versions'
          AND table_schema = 'admin'
        ) as exists
      `;

      if (!tableExists[0]?.exists) {
        this.log.info('schema_versions table does not exist yet');
        return null;
      }

      const current = await this.prisma.$queryRaw<Array<{
        id: number;
        version: string;
        description: string | null;
        checksum: string;
        applied_at: Date;
        applied_by: string | null;
        rollback_sql: string | null;
        is_current: boolean;
      }>>`
        SELECT * FROM admin.schema_versions
        WHERE is_current = true
        ORDER BY id DESC
        LIMIT 1
      `;

      if (current.length === 0) {
        return null;
      }

      return {
        id: current[0].id,
        version: current[0].version,
        description: current[0].description,
        checksum: current[0].checksum,
        appliedAt: current[0].applied_at,
        appliedBy: current[0].applied_by,
        rollbackSql: current[0].rollback_sql,
        isCurrent: current[0].is_current
      };
    } catch (error) {
      this.log.error({ error }, 'Failed to get current schema version');
      return null;
    }
  }

  /**
   * Get all schema versions from the database
   */
  async getAllVersions(): Promise<SchemaVersionRecord[]> {
    try {
      const versions = await this.prisma.$queryRaw<Array<{
        id: number;
        version: string;
        description: string | null;
        checksum: string;
        applied_at: Date;
        applied_by: string | null;
        rollback_sql: string | null;
        is_current: boolean;
      }>>`
        SELECT * FROM admin.schema_versions
        ORDER BY id ASC
      `;

      return versions.map(v => ({
        id: v.id,
        version: v.version,
        description: v.description,
        checksum: v.checksum,
        appliedAt: v.applied_at,
        appliedBy: v.applied_by,
        rollbackSql: v.rollback_sql,
        isCurrent: v.is_current
      }));
    } catch (error) {
      this.log.error({ error }, 'Failed to get all schema versions');
      return [];
    }
  }

  /**
   * Compare semantic versions
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA < numB) return -1;
      if (numA > numB) return 1;
    }
    return 0;
  }

  /**
   * Compare current version with target version
   */
  async compareWithTarget(targetVersion: string): Promise<VersionCompareResult> {
    const current = await this.getCurrentVersion();

    if (!current) {
      return {
        current: null,
        target: targetVersion,
        isUpgrade: true,
        isDowngrade: false,
        isSame: false,
        missingVersions: [targetVersion]
      };
    }

    const comparison = this.compareVersions(current.version, targetVersion);

    return {
      current: current.version,
      target: targetVersion,
      isUpgrade: comparison < 0,
      isDowngrade: comparison > 0,
      isSame: comparison === 0,
      missingVersions: comparison < 0 ? [targetVersion] : []
    };
  }

  /**
   * Record a new schema version
   */
  async recordVersion(params: {
    version: string;
    description?: string;
    appliedBy?: string;
    rollbackSql?: string;
  }): Promise<SchemaVersionRecord> {
    const checksum = this.calculateSchemaChecksum();

    try {
      // Mark all existing versions as not current
      await this.prisma.$executeRaw`
        UPDATE admin.schema_versions
        SET is_current = false
        WHERE is_current = true
      `;

      // Insert new version
      const result = await this.prisma.$queryRaw<Array<{
        id: number;
        version: string;
        description: string | null;
        checksum: string;
        applied_at: Date;
        applied_by: string | null;
        rollback_sql: string | null;
        is_current: boolean;
      }>>`
        INSERT INTO admin.schema_versions (version, description, checksum, applied_by, rollback_sql, is_current)
        VALUES (${params.version}, ${params.description || null}, ${checksum}, ${params.appliedBy || null}, ${params.rollbackSql || null}, true)
        RETURNING *
      `;

      this.log.info({ version: params.version, checksum }, 'Recorded new schema version');

      return {
        id: result[0].id,
        version: result[0].version,
        description: result[0].description,
        checksum: result[0].checksum,
        appliedAt: result[0].applied_at,
        appliedBy: result[0].applied_by,
        rollbackSql: result[0].rollback_sql,
        isCurrent: result[0].is_current
      };
    } catch (error) {
      this.log.error({ error, version: params.version }, 'Failed to record schema version');
      throw error;
    }
  }

  /**
   * Verify schema integrity by comparing checksum
   */
  async verifyIntegrity(): Promise<{
    isValid: boolean;
    currentChecksum: string;
    expectedChecksum: string | null;
    message: string;
  }> {
    const currentChecksum = this.calculateSchemaChecksum();
    const currentVersion = await this.getCurrentVersion();

    if (!currentVersion) {
      return {
        isValid: true,
        currentChecksum,
        expectedChecksum: null,
        message: 'No schema version recorded - first deployment'
      };
    }

    const isValid = currentChecksum === currentVersion.checksum;

    return {
      isValid,
      currentChecksum,
      expectedChecksum: currentVersion.checksum,
      message: isValid
        ? 'Schema checksum matches recorded version'
        : 'Schema has been modified since last recorded version'
    };
  }

  /**
   * Initialize the schema_versions table if it doesn't exist
   */
  async initializeVersionTable(): Promise<boolean> {
    try {
      // Create admin schema if it doesn't exist
      await this.prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS admin');

      // Check if table exists
      const tableExists = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'schema_versions'
          AND table_schema = 'admin'
        ) as exists
      `;

      if (!tableExists[0]?.exists) {
        this.log.info('Creating schema_versions table...');
        await this.prisma.$executeRaw`
          CREATE TABLE admin.schema_versions (
            id SERIAL PRIMARY KEY,
            version VARCHAR(50) NOT NULL,
            description TEXT,
            checksum VARCHAR(64) NOT NULL,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            applied_by VARCHAR(255),
            rollback_sql TEXT,
            is_current BOOLEAN DEFAULT true
          )
        `;

        await this.prisma.$executeRaw`
          CREATE INDEX idx_schema_versions_version ON admin.schema_versions (version)
        `;

        await this.prisma.$executeRaw`
          CREATE INDEX idx_schema_versions_is_current ON admin.schema_versions (is_current)
        `;

        this.log.info('schema_versions table created successfully');
        return true;
      }

      return false;
    } catch (error) {
      this.log.error({ error }, 'Failed to initialize version table');
      throw error;
    }
  }

  /**
   * Get the next version number based on current version
   */
  async getNextVersion(incrementType: 'major' | 'minor' | 'patch' = 'patch'): Promise<string> {
    const current = await this.getCurrentVersion();

    if (!current) {
      return '1.0.0';
    }

    const parts = current.version.split('.').map(Number);
    while (parts.length < 3) parts.push(0);

    switch (incrementType) {
      case 'major':
        parts[0]++;
        parts[1] = 0;
        parts[2] = 0;
        break;
      case 'minor':
        parts[1]++;
        parts[2] = 0;
        break;
      case 'patch':
        parts[2]++;
        break;
    }

    return parts.join('.');
  }

  /**
   * Health check for schema versioning
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    tableExists: boolean;
    currentVersion: string | null;
    schemaIntegrity: boolean;
    error?: string;
  }> {
    try {
      const tableExists = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'schema_versions'
          AND table_schema = 'admin'
        ) as exists
      `;

      const current = await this.getCurrentVersion();
      const integrity = await this.verifyIntegrity();

      return {
        healthy: true,
        tableExists: tableExists[0]?.exists || false,
        currentVersion: current?.version || null,
        schemaIntegrity: integrity.isValid
      };
    } catch (error) {
      return {
        healthy: false,
        tableExists: false,
        currentVersion: null,
        schemaIntegrity: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

// Singleton instance
let instance: SchemaVersionService | null = null;

/**
 * Get or create the SchemaVersionService singleton
 */
export function getSchemaVersionService(prisma: PrismaClient): SchemaVersionService {
  if (!instance) {
    instance = new SchemaVersionService(prisma);
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetSchemaVersionService(): void {
  instance = null;
}

export default SchemaVersionService;
