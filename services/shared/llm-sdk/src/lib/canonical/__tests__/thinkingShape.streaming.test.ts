/**
 * F2-8 — Ollama `<think>...</think>` XML parsing with STREAMING state.
 *
 * The existing `extractThinkingFromOllamaContent(content)` is single-shot —
 * it takes a complete content string and splits into (thinking, rest). For
 * Ollama's streaming `/api/chat`, the content arrives in many small chunks
 * and tags can straddle chunk boundaries (e.g. chunk 1 = "<thi", chunk 2 =
 * "nk>part 1", chunk 3 = "</think>visible").
 *
 * Need a stateful variant: `extractThinkingFromOllamaContentStreaming(
 *   chunk, prevState
 * ) → { thinking, rest, state }` where `state` carries enough info to
 * resume parsing on the next chunk.
 *
 * Used by `OllamaToOpenagentic.consume()` so deepseek-r1 / qwq / any other
 * legacy-XML reasoning model emits `thinking_delta` events instead of
 * leaking the reasoning into the assistant body via `text_delta`.
 *
 * Smoking gun (live 2026-05-12 dev, gpt-oss:20b sankey prompt): the
 * model's reasoning prose ("User wants: ... We need to fetch AWS Cost
 * Explorer... we can output mermaid code in a code block") showed up
 * inline in the assistant message body. Either (a) the model emitted
 * reasoning as plain text_delta (not in `<think>` tags), or (b) it emitted
 * `<think>` tags that the SDK normalizer never extracted. F2-8 fixes (b).
 */
import { describe, it, expect } from 'vitest';
import { extractThinkingFromOllamaContentStreaming } from '../thinkingShape.js';

describe('extractThinkingFromOllamaContentStreaming — chunk-aware <think> parser', () => {
  it('passes through plain text when no tag involved', () => {
    const out = extractThinkingFromOllamaContentStreaming('plain reply', {
      inThinkTag: false,
      pending: '',
    });
    expect(out.thinking).toBe('');
    expect(out.rest).toBe('plain reply');
    expect(out.state.inThinkTag).toBe(false);
    expect(out.state.pending).toBe('');
  });

  it('extracts a complete tag pair in a single chunk', () => {
    const out = extractThinkingFromOllamaContentStreaming(
      '<think>reasoning</think>visible',
      { inThinkTag: false, pending: '' },
    );
    expect(out.thinking).toBe('reasoning');
    expect(out.rest).toBe('visible');
    expect(out.state.inThinkTag).toBe(false);
  });

  it('handles tag opened in chunk 1, content continues, closed in chunk 3', () => {
    const s0 = { inThinkTag: false, pending: '' };
    const c1 = extractThinkingFromOllamaContentStreaming('<think>part 1 ', s0);
    expect(c1.thinking).toBe('part 1 ');
    expect(c1.rest).toBe('');
    expect(c1.state.inThinkTag).toBe(true);

    const c2 = extractThinkingFromOllamaContentStreaming('part 2 ', c1.state);
    expect(c2.thinking).toBe('part 2 ');
    expect(c2.rest).toBe('');
    expect(c2.state.inThinkTag).toBe(true);

    const c3 = extractThinkingFromOllamaContentStreaming(
      'part 3</think>then visible',
      c2.state,
    );
    expect(c3.thinking).toBe('part 3');
    expect(c3.rest).toBe('then visible');
    expect(c3.state.inThinkTag).toBe(false);
  });

  it('handles opening tag split across two chunks (<thi | nk>...)', () => {
    const s0 = { inThinkTag: false, pending: '' };
    const c1 = extractThinkingFromOllamaContentStreaming('hello <thi', s0);
    // The "<thi" is incomplete — the splitter must buffer it as `pending`
    // so we don't accidentally treat it as plain text + lose the tag on
    // the next chunk.
    expect(c1.thinking).toBe('');
    expect(c1.rest).toBe('hello ');
    expect(c1.state.inThinkTag).toBe(false);
    expect(c1.state.pending).toBe('<thi');

    const c2 = extractThinkingFromOllamaContentStreaming('nk>reasoning</think>visible', c1.state);
    expect(c2.thinking).toBe('reasoning');
    expect(c2.rest).toBe('visible');
    expect(c2.state.inThinkTag).toBe(false);
    expect(c2.state.pending).toBe('');
  });

  it('handles closing tag split across two chunks (</thi | nk>...)', () => {
    const s0 = { inThinkTag: false, pending: '' };
    const c1 = extractThinkingFromOllamaContentStreaming('<think>reasoning</thi', s0);
    // Inside tag, closing marker started but not complete → buffer the partial.
    expect(c1.thinking).toBe('reasoning');
    expect(c1.rest).toBe('');
    expect(c1.state.inThinkTag).toBe(true);
    expect(c1.state.pending).toBe('</thi');

    const c2 = extractThinkingFromOllamaContentStreaming('nk>visible reply', c1.state);
    expect(c2.thinking).toBe('');
    expect(c2.rest).toBe('visible reply');
    expect(c2.state.inThinkTag).toBe(false);
    expect(c2.state.pending).toBe('');
  });

  it('two-tag pair across many chunks', () => {
    const s0 = { inThinkTag: false, pending: '' };
    const c1 = extractThinkingFromOllamaContentStreaming('<think>a</think>x<think>b</think>y', s0);
    expect(c1.thinking).toBe('ab');
    expect(c1.rest).toBe('xy');
    expect(c1.state.inThinkTag).toBe(false);
  });

  it('returns no thinking when chunk has only a tag-open-prefix but is finalized via final flush', () => {
    // If a stream ends with pending '<thi', the caller is responsible for
    // deciding whether to surface that or drop it. For now, the function
    // just returns state with pending set; callers can call again with ''
    // to force the buffered prefix to flush into `rest`.
    const s0 = { inThinkTag: false, pending: '' };
    const c1 = extractThinkingFromOllamaContentStreaming('reply <thi', s0);
    expect(c1.rest).toBe('reply ');
    expect(c1.state.pending).toBe('<thi');
    // Caller signals end-of-stream by passing an empty chunk + a `finalize`
    // flag. Without finalize, the pending stays buffered.
    const c2 = extractThinkingFromOllamaContentStreaming('', c1.state, { finalize: true });
    expect(c2.rest).toBe('<thi');
    expect(c2.state.pending).toBe('');
  });
});
