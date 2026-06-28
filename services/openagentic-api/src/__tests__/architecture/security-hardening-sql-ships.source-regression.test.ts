/**
 * Source-regression: the DB security-hardening SQL ships + is wired into boot.
 *
 * The boot path is `prisma db push` (schema-only). The NIST AC-4 row-level
 * security policies + AU-9 audit-immutability triggers used to live as raw SQL
 * in prisma/migrations/, which `db push` SKIPS — so they never shipped on a
 * stock install. They are now consolidated into ONE idempotent, existence-
 * guarded file (prisma/security/hardening.sql) that docker-entrypoint.sh
 * applies right after `db push`, on every boot.
 *
 * This cage pins that the file exists, contains the required objects, and is
 * actually wired into the entrypoint — so it can't be silently deleted or
 * unwired (which would re-open the hardening gap). It is a CHEAP file/string
 * check — it does NOT require a live DB (the live-DB proof was captured at
 * implementation time).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVICE_ROOT = resolve(__dirname, '../../..'); // .../openagentic-api
const HARDENING_SQL = resolve(SERVICE_ROOT, 'prisma/security/hardening.sql');
const ENTRYPOINT = resolve(SERVICE_ROOT, 'docker-entrypoint.sh');

describe('arch: DB security-hardening SQL ships + is wired', () => {
  it('prisma/security/hardening.sql exists and is non-trivial', () => {
    const sql = readFileSync(HARDENING_SQL, 'utf8');
    expect(sql.length).toBeGreaterThan(2000);
  });

  it('defines the AU-9 immutability trigger function', () => {
    const sql = readFileSync(HARDENING_SQL, 'utf8');
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION\s+prevent_audit_modification\b/);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE/);
  });

  it('names all 4 deliberate audit-immutability triggers', () => {
    const sql = readFileSync(HARDENING_SQL, 'utf8');
    for (const trig of [
      'audit_immutable_admin_audit_log',
      'audit_immutable_user_query_audit',
      'audit_immutable_credential_exchange_audit',
      'audit_immutable_synth_capability_audit',
    ]) {
      expect(sql, `missing trigger ${trig}`).toContain(trig);
    }
  });

  it('does NOT add an immutability trigger to a mutated table (e.g. tool_call_attempt)', () => {
    const sql = readFileSync(HARDENING_SQL, 'utf8');
    // Surgical-trigger invariant: only the 4 append-only logs above are
    // protected. tool_call_attempt may appear in EXPLANATORY COMMENTS (as the
    // canonical "do not protect this" example), but it must never be a trigger
    // target: there is no audit_immutable_tool_call_attempt trigger name, and
    // it is not listed in the immutability VALUES tuple (the only place a
    // trigger target is declared, always quoted as a SQL identifier).
    expect(sql).not.toMatch(/audit_immutable_tool_call_attempt/);
    expect(sql).not.toMatch(/'tool_call_attempt'/);
  });

  it('ships the base AC-4 RLS policies (chat_sessions + chat_messages + llm_request_logs)', () => {
    const sql = readFileSync(HARDENING_SQL, 'utf8');
    expect(sql).toContain('chat_sessions');
    expect(sql).toContain('chat_messages');
    expect(sql).toContain('llm_request_logs');
    // Session variable that the API per-request middleware sets.
    expect(sql).toMatch(/app\.current_user_id/);
    // The user-isolation policy naming convention the verification queries on.
    expect(sql).toMatch(/_user_isolation/);
  });

  it('is idempotency-shaped: guards policy creation with pg_policies NOT EXISTS', () => {
    const sql = readFileSync(HARDENING_SQL, 'utf8');
    // Postgres has no CREATE POLICY IF NOT EXISTS — every policy must be guarded.
    expect(sql).toMatch(/NOT EXISTS\s*\(\s*SELECT 1 FROM pg_policies/);
    // Triggers must be drop-then-create to be re-runnable.
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS/);
  });

  it('docker-entrypoint.sh applies hardening.sql after db push', () => {
    const sh = readFileSync(ENTRYPOINT, 'utf8');
    expect(sh).toMatch(/prisma db execute --file prisma\/security\/hardening\.sql/);
    // The APPLY command must run AFTER the "Schema in sync" echo (i.e. after a
    // successful db push). Match on the actual command line, not the earlier
    // explanatory comment that also names the file.
    const syncIdx = sh.indexOf('echo "Schema in sync"');
    const applyIdx = sh.indexOf('prisma db execute --file prisma/security/hardening.sql');
    expect(syncIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(syncIdx);
    // Warn-and-continue: hardening failure must NOT abort boot.
    expect(sh).toMatch(/\[security\]/);
  });
});
