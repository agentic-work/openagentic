/**
 * Hydration parity contract.
 *
 * `buildFinalContentBlocks` must hydrate viz_render + app_render blocks
 * from `Message.content_blocks` (canonical Json column added per the
 * typed-block migration) — never from `Message.visualizations[]`. The
 * visualizations column is dead for these two frame types; reads of it
 * would produce duplicate sidecar artifacts that the legacy parent-state
 * path used to pool, recreating the chronological-narrative break the
 * typed-block path fixed.
 *
 * The contract also documents which sources `buildFinalContentBlocks`
 * legitimately reads — `activityBlocks` (live streaming reducer output)
 * and `messageContent` (concatenated text_deltas) — and pins that it
 * does NOT pull viz/app data from `message.visualizations[]`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFinalContentBlocks } from '../buildFinalContentBlocks';
import type { ContentBlock } from '../../../hooks/useChatStream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = resolve(__dirname, '..', 'buildFinalContentBlocks.ts');

describe('buildFinalContentBlocks — hydration parity', () => {
  it('does not read viz_render / app_render data from Message.visualizations[]', () => {
    const src = readFileSync(SRC, 'utf8');
    // Stripping comments so a documentation reference doesn't count as
    // a real read. Block + line comment forms covered.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(codeOnly).not.toMatch(/\bvisualizations\b/);
  });

  it('preserves persisted viz_render + app_render blocks when activityBlocks already contains them', () => {
    const persistedBlocks: ContentBlock[] = [
      {
        id: 'viz-from-persisted',
        index: 0,
        type: 'viz_render',
        content: '<svg/>',
        isComplete: true,
        template: 'sankey',
        kind: 'chart',
      },
      {
        id: 'app-from-persisted',
        index: 1,
        type: 'app_render',
        content: '',
        html: '<html/>',
        isComplete: true,
      },
    ];
    const out = buildFinalContentBlocks({
      activityBlocks: persistedBlocks,
      messageContent: '',
      messageId: 'msg-1',
      isStreaming: false,
      hasSteps: true,
    });
    const types = out.map((b) => b.type);
    expect(types).toContain('viz_render');
    expect(types).toContain('app_render');
    expect(out.find((b) => b.id === 'viz-from-persisted')).toBeDefined();
    expect(out.find((b) => b.id === 'app-from-persisted')).toBeDefined();
  });

  it('does not duplicate viz_render or app_render blocks when message.content also carries prose', () => {
    const persistedBlocks: ContentBlock[] = [
      {
        id: 'viz-1',
        index: 0,
        type: 'viz_render',
        content: '<svg/>',
        isComplete: true,
        template: 'bar_chart',
        kind: 'chart',
      },
    ];
    const out = buildFinalContentBlocks({
      activityBlocks: persistedBlocks,
      messageContent: 'Trailing prose that would otherwise be appended.',
      messageId: 'msg-2',
      isStreaming: false,
      hasSteps: true,
    });
    const vizCount = out.filter((b) => b.type === 'viz_render').length;
    expect(vizCount).toBe(1);
  });
});
