import { describe, it, expect } from 'vitest';
import { isEmbeddingModelName } from '../OllamaModelSyncService.js';

describe('isEmbeddingModelName', () => {
  it.each([
    ['nomic-embed-text:latest', true],
    ['mxbai-embed-large', true],
    ['bge-large-en', true],
    ['bge-m3', true],
    ['e5-large-v2', true],
    ['gte-large', true],
    ['snowflake-arctic-embed', true],
    ['gpt-oss:20b', false],
    ['llama3.2:3b', false],
    ['qwen3-coder:480b', false],
    ['mistral:7b', false],
    ['deepseek-coder:6.7b', false],
  ])('%s → %s', (name, expected) => {
    expect(isEmbeddingModelName(name)).toBe(expected);
  });
});
