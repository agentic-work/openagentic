/**
 * Prisma migration integrity gate (#508 §6.0) — Phase 1 lifecycle migration.
 *
 * The FedRAMP overhaul spec §6.0 mandates that every migration in this
 * overhaul apply cleanly to:
 *   1. a freshly-created empty database
 *   2. an existing populated database (no row loss)
 *   3. re-runs of the same migration (idempotency)
 *
 * Pre-existing constraint discovered while writing this test:
 *
 *   The migrations directory in `prisma/migrations/` predates §6.0 and is
 *   NOT zero-up clean — the very first migration (20260210_workflow_chargeback)
 *   references `public.users` which is created by `prisma db push`, not by
 *   any migration. Live deploys bootstrap the schema via `db push` then run
 *   `migrate deploy` to apply incrementals. Fixing every legacy migration
 *   to be zero-up clean is OUT of Phase 1's scope (this PR is constrained
 *   to three files). A separate hygiene pass will restore §6.0 compliance
 *   for the entire migrations directory.
 *
 * What this test covers — Phase 1 specific:
 *
 *   1. The schema's Phase 1 additions (lifecycle columns, FK, audit log
 *      table) materialize after `prisma db push` runs against an empty DB.
 *   2. The migration.sql DDL — including the cascade trigger and
 *      append-only audit grants — applies cleanly to that bootstrap state.
 *   3. The migration.sql is idempotent (re-running it is a no-op).
 *   4. The provider soft-delete cascade trigger flips registry rows to
 *      DEPRECATED with retention_until = deprecated_at + 90d.
 *
 * Skip condition: when Docker isn't reachable. Set
 * MIGRATION_GATE_REQUIRE_DOCKER=1 in CI to fail (rather than skip) when
 * Docker is missing. Skipping logs a loud warning so reviewers don't miss
 * that the gate didn't run.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { execSync, spawnSync } from 'child_process';
import path from 'path';
import { readFileSync, readdirSync } from 'fs';
import { randomBytes } from 'crypto';

// ----------------------------------------------------------------------------
// Docker helpers — minimal wrapper around `docker run` / `docker rm` so this
// test stays dependency-free (no testcontainers package). The image used is
// the same pgvector/pgvector:pg16 the dev compose already runs, so no extra
// image pull on the developer's box.
// ----------------------------------------------------------------------------

const PG_IMAGE = process.env.MIGRATION_GATE_PG_IMAGE || 'pgvector/pgvector:pg16';
const REQUIRE_DOCKER = process.env.MIGRATION_GATE_REQUIRE_DOCKER === '1';

function dockerAvailable(): boolean {
  try {
    const r = spawnSync('docker', ['ps'], { encoding: 'utf8' });
    return r.status === 0;
  } catch {
    return false;
  }
}

function freePort(): number {
  return 49152 + Math.floor(Math.random() * 16383);
}

interface PgHandle {
  containerName: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  url: string;
}

async function spinPostgres(): Promise<PgHandle> {
  const containerName = `aw-mig-test-${randomBytes(4).toString('hex')}`;
  const port = freePort();
  const user = 'awtest';
  const password = 'awtest';
  const database = 'awtest';

  execSync(
    [
      'docker run -d',
      `--name ${containerName}`,
      `-e POSTGRES_USER=${user}`,
      `-e POSTGRES_PASSWORD=${password}`,
      `-e POSTGRES_DB=${database}`,
      `-p ${port}:5432`,
      PG_IMAGE,
    ].join(' '),
    { stdio: 'pipe' }
  );

  // Wait for ready — pg_isready inside the container is the canonical check.
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < 30_000) {
    const r = spawnSync('docker', ['exec', containerName, 'pg_isready', '-U', user], {
      encoding: 'utf8',
    });
    if (r.status === 0) {
      ready = true;
      break;
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  if (!ready) {
    execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' });
    throw new Error(`Postgres container ${containerName} did not become ready in 30s`);
  }

  // Postgres is ready but Prisma's `multiSchema` requires the `admin` schema
  // to exist before `db push` runs. Mirrors live deploy: helm provisions
  // schemas in postgres bootstrap, then Prisma takes over.
  const adminSetup = spawnSync(
    'docker',
    [
      'exec',
      containerName,
      'psql',
      '-U',
      user,
      '-d',
      database,
      '-c',
      'CREATE SCHEMA IF NOT EXISTS admin;',
    ],
    { encoding: 'utf8' }
  );
  if (adminSetup.status !== 0) {
    execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' });
    throw new Error(`Failed to create admin schema: ${adminSetup.stderr}`);
  }

  return {
    containerName,
    host: '127.0.0.1',
    port,
    user,
    password,
    database,
    url: `postgresql://${user}:${password}@127.0.0.1:${port}/${database}?schema=public`,
  };
}

function tearDown(handle: PgHandle | null): void {
  if (!handle) return;
  try {
    execSync(`docker rm -f ${handle.containerName}`, { stdio: 'pipe' });
  } catch {
    /* best effort */
  }
}

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runPrismaCmd(args: string[], databaseUrl: string): ProcessResult {
  const apiDir = path.resolve(__dirname, '../..');
  const r = spawnSync('npx', ['prisma', ...args], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function bootstrapWithDbPush(databaseUrl: string): ProcessResult {
  // `db push` syncs the model state from schema.prisma directly into the DB
  // without going through the migration log. This is what production also
  // uses on first install (then `migrate deploy` runs only the incrementals
  // after that).
  return runPrismaCmd(['db', 'push', '--skip-generate', '--accept-data-loss'], databaseUrl);
}

function locatePhase1Migration(): { dir: string; sqlPath: string } {
  // Find the Phase 1 migration directory by name suffix. We do this rather
  // than hard-code the timestamp so the test still works when the migration
  // is regenerated.
  const migDir = path.resolve(__dirname, '../../prisma/migrations');
  const candidates = readdirSync(migDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith('_phase1_registry_lifecycle'))
    .map((e) => e.name)
    .sort();
  if (candidates.length === 0) {
    throw new Error('No phase1_registry_lifecycle migration directory found');
  }
  if (candidates.length > 1) {
    throw new Error(`Multiple phase1 migrations found: ${candidates.join(', ')}`);
  }
  const dir = path.join(migDir, candidates[0]);
  return { dir, sqlPath: path.join(dir, 'migration.sql') };
}

async function applyMigrationSql(client: Client, sqlPath: string): Promise<void> {
  const sql = readFileSync(sqlPath, 'utf8');
  // Postgres can run multi-statement SQL via a single Client.query call.
  await client.query(sql);
}

// ----------------------------------------------------------------------------
// The actual gate.
// ----------------------------------------------------------------------------

const docker = dockerAvailable();
const skipMessage =
  '[#508 §6.0 GATE] Docker not available — fresh-install gate SKIPPED. ' +
  'Set MIGRATION_GATE_REQUIRE_DOCKER=1 to fail instead of skip.';

if (!docker && !REQUIRE_DOCKER) {
  // eslint-disable-next-line no-console
  console.warn(skipMessage);
}

(docker || REQUIRE_DOCKER ? describe : describe.skip)(
  'Prisma migration integrity gate (#508 §6.0) — Phase 1 lifecycle',
  () => {
    let pg: PgHandle | null = null;

    beforeAll(async () => {
      if (!docker) throw new Error(skipMessage);
      pg = await spinPostgres();
    }, 60_000);

    afterAll(() => {
      tearDown(pg);
    });

    it('bootstraps fresh schema via prisma db push (zero-up scaffold)', () => {
      const result = bootstrapWithDbPush(pg!.url);
      if (result.code !== 0) {
        // eslint-disable-next-line no-console
        console.error('db push stdout:\n' + result.stdout);
        // eslint-disable-next-line no-console
        console.error('db push stderr:\n' + result.stderr);
      }
      expect(result.code).toBe(0);
    }, 240_000);

    it('Phase 1 lifecycle columns exist on model_role_assignments with default state=active', async () => {
      const client = new Client({ connectionString: pg!.url });
      await client.connect();
      try {
        const cols = await client.query<{
          column_name: string;
          data_type: string;
          column_default: string | null;
          is_nullable: string;
        }>(
          `SELECT column_name, data_type, column_default, is_nullable
           FROM information_schema.columns
           WHERE table_schema='admin' AND table_name='model_role_assignments'`
        );
        const byName = new Map(cols.rows.map((r) => [r.column_name, r]));

        // Required additive columns from spec §5.2.
        for (const c of [
          'state',
          'proposed_by',
          'proposed_at',
          'approved_by',
          'approved_at',
          'rejected_by',
          'rejected_at',
          'rejection_reason',
          'deprecated_at',
          'deprecation_reason',
          'disposed_at',
          'retention_until',
          'current_revision',
          'provider_id',
        ]) {
          expect(byName.has(c), `missing column ${c}`).toBe(true);
        }

        const state = byName.get('state')!;
        expect(String(state.column_default)).toMatch(/active/);

        const rev = byName.get('current_revision')!;
        expect(String(rev.column_default)).toMatch(/^1\b/);

        // provider_id is nullable for backfill safety.
        expect(byName.get('provider_id')!.is_nullable).toBe('YES');
      } finally {
        await client.end();
      }
    }, 30_000);

    it('FK admin.model_role_assignments.provider_id → admin.llm_providers(id) exists', async () => {
      const client = new Client({ connectionString: pg!.url });
      await client.connect();
      try {
        const fk = await client.query<{
          constraint_name: string;
          column_name: string;
          foreign_schema: string;
          foreign_table: string;
          foreign_column: string;
        }>(
          `SELECT
             tc.constraint_name,
             kcu.column_name,
             ccu.table_schema AS foreign_schema,
             ccu.table_name   AS foreign_table,
             ccu.column_name  AS foreign_column
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
           WHERE tc.table_schema = 'admin'
             AND tc.table_name = 'model_role_assignments'
             AND tc.constraint_type = 'FOREIGN KEY'
             AND kcu.column_name = 'provider_id'`
        );
        expect(fk.rowCount).toBeGreaterThan(0);
        expect(fk.rows[0].foreign_schema).toBe('admin');
        expect(fk.rows[0].foreign_table).toBe('llm_providers');
        expect(fk.rows[0].foreign_column).toBe('id');
      } finally {
        await client.end();
      }
    }, 30_000);

    it('admin.model_registry_audit_log table is present with the full append-only column set', async () => {
      const client = new Client({ connectionString: pg!.url });
      await client.connect();
      try {
        const cols = await client.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema='admin' AND table_name='model_registry_audit_log'`
        );
        const set = new Set(cols.rows.map((r) => r.column_name));
        for (const c of [
          'id',
          'registry_id',
          'tenant_id',
          'user_id',
          'action',
          'before_state',
          'after_state',
          'diff',
          'reason',
          'ip_address',
          'user_agent',
          'request_id',
          'signature',
          'created_at',
        ]) {
          expect(set.has(c), `missing audit column ${c}`).toBe(true);
        }
      } finally {
        await client.end();
      }
    }, 30_000);

    it('Phase 1 migration.sql applies cleanly on top of db-push schema (cascade trigger + REVOKE)', async () => {
      const { sqlPath } = locatePhase1Migration();
      const client = new Client({ connectionString: pg!.url });
      await client.connect();
      try {
        await applyMigrationSql(client, sqlPath);

        // Verify the cascade trigger is installed.
        const trig = await client.query<{ trigger_name: string }>(
          `SELECT trigger_name FROM information_schema.triggers
           WHERE event_object_schema = 'admin'
             AND event_object_table = 'llm_providers'
             AND trigger_name = 'provider_soft_delete_cascade'`
        );
        expect(trig.rowCount).toBeGreaterThan(0);
      } finally {
        await client.end();
      }
    }, 60_000);

    it('Phase 1 migration.sql is idempotent — re-applying is a no-op', async () => {
      const { sqlPath } = locatePhase1Migration();
      const client = new Client({ connectionString: pg!.url });
      await client.connect();
      try {
        await applyMigrationSql(client, sqlPath);
        // Re-apply: must not error (CREATE OR REPLACE, IF NOT EXISTS, etc.)
        await applyMigrationSql(client, sqlPath);
        await applyMigrationSql(client, sqlPath);

        // Trigger still present, single instance.
        const trigCount = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM information_schema.triggers
           WHERE event_object_schema = 'admin'
             AND event_object_table = 'llm_providers'
             AND trigger_name = 'provider_soft_delete_cascade'`
        );
        expect(parseInt(trigCount.rows[0].count, 10)).toBe(1);
      } finally {
        await client.end();
      }
    }, 60_000);

    it('cascade fires: provider soft-delete → registry rows go DEPRECATED with retention_until = +90d', async () => {
      const client = new Client({ connectionString: pg!.url });
      await client.connect();
      try {
        // Seed a user (creator FK), a provider, and a registry row referencing it.
        const userId = randomBytes(8).toString('hex');
        await client.query(
          `INSERT INTO admin.users (id, email, name, is_admin) VALUES ($1, $2, $3, true)`,
          [userId, `mig-test-${userId}@example.test`, 'mig-test']
        );

        const providerId = randomBytes(8).toString('hex');
        await client.query(
          `INSERT INTO admin.llm_providers
             (id, name, display_name, provider_type, auth_config, provider_config)
           VALUES
             ($1, $2, $3, 'azure-openai', '{}'::jsonb, '{}'::jsonb)`,
          [providerId, `mig-test-prov-${providerId}`, 'Mig Test Provider']
        );

        const rowId = randomBytes(8).toString('hex');
        await client.query(
          `INSERT INTO admin.model_role_assignments
             (id, role, model, provider, provider_id, created_by, state)
           VALUES
             ($1, 'chat', 'mig-test-model', $2, $3, $4, 'active')`,
          [rowId, `mig-test-prov-${providerId}`, providerId, userId]
        );

        // Soft-delete the provider — trigger should flip the registry row.
        await client.query(`UPDATE admin.llm_providers SET deleted_at = NOW() WHERE id = $1`, [
          providerId,
        ]);

        const after = await client.query<{
          state: string;
          deprecated_at: Date | null;
          retention_until: Date | null;
          deprecation_reason: string | null;
        }>(
          `SELECT state, deprecated_at, retention_until, deprecation_reason
           FROM admin.model_role_assignments
           WHERE id = $1`,
          [rowId]
        );
        expect(after.rowCount).toBe(1);
        expect(after.rows[0].state).toBe('deprecated');
        expect(after.rows[0].deprecated_at).toBeInstanceOf(Date);
        expect(after.rows[0].retention_until).toBeInstanceOf(Date);

        const dep = (after.rows[0].deprecated_at as Date).getTime();
        const ret = (after.rows[0].retention_until as Date).getTime();
        const days = (ret - dep) / (24 * 60 * 60 * 1000);
        expect(days).toBeGreaterThanOrEqual(89.9);
        expect(days).toBeLessThanOrEqual(90.1);
        expect(String(after.rows[0].deprecation_reason)).toMatch(
          /Cascade from provider soft-delete/
        );
      } finally {
        await client.end();
      }
    }, 60_000);

    it('cascade is idempotent: a no-op deleted_at update does not re-deprecate', async () => {
      const client = new Client({ connectionString: pg!.url });
      await client.connect();
      try {
        // Re-issue the same UPDATE (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NOT NULL)
        // — the trigger checks that deleted_at went from NULL -> NOT NULL, so a re-update
        // must NOT touch already-deprecated rows.
        const r = await client.query(
          `SELECT id, state FROM admin.model_role_assignments WHERE state = 'deprecated' LIMIT 1`
        );
        if (r.rowCount === 0) return; // earlier test didn't create any deprecated row; skip
        const rowId = r.rows[0].id;
        const beforeRetention = await client.query<{ retention_until: Date }>(
          `SELECT retention_until FROM admin.model_role_assignments WHERE id = $1`,
          [rowId]
        );
        const before = (beforeRetention.rows[0].retention_until as Date).getTime();

        // Touch the provider's deleted_at again — same value.
        await client.query(`
          UPDATE admin.llm_providers
          SET deleted_at = deleted_at
          WHERE deleted_at IS NOT NULL
        `);

        const afterRetention = await client.query<{ retention_until: Date }>(
          `SELECT retention_until FROM admin.model_role_assignments WHERE id = $1`,
          [rowId]
        );
        const after = (afterRetention.rows[0].retention_until as Date).getTime();
        // Retention should NOT have changed.
        expect(after).toBe(before);
      } finally {
        await client.end();
      }
    }, 30_000);
  }
);
