/**
 * buildTree.canonical.test — Slice G.4a RED→GREEN
 *
 * SDK migration: buildTree must consume canonical Anthropic Messages SSE
 * events (`content_block_start` / `content_block_delta` / `content_block_stop`)
 * with type discrimination on `content_block.type` and `delta.type`.
 *
 * Canonical events come straight from the api wire (per the in-source comment
 * at completion-simple.stage.ts: "all providers now emit content_block_delta/
 * start/stop"). The synthetic `Normalized*` family is deprecated; this test
 * proves buildTree produces equivalent TreeNodes from canonical input.
 *
 * After Slice G.4 ships fully (canonical-only consumers + Normalized* RIP),
 * the legacy `buildTree.test.ts` switch-case tests can be deleted.
 */

import { describe, test, expect } from 'vitest';
import { buildTree } from './buildTree';

describe('buildTree — canonical content_block_* events (G.4a)', () => {
  test('canonical thinking block produces thinking TreeNode', () => {
    const events: any[] = [
      {
        type: 'message_start',
        message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'gpt-5.4', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'analyzing the question' },
      },
      {
        type: 'content_block_stop',
        index: 0,
      },
      { type: 'message_stop' },
    ];
    const tree = buildTree(events as any);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('thinking');
    expect(tree[0].status).toBe('success');
    expect(tree[0].data.content).toBe('analyzing the question');
  });

  test('canonical tool_use block produces tool TreeNode with stringified args', () => {
    const events: any[] = [
      { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'gpt-5.4', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_xyz', name: 'azure_list_subscriptions', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"tenant_id":' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"abc"}' },
      },
      {
        type: 'content_block_stop',
        index: 0,
      },
      { type: 'message_stop' },
    ];
    const tree = buildTree(events as any);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('tool');
    expect(tree[0].id).toBe('toolu_xyz');
    expect(tree[0].data.toolName).toBe('azure_list_subscriptions');
    expect(tree[0].data.args).toBe('{"tenant_id":"abc"}');
    expect(tree[0].status).toBe('success');
  });

  test('canonical text block does NOT produce tree node (text rendered separately)', () => {
    // Per the in-source comment in buildTree.ts: "text_start/delta/stop — SKIP.
    // Text rendering is handled by EnhancedMessageContent."
    const events: any[] = [
      { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'gpt-5.4', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello world' },
      },
      {
        type: 'content_block_stop',
        index: 0,
      },
      { type: 'message_stop' },
    ];
    const tree = buildTree(events as any);
    expect(tree).toHaveLength(0);
  });

  test('canonical interleaved thinking + tool_use produces both TreeNodes in order', () => {
    const events: any[] = [
      { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'gpt-5.4', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } },
      // Thinking block at index 0
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'I should call azure_*' } },
      { type: 'content_block_stop', index: 0 },
      // Tool_use block at index 1
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_q', name: 'azure_list_subscriptions', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_stop' },
    ];
    const tree = buildTree(events as any);
    expect(tree).toHaveLength(2);
    expect(tree[0].type).toBe('thinking');
    expect(tree[0].data.content).toBe('I should call azure_*');
    expect(tree[1].type).toBe('tool');
    expect(tree[1].data.toolName).toBe('azure_list_subscriptions');
  });

  // Slice G.4c — legacy Normalized* model-stream switch cases were ripped
  // from buildTree. The previous "legacy Normalized* events still work"
  // back-compat test was deleted; canonical-only is now the contract.
});
