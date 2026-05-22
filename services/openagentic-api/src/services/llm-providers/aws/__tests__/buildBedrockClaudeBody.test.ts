/**
 * Tests for buildBedrockClaudeBody — Phase 0.4 wire helper for the
 * Claude-on-Bedrock path. Routes through the SDK's `'anthropic'`
 * adapter because Bedrock's InvokeModelWithResponseStream for Claude
 * accepts the same Anthropic Messages API body shape (minus `model`,
 * plus `anthropic_version`). The 'bedrock-anthropic' adapter is for
 * Converse API; that's a separate migration.
 */

import { describe, it, expect } from 'vitest';
import { buildBedrockClaudeBody } from '../buildBedrockClaudeBody.js';
import type { CompletionRequest } from '../../ILLMProvider.js';

const baseOpts = {
  parallelOn: true,
};

describe('buildBedrockClaudeBody', () => {
  it('strips model + adds anthropic_version + Anthropic Messages body shape', () => {
    const body = buildBedrockClaudeBody(
      {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi.' },
        ],
        max_tokens: 64,
      } as CompletionRequest,
      baseOpts,
    );
    // model goes in InvokeModel.modelId — NOT in the body. The helper
    // must strip it.
    expect((body as any).model).toBeUndefined();
    // Bedrock-specific top-level field.
    expect((body as any).anthropic_version).toBe('bedrock-2023-05-31');
    expect((body as any).max_tokens).toBe(64);
    // System prompt either as string or single-block array (Anthropic
    // wire accepts both).
    const system = (body as any).system;
    if (typeof system === 'string') {
      expect(system).toBe('You are helpful.');
    } else {
      expect(system).toEqual([{ type: 'text', text: 'You are helpful.' }]);
    }
    expect((body as any).messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hi.' }] },
    ]);
  });

  it('parallel tool batch preserved: 3 assistant tool_calls → 3 tool_use blocks', () => {
    const body = buildBedrockClaudeBody(
      {
        messages: [
          { role: 'user', content: 'list 3 clouds' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'toolu_aws', type: 'function', function: { name: 'aws_ls', arguments: '{}' } },
              { id: 'toolu_gcp', type: 'function', function: { name: 'gcp_ls', arguments: '{}' } },
              { id: 'toolu_azure', type: 'function', function: { name: 'azure_ls', arguments: '{}' } },
            ],
          },
        ],
        max_tokens: 1024,
      } as CompletionRequest,
      baseOpts,
    );
    const asst = (body as any).messages[1];
    expect(asst.role).toBe('assistant');
    expect(asst.content).toHaveLength(3);
  });

  it('tool result: role:tool → user with tool_result block', () => {
    const body = buildBedrockClaudeBody(
      {
        messages: [
          { role: 'tool', tool_call_id: 'toolu_x', content: 'result-text' },
        ],
        max_tokens: 256,
      } as CompletionRequest,
      baseOpts,
    );
    expect((body as any).messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_x', content: 'result-text' },
      ],
    });
  });

  it('tools array: shaped for Anthropic with input_schema; tool_choice carries disable_parallel_tool_use', () => {
    const body = buildBedrockClaudeBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        tools: [
          {
            type: 'function',
            function: {
              name: 'ls',
              description: 'List files',
              parameters: { type: 'object', properties: { path: { type: 'string' } } },
            },
          },
        ],
        tool_choice: 'auto',
      } as CompletionRequest,
      { ...baseOpts, parallelOn: true },
    );
    expect((body as any).tools).toEqual([
      {
        name: 'ls',
        description: 'List files',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ]);
    expect((body as any).tool_choice).toEqual({
      type: 'auto',
      disable_parallel_tool_use: false,
    });
  });

  it('thinking: when supportsThinking + budget given, attaches thinking field with budget_tokens', () => {
    const body = buildBedrockClaudeBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
      } as CompletionRequest,
      { ...baseOpts, supportsThinking: true, thinkingBudgetTokens: 4096 },
    );
    expect((body as any).thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
  });

  it('!supportsThinking: no thinking field on wire', () => {
    const body = buildBedrockClaudeBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
      } as CompletionRequest,
      baseOpts,
    );
    expect('thinking' in (body as any)).toBe(false);
  });

  it('temperature + top_p pass through (provider-config, not wire shape)', () => {
    const body = buildBedrockClaudeBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        temperature: 0.3,
        top_p: 0.95,
      } as CompletionRequest,
      baseOpts,
    );
    expect((body as any).temperature).toBe(0.3);
    expect((body as any).top_p).toBe(0.95);
  });

  it('no stream key on wire — Bedrock InvokeModelWithResponseStream is the streaming command (transport), not body field', () => {
    const body = buildBedrockClaudeBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        stream: true,
      } as CompletionRequest,
      baseOpts,
    );
    // Anthropic.com direct accepts `stream:true` in the body, but Bedrock
    // uses the InvokeModelWithResponseStream COMMAND (not the body field).
    // Including `stream:true` in the body to Bedrock is accepted but
    // ignored; we keep it out to match AWS's own documentation.
    expect('stream' in (body as any)).toBe(false);
  });
});
