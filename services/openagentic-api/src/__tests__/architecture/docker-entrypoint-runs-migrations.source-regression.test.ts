/**
 * v0.7.1 schema-sync contract — docker-entrypoint must reconcile the live DB
 * to schema.prisma via `prisma db push --skip-generate --accept-data-loss`
 * BEFORE exec'ing the server. This was originally pinned as `migrate deploy`,
 * but user direction (2026-05-09) explicitly removed prisma migrations from
 * the deploy contract:
 *
 *   "no migrations in prisma schema- delete all pvcs, redeploy clean-
 *    everyiong in 0.7.1 has to come up pefectly in one shot."
 *
 * The contract preserved across that change is:
 *   1. fresh installs reconcile ALL schema.prisma additions automatically
 *   2. rolling helm upgrades reconcile pending schema deltas before the new
 *      server binary serves any traffic
 *   3. a non-zero reconciliation exit aborts startup (server can't run on
 *      stale schema)
 *
 * That contract is now satisfied by `prisma db push`, not `prisma migrate
 * deploy`. This source-regression assertion was rewritten to pin the new
 * mechanism so the test continues to catch the original failure mode (#509:
 * spec called for a `state` column that was never created in any
 * environment).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../../../..');
const ENTRYPOINT = resolve(REPO_ROOT, 'services/openagentic-api/docker-entrypoint.sh');

describe('v0.7.1 — docker-entrypoint reconciles schema via prisma db push', () => {
  const text = readFileSync(ENTRYPOINT, 'utf8');

  it('contains a `prisma db push` invocation', () => {
    expect(text).toMatch(/prisma\s+db\s+push/);
  });

  it('passes --accept-data-loss so destructive deltas in schema.prisma are applied', () => {
    // schema.prisma is SoT; if a column was renamed/dropped in source, the
    // live DB must follow. Without --accept-data-loss, db push aborts on
    // destructive deltas and the rolling upgrade stalls.
    expect(text).toMatch(/prisma\s+db\s+push[^\n]*--accept-data-loss/);
  });

  it('runs db push BEFORE `exec node dist/server.js`', () => {
    const pushIdx = text.search(/prisma\s+db\s+push/);
    const execIdx = text.search(/exec\s+node\s+dist\/server\.js/);
    expect(pushIdx).toBeGreaterThan(-1);
    expect(execIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeLessThan(execIdx);
  });

  it('aborts startup with non-zero exit on schema-sync failure', () => {
    // Reconciliation failure must be FATAL — server can't start on stale
    // schema. Look for at least one `exit 1` line AFTER the first db push
    // invocation but BEFORE `exec node dist/server.js`.
    const pushIdx = text.search(/prisma\s+db\s+push/);
    const execIdx = text.search(/exec\s+node\s+dist\/server\.js/);
    expect(pushIdx).toBeGreaterThan(-1);
    expect(execIdx).toBeGreaterThan(pushIdx);

    const between = text.slice(pushIdx, execIdx);
    expect(between).toMatch(/exit\s+1/);
  });
});
