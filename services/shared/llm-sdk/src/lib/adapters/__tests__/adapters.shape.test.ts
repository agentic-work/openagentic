/**
 * Shape unit tests for the 6 outbound adapters.
 *
 * These tests assert what THE ADAPTER PRODUCES for a given canonical input —
 * they do NOT claim the output is what the provider accepts (that's the live
 * probe's job, see scripts/probe-real-adapter.ts). Mock fixtures here are
 * canonical inputs, not provider response captures. Per the project rule
 * `feedback_no_synthetic_chunks_only_real_provider_captures`, all
 * provider-acceptance validation is done via real-call probes in a separate
 * tier.
 *
 * What these tests catch:
 *   - Refactor regressions (e.g. someone renames a field)
 *   - Per-adapter shape divergence (e.g. AIF Responses must use `input[]`,
 *     not `messages[]`; OpenAI must use `messages[].tool_calls`, not
 *     content-array-with-tool_use)
 *   - tool_use_id format conversion (toolu_* → call_* for OpenAI/AIF/Ollama)
 *   - cache_control stripping on non-Anthropic targets
 *   - Thinking block drop vs preserve per target
 *   - Parallel tool batch pairing (#774 — function_call + function_call_output)
 */

import { describe, it, expect } from 'vitest';
import {
  OpenagenticToAnthropic,
  OpenagenticToAIFResponses,
  OpenagenticToOpenAI,
  OpenagenticToBedrock,
  OpenagenticToVertexGemini,
  OpenagenticToOllama,
  selectOutboundAdapter,
} from '../index.js';
import type { CanonicalRequest } from '../../canonical/types.js';

// ---------------------------------------------------------------------------
// Test fixtures (canonical inputs)
// ---------------------------------------------------------------------------

function basicTextReq(): CanonicalRequest {
  return {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    system: 'You are helpful.',
    tools: [],
    tool_choice: { type: 'auto' },
    max_tokens: 1024,
  };
}

function parallelToolBatchReq(): CanonicalRequest {
  // The #774 scenario — assistant emits 2 parallel tool_use blocks, user
  // returns 2 tool_result blocks in the next turn. Every adapter must pair
  // them correctly on outbound.
  return {
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'check AWS + Azure' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running both checks.' },
          { type: 'tool_use', id: 'toolu_abc', name: 'aws_list', input: { region: 'us-east-1' } },
          { type: 'tool_use', id: 'toolu_xyz', name: 'azure_list', input: { sub: 'prod' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_abc', content: 'aws result' },
          { type: 'tool_result', tool_use_id: 'toolu_xyz', content: 'azure result' },
        ],
      },
    ],
    system: null,
    tools: [
      { name: 'aws_list', description: 'list aws', input_schema: { type: 'object' } },
      { name: 'azure_list', description: 'list azure', input_schema: { type: 'object' } },
    ],
    tool_choice: { type: 'auto' },
    max_tokens: 2048,
  };
}

function thinkingReq(): CanonicalRequest {
  return {
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me think step by step about this problem.' },
          { type: 'text', text: 'The answer is 42.' },
        ],
      },
    ],
    system: null,
    tools: [],
    tool_choice: { type: 'auto' },
    max_tokens: 1024,
    thinking: { type: 'enabled', budget_tokens: 4000 },
  };
}

function cacheControlReq(): CanonicalRequest {
  return {
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'long-cached system context' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'now my actual question' }],
      },
    ],
    system: 'Big system prompt eligible for caching.',
    tools: [],
    tool_choice: { type: 'auto' },
    max_tokens: 1024,
    cache_control_marker_indices: [0],
  };
}

// ---------------------------------------------------------------------------
// 1. OpenagenticToAnthropic
// ---------------------------------------------------------------------------

describe('OpenagenticToAnthropic', () => {
  const a = new OpenagenticToAnthropic();

  it('basic request shape: messages + system + max_tokens', () => {
    const body: any = a.adaptRequest(basicTextReq());
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    });
    expect(body.system).toEqual([{ type: 'text', text: 'You are helpful.' }]);
    expect(body.max_tokens).toBe(1024);
  });

  it('preserves tool_use_id as canonical toolu_*', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    const assistantMsg = body.messages[1];
    const toolUses = assistantMsg.content.filter((b: any) => b.type === 'tool_use');
    expect(toolUses).toHaveLength(2);
    expect(toolUses[0].id).toBe('toolu_abc');
    expect(toolUses[1].id).toBe('toolu_xyz');
  });

  it('preserves thinking blocks', () => {
    const body: any = a.adaptRequest(thinkingReq());
    const assistantContent = body.messages[0].content;
    expect(assistantContent[0]).toEqual({
      type: 'thinking',
      thinking: 'Let me think step by step about this problem.',
    });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4000 });
  });

  it('attaches cache_control on indexed message LAST content block', () => {
    const body: any = a.adaptRequest(cacheControlReq());
    const msg0LastBlock = body.messages[0].content[body.messages[0].content.length - 1];
    const msg1LastBlock = body.messages[1].content[body.messages[1].content.length - 1];
    expect(msg0LastBlock.cache_control).toEqual({ type: 'ephemeral' });
    expect(msg1LastBlock.cache_control).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. OpenagenticToAIFResponses — the #774 contract
// ---------------------------------------------------------------------------

describe('OpenagenticToAIFResponses', () => {
  const a = new OpenagenticToAIFResponses();

  it('uses input[] array, not messages[]', () => {
    const body: any = a.adaptRequest(basicTextReq());
    expect(body.input).toBeDefined();
    expect(body.messages).toBeUndefined();
    expect(Array.isArray(body.input)).toBe(true);
  });

  it('puts system prompt in instructions field (not a role)', () => {
    const body: any = a.adaptRequest(basicTextReq());
    expect(body.instructions).toBe('You are helpful.');
    const hasSystemRole = body.input.some((item: any) => item.role === 'system');
    expect(hasSystemRole).toBe(false);
  });

  it('parallel tool batch: emits N function_call items immediately followed by N function_call_output items', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    // Find the function_call items
    const callItems = body.input.filter((i: any) => i.type === 'function_call');
    const outputItems = body.input.filter((i: any) => i.type === 'function_call_output');
    expect(callItems).toHaveLength(2);
    expect(outputItems).toHaveLength(2);
    // Pair by call_id (toolu_ converted to call_)
    expect(callItems[0].call_id).toBe('call_abc');
    expect(callItems[1].call_id).toBe('call_xyz');
    expect(outputItems[0].call_id).toBe('call_abc');
    expect(outputItems[1].call_id).toBe('call_xyz');
    // call_ids must MATCH between call and output (the #774 contract)
    const callIds = callItems.map((c: any) => c.call_id).sort();
    const outIds = outputItems.map((c: any) => c.call_id).sort();
    expect(callIds).toEqual(outIds);
  });

  it('thinking blocks → reasoning items with summary_text', () => {
    const body: any = a.adaptRequest(thinkingReq());
    const reasoning = body.input.find((i: any) => i.type === 'reasoning');
    expect(reasoning).toBeDefined();
    expect(reasoning.summary).toEqual([
      { type: 'summary_text', text: 'Let me think step by step about this problem.' },
    ]);
  });

  it('tool definitions use {type:"function", function:{...}} shape', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    expect(body.tools).toBeDefined();
    expect(body.tools[0]).toMatchObject({
      type: 'function',
      name: 'aws_list',
      description: 'list aws',
      parameters: { type: 'object' },
    });
  });

  it('strips cache_control markers', () => {
    const body: any = a.adaptRequest(cacheControlReq());
    // No item in input[] should have cache_control
    const hasAnyCacheControl = JSON.stringify(body).includes('cache_control');
    expect(hasAnyCacheControl).toBe(false);
  });

  it('tool_use_id toolu_* → call_*', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    const callItems = body.input.filter((i: any) => i.type === 'function_call');
    for (const c of callItems) {
      expect(c.call_id.startsWith('call_')).toBe(true);
      expect(c.call_id.startsWith('toolu_')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. OpenagenticToOpenAI
// ---------------------------------------------------------------------------

describe('OpenagenticToOpenAI', () => {
  const a = new OpenagenticToOpenAI();

  it('hoists system to role:system message at position 0', () => {
    const body: any = a.adaptRequest(basicTextReq());
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
  });

  it('tool_use blocks → assistant.tool_calls[] (NOT content-array-with-tool_use)', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg.tool_calls).toBeDefined();
    expect(assistantMsg.tool_calls).toHaveLength(2);
    expect(assistantMsg.tool_calls[0]).toMatchObject({
      id: 'call_abc',
      type: 'function',
      function: { name: 'aws_list', arguments: '{"region":"us-east-1"}' },
    });
  });

  it('tool_result blocks → N separate role:"tool" messages (NOT wrapped in user message)', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    const toolMsgs = body.messages.filter((m: any) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs[0]).toEqual({
      role: 'tool',
      tool_call_id: 'call_abc',
      content: 'aws result',
    });
    expect(toolMsgs[1].tool_call_id).toBe('call_xyz');
  });

  it('drops thinking blocks (no slot on OpenAI wire)', () => {
    const body: any = a.adaptRequest(thinkingReq());
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg.content).toBe('The answer is 42.');
    expect(JSON.stringify(body)).not.toContain('thinking');
  });

  it('strips cache_control', () => {
    const body: any = a.adaptRequest(cacheControlReq());
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });

  it('arguments is a JSON string, not an object', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    expect(typeof assistantMsg.tool_calls[0].function.arguments).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 4. OpenagenticToBedrock
// ---------------------------------------------------------------------------

describe('OpenagenticToBedrock', () => {
  const a = new OpenagenticToBedrock();

  it('renames tool_use → toolUse, tool_result → toolResult', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    const assistantMsg = body.messages[1];
    const toolUses = assistantMsg.content.filter((b: any) => b.toolUse);
    expect(toolUses).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('"tool_use"');
    expect(JSON.stringify(body)).not.toContain('"tool_result"');
  });

  it('tool_use_id stays canonical toolu_* (Bedrock-Anthropic preserves)', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    const assistantMsg = body.messages[1];
    const toolUses = assistantMsg.content.filter((b: any) => b.toolUse);
    expect(toolUses[0].toolUse.toolUseId).toBe('toolu_abc');
    expect(toolUses[1].toolUse.toolUseId).toBe('toolu_xyz');
  });

  it('tools wrapped in toolSpec, with inputSchema.json', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    expect(body.toolConfig.tools[0]).toMatchObject({
      toolSpec: {
        name: 'aws_list',
        description: 'list aws',
        inputSchema: { json: { type: 'object' } },
      },
    });
  });

  it('maxTokens lives under inferenceConfig', () => {
    const body: any = a.adaptRequest(basicTextReq());
    expect(body.inferenceConfig.maxTokens).toBe(1024);
    expect(body.max_tokens).toBeUndefined();
  });

  it('system prompt is an array of {text} (not {type:text, text})', () => {
    const body: any = a.adaptRequest(basicTextReq());
    expect(body.system).toEqual([{ text: 'You are helpful.' }]);
  });
});

// ---------------------------------------------------------------------------
// 5. OpenagenticToVertexGemini
// ---------------------------------------------------------------------------

describe('OpenagenticToVertexGemini', () => {
  const a = new OpenagenticToVertexGemini();

  it('uses contents[], not messages[]', () => {
    const body: any = a.adaptRequest(basicTextReq());
    expect(body.contents).toBeDefined();
    expect(body.messages).toBeUndefined();
  });

  it('renames assistant role → model', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    const modelContent = body.contents.find((c: any) => c.role === 'model');
    expect(modelContent).toBeDefined();
    const assistantContent = body.contents.find((c: any) => c.role === 'assistant');
    expect(assistantContent).toBeUndefined();
  });

  it('system prompt in system_instruction.parts (NOT a role)', () => {
    const body: any = a.adaptRequest(basicTextReq());
    expect(body.system_instruction).toEqual({ parts: [{ text: 'You are helpful.' }] });
    const hasSystemRole = body.contents.some((c: any) => c.role === 'system');
    expect(hasSystemRole).toBe(false);
  });

  it('tool_use → functionCall with args (NOT arguments JSON-string like OpenAI)', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    const modelContent = body.contents.find((c: any) => c.role === 'model');
    const functionCalls = modelContent.parts.filter((p: any) => p.functionCall);
    expect(functionCalls).toHaveLength(2);
    expect(functionCalls[0].functionCall).toEqual({
      name: 'aws_list',
      args: { region: 'us-east-1' },
    });
    expect(typeof functionCalls[0].functionCall.args).toBe('object');
  });

  it('tool_result → functionResponse with paired NAME from prior tool_use', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    const userResponses = body.contents.filter((c: any) => c.role === 'user');
    // Two user messages: initial prompt + tool results
    const respMsg = userResponses[1];
    const functionResponses = respMsg.parts.filter((p: any) => p.functionResponse);
    expect(functionResponses).toHaveLength(2);
    expect(functionResponses[0].functionResponse.name).toBe('aws_list');
    expect(functionResponses[1].functionResponse.name).toBe('azure_list');
  });

  it('tools wrapped in functionDeclarations array', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    expect(body.tools[0].functionDeclarations).toHaveLength(2);
  });

  it('drops thinking blocks', () => {
    const body: any = a.adaptRequest(thinkingReq());
    expect(JSON.stringify(body)).not.toContain('thinking');
  });
});

// ---------------------------------------------------------------------------
// 6. OpenagenticToOllama
// ---------------------------------------------------------------------------

describe('OpenagenticToOllama', () => {
  const a = new OpenagenticToOllama();

  it('system prompt is role:system at position 0', () => {
    const body: any = a.adaptRequest(basicTextReq());
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
  });

  it('tool_use → assistant.tool_calls[] with id field (call_*)', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg.tool_calls).toHaveLength(2);
    expect(assistantMsg.tool_calls[0].id).toBe('call_abc');
  });

  it('arguments is an OBJECT (not JSON-string like OpenAI)', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    expect(typeof assistantMsg.tool_calls[0].function.arguments).toBe('object');
    expect(assistantMsg.tool_calls[0].function.arguments).toEqual({ region: 'us-east-1' });
  });

  it('tool_result → role:tool with NO tool_call_id (paired by position)', () => {
    const body: any = a.adaptRequest(parallelToolBatchReq());
    const toolMsgs = body.messages.filter((m: any) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
    // Critical: NO tool_call_id field
    for (const t of toolMsgs) {
      expect(t.tool_call_id).toBeUndefined();
    }
    // Order matches the prior assistant tool_calls order
    expect(toolMsgs[0].content).toBe('aws result');
    expect(toolMsgs[1].content).toBe('azure result');
  });

  it('drops thinking blocks (no outbound slot)', () => {
    const body: any = a.adaptRequest(thinkingReq());
    expect(JSON.stringify(body)).not.toContain('thinking');
  });

  it('stream is true by default', () => {
    const body: any = a.adaptRequest(basicTextReq());
    expect(body.stream).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. selectOutboundAdapter() dispatch
// ---------------------------------------------------------------------------

describe('selectOutboundAdapter', () => {
  it('returns the correct adapter class per format', () => {
    expect(selectOutboundAdapter('anthropic')).toBeInstanceOf(OpenagenticToAnthropic);
    expect(selectOutboundAdapter('aif-responses')).toBeInstanceOf(OpenagenticToAIFResponses);
    expect(selectOutboundAdapter('openai')).toBeInstanceOf(OpenagenticToOpenAI);
    expect(selectOutboundAdapter('bedrock-anthropic')).toBeInstanceOf(OpenagenticToBedrock);
    expect(selectOutboundAdapter('vertex')).toBeInstanceOf(OpenagenticToVertexGemini);
    expect(selectOutboundAdapter('ollama')).toBeInstanceOf(OpenagenticToOllama);
  });

  it('vertex-anthropic + foundry-anthropic route through OpenagenticToAnthropic', () => {
    expect(selectOutboundAdapter('vertex-anthropic')).toBeInstanceOf(OpenagenticToAnthropic);
    expect(selectOutboundAdapter('foundry-anthropic')).toBeInstanceOf(OpenagenticToAnthropic);
  });
});
