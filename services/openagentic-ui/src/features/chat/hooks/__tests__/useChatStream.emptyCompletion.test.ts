/**
 * Sev-0 2026-05-08. Pre-fix: when /api/chat/stream emits stream_complete
 * after a tool-use chain where the model emits zero assistant_message_delta
 * frames AND no tool_use content blocks reach the UI, useChatStream
 * skipped the entire if-block at line 5499 (`if (assistantMessage ||
 * mcpCalls.length > 0)`) — no message was ever appended → the bubble
 * stayed on "waiting for first token" forever even after the spinner
 * stopped.
 *
 * Curl probe evidence: weather-in-seattle prompt → 4 tool_executing/
 * tool_result frames (wttr.in returned ☁ +55°F) → 0 assistant_message_delta
 * → done. UI: no assistant bubble, no fallback. User can't see the answer.
 *
 * This test pins the fallback contract: a pure function decides whether
 * the existing branch should run with the original content, run with a
 * placeholder, or skip. Wired into the case-'done' handler so the
 * condition becomes `if (resolved.shouldRender) { ... use resolved.content }`.
 */
import { describe, it, expect } from 'vitest';
import { resolveEmptyCompletionFallback } from '../useChatStream';

describe('resolveEmptyCompletionFallback', () => {
  it('non-empty assistantMessage → render with original content (no fallback)', () => {
    const r = resolveEmptyCompletionFallback({
      assistantMessage: 'hello world',
      mcpCallsLength: 0,
      hasToolUseBlocks: false,
    });
    expect(r.shouldRender).toBe(true);
    expect(r.content).toBe('hello world');
    expect(r.usedFallback).toBe(false);
  });

  it('empty content + has mcpCalls → render with empty content (existing tool-only path)', () => {
    const r = resolveEmptyCompletionFallback({
      assistantMessage: '',
      mcpCallsLength: 2,
      hasToolUseBlocks: false,
    });
    expect(r.shouldRender).toBe(true);
    expect(r.content).toBe('');
    expect(r.usedFallback).toBe(false);
  });

  it('empty content + no mcpCalls + has tool_use blocks → render with empty content', () => {
    const r = resolveEmptyCompletionFallback({
      assistantMessage: '',
      mcpCallsLength: 0,
      hasToolUseBlocks: true,
    });
    expect(r.shouldRender).toBe(true);
    expect(r.content).toBe('');
    expect(r.usedFallback).toBe(false);
  });

  it('empty content + no mcpCalls + no tool_use blocks → render with fallback placeholder', () => {
    const r = resolveEmptyCompletionFallback({
      assistantMessage: '',
      mcpCallsLength: 0,
      hasToolUseBlocks: false,
    });
    expect(r.shouldRender).toBe(true);
    expect(r.usedFallback).toBe(true);
    expect(r.content.length).toBeGreaterThan(0);
    // Must be human-readable italics, not blank
    expect(r.content).toMatch(/^_.+_$/);
  });

  it('whitespace-only content + no tools → treated as empty → fallback', () => {
    const r = resolveEmptyCompletionFallback({
      assistantMessage: '   \n  ',
      mcpCallsLength: 0,
      hasToolUseBlocks: false,
    });
    expect(r.shouldRender).toBe(true);
    expect(r.usedFallback).toBe(true);
  });
});
