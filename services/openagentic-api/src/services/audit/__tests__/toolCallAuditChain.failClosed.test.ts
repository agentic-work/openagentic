/**
 * Pin: the AU-10 tool-call audit-chain verifier FAILS CLOSED.
 *
 * SECURITY REGRESSION (legitimacy red-team 2026-06-21): the catch block used to
 * return { intact: true, checkedCount: 0 } on any DB/query error — turning a
 * tampering event or a DB outage into a false clean bill of health on a
 * non-repudiation control. It must return intact:false on a verification error.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    toolCallAuditLog: {
      findMany: vi.fn().mockRejectedValue(new Error('DB unreachable')),
    },
  },
}));

import { verifyToolCallAuditChain } from '../toolCallAuditChain.js';

describe('verifyToolCallAuditChain — fail CLOSED', () => {
  it('returns intact:false (not true) when the verification query throws', async () => {
    const res = await verifyToolCallAuditChain();
    expect(res.intact).toBe(false);
    expect(res.reason).toBe('verification-error');
    expect(res.checkedCount).toBe(0);
  });
});
