/**
 * Sev-0 #924 + #925 + #926 — stream and finalized assistant DOM must be
 * byte-identical.
 *
 * Root cause: at `done` time, `useChatStream.ts` (~line 5751) filters
 * `contentBlocksRef.current` to keep only `thinking` and `tool_use` blocks.
 * Every other type — `text`, `viz_render`, `app_render`, `streaming_table`,
 * `follow_up`, `sub_agent`, `hitl_approval`, `tool_round`, `tool_result` —
 * is DROPPED. The dispatched onMessage payload also omits `content_blocks`
 * entirely, so the server never persists the chronology and the UI never
 * rehydrates on reload.
 *
 * Fix layers:
 *   1. Extract a pure helper `buildDoneMessagePayload` that preserves ALL
 *      block types AND includes `content_blocks: ContentBlock[]` on the
 *      onMessage payload.
 *   2. Wire it in useChatStream's `done` case (replace inline filter).
 *   3. Pass `content_blocks` through useChatStore.addMessage / updateMessage.
 *   4. MessageBubble reads message.content_blocks when present (rehydration).
 *
 * These tests are RED on main, GREEN after fix.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import {
  buildDoneMessagePayload,
  type DoneMessagePayloadInputs,
} from '../buildDoneMessagePayload';

import type { ContentBlock } from '../useChatStream';

const SEVEN_BLOCK_CHRONOLOGY: ContentBlock[] = [
  {
    id: 'b-0',
    index: 0,
    type: 'thinking',
    content: 'Let me figure this out',
    isComplete: true,
    timestamp: 100,
    startTime: 100,
    duration: 800,
  },
  {
    id: 'b-1',
    index: 1,
    type: 'text',
    content: 'Good — let me start',
    isComplete: true,
    timestamp: 200,
    startTime: 200,
  },
  {
    id: 'b-2',
    index: 2,
    type: 'tool_use',
    content: '{"name":"azure_list_subscriptions"}',
    toolName: 'azure_list_subscriptions',
    toolId: 'tu-2',
    isComplete: true,
    timestamp: 300,
    startTime: 300,
    duration: 400,
  },
  {
    id: 'b-3',
    index: 3,
    type: 'text',
    content: 'Now firing parallel cost tools',
    isComplete: true,
    timestamp: 700,
    startTime: 700,
  },
  {
    id: 'b-4',
    index: 4,
    type: 'tool_use',
    content: '{"query":"costs"}',
    toolName: 'azure_cost_query',
    toolId: 'tu-4',
    isComplete: true,
    timestamp: 800,
    startTime: 800,
    duration: 500,
  },
  {
    id: 'b-5',
    index: 5,
    type: 'viz_render',
    content: '<svg>sankey</svg>',
    template: 'sankey',
    kind: 'svg',
    isComplete: true,
    timestamp: 1400,
    startTime: 1400,
  },
  {
    id: 'b-6',
    index: 6,
    type: 'text',
    content: "Here's the breakdown",
    isComplete: true,
    timestamp: 1500,
    startTime: 1500,
  },
];

function baseInputs(blocks: ContentBlock[]): DoneMessagePayloadInputs {
  return {
    contentBlocks: blocks,
    assistantMessage: 'flat fallback text',
    mcpCalls: [],
    cotSteps: [],
    extractedThinking: '',
    currentThinking: '',
    messageId: 'msg-test-1',
    safeData: {},
    responseModel: 'sonnet-4-6',
    pipelineState: { stageTiming: {}, activeToolRound: 0 },
  };
}

describe('buildDoneMessagePayload — Sev-0 #924/#925/#926 content_blocks parity', () => {
  it('preserves ALL content_block types in chronological order on done finalize', () => {
    const payload = buildDoneMessagePayload(baseInputs(SEVEN_BLOCK_CHRONOLOGY));
    expect(payload).not.toBeNull();
    expect(payload!.content_blocks).toBeDefined();
    expect(Array.isArray(payload!.content_blocks)).toBe(true);
    // SAME COUNT as source — no filtering on type.
    expect(payload!.content_blocks!.length).toBe(SEVEN_BLOCK_CHRONOLOGY.length);
    // SAME ORDER — no reordering. Source ts: 100,200,300,700,800,1400,1500.
    const types = payload!.content_blocks!.map((b) => b.type);
    expect(types).toEqual([
      'thinking',
      'text',
      'tool_use',
      'text',
      'tool_use',
      'viz_render',
      'text',
    ]);
    // SAME IDS — preserves block.id.
    const ids = payload!.content_blocks!.map((b) => b.id);
    expect(ids).toEqual(['b-0', 'b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6']);
  });

  it('includes viz_render + app_render + streaming_table blocks (no artifact dropping)', () => {
    const artifactChronology: ContentBlock[] = [
      {
        id: 't-0',
        index: 0,
        type: 'text',
        content: 'opening',
        isComplete: true,
      },
      {
        id: 'v-1',
        index: 1,
        type: 'viz_render',
        content: '<svg>sankey</svg>',
        template: 'sankey',
        kind: 'svg',
        isComplete: true,
      },
      {
        id: 't-2',
        index: 2,
        type: 'text',
        content: 'middle',
        isComplete: true,
      },
      {
        id: 'a-3',
        index: 3,
        type: 'app_render',
        content: '',
        html: '<div>x</div>',
        kind: 'html',
        isComplete: true,
      },
      {
        id: 't-4',
        index: 4,
        type: 'text',
        content: 'after',
        isComplete: true,
      },
      // streaming_table emitted via tool_use carrier with outputTemplate
      // OR via the deriveFlatMessage path's typed-block extension; the
      // helper must preserve whatever type label the reducer assigned.
      {
        id: 's-5',
        index: 5,
        // Using a representative artifact type allowed by ContentBlock.type
        // — the contract is "preserve every type", not "limit to canonical".
        type: 'tool_use' as any,
        toolName: 'streaming_table',
        content: '{"columns":["a","b"]}',
        result: { rows: [{ a: 1, b: 2 }] },
        outputTemplate: 'streaming_table',
        isComplete: true,
      },
    ];
    const payload = buildDoneMessagePayload(baseInputs(artifactChronology));
    expect(payload).not.toBeNull();
    const cbs = payload!.content_blocks!;
    const types = cbs.map((b) => b.type);
    expect(types).toContain('viz_render');
    expect(types).toContain('app_render');
    // streaming_table is carried as tool_use (with outputTemplate); the
    // tool_use block must survive AND its outputTemplate must travel through.
    const stBlock = cbs.find((b) => b.id === 's-5');
    expect(stBlock).toBeDefined();
    expect(stBlock!.outputTemplate).toBe('streaming_table');
    // viz_render block payload survives intact.
    const vizBlock = cbs.find((b) => b.id === 'v-1');
    expect(vizBlock).toBeDefined();
    expect(vizBlock!.type).toBe('viz_render');
    expect(vizBlock!.content).toBe('<svg>sankey</svg>');
    expect((vizBlock as any).template).toBe('sankey');
    // app_render block payload survives intact.
    const appBlock = cbs.find((b) => b.id === 'a-3');
    expect(appBlock).toBeDefined();
    expect(appBlock!.type).toBe('app_render');
    expect((appBlock as any).html).toBe('<div>x</div>');
  });

  it('renders text blocks with markdown payload preserved (GFM tables, headings, lists, code)', () => {
    const md = '# H1\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- item\n\n```ts\nconst x=1;\n```';
    const blocks: ContentBlock[] = [
      {
        id: 't-md',
        index: 0,
        type: 'text',
        content: md,
        isComplete: true,
      },
    ];
    const payload = buildDoneMessagePayload(baseInputs(blocks));
    expect(payload).not.toBeNull();
    const tb = payload!.content_blocks!.find((b) => b.id === 't-md');
    expect(tb).toBeDefined();
    // The full markdown source must survive — MessageBubble + AAS will
    // route it through SharedMarkdownRenderer for GFM + Shiki rendering.
    expect(tb!.content).toBe(md);
    expect(tb!.type).toBe('text');
  });

  it('does not collapse text blocks into the flat `content` string — both fields populated', () => {
    const payload = buildDoneMessagePayload(baseInputs(SEVEN_BLOCK_CHRONOLOGY));
    expect(payload).not.toBeNull();
    // The legacy `content` field still gets the formatted assistantMessage
    // for back-compat with any consumer that hasn't migrated to content_blocks.
    expect(typeof payload!.content).toBe('string');
    // But content_blocks must ALSO be populated with each text block
    // as its own structured entry — not just concatenated into content.
    const textCount = payload!.content_blocks!.filter((b) => b.type === 'text').length;
    expect(textCount).toBe(3);
  });

  it('falls back to the italic placeholder when there is nothing to render (matches pre-fix empty-completion contract)', () => {
    const payload = buildDoneMessagePayload({
      contentBlocks: [],
      assistantMessage: '',
      mcpCalls: [],
      cotSteps: [],
      extractedThinking: '',
      currentThinking: '',
      messageId: 'msg-empty',
      safeData: {},
      responseModel: undefined,
      pipelineState: { stageTiming: {}, activeToolRound: 0 },
    });
    // The fallback content carries the italic placeholder — same as the
    // pre-fix behavior at resolveEmptyCompletionFallback (usedFallback:true).
    expect(payload).not.toBeNull();
    expect(payload!.content).toMatch(/finished without producing an answer/i);
    // content_blocks must be undefined (empty array — nothing to persist).
    expect(payload!.content_blocks).toBeUndefined();
  });
});

describe('useChatStream — source-level wire-in of buildDoneMessagePayload', () => {
  const src = readFileSync(
    join(__dirname, '..', 'useChatStream.ts'),
    'utf8',
  );

  it('imports buildDoneMessagePayload from sibling module', () => {
    expect(src).toMatch(
      /from\s+['"]\.\/buildDoneMessagePayload['"]/,
    );
  });

  it('calls buildDoneMessagePayload in the done/stream_complete handler', () => {
    expect(src).toMatch(/buildDoneMessagePayload\s*\(/);
  });

  it('removes the legacy type-filter that dropped non-thinking / non-tool blocks', () => {
    // The pre-fix code had this exact filter at the done case (~line 5752):
    //   .filter(b => (b.type === 'thinking' || b.type === 'tool_use') && (b.content || b.toolName))
    // After the fix the filter is gone — buildDoneMessagePayload preserves all types.
    expect(src).not.toMatch(
      /\.filter\(\s*b\s*=>\s*\(\s*b\.type\s*===\s*['"]thinking['"]\s*\|\|\s*b\.type\s*===\s*['"]tool_use['"]\s*\)/,
    );
  });

  it('passes content_blocks through to the onMessage payload (in the helper)', () => {
    // The done case calls `buildDoneMessagePayload` which must emit a
    // `content_blocks` field (snake_case canonical matching
    // Message.content_blocks Json column) on the returned payload.
    const helperSrc = readFileSync(
      join(__dirname, '..', 'buildDoneMessagePayload.ts'),
      'utf8',
    );
    expect(helperSrc).toMatch(/content_blocks\s*:/);
  });
});
