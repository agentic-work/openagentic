/**
 * Z.ET.4 — extendedThinkingEnabled per-request toggle (2026-05-19).
 *
 * Source-code contract test: when the chat request sets
 * `extendedThinkingEnabled: false`, the stream.handler must forward it into
 * RunChatInput and runChat must thread it into the ChatLoopInput →
 * ProviderRequest path so AnthropicProvider can honor the user's toggle.
 *
 * Pattern follows runChat.grounding.test.ts (source-text contract).
 *
 * RED: these tests should FAIL before the wiring is added.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const STREAM_HANDLER_PATH = path.resolve(__dirname, '../../../handlers/stream.handler.ts');
const TYPES_PATH = path.resolve(__dirname, '../types.ts');
const ANTHROPIC_PROVIDER_PATH = path.resolve(
  __dirname,
  '../../../../../services/llm-providers/AnthropicProvider.ts',
);
const STREAM_PROVIDER_PATH = path.resolve(__dirname, '../streamProvider.ts');

describe('stream.handler — extendedThinkingEnabled forwarding', () => {
  const src = fs.readFileSync(STREAM_HANDLER_PATH, 'utf-8');

  it('forwards extendedThinkingEnabled from request body to RunChatInput', () => {
    expect(src).toMatch(/extendedThinkingEnabled/);
  });
});

describe('types.ts — RunChatInput has extendedThinkingEnabled', () => {
  const src = fs.readFileSync(TYPES_PATH, 'utf-8');

  it('RunChatInput declares extendedThinkingEnabled as optional boolean', () => {
    expect(src).toMatch(/extendedThinkingEnabled\s*\?/);
  });
});

describe('streamProvider — passes extendedThinkingEnabled to oaiRequest', () => {
  const src = fs.readFileSync(STREAM_PROVIDER_PATH, 'utf-8');

  it('threads extendedThinkingEnabled onto the oaiRequest', () => {
    expect(src).toMatch(/extendedThinkingEnabled/);
  });
});

describe('AnthropicProvider — honors extendedThinkingEnabled=false', () => {
  const src = fs.readFileSync(ANTHROPIC_PROVIDER_PATH, 'utf-8');

  it('checks extendedThinkingEnabled on the request before enabling thinking', () => {
    expect(src).toMatch(/extendedThinkingEnabled/);
  });

  it('treats extendedThinkingEnabled=false as "do not enable thinking"', () => {
    // The guard must be an explicit !== false (truthy default — undefined = ON)
    expect(src).toMatch(/extendedThinkingEnabled\s*!==\s*false/);
  });
});
