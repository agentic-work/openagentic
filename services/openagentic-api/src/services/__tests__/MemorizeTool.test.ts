/**
 * MemorizeTool — TDD for the memory-write meta-tool.
 *
 * Wraps the existing AgentMemoryService.store() so the model can persist
 * facts / preferences / workflow context across sessions via a tool call.
 * Mirrors the shape of RequestClarificationTool / RenderArtifactTool:
 * tool definition + executeMemorize(ctx, input) + isMemorizeTool(name).
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §177
 *       (Phase 1 task 1.1 + 1.10 — meta-tool list).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AgentMemoryService module BEFORE importing the SUT so the
// `getAgentMemoryService()` singleton returns our spy.
const storeSpy = vi.fn();
vi.mock('../AgentMemoryService.js', () => ({
  getAgentMemoryService: () => ({ store: storeSpy }),
}));

import {
  MEMORIZE_TOOL,
  isMemorizeTool,
  executeMemorize,
  type MemorizeInput,
} from '../MemorizeTool.js';

function makeCtx(emit = vi.fn()) {
  return {
    emit,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-test',
    userId: 'user-test',
  } as any;
}

beforeEach(() => {
  storeSpy.mockReset();
  storeSpy.mockResolvedValue({
    id: 'mem-abc',
    category: 'general',
    key: 'preferred_cloud',
    value: 'azure',
    confidence: 1.0,
    ttl_hours: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
});

describe('MEMORIZE_TOOL — schema shape', () => {
  it('is a valid OpenAI/Anthropic function-tool definition', () => {
    expect(MEMORIZE_TOOL.type).toBe('function');
    expect(MEMORIZE_TOOL.function.name).toBe('memorize');
  });

  it('description follows when-to-use rubric (>=200 chars, USE WHEN, DO NOT USE, example)', () => {
    const desc = MEMORIZE_TOOL.function.description;
    expect(desc.length).toBeGreaterThanOrEqual(200);
    expect(desc).toMatch(/USE WHEN/);
    expect(desc).toMatch(/DO NOT USE/);
    // Canonical example call must be present per Anthropic rubric.
    expect(desc).toMatch(/memorize\s*\(/);
  });

  it('input schema requires key and value; scope is optional with allowed enum', () => {
    const params = MEMORIZE_TOOL.function.parameters as any;
    expect(params.required).toEqual(['key', 'value']);
    expect(params.properties.key.type).toBe('string');
    expect(params.properties.value.type).toBe('string');
    expect(params.properties.scope).toBeDefined();
    expect(params.properties.scope.enum).toEqual(['session', 'user', 'tenant']);
  });
});

describe('isMemorizeTool — name match', () => {
  it('matches canonical "memorize" + 3 documented aliases', () => {
    expect(isMemorizeTool('memorize')).toBe(true);
    expect(isMemorizeTool('Memorize')).toBe(true);
    expect(isMemorizeTool('memory_write')).toBe(true);
    expect(isMemorizeTool('remember')).toBe(true);
  });

  it('rejects unrelated names', () => {
    expect(isMemorizeTool('memory_recall')).toBe(false);
    expect(isMemorizeTool('Task')).toBe(false);
    expect(isMemorizeTool('render_artifact')).toBe(false);
    expect(isMemorizeTool('')).toBe(false);
  });
});

describe('executeMemorize — happy path', () => {
  it('returns a structured tool_result with text content on success', async () => {
    const ctx = makeCtx();
    const result = await executeMemorize(ctx, {
      key: 'preferred_cloud',
      value: 'azure',
    });
    expect(result.type).toBe('tool_result');
    expect(result.is_error).toBe(false);
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(typeof result.content[0].text).toBe('string');
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it('calls AgentMemoryService.store(userId, category, key, value)', async () => {
    const ctx = makeCtx();
    await executeMemorize(ctx, {
      key: 'preferred_cloud',
      value: 'azure',
    });
    expect(storeSpy).toHaveBeenCalledTimes(1);
    const [userId, category, key, value] = storeSpy.mock.calls[0];
    expect(userId).toBe('user-test');
    expect(typeof category).toBe('string'); // default 'general'
    expect(key).toBe('preferred_cloud');
    expect(value).toBe('azure');
  });

  it('emits a memory_written NDJSON frame with key + scope + timestamp', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    await executeMemorize(ctx, {
      key: 'preferred_cloud',
      value: 'azure',
      scope: 'user',
    });
    expect(emit).toHaveBeenCalledTimes(1);
    const [frameType, payload] = emit.mock.calls[0];
    expect(frameType).toBe('memory_written');
    expect(payload.key).toBe('preferred_cloud');
    expect(payload.scope).toBe('user');
    expect(typeof payload.timestamp).toBe('string');
    // timestamp should be ISO 8601-ish
    expect(() => new Date(payload.timestamp)).not.toThrow();
    expect(Number.isFinite(new Date(payload.timestamp).getTime())).toBe(true);
  });

  it('defaults scope to "user" when not provided', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    await executeMemorize(ctx, {
      key: 'project_name',
      value: 'openagentic',
    });
    const [, payload] = emit.mock.calls[0];
    expect(payload.scope).toBe('user');
  });

  it('passes value verbatim to AgentMemoryService — no rewriting', async () => {
    const ctx = makeCtx();
    const exotic =
      "I prefer 'sankey' diagrams for cost flows (mock-spec test 02-aware preference)";
    await executeMemorize(ctx, { key: 'viz_pref', value: exotic });
    const [, , , value] = storeSpy.mock.calls[0];
    expect(value).toBe(exotic);
  });

  it('tolerates missing ctx.emit (no-op)', async () => {
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      userId: 'user-test',
    } as any;
    const result = await executeMemorize(ctx, {
      key: 'k',
      value: 'v',
    });
    expect(result.is_error).toBe(false);
  });
});

describe('executeMemorize — error paths', () => {
  it('returns is_error=true with 1-line apology when store() throws', async () => {
    storeSpy.mockRejectedValueOnce(new Error('db connection lost'));
    const ctx = makeCtx();
    const result = await executeMemorize(ctx, {
      key: 'k',
      value: 'v',
    });
    expect(result.type).toBe('tool_result');
    expect(result.is_error).toBe(true);
    expect(result.content[0].type).toBe('text');
    // Single-line apology
    expect(result.content[0].text.split('\n').length).toBe(1);
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it('rejects empty key with structured error (no throw)', async () => {
    const ctx = makeCtx();
    const result = await executeMemorize(ctx, { key: '', value: 'v' });
    expect(result.is_error).toBe(true);
    expect(result.content[0].text).toMatch(/key/i);
    expect(storeSpy).not.toHaveBeenCalled();
  });

  it('rejects empty value with structured error (no throw)', async () => {
    const ctx = makeCtx();
    const result = await executeMemorize(ctx, { key: 'k', value: '' });
    expect(result.is_error).toBe(true);
    expect(result.content[0].text).toMatch(/value/i);
    expect(storeSpy).not.toHaveBeenCalled();
  });

  it('does not emit memory_written frame on error', async () => {
    storeSpy.mockRejectedValueOnce(new Error('boom'));
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    await executeMemorize(ctx, { key: 'k', value: 'v' });
    expect(emit).not.toHaveBeenCalled();
  });

  it('threads tool_use_id back into the result when supplied', async () => {
    const ctx = makeCtx();
    const result = await executeMemorize(
      ctx,
      { key: 'k', value: 'v' },
      { tool_use_id: 'toolu_01abc' },
    );
    expect(result.tool_use_id).toBe('toolu_01abc');
  });
});
