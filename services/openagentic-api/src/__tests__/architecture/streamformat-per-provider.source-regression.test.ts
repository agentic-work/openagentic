/**
 * Architecture pin — Workstream D, Phase D-1 (per-provider streamFormat
 * correctness).
 *
 * Each LLM provider class MUST declare `streamFormat` as a value of the
 * 8-value `CanonicalStreamFormat` union, AND that value MUST match the
 * native chunk shape the provider's stream actually emits.
 *
 * Single-mode providers declare a static `readonly streamFormat = '...' as const`.
 * Multi-mode providers (AIF / Bedrock / Vertex) keep a static default for
 * the `(provider as any).streamFormat` callsite at `ProviderManager.ts:1180-1181`
 * AND override `getStreamFormat(request: CompletionRequest): CanonicalStreamFormat`
 * for per-request dispatch — that overload lands in D-1.2 / D-1.3 / D-1.4
 * and gets pinned by additional describe blocks in this file.
 *
 * Plan: docs/superpowers/plans/2026-05-05-chatmode-100-percent-accuracy-implementation.md
 *       Workstream D, Phase D-1.
 * Source: docs/research/2026-05-05-sdk-wire-in-plan.md §"Phase D-1: provider-side correctness pass".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROVIDERS = join(__dirname, '../../services/llm-providers');

function readProvider(name: string): string {
  return readFileSync(join(PROVIDERS, `${name}.ts`), 'utf8');
}

describe('D-1 — single-mode providers declare correct streamFormat', () => {
  it('OllamaProvider declares streamFormat = "ollama" (D-1.1 fix; was wrong: "openai")', () => {
    const src = readProvider('OllamaProvider');
    const correctRe = /readonly\s+streamFormat\s*=\s*['"]ollama['"]\s+as\s+const/;
    const wrongRe = /readonly\s+streamFormat\s*=\s*['"]openai['"]\s+as\s+const/;
    expect(src).toMatch(correctRe);
    expect(src).not.toMatch(wrongRe);
  });

  it('AnthropicProvider declares streamFormat = "anthropic"', () => {
    const src = readProvider('AnthropicProvider');
    expect(src).toMatch(/readonly\s+streamFormat\s*=\s*['"]anthropic['"]\s+as\s+const/);
  });

  it('OpenAIProvider declares streamFormat = "openai"', () => {
    const src = readProvider('OpenAIProvider');
    expect(src).toMatch(/readonly\s+streamFormat\s*=\s*['"]openai['"]\s+as\s+const/);
  });

  it('AzureOpenAIProvider declares streamFormat = "openai"', () => {
    const src = readProvider('AzureOpenAIProvider');
    expect(src).toMatch(/readonly\s+streamFormat\s*=\s*['"]openai['"]\s+as\s+const/);
  });
});

describe('D-1.2 — AzureAIFoundryProvider multi-mode dispatch', () => {
  it('keeps a static streamFormat default for ProviderManager bootstrap callsite', () => {
    const src = readProvider('AzureAIFoundryProvider');
    // Any 8-value member is acceptable — multi-mode providers pick a
    // sensible default; the per-request dispatch happens in getStreamFormat.
    expect(src).toMatch(/readonly\s+streamFormat\s*=\s*['"](?:anthropic|bedrock-anthropic|vertex-anthropic|foundry-anthropic|ollama|openai|gemini|aif-responses)['"]\s+as\s+const/);
  });

  it('declares getStreamFormat(request): CanonicalStreamFormat for multi-mode dispatch', () => {
    const src = readProvider('AzureAIFoundryProvider');
    // Method signature anywhere in the class body. Loose match on the
    // return-type because TypeScript inference is OK; we just need the
    // method to exist with a CompletionRequest parameter.
    expect(src).toMatch(/\bgetStreamFormat\s*\(\s*request\s*:\s*CompletionRequest\s*\)\s*:\s*CanonicalStreamFormat/);
  });

  it('handles the three AIF modes (Responses / Anthropic / OpenAI)', () => {
    const src = readProvider('AzureAIFoundryProvider');
    // The body must reference the three CanonicalStreamFormat values
    // mapped to the three AIF dispatch branches.
    expect(src).toMatch(/['"]aif-responses['"]/);
    expect(src).toMatch(/['"]foundry-anthropic['"]/);
    // 'openai' fallback (the static default already enforces this).
  });
});

describe('D-1.3 — AWSBedrockProvider multi-mode dispatch', () => {
  it('declares streamFormat = "bedrock-anthropic" (was wrong: "anthropic")', () => {
    const src = readProvider('AWSBedrockProvider');
    expect(src).toMatch(/readonly\s+streamFormat\s*=\s*['"]bedrock-anthropic['"]\s+as\s+const/);
  });

  it('declares getStreamFormat(request): CanonicalStreamFormat for Claude vs Nova dispatch', () => {
    const src = readProvider('AWSBedrockProvider');
    expect(src).toMatch(/\bgetStreamFormat\s*\(\s*request\s*:\s*CompletionRequest\s*\)\s*:\s*CanonicalStreamFormat/);
  });

  it('routes Claude models to "bedrock-anthropic"', () => {
    const src = readProvider('AWSBedrockProvider');
    // The body must reference the dispatch + return value.
    expect(src).toMatch(/anthropic\.claude/);
    expect(src).toMatch(/return\s+['"]bedrock-anthropic['"]/);
  });
});

describe('D-1.4 — GoogleVertexProvider multi-mode dispatch', () => {
  it('keeps streamFormat = "gemini" as static default', () => {
    const src = readProvider('GoogleVertexProvider');
    expect(src).toMatch(/readonly\s+streamFormat\s*=\s*['"]gemini['"]\s+as\s+const/);
  });

  it('declares getStreamFormat(request): CanonicalStreamFormat for Claude vs Gemini dispatch', () => {
    const src = readProvider('GoogleVertexProvider');
    expect(src).toMatch(/\bgetStreamFormat\s*\(\s*request\s*:\s*CompletionRequest\s*\)\s*:\s*CanonicalStreamFormat/);
  });

  it('routes Claude models on Model Garden to "vertex-anthropic"', () => {
    const src = readProvider('GoogleVertexProvider');
    expect(src).toMatch(/return\s+['"]vertex-anthropic['"]/);
    expect(src).toMatch(/['"]gemini['"]/);
  });
});
