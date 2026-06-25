/**
 * Tests for buildAifResponsesBody — pins the AIF Responses API wire shape
 * after Phase 0.4 migrated wire-shape construction to the SDK adapter.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAifResponsesBody,
  filterOrphanFunctionCallOutputs,
} from '../buildAifResponsesBody.js';
import type { CompletionRequest } from '../../ILLMProvider.js';

const baseOpts = {
  deployment: 'gpt-5.4',
};

describe('buildAifResponsesBody', () => {
  it('basic text turn: model + stream + input[user] + instructions + max_output_tokens', () => {
    const body = buildAifResponsesBody(
      {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi.' },
        ],
        max_tokens: 256,
      } as CompletionRequest,
      baseOpts,
    );

    expect(body.model).toBe('gpt-5.4');
    expect(body.stream).toBe(true);
    expect(body.instructions).toBe('You are helpful.');
    expect(body.max_output_tokens).toBe(256);
    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'Hi.' }] },
    ]);
  });

  it('Sev-0 #774 parallel tool batch: N function_call items followed by N function_call_output items', () => {
    const body = buildAifResponsesBody(
      {
        messages: [
          { role: 'user', content: 'list buckets in 3 clouds' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'call_aws', type: 'function', function: { name: 'aws_ls', arguments: '{}' } },
              { id: 'call_gcp', type: 'function', function: { name: 'gcp_ls', arguments: '{}' } },
              { id: 'call_azure', type: 'function', function: { name: 'azure_ls', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'call_aws', content: 'bucket1' },
          { role: 'tool', tool_call_id: 'call_gcp', content: 'bucket2' },
          { role: 'tool', tool_call_id: 'call_azure', content: 'bucket3' },
        ],
        max_tokens: 1024,
      } as CompletionRequest,
      baseOpts,
    );

    const input = body.input as Array<any>;
    // user + 3 function_call + 3 function_call_output
    expect(input.length).toBe(7);
    expect(input[0].role).toBe('user');
    expect(input[1].type).toBe('function_call');
    expect(input[1].call_id).toBe('call_aws');
    expect(input[2].type).toBe('function_call');
    expect(input[2].call_id).toBe('call_gcp');
    expect(input[3].type).toBe('function_call');
    expect(input[3].call_id).toBe('call_azure');
    expect(input[4].type).toBe('function_call_output');
    expect(input[4].call_id).toBe('call_aws');
    expect(input[5].type).toBe('function_call_output');
    expect(input[5].call_id).toBe('call_gcp');
    expect(input[6].type).toBe('function_call_output');
    expect(input[6].call_id).toBe('call_azure');
  });

  it('thinking block → reasoning item with summary_text', () => {
    const body = buildAifResponsesBody(
      {
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'let me think', signature: 'sig' },
              { type: 'text', text: 'answer' },
            ],
          },
        ],
        max_tokens: 100,
      } as CompletionRequest,
      baseOpts,
    );

    const input = body.input as Array<any>;
    expect(input[0]).toEqual({
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: 'let me think' }],
    });
    expect(input[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'output_text', text: 'answer' }],
    });
  });

  it('tools: passed through with normalizeAifToolParameters applied', () => {
    const body = buildAifResponsesBody(
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
      } as CompletionRequest,
      baseOpts,
    );

    const tools = body.tools as Array<any>;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('ls');
    expect(tools[0].description).toBe('List files');
    expect(tools[0].type).toBe('function');
    expect(tools[0].parameters.type).toBe('object');
  });

  it('reasoningEffort: emitted as reasoning.effort', () => {
    const body = buildAifResponsesBody(
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 } as CompletionRequest,
      { ...baseOpts, reasoningEffort: 'high' },
    );
    expect((body.reasoning as any).effort).toBe('high');
  });

  it('!reasoningEffort: no reasoning key on wire', () => {
    const body = buildAifResponsesBody(
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 } as CompletionRequest,
      baseOpts,
    );
    expect('reasoning' in body).toBe(false);
  });

  it('maxOutputTokensOverride: wins over wire.max_output_tokens', () => {
    const body = buildAifResponsesBody(
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 } as CompletionRequest,
      { ...baseOpts, maxOutputTokensOverride: 50_000 },
    );
    expect(body.max_output_tokens).toBe(50_000);
  });

  it('stream=false honored', () => {
    const body = buildAifResponsesBody(
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 } as CompletionRequest,
      { ...baseOpts, stream: false },
    );
    expect(body.stream).toBe(false);
  });
});

describe('filterOrphanFunctionCallOutputs', () => {
  it('drops function_call_output whose call_id has no preceding function_call', () => {
    const out = filterOrphanFunctionCallOutputs([
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      { type: 'function_call_output', call_id: 'call_orphan', output: 'stale' },
      { type: 'function_call', call_id: 'call_real', name: 'f', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_real', output: 'result' },
    ]);

    expect(out.length).toBe(3);
    expect(out[1].type).toBe('function_call');
    expect(out[2].type).toBe('function_call_output');
    expect(out[2].call_id).toBe('call_real');
  });

  it('drops function_call_output with empty call_id', () => {
    const out = filterOrphanFunctionCallOutputs([
      { type: 'function_call_output', call_id: '', output: 'nope' },
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    ]);
    expect(out).toHaveLength(1);
    expect((out[0] as any).role).toBe('user');
  });

  it('keeps paired items in order', () => {
    const input = [
      { type: 'function_call', call_id: 'c1', name: 'a', arguments: '{}' },
      { type: 'function_call', call_id: 'c2', name: 'b', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: '1' },
      { type: 'function_call_output', call_id: 'c2', output: '2' },
    ];
    expect(filterOrphanFunctionCallOutputs(input)).toEqual(input);
  });
});
