/**
 * Phase 9 — V3 meta-tools dispatch wiring (TDD RED first).
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §10
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md
 *       Phase 9 (Tasks 9.1-9.10)
 *
 * Asserts that the V3 dispatcher handles the four Phase 9 meta-tools:
 *
 *   1. memory_search   — query persistent user memory (AgentMemoryService.recall)
 *   2. read_large_result — already created in Phase 4 (executeReadLargeResult)
 *   3. synth_execute   — route to SynthExecutorClient.execute
 *   4. memorize        — already wired in V2 dispatch; covered by V2 test
 *
 * Each new arm is intercepted in V3's makeDispatch BEFORE the V2
 * passthrough so V3 owns the contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDispatch } from '../dispatchTool.js';
import { getAllBaseTools } from '../toolRegistry.js';

// The inner `dispatchChatToolCall` is imported by dispatchTool — for the
// adapter-owned arms (memory_search / read_large_result / synth_execute)
// we don't touch the inner dispatcher, so we let dispatch be a no-op
// pass-through. Mock it as a vi.fn() so any test that accidentally falls
// through fails loudly.
vi.mock('../dispatchChatToolCall.js', async () => {
  const actual = await vi.importActual<any>('../dispatchChatToolCall.js');
  return {
    ...actual,
    dispatchChatToolCall: vi.fn(),
  };
});

import { dispatchChatToolCall } from '../dispatchChatToolCall.js';

// AgentMemoryService — wire memory_search to its recall() method.
vi.mock('../../../../../services/AgentMemoryService.js', () => ({
  getAgentMemoryService: vi.fn(),
}));

// SynthExecutorClient — wire synth_execute to its execute() method.
vi.mock('../../../../../services/SynthExecutorClient.js', () => ({
  getSynthExecutorClient: vi.fn(),
}));

// LargeResultStorage — wire read_large_result to its get() method.
vi.mock('../../../../../services/LargeResultStorageService.js', () => ({
  getLargeResultStorageService: vi.fn(),
}));

import { getAgentMemoryService } from '../../../../../services/AgentMemoryService.js';
import { getSynthExecutorClient } from '../../../../../services/SynthExecutorClient.js';
import { getLargeResultStorageService } from '../../../../../services/LargeResultStorageService.js';

function makeRunCtx() {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-123',
    userId: 'user-abc',
    user: { id: 'user-abc' },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('V3 dispatch — Phase 9 meta-tools', () => {
  // --------------------------------------------------------------------------
  // memory_search
  // --------------------------------------------------------------------------
  describe('memory_search', () => {
    it('routes to AgentMemoryService.recall and returns hits', async () => {
      const recallMock = vi.fn(async () => [
        { id: 'm1', category: 'user', key: 'preferred_cloud', value: 'azure', confidence: 1.0 },
        { id: 'm2', category: 'user', key: 'project_name', value: 'foo', confidence: 0.9 },
      ]);
      (getAgentMemoryService as any).mockReturnValue({ recall: recallMock });

      const dispatch = makeDispatch({ v2Deps: {} as any });
      const result = await dispatch(makeRunCtx(), {
        name: 'memory_search',
        input: { query: 'cloud preference' },
      });

      expect(result.ok).toBe(true);
      expect(recallMock).toHaveBeenCalled();
      // Output should include the hits
      const out: any = result.output;
      expect(out).toBeDefined();
      // Either an array of memories or a struct that wraps them
      const hits = Array.isArray(out) ? out : (out?.memories ?? out?.hits);
      expect(hits).toBeDefined();
      expect(hits.length).toBe(2);
    });

    it('returns ok:true with empty array when no hits — does NOT throw', async () => {
      const recallMock = vi.fn(async () => []);
      (getAgentMemoryService as any).mockReturnValue({ recall: recallMock });

      const dispatch = makeDispatch({ v2Deps: {} as any });
      const result = await dispatch(makeRunCtx(), {
        name: 'memory_search',
        input: { query: 'no-hits-here' },
      });

      expect(result.ok).toBe(true);
      const out: any = result.output;
      const hits = Array.isArray(out) ? out : (out?.memories ?? out?.hits ?? []);
      expect(hits.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // read_large_result
  // --------------------------------------------------------------------------
  describe('read_large_result', () => {
    it('routes to LargeResultStorage.get with handle/offset/limit', async () => {
      const getMock = vi.fn(async (_handle: string, _opts: any) => ({
        rows: [{ a: 1 }, { a: 2 }],
        total: 2,
      }));
      (getLargeResultStorageService as any).mockReturnValue({ get: getMock });

      const dispatch = makeDispatch({ v2Deps: {} as any });
      const result = await dispatch(makeRunCtx(), {
        name: 'read_large_result',
        input: { handle: 'h-abc', offset: 0, limit: 10 },
      });

      expect(result.ok).toBe(true);
      expect(getMock).toHaveBeenCalledWith(
        'h-abc',
        expect.objectContaining({ offset: 0, limit: 10 }),
      );
    });

    it('returns ok:false when handle is unknown / storage throws', async () => {
      const getMock = vi.fn(async () => {
        throw new Error('handle not found');
      });
      (getLargeResultStorageService as any).mockReturnValue({ get: getMock });

      const dispatch = makeDispatch({ v2Deps: {} as any });
      const result = await dispatch(makeRunCtx(), {
        name: 'read_large_result',
        input: { handle: 'h-bad' },
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('handle not found');
    });
  });

  // --------------------------------------------------------------------------
  // synth_execute
  // --------------------------------------------------------------------------
  describe('synth_execute', () => {
    it('routes to SynthExecutorClient.execute and returns result', async () => {
      const executeMock = vi.fn(async () => ({
        executionId: 'exec-1',
        success: true,
        stdout: 'hello\n',
        stderr: '',
        result: { ok: true },
        executionTimeMs: 42,
        codeHash: 'abc',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }));
      (getSynthExecutorClient as any).mockReturnValue({ execute: executeMock });

      const dispatch = makeDispatch({ v2Deps: {} as any });
      const result = await dispatch(makeRunCtx(), {
        name: 'synth_execute',
        input: { code: 'print("hi")', intent: 'say hi' },
      });

      expect(result.ok).toBe(true);
      expect(executeMock).toHaveBeenCalled();
      const callArg = executeMock.mock.calls[0]![0];
      expect(callArg.userId).toBe('user-abc');
      expect(callArg.sessionId).toBe('sess-123');
      expect(callArg.code).toBe('print("hi")');
    });

    it('surfaces failure as ok:false with error string', async () => {
      const executeMock = vi.fn(async () => ({
        executionId: 'exec-2',
        success: false,
        error: 'sandbox crash',
        executionTimeMs: 1,
        codeHash: '',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }));
      (getSynthExecutorClient as any).mockReturnValue({ execute: executeMock });

      const dispatch = makeDispatch({ v2Deps: {} as any });
      const result = await dispatch(makeRunCtx(), {
        name: 'synth_execute',
        input: { code: 'raise Exception()', intent: 'crash' },
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('sandbox crash');
    });
  });

  // --------------------------------------------------------------------------
  // Catalog presence — read_large_result + synth ship in the T1 catalog.
  // memory_search and synth_execute were removed in Phase C.1 — memory_search
  // moves into the mcp_tools index (discoverable via tool_search), and
  // synth_execute was renamed to `synth`. The catalog membership contract
  // proper lives in getAllBaseTools.t1Catalog.test.ts; this section just
  // pins the meta-9 tools that survived the T1 trim.
  // --------------------------------------------------------------------------
  describe('meta-tool catalog (post Phase C.1)', () => {
    it('catalog includes read_large_result + synth', () => {
      const tools = getAllBaseTools();
      const names = tools.map((t: any) => t.function?.name);
      expect(names).toContain('read_large_result');
      expect(names).toContain('synth');
    });
  });
});
