/**
 * AU-10 (NIST 800-53 non-repudiation) — the tool-call-audit hash chain.
 *
 * Every tool_call_audit_log row must be cryptographically chained:
 *   chain_hash    = SHA256(previous_hash + immutable insert content)
 *   decision_hash = SHA256(chain_hash + decision content)   [once decided]
 * previous_hash must equal the prior row's chain_hash. Concurrent inserts must
 * NOT fork the chain (serialized). The decide step is an in-place UPDATE that
 * must NOT break the linear chain (it never touches chain_hash/previous_hash).
 * verifyToolCallAuditChain() must report intact for a well-formed chain and
 * detect tampering of EITHER the immutable content OR the decision.
 *
 * Driven through the real writers (insertAuditRow / decideAuditRow) so the test
 * proves the wiring, not just the crypto. `args` is jsonb — Postgres does NOT
 * preserve object key order, so we REORDER keys on read-back to prove the
 * canonical (sorted-key) serializer survives jsonb churn.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// In-memory tool_call_audit_log table backing a mocked prisma.
const rows: any[] = [];

function reorderKeys(v: any): any {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(reorderKeys);
  const out: any = {};
  for (const k of Object.keys(v).reverse()) out[k] = reorderKeys(v[k]); // simulate jsonb churn
  return out;
}
function readBack(row: any): any {
  // jsonb returns args as a (possibly key-reordered) object, never a string.
  return { ...row, args: row.args == null ? row.args : reorderKeys(row.args) };
}

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    toolCallAuditLog: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `r${rows.length}`, ...data };
        rows.push(row);
        return { id: row.id };
      }),
      findFirst: vi.fn(async () => (rows.length ? readBack(rows[rows.length - 1]) : null)),
      findUnique: vi.fn(async ({ where }: any) => {
        const row = rows.find((r) => r.id === where.id);
        return row ? readBack(row) : null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id && r.decision === where.decision);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      findMany: vi.fn(async ({ take }: any = {}) =>
        rows.slice(0, take ?? rows.length).map(readBack),
      ),
    },
  },
}));

import { insertAuditRow, decideAuditRow } from '../../approval/auditLog.js';
import { verifyToolCallAuditChain, __resetToolCallAuditChainCache } from '../toolCallAuditChain.js';

beforeEach(() => {
  vi.clearAllMocks();
  rows.length = 0;
  __resetToolCallAuditChainCache();
});

describe('AU-10 tool-call-audit hash chain', () => {
  it('chains sequential inserts (each previous_hash == prior chain_hash; first is GENESIS-derived)', async () => {
    await insertAuditRow({ toolName: 'list_pods', args: {}, classification: 'READ', decision: 'auto' });
    await insertAuditRow({ toolName: 'web_search', args: { q: 'x' }, classification: 'READ', decision: 'auto' });
    await insertAuditRow({ toolName: 'kubectl_delete_pod', args: { pod: 'web-0' }, classification: 'MUTATING', decision: 'pending' });

    expect(rows).toHaveLength(3);
    expect(rows[0].previous_hash).toBeNull();
    expect(rows[0].chain_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[1].previous_hash).toBe(rows[0].chain_hash);
    expect(rows[2].previous_hash).toBe(rows[1].chain_hash);
  });

  it('does NOT fork the chain under concurrent inserts (serialized)', async () => {
    await Promise.all([
      insertAuditRow({ toolName: 't1', args: {}, classification: 'READ', decision: 'auto' }),
      insertAuditRow({ toolName: 't2', args: {}, classification: 'READ', decision: 'auto' }),
      insertAuditRow({ toolName: 't3', args: {}, classification: 'READ', decision: 'auto' }),
      insertAuditRow({ toolName: 't4', args: {}, classification: 'READ', decision: 'auto' }),
    ]);
    expect(rows).toHaveLength(4);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].previous_hash).toBe(rows[i - 1].chain_hash);
    }
    const prevs = rows.slice(1).map((r) => r.previous_hash);
    expect(new Set(prevs).size).toBe(prevs.length); // no shared previous_hash → no fork
  });

  it('verifies intact for a well-formed chain incl. a pending→approved decision', async () => {
    await insertAuditRow({ toolName: 'list_pods', args: { ns: 'default' }, classification: 'READ', decision: 'auto' });
    const auditId = await insertAuditRow({
      toolName: 'kubectl_delete_pod',
      args: { pod: 'web-0', ns: 'prod' },
      classification: 'MUTATING',
      decision: 'pending',
      userId: 'u1',
    });
    const ok = await decideAuditRow(auditId, 'approved', 'admin-1');
    expect(ok).toBe(true);

    // The decide UPDATE wrote decision_hash but did NOT touch chain_hash/previous_hash.
    const decided = rows.find((r) => r.id === auditId)!;
    expect(decided.decision).toBe('approved');
    expect(decided.decision_hash).toMatch(/^[a-f0-9]{64}$/);

    const res = await verifyToolCallAuditChain(100);
    expect(res.intact).toBe(true);
    expect(res.checkedCount).toBe(2);
  });

  it('verifies intact even when jsonb reorders args keys on read-back (canonical hash)', async () => {
    await insertAuditRow({
      toolName: 'aws_create_bucket',
      args: { zeta: 1, alpha: 2, mid: { y: 9, x: 8 } },
      classification: 'MUTATING',
      decision: 'pending',
    });
    await insertAuditRow({
      toolName: 'aws_put_object',
      args: { beta: 3, gamma: 4 },
      classification: 'MUTATING',
      decision: 'pending',
    });
    const res = await verifyToolCallAuditChain(100);
    expect(res.intact).toBe(true);
    expect(res.checkedCount).toBe(2);
  });

  it('detects tampering with immutable content (mutated args breaks chain_hash)', async () => {
    await insertAuditRow({ toolName: 'kubectl_delete_pod', args: { pod: 'web-0' }, classification: 'MUTATING', decision: 'pending' });
    await insertAuditRow({ toolName: 'list_pods', args: {}, classification: 'READ', decision: 'auto' });

    // A DB actor edits the first row's args after the fact.
    rows[0].args = { pod: 'db-primary' };

    const res = await verifyToolCallAuditChain(100);
    expect(res.intact).toBe(false);
    expect(res.brokenAt).toBe(rows[0].id);
    expect(res.reason).toBe('content');
  });

  it('detects tampering with the decision (flipped denied→approved breaks decision_hash)', async () => {
    const auditId = await insertAuditRow({
      toolName: 'aws_delete_bucket',
      args: { bucket: 'prod-data' },
      classification: 'MUTATING',
      decision: 'pending',
    });
    await decideAuditRow(auditId, 'denied', 'admin-1');

    // A DB actor flips the recorded decision from denied → approved.
    const row = rows.find((r) => r.id === auditId)!;
    row.decision = 'approved';

    const res = await verifyToolCallAuditChain(100);
    expect(res.intact).toBe(false);
    expect(res.brokenAt).toBe(auditId);
    expect(res.reason).toBe('decision');
  });
});
