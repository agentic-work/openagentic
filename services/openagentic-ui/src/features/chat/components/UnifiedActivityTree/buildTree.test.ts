/**
 * buildTree unit tests
 *
 * For all inquiries, please contact:
 *
 * Openagentic LLC
 * hello@openagentic.io
 */

import { describe, test, expect } from 'vitest';
import { buildTree } from './buildTree';
import type { NormalizedStreamEvent } from '../../../../types/AnthropicStreamEvent';

/**
 * Slice G.4c (2026-05-01) — buildTree consumes ONLY canonical
 * Anthropic Messages SSE events (content_block_*) for thinking/tool/text
 * blocks plus the platform envelope events (agent_*, hitl_*, artifact_*,
 * error). The synthetic Normalized* family was ripped from the consumer.
 *
 * Tests that previously asserted thinking_* / tool_* / text_* switch cases
 * were rewritten to canonical events. The now-deleted "thinking + text
 * produces flat sequence" test was already broken (text_* nodes are never
 * produced — text rendering is handled by EnhancedMessageContent).
 */

describe('buildTree', () => {
  test('empty events returns empty tree', () => {
    expect(buildTree([])).toEqual([]);
  });

  test('canonical thinking block produces thinking node with content + elapsed', () => {
    const events: any[] = [
      { type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: 'gpt-5.4', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'analyzing' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ];
    const tree = buildTree(events as NormalizedStreamEvent[]);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('thinking');
    expect(tree[0].status).toBe('success');
    expect(tree[0].data.content).toBe('analyzing');
    expect(typeof tree[0].data.elapsedMs).toBe('number');
  });

  test('canonical tool_use start/delta/stop produces tool node with args and success', () => {
    const events: any[] = [
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'list_pods', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"ns":' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"default"}' } },
      { type: 'content_block_stop', index: 0 },
    ];
    const tree = buildTree(events as NormalizedStreamEvent[]);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('tool');
    expect(tree[0].id).toBe('t1');
    expect(tree[0].data.toolName).toBe('list_pods');
    expect(tree[0].data.args).toBe('{"ns":"default"}');
    expect(tree[0].status).toBe('success');
  });

  test('agent_start creates nested branch with canonical tool child', () => {
    const events: any[] = [
      { type: 'agent_start', id: 'a1', name: 'infra-agent', role: 'infrastructure' },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'list_pods', input: {} } },
      { type: 'content_block_stop', index: 0 },
      { type: 'agent_stop', id: 'a1', durationMs: 5000, tokensIn: 1000, tokensOut: 500, cost: 0.01 },
    ];
    const tree = buildTree(events as NormalizedStreamEvent[]);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('agent');
    expect(tree[0].data.name).toBe('infra-agent');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].type).toBe('tool');
    expect(tree[0].children[0].data.toolName).toBe('list_pods');
  });

  test('hitl_request without response marks node as pending', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'hitl_request', id: 'h1', tool: 'oat_scan', description: 'CIS scan', scope: 'read-only', metadata: {} },
    ];
    const tree = buildTree(events);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('hitl');
    expect(tree[0].status).toBe('pending');
  });

  test('hitl_response updates status', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'hitl_request', id: 'h1', tool: 'oat_scan', description: 'CIS scan', scope: 'read-only', metadata: {} },
      { type: 'hitl_response', id: 'h1', approved: true, waitMs: 3000 },
    ];
    const tree = buildTree(events);
    expect(tree[0].status).toBe('success');
  });

  test('hitl_response denied sets status to error', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'hitl_request', id: 'h1', tool: 'oat_scan', description: 'CIS scan', scope: 'read-only', metadata: {} },
      { type: 'hitl_response', id: 'h1', approved: false, waitMs: 3000 },
    ];
    const tree = buildTree(events);
    expect(tree[0].status).toBe('error');
  });

  test('artifact produces artifact node with content', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'artifact_start', id: 'art1', artifactType: 'html', title: 'Dashboard' },
      { type: 'artifact_delta', id: 'art1', content: '<div>chart</div>' },
      { type: 'artifact_stop', id: 'art1', sizeBytes: 1024 },
    ];
    const tree = buildTree(events);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('artifact');
    expect(tree[0].data.content).toBe('<div>chart</div>');
    expect(tree[0].data.sizeBytes).toBe(1024);
  });

  test('error event creates error node', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'error', code: 'RATE_LIMIT', message: 'Too many requests', retryable: true },
    ];
    const tree = buildTree(events);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('error');
    expect(tree[0].data.code).toBe('RATE_LIMIT');
  });

  test('streaming canonical thinking node has running status until stop', () => {
    const events: any[] = [
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'analyzing...' } },
    ];
    const tree = buildTree(events as NormalizedStreamEvent[]);
    expect(tree[0].status).toBe('running');
  });

  test('canonical tool inside agent_start nests under that agent on stack', () => {
    const events: any[] = [
      { type: 'agent_start', id: 'a1', name: 'test-agent', role: 'test' },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'read_file', input: {} } },
      { type: 'content_block_stop', index: 0 },
      { type: 'agent_stop', id: 'a1', durationMs: 500, tokensIn: 50, tokensOut: 20, cost: 0.001 },
    ];
    const tree = buildTree(events as NormalizedStreamEvent[]);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('agent');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].type).toBe('tool');
  });

  test('multiple errors create separate error nodes', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'error', code: 'ERR_1', message: 'first error', retryable: false },
      { type: 'error', code: 'ERR_2', message: 'second error', retryable: true },
    ];
    const tree = buildTree(events);
    expect(tree).toHaveLength(2);
    expect(tree[0].data.code).toBe('ERR_1');
    expect(tree[1].data.code).toBe('ERR_2');
  });

  test('nested agents via parentId', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'agent_start', id: 'parent', name: 'orchestrator', role: 'orchestrator' },
      { type: 'agent_start', id: 'child', name: 'worker', role: 'worker', parentId: 'parent' },
      { type: 'agent_stop', id: 'child', durationMs: 1000, tokensIn: 100, tokensOut: 50, cost: 0.002 },
      { type: 'agent_stop', id: 'parent', durationMs: 2000, tokensIn: 200, tokensOut: 100, cost: 0.004 },
    ];
    const tree = buildTree(events);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('agent');
    expect(tree[0].data.name).toBe('orchestrator');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].data.name).toBe('worker');
  });

  test('agent_stop updates durationMs, tokensIn, tokensOut, cost', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'agent_start', id: 'a1', name: 'agent', role: 'role' },
      { type: 'agent_stop', id: 'a1', durationMs: 7500, tokensIn: 2000, tokensOut: 800, cost: 0.05 },
    ];
    const tree = buildTree(events);
    expect(tree[0].data.durationMs).toBe(7500);
    expect(tree[0].data.tokensIn).toBe(2000);
    expect(tree[0].data.tokensOut).toBe(800);
    expect(tree[0].data.cost).toBe(0.05);
    expect(tree[0].status).toBe('success');
  });

  test('stream_start, stream_end, usage are ignored', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'stream_start', messageId: 'm1', model: 'gpt-4', provider: 'openai' },
      { type: 'usage', tokensIn: 100, tokensOut: 50, cost: 0.01, contextUsed: 1000, contextMax: 128000 },
      { type: 'stream_end', finishReason: 'stop', totalDurationMs: 5000 },
    ];
    const tree = buildTree(events);
    expect(tree).toHaveLength(0);
  });

  test('artifact title and type are preserved', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'artifact_start', id: 'art2', artifactType: 'markdown', title: 'Report' },
      { type: 'artifact_stop', id: 'art2', sizeBytes: 512 },
    ];
    const tree = buildTree(events);
    expect(tree[0].data.artifactType).toBe('markdown');
    expect(tree[0].data.title).toBe('Report');
  });

  test('multiple artifact_delta events concatenate content', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'artifact_start', id: 'art3', artifactType: 'html', title: 'Page' },
      { type: 'artifact_delta', id: 'art3', content: '<html>' },
      { type: 'artifact_delta', id: 'art3', content: '<body>' },
      { type: 'artifact_delta', id: 'art3', content: '</body></html>' },
      { type: 'artifact_stop', id: 'art3', sizeBytes: 30 },
    ];
    const tree = buildTree(events);
    expect(tree[0].data.content).toBe('<html><body></body></html>');
  });
});
