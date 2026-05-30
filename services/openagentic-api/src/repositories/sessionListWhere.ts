/**
 * Sev-0 2026-05-08 — empty session pollution.
 *
 * Builds the Prisma where clause that hides rows with zero messages
 * older than the freshness window. Pure helper so we can pin the
 * contract in a vitest unit test without spinning up Prisma.
 */
const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

export function buildSessionListWhere(userId: string, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - FRESHNESS_WINDOW_MS);
  return {
    user_id: userId,
    deleted_at: null,
    OR: [
      { message_count: { gt: 0 } },
      { created_at: { gt: cutoff } },
    ],
  };
}
