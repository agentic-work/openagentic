/**
 * Architecture-grep regression test: OllamaProvider MUST import and call
 * `parseInlineJsonObjectToolCall` as a third-layer fallback after the
 * #798 inline-array parser.
 *
 * Why: gpt-oss:20b emits compose_visual / compose_app / render_artifact
 * as a bare JSON object (`{"name":"...","arguments":{...}}`) when Ollama
 * silently ignores `tool_choice` forcing. Without this parser the JSON
 * envelope leaks to the user as raw text and the artifact never renders.
 *
 * If this test fails, someone ripped the bare-object recovery. Re-add it
 * — do NOT delete this test. The pattern is hard-earned (Q-loop
 * 2026-05-21).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const OLLAMA_PROVIDER_PATH = resolve(
  __dirname,
  '../../services/llm-providers/OllamaProvider.ts',
);

function readSource(p: string): string {
  return readFileSync(p, 'utf8');
}

describe('ollama-bare-object-tool-call source-regression', () => {
  it('OllamaProvider.ts imports parseInlineJsonObjectToolCall', () => {
    const src = readSource(OLLAMA_PROVIDER_PATH);
    const hasImport = /import\s*\{\s*parseInlineJsonObjectToolCall\s*\}\s*from\s*['"]\.\/util\/parseInlineJsonObjectToolCall\.js['"]/.test(src);
    expect(
      hasImport,
      [
        'OllamaProvider.ts must import parseInlineJsonObjectToolCall from',
        '`./util/parseInlineJsonObjectToolCall.js`. This is the third-layer',
        'fallback after parseGptOssToolCalls and parseInlineJsonArrayToolCalls',
        'for bare JSON object tool calls (post-#798 Q-loop 2026-05-21).',
      ].join('\n'),
    ).toBe(true);
  });

  it('OllamaProvider.ts calls parseInlineJsonObjectToolCall at least once', () => {
    const src = readSource(OLLAMA_PROVIDER_PATH);
    const callMatches = src.match(/parseInlineJsonObjectToolCall\s*\(/g) || [];
    expect(
      callMatches.length >= 1,
      [
        'OllamaProvider.ts must call parseInlineJsonObjectToolCall as the',
        'third-layer tool-call recovery after parseGptOssToolCalls and',
        'parseInlineJsonArrayToolCalls fail. Without this call the bare',
        'object JSON envelope leaks to the user.',
      ].join('\n'),
    ).toBe(true);
  });

  it('OllamaProvider.ts logs the inline-object recovery path', () => {
    const src = readSource(OLLAMA_PROVIDER_PATH);
    // Look for the recoveryPath: 'inline_json_object' log seam — required
    // so SRE can grep frequency of this rescue path in production logs.
    const hasLogSeam = /recoveryPath\s*:\s*['"]inline_json_object['"]/.test(src);
    expect(
      hasLogSeam,
      [
        'OllamaProvider.ts must log `recoveryPath: \'inline_json_object\'`',
        'when the bare-object fallback fires. This is the SRE grep seam',
        'for tracking gpt-oss tool_choice silent-drop frequency.',
      ].join('\n'),
    ).toBe(true);
  });
});
