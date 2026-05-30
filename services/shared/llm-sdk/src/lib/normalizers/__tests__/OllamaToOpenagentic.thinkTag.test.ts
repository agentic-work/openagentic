/**
 * F2-8 integration — pipe raw Ollama NDJSON chunks containing legacy
 * `<think>...</think>` XML content through the full normalizer pipeline
 * and assert reasoning is routed to thinking_delta blocks (not text_delta).
 *
 * Smoking gun: deepseek-r1 / qwq / some gpt-oss configs emit reasoning as
 * `<think>...</think>` inside `message.content` rather than the modern
 * `message.thinking` field. Before F2-8, that content went straight to
 * text_delta and leaked into the assistant body. After F2-8, it routes
 * to thinking_delta blocks the UI can collapse.
 */
import { describe, it, expect } from 'vitest';
import { createOllamaToOpenagenticNormalizer } from '../OllamaToOpenagentic.js';
import type { CanonicalEvent } from '../CanonicalEvent.js';

interface OllamaChunk {
  model?: string;
  created_at?: string;
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    tool_calls?: Array<{
      function?: { name: string; arguments?: unknown };
      id?: string;
    }>;
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

function pipeChunks(chunks: OllamaChunk[]): CanonicalEvent[] {
  const norm = createOllamaToOpenagenticNormalizer({
    messageId: 'test-msg',
    model: 'test-model',
  });
  const events: CanonicalEvent[] = [];
  for (const c of chunks) events.push(...norm.consume(c));
  events.push(...norm.finalize());
  return events;
}

function deltaText(evt: CanonicalEvent, deltaType: 'text_delta' | 'thinking_delta'): string {
  if (evt.type !== 'content_block_delta') return '';
  const d = (evt as any).delta;
  if (d?.type !== deltaType) return '';
  return deltaType === 'text_delta' ? (d.text ?? '') : (d.thinking ?? '');
}

describe('OllamaToOpenagentic — F2-8 <think>...</think> tag routing', () => {
  it('routes <think>...</think> content to thinking_delta, visible body to text_delta', () => {
    const events = pipeChunks([
      { message: { role: 'assistant', content: '<think>let me reason</think>visible answer' } },
      { done: true, done_reason: 'stop' },
    ]);

    const thinkingText = events.map(e => deltaText(e, 'thinking_delta')).join('');
    const textBody = events.map(e => deltaText(e, 'text_delta')).join('');

    expect(thinkingText).toBe('let me reason');
    expect(textBody).toBe('visible answer');
  });

  it('handles <think> tags split across chunks (smoking-gun streaming case)', () => {
    // Simulates Ollama's small NDJSON chunks. Real-world gpt-oss:20b
    // streams content in ~10-50-char chunks. The opening tag in chunk 1
    // is split: "...<thi". Closing tag in chunk 3 split: "</thin"...
    const events = pipeChunks([
      { message: { content: 'hello <thi' } },
      { message: { content: 'nk>reasoning chunk 2 ' } },
      { message: { content: 'reasoning chunk 3</thin' } },
      { message: { content: 'k>then the visible reply' } },
      { done: true, done_reason: 'stop' },
    ]);

    const thinkingText = events.map(e => deltaText(e, 'thinking_delta')).join('');
    const textBody = events.map(e => deltaText(e, 'text_delta')).join('');

    expect(thinkingText).toBe('reasoning chunk 2 reasoning chunk 3');
    expect(textBody).toBe('hello then the visible reply');
  });

  it('passes through plain text untouched when there are no <think> tags', () => {
    const events = pipeChunks([
      { message: { content: 'just a plain reply' } },
      { done: true, done_reason: 'stop' },
    ]);

    const thinkingText = events.map(e => deltaText(e, 'thinking_delta')).join('');
    const textBody = events.map(e => deltaText(e, 'text_delta')).join('');

    expect(thinkingText).toBe('');
    expect(textBody).toBe('just a plain reply');
  });

  it('still emits message.thinking through thinking_delta (modern Ollama path unchanged)', () => {
    // When the model uses native thinking (gpt-oss:20b with think=true),
    // message.thinking + message.content are EXCLUSIVE (thinking-then-content
    // sequence). Verify the native path still works alongside F2-8.
    const events = pipeChunks([
      { message: { thinking: 'native thinking only' } },
      { message: { content: 'the visible answer' } },
      { done: true, done_reason: 'stop' },
    ]);

    const thinkingText = events.map(e => deltaText(e, 'thinking_delta')).join('');
    const textBody = events.map(e => deltaText(e, 'text_delta')).join('');

    expect(thinkingText).toBe('native thinking only');
    expect(textBody).toBe('the visible answer');
  });

  it('content with multiple <think> pairs concatenates thinking fragments', () => {
    const events = pipeChunks([
      { message: { content: '<think>one</think>between<think>two</think>after' } },
      { done: true, done_reason: 'stop' },
    ]);
    const thinkingText = events.map(e => deltaText(e, 'thinking_delta')).join('');
    const textBody = events.map(e => deltaText(e, 'text_delta')).join('');
    expect(thinkingText).toBe('onetwo');
    expect(textBody).toBe('betweenafter');
  });

  it('emits content_block_start for thinking BEFORE any thinking_delta is sent', () => {
    const events = pipeChunks([
      { message: { content: '<think>r</think>x' } },
      { done: true, done_reason: 'stop' },
    ]);
    const blockStartIdx = events.findIndex(
      e => e.type === 'content_block_start' &&
           (e as any).content_block?.type === 'thinking',
    );
    const firstThinkingDeltaIdx = events.findIndex(
      e => e.type === 'content_block_delta' &&
           (e as any).delta?.type === 'thinking_delta',
    );
    expect(blockStartIdx).toBeGreaterThanOrEqual(0);
    expect(firstThinkingDeltaIdx).toBeGreaterThan(blockStartIdx);
  });
});
