/**
 * Sev-0 #924/#925/#926 — server-side content_blocks chronology accumulator.
 *
 * Mirrors the client-side `applyCanonicalFrame` reducer so the persisted
 * `chat_messages.content_blocks` Json column carries the same chronology
 * the live stream rendered. Without this, the post-`done` rehydrated DOM
 * loses every interleaved text block, viz_render iframe, app_render iframe,
 * follow_up chip row, and tool input/result correlation.
 */

import { describe, it, expect } from 'vitest';
import { createContentBlocksAccumulator } from '../contentBlocksAccumulator';

describe('contentBlocksAccumulator', () => {
  it('preserves chronological order across text + tool + artifact frames', () => {
    const acc = createContentBlocksAccumulator();

    acc.consume('thinking_event', { text: 'Let me think' });
    acc.consume('thinking_complete', {});
    acc.consume('assistant_message_delta', { text: 'Good — firing tools' });
    acc.consume('tool_executing', {
      tool_use_id: 'tu-1',
      name: 'azure_list_subscriptions',
      input: {},
    });
    acc.consume('tool_result', {
      tool_use_id: 'tu-1',
      content: { summary: 'sub-list', data: [{ id: '1' }] },
    });
    acc.consume('assistant_message_delta', { text: ' Now visualizing' });
    acc.consume('visual_render', {
      artifact_id: 'viz-1',
      template: 'sankey',
      kind: 'svg',
      content: '<svg/>',
    });
    acc.consume('assistant_message_delta', { text: ' Final synthesis' });

    const blocks = acc.snapshot();
    const types = blocks.map((b) => b.type);
    expect(types).toEqual([
      'thinking',
      'text',
      'tool_use',
      'text',
      'viz_render',
      'text',
    ]);
  });

  it('completes tool blocks on tool_result with result + duration', () => {
    const acc = createContentBlocksAccumulator();
    acc.consume('tool_executing', {
      tool_use_id: 'tu-x',
      name: 'foo',
      input: { a: 1 },
    });
    acc.consume('tool_result', {
      tool_use_id: 'tu-x',
      content: { summary: 'ok', data: { result: 'yes' } },
    });
    const blocks = acc.snapshot();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('tool_use');
    expect(blocks[0].isComplete).toBe(true);
    expect(blocks[0].toolId).toBe('tu-x');
    expect(blocks[0].toolName).toBe('foo');
    expect((blocks[0].result as any)?.summary).toBe('ok');
  });

  it('flags tool blocks with error on tool_error', () => {
    const acc = createContentBlocksAccumulator();
    acc.consume('tool_executing', { tool_use_id: 'tu-y', name: 'bar' });
    acc.consume('tool_error', { tool_use_id: 'tu-y', error: 'boom' });
    const blocks = acc.snapshot();
    expect(blocks[0].error).toBe('boom');
    expect(blocks[0].isComplete).toBe(true);
  });

  it('appends viz_render and app_render with payload fields', () => {
    const acc = createContentBlocksAccumulator();
    acc.consume('visual_render', {
      artifact_id: 'viz-a',
      template: 'kpi_grid',
      kind: 'html',
      content: '<div>kpi</div>',
      title: 'KPI',
    });
    acc.consume('app_render', {
      artifact_id: 'app-a',
      html: '<html><body>x</body></html>',
      title: 'Mini app',
      pyodide_required: false,
    });
    const blocks = acc.snapshot();
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: 'viz_render',
      content: '<div>kpi</div>',
      template: 'kpi_grid',
      kind: 'html',
      title: 'KPI',
    });
    expect(blocks[1]).toMatchObject({
      type: 'app_render',
      html: '<html><body>x</body></html>',
      title: 'Mini app',
      pyodideRequired: undefined, // false → not set
    });
  });

  it('hot-swaps viz_render blocks by group_id (replace, not append)', () => {
    const acc = createContentBlocksAccumulator();
    acc.consume('visual_render', {
      artifact_id: 'v1',
      template: 'sankey',
      kind: 'svg',
      content: '<svg>v1</svg>',
      group_id: 'g1',
    });
    acc.consume('visual_render', {
      artifact_id: 'v2',
      template: 'sankey',
      kind: 'svg',
      content: '<svg>v2</svg>',
      group_id: 'g1',
    });
    const blocks = acc.snapshot();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('<svg>v2</svg>');
    expect(blocks[0].groupId).toBe('g1');
  });

  it('appends a single follow_up chip-row block, clamped to <=5 items', () => {
    const acc = createContentBlocksAccumulator();
    acc.consume('assistant_message_delta', { text: 'ok' });
    acc.consume('follow_up', {
      items: ['a', 'b', 'c', 'd', 'e', 'f', '   '],
    });
    const blocks = acc.snapshot();
    const followUp = blocks.find((b) => b.type === 'follow_up');
    expect(followUp).toBeDefined();
    expect(followUp!.items).toEqual(['a', 'b', 'c', 'd', 'e']);
    // Single chip row even if emitted twice.
    acc.consume('follow_up', { items: ['x', 'y'] });
    const blocks2 = acc.snapshot();
    expect(blocks2.filter((b) => b.type === 'follow_up')).toHaveLength(1);
    expect(blocks2.find((b) => b.type === 'follow_up')!.items).toEqual(['x', 'y']);
  });

  it('ignores frames that do not contribute to the chronology', () => {
    const acc = createContentBlocksAccumulator();
    acc.consume('pipeline_stage', { stage: 'prompt' });
    acc.consume('model_info', { model: 'sonnet' });
    acc.consume('ping', {});
    acc.consume('metrics_update', {});
    const blocks = acc.snapshot();
    expect(blocks).toHaveLength(0);
  });

  it('#1021 — accumulates thinking from content_block_delta envelope with thinking_delta inner (Anthropic canonical wire shape)', () => {
    // Live evidence: chat_messages.content_blocks for 4 most-recent assistant
    // messages had types=['follow_up','text','tool_use'] — NO 'thinking' —
    // despite the UI rendering thinking blocks live mid-stream. UI's
    // applyCanonicalFrame.ts:172 handles this exact frame shape; the server
    // accumulator did not. Result: reload drops every thinking block across
    // all turns (Q18 evidence Q-loop 2026-05-21).
    const acc = createContentBlocksAccumulator();
    acc.consume('content_block_delta', {
      delta: { type: 'thinking_delta', thinking: 'Let me think about this' },
    });
    acc.consume('content_block_delta', {
      delta: { type: 'thinking_delta', thinking: ' carefully.' },
    });
    acc.consume('thinking_complete', {});
    const blocks = acc.snapshot();
    const thinking = blocks.filter((b) => b.type === 'thinking');
    expect(thinking).toHaveLength(1);
    expect(thinking[0].content).toBe('Let me think about this carefully.');
    expect(thinking[0].isComplete).toBe(true);
  });

  it('#1021 — content_block_delta without thinking_delta inner is a no-op (text_delta path handled via content_delta/stream)', () => {
    const acc = createContentBlocksAccumulator();
    acc.consume('content_block_delta', { delta: { type: 'text_delta', text: 'hello' } });
    acc.consume('content_block_delta', { delta: {} });
    acc.consume('content_block_delta', {});
    const blocks = acc.snapshot();
    expect(blocks).toHaveLength(0);
  });
});
