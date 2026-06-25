/**
 * Contract test for the F0 migration SQL.
 *
 * the design notes
 *
 * Asserts the migration SQL declares all DDL the spec requires. Pure file-content
 * test; no Testcontainers (this repo doesn't have it). F2 will add real DB
 * integration tests once we have a seeder behavior to exercise.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, '../../../prisma/migrations');

function findF0MigrationSql(): string {
  const dirs = readdirSync(MIGRATIONS_DIR);
  const f0 = dirs.find(d => d.includes('registry_sot_v1_F0'));
  if (!f0) throw new Error('F0 migration directory not found under prisma/migrations');
  return readFileSync(join(MIGRATIONS_DIR, f0, 'migration.sql'), 'utf8');
}

describe('Registry SoT v1 F0 migration — contract', () => {
  const sql = findF0MigrationSql();

  describe('model_role_assignments columns', () => {
    it('adds managed_by column with bootstrap|admin|discovered CHECK', () => {
      expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS managed_by/);
      expect(sql).toMatch(/CHECK \(managed_by IN \('bootstrap','admin','discovered'\)\)/);
    });
    it('adds bootstrap_version INTEGER NULL', () => {
      expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS bootstrap_version INTEGER NULL/);
    });
    it('adds version INTEGER NOT NULL DEFAULT 1', () => {
      expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1/);
    });
    it('creates idx_mra_managed_by index', () => {
      expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_mra_managed_by/);
    });
  });

  describe('tombstone table', () => {
    it('creates model_role_assignment_tombstones', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS admin\.model_role_assignment_tombstones/);
    });
    it('PK is (provider_name, model, role) — by-name not by-id', () => {
      expect(sql).toMatch(/PRIMARY KEY \(provider_name, model, role\)/);
    });
  });

  describe('audit log table', () => {
    it('creates model_registry_events with hash + prev_hash', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS admin\.model_registry_events/);
      expect(sql).toMatch(/hash\s+TEXT NOT NULL/);
      expect(sql).toMatch(/prev_hash\s+TEXT NULL/);
    });
    it('action CHECK includes BOOTSTRAP_SEED + TOMBSTONE + TOMBSTONE_RESET', () => {
      expect(sql).toMatch(/BOOTSTRAP_SEED/);
      expect(sql).toMatch(/'TOMBSTONE'/);
      expect(sql).toMatch(/TOMBSTONE_RESET/);
    });
    it('enables RLS on the audit table', () => {
      expect(sql).toMatch(/ALTER TABLE admin\.model_registry_events ENABLE ROW LEVEL SECURITY/);
    });
    it('declares mre_insert + mre_select policies (no UPDATE / DELETE policy)', () => {
      expect(sql).toMatch(/CREATE POLICY mre_insert/);
      expect(sql).toMatch(/CREATE POLICY mre_select/);
      expect(sql).not.toMatch(/CREATE POLICY mre_update/);
      expect(sql).not.toMatch(/CREATE POLICY mre_delete/);
    });
  });

  describe('LISTEN/NOTIFY trigger', () => {
    it('declares notify_model_registry_change function', () => {
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION admin\.notify_model_registry_change/);
    });
    it('publishes to channel model_registry_changed', () => {
      expect(sql).toMatch(/pg_notify\('model_registry_changed'/);
    });
    it('attaches trg_model_registry_change to model_role_assignments AFTER INSERT/UPDATE/DELETE', () => {
      expect(sql).toMatch(/CREATE TRIGGER trg_model_registry_change/);
      expect(sql).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON admin\.model_role_assignments/);
    });
  });

  describe('pending_changes table', () => {
    it('creates pending_changes with status CHECK', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS admin\.pending_changes/);
      expect(sql).toMatch(/CHECK \(status IN \('pending','approved','rejected','expired'\)\)/);
    });
  });

  describe('seeder version row', () => {
    it('inserts registry_seeder_version row with version 0', () => {
      expect(sql).toMatch(/INSERT INTO admin\.system_configuration/);
      expect(sql).toMatch(/registry_seeder_version/);
      expect(sql).toMatch(/'\{"version": 0\}'::jsonb/);
      expect(sql).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
    });
  });

  describe('idempotency (Tested-fresh-install: yes)', () => {
    it('all CREATE TABLE statements use IF NOT EXISTS', () => {
      const createTables = sql.match(/CREATE TABLE\s+(?!IF NOT EXISTS)/g) || [];
      expect(createTables, 'every CREATE TABLE must be IF NOT EXISTS for idempotency').toEqual([]);
    });
    it('all ALTER TABLE ADD COLUMN use IF NOT EXISTS', () => {
      const addCols = sql.match(/ADD COLUMN\s+(?!IF NOT EXISTS)/g) || [];
      expect(addCols, 'every ADD COLUMN must be IF NOT EXISTS').toEqual([]);
    });
    it('all CREATE INDEX use IF NOT EXISTS', () => {
      const createIdx = sql.match(/CREATE INDEX\s+(?!IF NOT EXISTS)/g) || [];
      expect(createIdx, 'every CREATE INDEX must be IF NOT EXISTS').toEqual([]);
    });
  });
});
