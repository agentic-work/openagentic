/**
 * TDD tests for IdempotencyService.
 * Covers I1-I5 acceptance criteria.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock prisma BEFORE importing the service
// ---------------------------------------------------------------------------
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    idempotencyKey: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  loggers: {
    services: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

import { prisma } from '../../utils/prisma.js';
import {
  findIdempotencyKey,
  storeIdempotencyKey,
  sweepExpiredKeys,
} from '../IdempotencyService.js';

const mockFindUnique = prisma.idempotencyKey.findUnique as ReturnType<typeof vi.fn>;
const mockUpsert = prisma.idempotencyKey.upsert as ReturnType<typeof vi.fn>;
const mockDeleteMany = prisma.idempotencyKey.deleteMany as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function futureExpiry(offsetMs = 24 * 60 * 60 * 1000): Date {
  return new Date(Date.now() + offsetMs);
}

function pastExpiry(): Date {
  return new Date(Date.now() - 1000);
}

// ---------------------------------------------------------------------------
// findIdempotencyKey
// ---------------------------------------------------------------------------
describe('findIdempotencyKey', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('I2 – returns null when key does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await findIdempotencyKey('non-existent-key');
    expect(result).toBeNull();
  });

  it('I3 – returns stored record when key exists and is unexpired', async () => {
    const stored = {
      idempotency_key: 'key-abc',
      execution_id: 'exec-123',
      result: { success: true, output: 'hello' },
      expires_at: futureExpiry(),
    };
    mockFindUnique.mockResolvedValue(stored);
    const result = await findIdempotencyKey('key-abc');
    expect(result).not.toBeNull();
    expect(result?.execution_id).toBe('exec-123');
    expect(result?.result).toEqual({ success: true, output: 'hello' });
  });

  it('I3 – returns null for expired record (lazy cleanup path)', async () => {
    const expired = {
      idempotency_key: 'key-old',
      execution_id: 'exec-999',
      result: {},
      expires_at: pastExpiry(),
    };
    mockFindUnique.mockResolvedValue(expired);
    const result = await findIdempotencyKey('key-old');
    expect(result).toBeNull();
  });

  it('I4 – different keys return independent results (null vs found)', async () => {
    const stored = {
      idempotency_key: 'key-A',
      execution_id: 'exec-A',
      result: { x: 1 },
      expires_at: futureExpiry(),
    };
    mockFindUnique
      .mockResolvedValueOnce(stored)  // key-A found
      .mockResolvedValueOnce(null);   // key-B not found

    const r1 = await findIdempotencyKey('key-A');
    const r2 = await findIdempotencyKey('key-B');
    expect(r1?.execution_id).toBe('exec-A');
    expect(r2).toBeNull();
  });

  it('returns null and does not throw when prisma throws', async () => {
    mockFindUnique.mockRejectedValue(new Error('DB down'));
    const result = await findIdempotencyKey('any-key');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// storeIdempotencyKey
// ---------------------------------------------------------------------------
describe('storeIdempotencyKey', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('I2 – calls prisma upsert with correct fields', async () => {
    mockUpsert.mockResolvedValue({});
    await storeIdempotencyKey('key-xyz', 'exec-456', { success: true });

    expect(mockUpsert).toHaveBeenCalledOnce();
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.idempotency_key).toBe('key-xyz');
    expect(call.create.execution_id).toBe('exec-456');
    expect(call.create.result).toEqual({ success: true });
    // expires_at must be ~24h in the future
    const expiresAt: Date = call.create.expires_at;
    const diffMs = expiresAt.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it('does not throw when prisma upsert fails', async () => {
    mockUpsert.mockRejectedValue(new Error('constraint'));
    await expect(storeIdempotencyKey('key-bad', 'exec-bad', {})).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// sweepExpiredKeys
// ---------------------------------------------------------------------------
describe('sweepExpiredKeys', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('I5 – deletes records with expires_at <= now', async () => {
    mockDeleteMany.mockResolvedValue({ count: 3 });
    const count = await sweepExpiredKeys();
    expect(count).toBe(3);
    const call = mockDeleteMany.mock.calls[0][0];
    // The where clause must filter on expires_at lte current time
    expect(call.where.expires_at.lte).toBeInstanceOf(Date);
  });

  it('returns 0 when nothing to sweep', async () => {
    mockDeleteMany.mockResolvedValue({ count: 0 });
    expect(await sweepExpiredKeys()).toBe(0);
  });

  it('returns 0 and does not throw when prisma fails', async () => {
    mockDeleteMany.mockRejectedValue(new Error('network'));
    expect(await sweepExpiredKeys()).toBe(0);
  });
});
