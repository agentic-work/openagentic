/**
 * Architecture pin — Phase 0.4 wire-in (per audit
 * docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md §0.4).
 *
 * Each LLM provider's outbound request-body construction MUST delegate to the
 * SDK's `selectOutboundAdapter()` (via a thin helper) — providers must NOT
 * hand-roll their own message/tool conversion. The pin catches regression of
 * `convertMessages`, `convertToolsToOllama`, `convertAnthropicMessagesToOpenAI`
 * (and similar inline converters) drifting back into the provider source.
 *
 * Each subsection lights up green as the matching provider class is migrated.
 * Until then it sits idle (pin-only; no failure for un-migrated providers).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROVIDERS = join(__dirname, '../../services/llm-providers');

function readProvider(name: string): string {
  return readFileSync(join(PROVIDERS, `${name}.ts`), 'utf8');
}

describe('Phase 0.4 — OllamaProvider uses SDK outbound adapter', () => {
  it('imports buildOllamaWireBody (thin client wrapper around selectOutboundAdapter)', () => {
    const src = readProvider('OllamaProvider');
    expect(/from\s+['"]\.\/ollama\/buildOllamaWireBody\.js['"]/.test(src)).toBe(true);
  });

  it('invokes the helper in the createCompletion path', () => {
    const src = readProvider('OllamaProvider');
    expect(/buildOllamaWireBody\s*\(/.test(src)).toBe(true);
  });

  it('does NOT contain hand-rolled wire conversion (`convertMessages` / `convertToolsToOllama` deleted)', () => {
    const src = readProvider('OllamaProvider');
    expect(/private\s+convertMessages\s*\(/.test(src)).toBe(false);
    expect(/private\s+convertToolsToOllama\s*\(/.test(src)).toBe(false);
  });

  it('helper imports selectOutboundAdapter from SDK', () => {
    const helperPath = join(PROVIDERS, 'ollama/buildOllamaWireBody.ts');
    if (!existsSync(helperPath)) {
      throw new Error('buildOllamaWireBody.ts not found');
    }
    const src = readFileSync(helperPath, 'utf8');
    expect(/selectOutboundAdapter\s*\(\s*['"]ollama['"]\s*\)/.test(src)).toBe(true);
    expect(/completionRequestToCanonical\s*\(/.test(src)).toBe(true);
  });
});

describe('Phase 0.4 — AWSBedrockProvider Claude path uses SDK outbound adapter', () => {
  it('imports buildBedrockClaudeBody', () => {
    const src = readProvider('AWSBedrockProvider');
    expect(/from\s+['"]\.\/aws\/buildBedrockClaudeBody\.js['"]/.test(src)).toBe(true);
  });

  it('Claude branch invokes the helper', () => {
    const src = readProvider('AWSBedrockProvider');
    expect(/buildBedrockClaudeBody\s*\(/.test(src)).toBe(true);
  });

  it('helper imports buildAnthropicWireBody (shared SoT for Anthropic-shape body)', () => {
    const helperPath = join(PROVIDERS, 'aws/buildBedrockClaudeBody.ts');
    if (!existsSync(helperPath)) {
      throw new Error('buildBedrockClaudeBody.ts not found');
    }
    const src = readFileSync(helperPath, 'utf8');
    expect(/buildAnthropicWireBody\s*\(/.test(src)).toBe(true);
    // Bedrock-specific quirks must be present in the helper.
    expect(/anthropic_version/.test(src)).toBe(true);
  });
});

describe('Phase 0.4 — AnthropicProvider uses SDK outbound adapter', () => {
  it('imports buildAnthropicWireBody', () => {
    const src = readProvider('AnthropicProvider');
    expect(/from\s+['"]\.\/anthropic\/buildAnthropicWireBody\.js['"]/.test(src)).toBe(true);
  });

  it('createCompletion invokes the helper', () => {
    const src = readProvider('AnthropicProvider');
    expect(/buildAnthropicWireBody\s*\(/.test(src)).toBe(true);
  });

  it('does NOT contain hand-rolled wire conversion (`convertMessages` / `convertTools` / `convertToolChoice` deleted)', () => {
    const src = readProvider('AnthropicProvider');
    expect(/private\s+convertMessages\s*\(/.test(src)).toBe(false);
    expect(/private\s+convertTools\s*\(/.test(src)).toBe(false);
    expect(/private\s+convertToolChoice\s*\(/.test(src)).toBe(false);
  });

  it('helper imports selectOutboundAdapter("anthropic") from SDK', () => {
    const helperPath = join(PROVIDERS, 'anthropic/buildAnthropicWireBody.ts');
    if (!existsSync(helperPath)) {
      throw new Error('buildAnthropicWireBody.ts not found');
    }
    const src = readFileSync(helperPath, 'utf8');
    expect(/selectOutboundAdapter\s*\(\s*['"]anthropic['"]\s*\)/.test(src)).toBe(true);
    expect(/completionRequestToCanonical\s*\(/.test(src)).toBe(true);
  });
});

describe('Phase 0.4 — AzureAIFoundryProvider Chat Completions path uses SDK outbound adapter', () => {
  it('imports buildAifChatCompletionsBody', () => {
    const src = readProvider('AzureAIFoundryProvider');
    expect(/from\s+['"]\.\/aif\/buildAifChatCompletionsBody\.js['"]/.test(src)).toBe(true);
  });

  it('createOpenAICompletion invokes the helper', () => {
    const src = readProvider('AzureAIFoundryProvider');
    expect(/buildAifChatCompletionsBody\s*\(/.test(src)).toBe(true);
  });

  it('helper imports selectOutboundAdapter("openai") + normalizeAifToolParameters', () => {
    const helperPath = join(PROVIDERS, 'aif/buildAifChatCompletionsBody.ts');
    if (!existsSync(helperPath)) {
      throw new Error('buildAifChatCompletionsBody.ts not found');
    }
    const src = readFileSync(helperPath, 'utf8');
    expect(/selectOutboundAdapter\s*\(\s*['"]openai['"]\s*\)/.test(src)).toBe(true);
    expect(/normalizeAifToolParameters\s*\(/.test(src)).toBe(true);
  });
});

describe('Phase 0.4 — AzureAIFoundryProvider Responses API uses SDK outbound adapter', () => {
  it('imports buildAifResponsesBody', () => {
    const src = readProvider('AzureAIFoundryProvider');
    expect(/from\s+['"]\.\/aif\/buildAifResponsesBody\.js['"]/.test(src)).toBe(true);
  });

  it('streamResponsesApi + nonStreamResponsesApi invoke the helper', () => {
    const src = readProvider('AzureAIFoundryProvider');
    const matches = src.match(/buildAifResponsesBody\s*\(/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('helper imports selectOutboundAdapter("aif-responses") from SDK', () => {
    const helperPath = join(PROVIDERS, 'aif/buildAifResponsesBody.ts');
    if (!existsSync(helperPath)) {
      throw new Error('buildAifResponsesBody.ts not found');
    }
    const src = readFileSync(helperPath, 'utf8');
    expect(/selectOutboundAdapter\s*\(\s*['"]aif-responses['"]\s*\)/.test(src)).toBe(true);
    expect(/completionRequestToCanonical\s*\(/.test(src)).toBe(true);
  });

  it('Responses API call sites do NOT call the deprecated in-class buildResponsesApiBody', () => {
    const src = readProvider('AzureAIFoundryProvider');
    // The method still exists as @deprecated but has zero remaining callers.
    expect(/this\.buildResponsesApiBody\s*\(/.test(src)).toBe(false);
  });
});
