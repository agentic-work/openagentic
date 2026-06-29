/**
 * Section registry primitive — ref-arch port from
 * ~/anthropic/src/constants/systemPromptSections.ts:8-58.
 *
 * The registry lets us declare prompt sections as named compute fns and
 * resolve them all in parallel. DANGEROUS_uncached* marks sections whose
 * value can change mid-session (the marker becomes a cache-break boundary
 * once we wire prompt caching; for now it's documentation).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  systemPromptSection,
  DANGEROUS_uncachedSystemPromptSection,
  resolveSystemPromptSections,
} from '../sections.js';

describe('section registry', () => {
  it('systemPromptSection wraps a compute fn with cacheBreak=false', () => {
    const s = systemPromptSection('memory', () => 'mem-body');
    expect(s.name).toBe('memory');
    expect(s.cacheBreak).toBe(false);
    expect(typeof s.compute).toBe('function');
  });

  it('DANGEROUS_uncachedSystemPromptSection wraps with cacheBreak=true + reason', () => {
    const s = DANGEROUS_uncachedSystemPromptSection(
      'mcp_instructions',
      () => 'mcp-body',
      'MCP servers connect/disconnect between turns',
    );
    expect(s.name).toBe('mcp_instructions');
    expect(s.cacheBreak).toBe(true);
    expect(s.reason).toBe('MCP servers connect/disconnect between turns');
  });

  it('resolveSystemPromptSections returns ordered strings, in registry order', async () => {
    const sections = [
      systemPromptSection('a', () => 'A'),
      systemPromptSection('b', async () => 'B'),
      systemPromptSection('c', () => 'C'),
    ];
    const resolved = await resolveSystemPromptSections(sections);
    expect(resolved).toEqual(['A', 'B', 'C']);
  });

  it('resolveSystemPromptSections runs compute fns in parallel', async () => {
    let aDone = false;
    const sections = [
      systemPromptSection('slow', async () => {
        await new Promise((r) => setTimeout(r, 20));
        aDone = true;
        return 'slow';
      }),
      systemPromptSection('fast', async () => {
        // If parallel, this resolves before `slow` finishes.
        expect(aDone).toBe(false);
        return 'fast';
      }),
    ];
    const resolved = await resolveSystemPromptSections(sections);
    expect(resolved).toEqual(['slow', 'fast']);
  });

  it('resolveSystemPromptSections filters out empty / null / undefined section bodies', async () => {
    const sections = [
      systemPromptSection('keep', () => 'kept'),
      systemPromptSection('empty', () => ''),
      systemPromptSection('null', () => null as unknown as string),
      systemPromptSection('undef', () => undefined as unknown as string),
    ];
    const resolved = await resolveSystemPromptSections(sections);
    expect(resolved).toEqual(['kept']);
  });

  it('compute fn that throws is logged + dropped (best-effort, prompt still composes)', async () => {
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as any;
    const sections = [
      systemPromptSection('good', () => 'ok'),
      systemPromptSection('broken', () => { throw new Error('section blew up'); }),
    ];
    const resolved = await resolveSystemPromptSections(sections, { logger });
    expect(resolved).toEqual(['ok']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ section: 'broken' }),
      expect.stringContaining('compute failed'),
    );
  });
});
