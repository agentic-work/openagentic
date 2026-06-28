/**
 * AU-10 (NIST 800-53 AU-10 non-repudiation) — the admin-audit hash chain.
 *
 * Every admin_audit_log row must be cryptographically chained:
 *   chain_hash = SHA256(previous_hash + event + userId + action + ts + details)
 * and previous_hash must equal the prior row's chain_hash. Concurrent writes
 * must NOT fork the chain (writes are serialized). verifyAdminAuditChain() must
 * report intact for a well-formed chain and detect tampering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory adminAuditLog table backing a mocked prisma.
// IMPORTANT: `details` is a jsonb column — Postgres does NOT preserve object key
// order. We model that by REORDERING keys on read-back, so any hash that relies
// on JSON.stringify key order will (correctly) fail verify. The canonical
// (sorted-key) serializer must survive this.
const rows: any[] = [];
function reorderKeys(v: any): any {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(reorderKeys);
  const out: any = {};
  for (const k of Object.keys(v).reverse()) out[k] = reorderKeys(v[k]); // reverse to simulate jsonb churn
  return out;
}
function readBack(row: any): any {
  // jsonb returns details as a (possibly key-reordered) object, never a string.
  return { ...row, details: row.details == null ? row.details : reorderKeys(row.details) };
}
vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    adminAuditLog: {
      create: vi.fn(async ({ data }: any) => { rows.push({ id: `r${rows.length}`, ...data }); return data; }),
      findFirst: vi.fn(async () => (rows.length ? readBack(rows[rows.length - 1]) : null)),
      findMany: vi.fn(async ({ take }: any = {}) => rows.slice(0, take ?? rows.length).map(readBack)),
    },
  },
}));

import { appendAdminAudit, createChainedAdminAudit, verifyAdminAuditChain, __resetAdminAuditChainCache } from '../adminAuditChain.js';

describe('AU-10 admin-audit hash chain', () => {
  beforeEach(() => {
    rows.length = 0;
    __resetAdminAuditChainCache();
  });

  it('chains sequential writes (each previous_hash == prior chain_hash; first is GENESIS-derived)', async () => {
    await appendAdminAudit({ adminUserId: 'u1', action: 'role.grant', resourceType: 'user', resourceId: 'a' });
    await appendAdminAudit({ adminUserId: 'u1', action: 'role.revoke', resourceType: 'user', resourceId: 'b' });
    await appendAdminAudit({ adminUserId: 'u2', action: 'mcp.toggle', resourceType: 'mcp', resourceId: 'c' });

    expect(rows).toHaveLength(3);
    expect(rows[0].previous_hash).toBeNull();
    expect(rows[0].chain_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[1].previous_hash).toBe(rows[0].chain_hash);
    expect(rows[2].previous_hash).toBe(rows[1].chain_hash);
  });

  it('does NOT fork the chain under concurrent writes (serialized)', async () => {
    await Promise.all([
      appendAdminAudit({ adminUserId: 'u', action: 'a1', resourceType: 't', resourceId: '1' }),
      appendAdminAudit({ adminUserId: 'u', action: 'a2', resourceType: 't', resourceId: '2' }),
      appendAdminAudit({ adminUserId: 'u', action: 'a3', resourceType: 't', resourceId: '3' }),
      appendAdminAudit({ adminUserId: 'u', action: 'a4', resourceType: 't', resourceId: '4' }),
    ]);
    expect(rows).toHaveLength(4);
    // Every row (after the first) must link to exactly the immediately-prior row.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].previous_hash).toBe(rows[i - 1].chain_hash);
    }
    // No two rows share a previous_hash (would indicate a fork).
    const prevs = rows.slice(1).map(r => r.previous_hash);
    expect(new Set(prevs).size).toBe(prevs.length);
  });

  it('verifyAdminAuditChain reports intact for a well-formed chain', async () => {
    await appendAdminAudit({ adminUserId: 'u', action: 'x', resourceType: 't', resourceId: '1' });
    await appendAdminAudit({ adminUserId: 'u', action: 'y', resourceType: 't', resourceId: '2' });
    const res = await verifyAdminAuditChain(100);
    expect(res.intact).toBe(true);
    expect(res.checkedCount).toBe(2);
  });

  it('CANONICAL: chain verifies intact even when jsonb reorders details keys on read-back', async () => {
    // Production path: the 8 direct writers store details as OBJECTS in the jsonb
    // column. On read-back the mock reorders keys (modeling jsonb). The chain hash
    // must use a canonical (sorted-key) form so write-hash == verify-hash despite
    // reordering. A plain JSON.stringify would fork here → verify=false.
    await createChainedAdminAudit({ data: { admin_user_id: 'u', action: 'cfg.update', resource_type: 'setting', resource_id: 's1', details: { zeta: 1, alpha: 2, mid: { y: 9, x: 8 } } } });
    await createChainedAdminAudit({ data: { admin_user_id: 'u', action: 'cfg.update', resource_type: 'setting', resource_id: 's2', details: { beta: 3, gamma: 4 } } });
    const res = await verifyAdminAuditChain(100);
    expect(res.intact).toBe(true);
    expect(res.checkedCount).toBe(2);
  });

  it('verifyAdminAuditChain detects tampering (mutated details breaks the hash)', async () => {
    await appendAdminAudit({ adminUserId: 'u', action: 'x', resourceType: 't', resourceId: '1', details: { v: 1 } });
    await appendAdminAudit({ adminUserId: 'u', action: 'y', resourceType: 't', resourceId: '2' });
    // Tamper with the first row's stored details after the fact.
    rows[0].details = JSON.stringify({ v: 999 });
    const res = await verifyAdminAuditChain(100);
    expect(res.intact).toBe(false);
    expect(res.brokenAt).toBeDefined();
  });
});
