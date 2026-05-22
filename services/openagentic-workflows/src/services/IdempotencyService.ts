/**
 * IdempotencyService
 *
 * Provides idempotency key lookup and storage for /execute and /execute-sync
 * endpoints. When a client-supplied Idempotency-Key arrives:
 *   1. First call: store (key, executionId, result, expires_at=now+24h) after execution.
 *   2. Repeated call within 24h: return the stored result with Idempotent-Replay: true.
 *   3. Expired records are purged by the scheduler's hourly sweep (sweepExpiredKeys).
 *
 * The backing table is IdempotencyKey in schema.prisma.
 */

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.services;

/** TTL for idempotency records: 24 hours in milliseconds */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyRecord {
  idempotency_key: string;
  execution_id: string;
  result: unknown;
  expires_at: Date;
}

/**
 * Look up an existing idempotency record.
 * Returns the stored record if found AND not yet expired; null otherwise.
 */
export async function findIdempotencyKey(key: string): Promise<IdempotencyRecord | null> {
  const now = new Date();
  try {
    const record = await prisma.idempotencyKey.findUnique({
      where: { idempotency_key: key },
    });
    if (!record) return null;
    if (record.expires_at <= now) {
      // Expired — treat as absent (lazy cleanup)
      return null;
    }
    return record as unknown as IdempotencyRecord;
  } catch (err: any) {
    logger.error({ err, key }, '[IdempotencyService] findIdempotencyKey failed');
    return null;
  }
}

/**
 * Store an idempotency record.
 * Uses upsert so re-running the same key (e.g. in tests) doesn't double-insert.
 */
export async function storeIdempotencyKey(
  key: string,
  executionId: string,
  result: unknown,
): Promise<void> {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
  const resultJson = result as any; // Prisma Json field accepts any serialisable value
  try {
    await prisma.idempotencyKey.upsert({
      where: { idempotency_key: key },
      create: {
        idempotency_key: key,
        execution_id: executionId,
        result: resultJson,
        expires_at: expiresAt,
      },
      update: {
        execution_id: executionId,
        result: resultJson,
        expires_at: expiresAt,
      },
    });
    logger.info({ key, executionId, expiresAt }, '[IdempotencyService] key stored');
  } catch (err: any) {
    logger.error({ err, key, executionId }, '[IdempotencyService] storeIdempotencyKey failed');
  }
}

/**
 * Delete all expired idempotency records.
 * Called by the scheduler's hourly sweep.
 * Returns the count of deleted records.
 */
export async function sweepExpiredKeys(): Promise<number> {
  const now = new Date();
  try {
    const { count } = await prisma.idempotencyKey.deleteMany({
      where: { expires_at: { lte: now } },
    });
    if (count > 0) {
      logger.info({ count }, '[IdempotencyService] Swept expired idempotency keys');
    }
    return count;
  } catch (err: any) {
    logger.error({ err }, '[IdempotencyService] sweepExpiredKeys failed');
    return 0;
  }
}
