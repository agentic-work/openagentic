/**
 * AU-10 (NIST non-repudiation) — every admin_audit_log write MUST go through the
 * single chained writer (services/audit/adminAuditChain.ts), never
 * `prisma.adminAuditLog.create` directly. A direct write produces an UNCHAINED
 * row (null previous_hash/chain_hash) and silently breaks the tamper-evident
 * chain. This guard fails if any direct write is (re)introduced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');
const ALLOWED = join('services', 'audit', 'adminAuditChain.ts'); // the one place allowed to call it

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'tests') continue;
      out.push(...walk(p));
    } else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('admin_audit_log writes are chained (AU-10)', () => {
  it('no source file calls prisma.adminAuditLog.create directly (except the chain writer)', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.endsWith(ALLOWED)) continue;
      const text = readFileSync(file, 'utf8');
      if (/prisma\.adminAuditLog\.create\s*\(/.test(text)) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(
      offenders,
      `These files write admin_audit_log directly — route them through createChainedAdminAudit():\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
