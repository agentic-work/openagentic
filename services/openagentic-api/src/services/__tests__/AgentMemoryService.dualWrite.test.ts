/**
 * Memory.2a — RED tests: AgentMemoryService dual-write (Postgres + Milvus).
 *
 * Asserts that:
 *   1. store() still calls Postgres (prisma.agentMemory.create/update)
 *   2. store() ALSO calls UserMemoriesService.store() with the same key/value
 *   3. A Milvus failure in UserMemoriesService.store() does NOT throw —
 *      Postgres write still succeeds (non-fatal Milvus path).
 *   4. recall() with opts.userMessage calls UserMemoriesService.search()
 *      and returns hits with NO substring overlap with the raw key.
 *   5. Legacy opts.key path still uses Postgres substring match.
 *   6. User isolation: recall for user-B never returns user-A's Milvus hits.
 *
 * RED until AgentMemoryService.store() dual-writes and AgentMemoryService.recall()
 * accepts opts.userMessage and delegates to UserMemoriesService.search().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Use vi.hoisted so mock vars are accessible before vi.mock() hoisting ────

const {
  findFirstMock,
  createMock,
  updateMock,
  findManyMock,
  deleteManyMock,
  milvusStoreMock,
  milvusSearchMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  findManyMock: vi.fn(),
  deleteManyMock: vi.fn(),
  milvusStoreMock: vi.fn(),
  milvusSearchMock: vi.fn(),
}));

// ── Prisma mock ─────────────────────────────────────────────────────────────

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    agentMemory: {
      findFirst: findFirstMock,
      create: createMock,
      update: updateMock,
      findMany: findManyMock,
      deleteMany: deleteManyMock,
    },
  },
}));

// ── UserMemoriesService mock ────────────────────────────────────────────────

vi.mock('../UserMemoriesService.js', () => ({
  getUserMemoriesService: () => ({
    store: milvusStoreMock,
    search: milvusSearchMock,
  }),
}));

// ── Import SUT ──────────────────────────────────────────────────────────────

import { AgentMemoryService } from '../AgentMemoryService.js';

const stubEntry = (overrides: Partial<any> = {}) => ({
  id: 'mem-001',
  user_id: 'user-A',
  category: 'cloud',
  key: 'azure_sub_id',
  value: 'abc-123',
  confidence: 1.0,
  ttl_hours: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no existing entry (create path)
  findFirstMock.mockResolvedValue(null);
  createMock.mockResolvedValue(stubEntry());
  findManyMock.mockResolvedValue([]);
  deleteManyMock.mockResolvedValue({ count: 0 });
  milvusStoreMock.mockResolvedValue(undefined);
  milvusSearchMock.mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// store() dual-write
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentMemoryService.store() — dual-write', () => {
  it('still calls prisma.agentMemory.create for a new entry', async () => {
    const svc = new AgentMemoryService();
    await svc.store('user-A', 'cloud', 'azure_sub_id', 'abc-123');
    expect(createMock).toHaveBeenCalledOnce();
    const data = createMock.mock.calls[0][0].data;
    expect(data.user_id).toBe('user-A');
    expect(data.key).toBe('azure_sub_id');
    expect(data.value).toBe('abc-123');
  });

  it('calls UserMemoriesService.store() with the Postgres entry fields', async () => {
    const entry = stubEntry({ id: 'mem-XYZ' });
    createMock.mockResolvedValue(entry);
    const svc = new AgentMemoryService();
    await svc.store('user-A', 'cloud', 'azure_sub_id', 'abc-123');
    expect(milvusStoreMock).toHaveBeenCalledOnce();
    const milvusArgs = milvusStoreMock.mock.calls[0][0];
    expect(milvusArgs.memory_id).toBe('mem-XYZ');
    expect(milvusArgs.user_id).toBe('user-A');
    expect(milvusArgs.key).toBe('azure_sub_id');
    expect(milvusArgs.value).toBe('abc-123');
    expect(milvusArgs.category).toBe('cloud');
  });

  it('returns the Postgres entry even when Milvus store throws', async () => {
    milvusStoreMock.mockRejectedValue(new Error('milvus down'));
    const svc = new AgentMemoryService();
    // Must NOT throw — Postgres entry is the canonical SoT
    const result = await svc.store('user-A', 'cloud', 'azure_sub_id', 'abc-123');
    expect(result).toBeDefined();
    expect(result.key).toBe('azure_sub_id');
    expect(createMock).toHaveBeenCalledOnce();
  });

  it('dual-writes on update path (findFirst returns existing entry)', async () => {
    const existing = stubEntry({ id: 'mem-existing' });
    findFirstMock.mockResolvedValue(existing);
    updateMock.mockResolvedValue({ ...existing, value: 'new-value' });
    const svc = new AgentMemoryService();
    await svc.store('user-A', 'cloud', 'azure_sub_id', 'new-value');
    // Both Postgres update AND Milvus store must be called
    expect(updateMock).toHaveBeenCalledOnce();
    expect(milvusStoreMock).toHaveBeenCalledOnce();
    const milvusArgs = milvusStoreMock.mock.calls[0][0];
    expect(milvusArgs.value).toBe('new-value');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recall() — semantic path via opts.userMessage
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentMemoryService.recall() — semantic path via opts.userMessage', () => {
  it('calls UserMemoriesService.search() when opts.userMessage is provided', async () => {
    milvusSearchMock.mockResolvedValue([]);
    const svc = new AgentMemoryService();
    await svc.recall('user-A', { userMessage: "what's my Azure subscription id?" });
    expect(milvusSearchMock).toHaveBeenCalledOnce();
    const [query, userId] = milvusSearchMock.mock.calls[0];
    expect(query).toBe("what's my Azure subscription id?");
    expect(userId).toBe('user-A');
  });

  it('maps Milvus hits to MemoryEntry shape', async () => {
    const milvusHit = {
      memory_id: 'mem-001',
      user_id: 'user-A',
      key: 'azure_sub_id',
      value: 'abc-123',
      category: 'cloud',
      confidence: 0.95,
      created_at: Date.now(),
      similarity: 0.91,
    };
    milvusSearchMock.mockResolvedValue([milvusHit]);
    const svc = new AgentMemoryService();
    const hits = await svc.recall('user-A', { userMessage: "what's my Azure subscription?" });
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toBe('azure_sub_id');
    expect(hits[0].value).toBe('abc-123');
    expect(hits[0].category).toBe('cloud');
    expect(hits[0].confidence).toBeCloseTo(0.95);
  });

  it('does NOT call Postgres findMany when opts.userMessage is provided', async () => {
    milvusSearchMock.mockResolvedValue([]);
    const svc = new AgentMemoryService();
    await svc.recall('user-A', { userMessage: 'sub id please' });
    // Postgres findMany should NOT be called — semantic path bypasses it
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('falls back gracefully when Milvus search throws (does not throw itself)', async () => {
    milvusSearchMock.mockRejectedValue(new Error('milvus unreachable'));
    findManyMock.mockResolvedValue([stubEntry()]);
    const svc = new AgentMemoryService();
    // Must not throw even when Milvus is down
    await expect(
      svc.recall('user-A', { userMessage: 'azure subscription' })
    ).resolves.toBeDefined();
  });

  it('still supports legacy opts.key substring path (no userMessage)', async () => {
    findManyMock.mockResolvedValue([stubEntry()]);
    const svc = new AgentMemoryService();
    const hits = await svc.recall('user-A', { key: 'azure_sub_id', limit: 5 });
    // Legacy path: Postgres should be called (at least once — cleanExpired may also call it)
    expect(findManyMock).toHaveBeenCalled();
    expect(hits).toHaveLength(1);
    // Milvus should NOT be called for the legacy key path
    expect(milvusSearchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// User isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentMemoryService — user isolation', () => {
  it('passes userId to UserMemoriesService.search(), not a different userId', async () => {
    milvusSearchMock.mockResolvedValue([]);
    const svc = new AgentMemoryService();
    await svc.recall('user-B', { userMessage: 'my subscription' });
    const [, userId] = milvusSearchMock.mock.calls[0];
    expect(userId).toBe('user-B');
    expect(userId).not.toBe('user-A');
  });

  it('filters out Milvus hits where user_id !== requested userId', async () => {
    // Simulate a Milvus bug or test that the service enforces isolation
    const userAHit = {
      memory_id: 'mem-userA',
      user_id: 'user-A', // wrong user for this recall call
      key: 'secret_key',
      value: 'user-A-secret',
      category: 'cloud',
      confidence: 1.0,
      created_at: Date.now(),
      similarity: 0.99,
    };
    milvusSearchMock.mockResolvedValue([userAHit]);
    const svc = new AgentMemoryService();
    // Recall as user-B — must not leak user-A's data
    const hits = await svc.recall('user-B', { userMessage: 'something' });
    const leaked = hits.filter(h => h.key === 'secret_key');
    expect(leaked).toHaveLength(0);
  });
});
