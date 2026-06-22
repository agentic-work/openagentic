/**
 * Unit test for isLocalModelFamily — the Ollama-family detector that gates
 * smart-tool-stripping in mcp.stage.ts. Locally-served models support native
 * tool calling, so their tools must NEVER be stripped.
 *
 * Also guards the no-hardcoded-models refactor: detection routes through the
 * canonical modelFamily() SOT instead of inline `.includes('gpt-oss')` model
 * literals, and this test pins the behavior so the refactor stays correct.
 */
import { describe, it, expect } from 'vitest';
import { isLocalModelFamily } from '../mcp.stage.js';

describe('isLocalModelFamily', () => {
  it('detects gpt-oss family (tagged + sized variants)', () => {
    expect(isLocalModelFamily('gpt-oss')).toBe(true);
    expect(isLocalModelFamily('gpt-oss:20b')).toBe(true);
    expect(isLocalModelFamily('gpt-oss-120b')).toBe(true);
    expect(isLocalModelFamily('GPT-OSS')).toBe(true); // case-insensitive
  });

  it('detects llama / qwen / deepseek / mistral families', () => {
    expect(isLocalModelFamily('llama3.1')).toBe(true);
    expect(isLocalModelFamily('llama-3.3-70b')).toBe(true);
    expect(isLocalModelFamily('qwen2.5-coder')).toBe(true);
    expect(isLocalModelFamily('deepseek-r1')).toBe(true);
    expect(isLocalModelFamily('mistral-nemo')).toBe(true);
  });

  it('detects the explicit ollama provider tag (e.g. ollama/llama3)', () => {
    expect(isLocalModelFamily('ollama/llama3')).toBe(true);
    expect(isLocalModelFamily('ollama:qwen2.5')).toBe(true);
  });

  it('does NOT match hosted cloud models', () => {
    expect(isLocalModelFamily('gpt-4o')).toBe(false);
    expect(isLocalModelFamily('gpt-5.2')).toBe(false);
    expect(isLocalModelFamily('claude-sonnet-4-6')).toBe(false);
    expect(isLocalModelFamily('gemini-2.0-flash')).toBe(false);
  });

  it('handles empty / nullish input safely', () => {
    expect(isLocalModelFamily('')).toBe(false);
    expect(isLocalModelFamily(undefined)).toBe(false);
    expect(isLocalModelFamily(null)).toBe(false);
  });
});
