/**
 * Step 07 — mcp-index
 * RED-first: step file does not exist yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppContext } from '../../context/AppContext.js';
import { createLoggerMock } from '../../test/mocks/logger.js';

const mockIndexAllMCPTools = vi.fn().mockResolvedValue(undefined);
const mockStartPeriodicIndexing = vi.fn();
const MockMCPToolIndexingService = vi.fn().mockImplementation(() => ({
  indexAllMCPTools: mockIndexAllMCPTools,
  startPeriodicIndexing: mockStartPeriodicIndexing,
}));

vi.mock('../../services/MCPToolIndexingService.js', () => ({
  MCPToolIndexingService: MockMCPToolIndexingService,
}));

vi.mock('@zilliz/milvus2-sdk-node', () => ({
  MilvusClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../utils/redis-client.js', () => ({
  getRedisClient: vi.fn().mockReturnValue({}),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {},
}));

vi.mock('../../utils/logger.js', () => createLoggerMock());

import { INIT_MCP_INDEX } from '../07-mcp-index.js';
import type { BootstrapDeps } from '../types.js';

function makeCtx() {
  return new AppContext({ prisma: {} as any, logger: {} as any });
}

const stubDeps = (ctx = makeCtx()): BootstrapDeps => ({
  server: {} as any,
  ctx,
});

describe('INIT_MCP_INDEX step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct name and critical=false', () => {
    expect(INIT_MCP_INDEX.name).toBe('mcp-index');
    expect(INIT_MCP_INDEX.critical).toBe(false);
  });

  it('calls MCPToolIndexingService.indexAllMCPTools', async () => {
    await INIT_MCP_INDEX.run(stubDeps());
    expect(mockIndexAllMCPTools).toHaveBeenCalledOnce();
  });

  it('does NOT throw when indexAllMCPTools fails (non-critical)', async () => {
    mockIndexAllMCPTools.mockRejectedValueOnce(new Error('indexing failed'));
    await expect(INIT_MCP_INDEX.run(stubDeps())).resolves.toBeUndefined();
  });

  it('returns within timeout when indexAllMCPTools hangs (boot must not block)', async () => {
    // Hung promise: never resolves. Without timeout wrap, the step blocks
    // server.listen() indefinitely. With Promise.race wrap + MCP_INDEX_BOOT_TIMEOUT_MS,
    // it must reject internally, the catch fires, and the step resolves.
    mockIndexAllMCPTools.mockImplementationOnce(() => new Promise(() => {}));
    process.env.MCP_INDEX_BOOT_TIMEOUT_MS = '100';
    const start = Date.now();
    await expect(INIT_MCP_INDEX.run(stubDeps())).resolves.toBeUndefined();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    delete process.env.MCP_INDEX_BOOT_TIMEOUT_MS;
  });
});
