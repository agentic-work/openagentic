/**
 * #591 — chatModel fallback selection on Ollama sync.
 *
 * The previous logic was:
 *   const fallback = hostModelNames.find(m => !m.toLowerCase().includes('embed'))
 *                   || hostModelNames[0];
 * which has TWO bugs:
 *   1. Substring `.includes('embed')` is weaker than `isEmbeddingModelName`
 *      and misses bge-m3 / e5-large-v2 / gte-large / snowflake-arctic-embed.
 *   2. The `|| hostModelNames[0]` fallback re-selects the embedding model
 *      itself on embed-only hosts (live 2026-05-01: 'hal' provider stuck on
 *      `nomic-embed-text:latest` after sync).
 *
 * Fix: `selectChatModelFallback` returns the first non-embedding model on
 * the host, or null if no chat-capable model exists. Caller must clear
 * chatModel + defaultModel when null is returned.
 */
import { describe, it, expect } from 'vitest';
import { selectChatModelFallback } from '../OllamaModelSyncService.js';

describe('selectChatModelFallback (#591)', () => {
  it('picks the first non-embedding model when both exist', () => {
    expect(
      selectChatModelFallback(['nomic-embed-text:latest', 'gpt-oss:20b']),
    ).toBe('gpt-oss:20b');
  });

  it('returns null on embed-only hosts (the live "hal" provider case)', () => {
    expect(selectChatModelFallback(['nomic-embed-text:latest'])).toBeNull();
  });

  it('returns null on empty hosts', () => {
    expect(selectChatModelFallback([])).toBeNull();
  });

  it('uses isEmbeddingModelName, not substring (catches bge-m3 / e5)', () => {
    // bge-m3 has no `embed` substring but is an embedding model.
    expect(selectChatModelFallback(['bge-m3'])).toBeNull();
    expect(selectChatModelFallback(['bge-m3', 'llama3.2:3b'])).toBe('llama3.2:3b');
    expect(selectChatModelFallback(['e5-large-v2'])).toBeNull();
    expect(selectChatModelFallback(['gte-large', 'qwen3-coder:480b'])).toBe(
      'qwen3-coder:480b',
    );
  });

  it('preserves order (returns first non-embedding model)', () => {
    expect(
      selectChatModelFallback(['llama3.2:3b', 'mistral:7b', 'gpt-oss:20b']),
    ).toBe('llama3.2:3b');
  });
});
