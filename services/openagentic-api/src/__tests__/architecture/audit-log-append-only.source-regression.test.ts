/**
 * Source-regression: tool_call_audit_log is append-only + single guarded
 * transition.
 *
 * The immutability invariant for the approval-gate audit trail is APP-ENFORCED
 * (prisma db push runs no triggers). This cage pins that invariant in source:
 *   1. NO toolCallAuditLog.delete / deleteMany anywhere under src/.
 *   2. The ONLY toolCallAuditLog.update* callsite is the guarded updateMany in
 *      services/approval/auditLog.ts, and it scopes WHERE decision: 'pending'.
 *   3. auditLog.ts exports insertAuditRow + decideAuditRow and NO delete* path.
 *
 * Mirrors docker-entrypoint-runs-migrations.source-regression.test.ts (grep
 * source for forbidden patterns).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_ROOT = resolve(__dirname, '../..'); // .../src
const AUDIT_LOG_FILE = resolve(SRC_ROOT, 'services/approval/auditLog.ts');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const ALL_TS = walk(SRC_ROOT);

describe('arch: tool_call_audit_log is append-only', () => {
  it('has NO toolCallAuditLog.delete / deleteMany anywhere under src/', () => {
    const offenders: string[] = [];
    for (const file of ALL_TS) {
      // Skip this test file itself (it names the forbidden pattern).
      if (file === __filename) continue;
      const text = readFileSync(file, 'utf8');
      if (/toolCallAuditLog\.delete(Many)?\b/.test(text)) {
        offenders.push(relative(SRC_ROOT, file));
      }
    }
    expect(offenders, `delete on tool_call_audit_log found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the ONLY toolCallAuditLog.update* callsite is the guarded updateMany in auditLog.ts', () => {
    const offenders: string[] = [];
    for (const file of ALL_TS) {
      if (file === __filename) continue;
      const text = readFileSync(file, 'utf8');
      if (/toolCallAuditLog\.update/.test(text) && file !== AUDIT_LOG_FILE) {
        offenders.push(relative(SRC_ROOT, file));
      }
    }
    expect(offenders, `unexpected toolCallAuditLog.update outside auditLog.ts: ${offenders.join(', ')}`).toEqual([]);
  });

  it('auditLog.ts uses updateMany guarded by WHERE decision pending', () => {
    const text = readFileSync(AUDIT_LOG_FILE, 'utf8');
    expect(text).toMatch(/toolCallAuditLog\.updateMany/);
    // The guard must be present: decision: 'pending' in the where clause.
    expect(text).toMatch(/decision:\s*['"]pending['"]/);
    // No bare .update( (single-row, unguarded) on the model.
    expect(text).not.toMatch(/toolCallAuditLog\.update\b(?!Many)/);
  });

  it('auditLog.ts exports insertAuditRow + decideAuditRow and NO delete* export', () => {
    const text = readFileSync(AUDIT_LOG_FILE, 'utf8');
    expect(text).toMatch(/export\s+(async\s+)?function\s+insertAuditRow/);
    expect(text).toMatch(/export\s+(async\s+)?function\s+decideAuditRow/);
    expect(text).not.toMatch(/export\s+(async\s+)?function\s+delete/i);
  });
});

/**
 * Source-regression: the SECONDARY audit trails are append-only too (NIST 800-53
 * AU-9, app-enforced). The boot path is `prisma db push`, which runs no DB
 * triggers, so immutability is enforced by the ABSENCE of any update/delete
 * code path — not by a trigger. These tables have zero mutation callsites
 * today; this cage pins that so a future change can't silently make an audit
 * record mutable or deletable. (DB-trigger migrations are intentionally NOT
 * used — they would be inert under db push.)
 */
describe('arch: secondary audit logs are append-only (AU-9, app-enforced)', () => {
  const SECONDARY_AUDIT_MODELS = [
    'authAuditLog',       // auth_audit_log — login/logout/password_change/token
    'flowAuditLog',       // flow_audit_log — workflow/flow governance
    'credentialAuditLog', // credential_audit_log — provider/MCP/credential CRUD
    'agentAuditLog',      // agent_audit_log — agent execution/actions
    'webhookAuditLog',    // webhook_audit_logs — inbound webhook req/resp
  ] as const;

  for (const model of SECONDARY_AUDIT_MODELS) {
    it(`${model} has NO .delete/.deleteMany/.update/.updateMany anywhere under src/`, () => {
      const re = new RegExp(`\\b${model}\\.(delete|deleteMany|update|updateMany)\\b`);
      const offenders: string[] = [];
      for (const file of ALL_TS) {
        if (file === __filename) continue; // this file names the patterns
        if (re.test(readFileSync(file, 'utf8'))) offenders.push(relative(SRC_ROOT, file));
      }
      expect(
        offenders,
        `mutation of append-only audit table ${model} found in: ${offenders.join(', ')}`,
      ).toEqual([]);
    });
  }
});
