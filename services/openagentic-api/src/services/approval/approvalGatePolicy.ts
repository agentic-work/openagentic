import { prisma } from '../../utils/prisma.js';
import { featureFlags } from '../../config/featureFlags.js';

const KEY = 'approval_gate_policy';
const DEFAULT_TIMEOUT_MS = 300_000; // spec: 300s → deny

export interface ApprovalGatePolicy {
  gateMutating: boolean;
  timeoutMs: number;
}

/**
 * Resolve the approval-gate policy. DB row overrides env; env is the default.
 * Seeds the row idempotently on first read. DB-down falls back to env defaults.
 * NOTE: audit is ALWAYS on — it is never part of this policy.
 */
export async function resolveApprovalGatePolicy(): Promise<ApprovalGatePolicy> {
  let dbVal: any = null;
  try {
    const row = await prisma.systemConfiguration.findFirst({ where: { key: KEY } });
    if (row?.value) {
      dbVal = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    } else {
      // seed-if-missing (idempotent, race-tolerant)
      try {
        await prisma.systemConfiguration.create({
          data: {
            key: KEY,
            value: { gateMutating: featureFlags.approvalGateMutating, timeoutMs: DEFAULT_TIMEOUT_MS } as any,
            description:
              'Approval gate policy for MUTATING tool calls. gateMutating=false disables the human gate (audit still always on).',
          },
        });
      } catch {
        /* race across replicas — fine */
      }
    }
  } catch {
    /* DB down — fall back to env defaults below */
  }

  return {
    gateMutating: dbVal?.gateMutating ?? featureFlags.approvalGateMutating,
    timeoutMs: dbVal?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}
