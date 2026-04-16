/**
 * buildTree unit tests
 *
 * For all inquiries, please contact:
 * * hello@openagentic.io
 */

import { describe, test, expect } from 'vitest';
import { buildTree } from './buildTree';
import type { NormalizedStreamEvent } from '../../../../types/NormalizedStreamTypes';

describe('buildTree', () => {
  test('empty events returns empty tree', () => {
    expect(buildTree([])).toEqual([]);
  });

  test('thinking + text produces flat sequence', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'stream_start', messageId: 'm1', model: 'gpt-41', provider: 'aif' },
      { type: 'thinking_start', id: 'tk1' },
      { type: 'thinking_delta', id: 'tk1', content: 'analyzing', accumulated: 'analyzing' },
      { type: 'thinking_stop', id: 'tk1', elapsedMs: 2000 },
      { type: 'text_start', id: 'tx1' },
      { type: 'text_delta', id: 'tx1', content: 'Hello' },
      { type: 'text_stop', id: 'tx1' },
      { type: 'stream_end', finishReason: 'stop', totalDurationMs: 3000 },
    ];
    const tree = buildTree(events);
    expect(tree).toHaveLength(2);
    expect(tree[0].type).toBe('thinking');
    expect(tree[0].status).toBe('success');
    expect(tree[0].data.content).toBe('analyzing');
    expect(tree[0].data.elapsedMs).toBe(2000);
    expect(tree[1].type).toBe('text');
    expect(tree[1].status).toBe('success');
    expect(tree[1].data.content).toBe('Hello');
  });

  test('tool start/delta/stop produces tool node with args and result', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'tool_start', id: 't1', toolName: 'list_pods', serverName: 'k8s' },
      { type: 'tool_delta', id: 't1', argsFragment: '{"ns":' },
      { type: 'tool_delta', id: 't1', argsFragment: '"default"}' },
      { type: 'tool_stop', id: 't1', result: { pods: 3 }, durationMs: 1200 },
    ];
    const tree = buildTree(events);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('tool');
    expect(tree[0].data.toolName).toBe('list_pods');
    expect(tree[0].data.args).toBe('{"ns":"default"}');
    expect(tree[0].data.result).toEqual({ pods: 3 });
    expect(tree[0].data.durationMs).toBe(1200);
  });

  test('agent_start creates nested branch with tool children', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'agent_start', id: 'a1', name: 'infra-agent', role: 'infrastructure' },
      { type: 'tool_start', id: 't1', toolName: 'list_pods', serverName: 'k8s', agentId: 'a1' },
      { type: 'tool_stop', id: 't1', result: {}, durationMs: 1200 },
      { type: 'agent_stop', id: 'a1', durationMs: 5000, tokensIn: 1000, tokensOut: 500, cost: 0.01 },
    ];
    const tree = buildTree(events);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('agent');
    expect(tree[0].data.name).toBe('infra-agent');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].type).toBe('tool');
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

  test('streaming thinking node has running status', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'thinking_start', id: 'tk1' },
      { type: 'thinking_delta', id: 'tk1', content: 'analyzing...', accumulated: 'analyzing...' },
    ];
    const tree = buildTree(events);
    expect(tree[0].status).toBe('running');
  });

  test('tool without agentId goes to active agent on stack', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'agent_start', id: 'a1', name: 'test-agent', role: 'test' },
      { type: 'tool_start', id: 't1', toolName: 'read_file', serverName: 'fs' },
      { type: 'tool_stop', id: 't1', result: 'ok', durationMs: 100 },
      { type: 'agent_stop', id: 'a1', durationMs: 500, tokensIn: 50, tokensOut: 20, cost: 0.001 },
    ];
    const tree = buildTree(events);
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

  test('stream_start, stream_end, usage, redacted_thinking are ignored', () => {
    const events: NormalizedStreamEvent[] = [
      { type: 'stream_start', messageId: 'm1', model: 'gpt-4', provider: 'openai' },
      { type: 'usage', tokensIn: 100, tokensOut: 50, cost: 0.01, contextUsed: 1000, contextMax: 128000 },
      { type: 'redacted_thinking', id: 'rt1', signature: 'sig123' },
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
