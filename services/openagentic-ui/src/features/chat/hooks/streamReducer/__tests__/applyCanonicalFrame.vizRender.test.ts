/**
 * RED-first contract for `visual_render` + `app_render` wire frames
 * folded into ContentBlock[] by `applyCanonicalFrame`.
 *
 * Routing pattern (mirrors how sub_agent already routes through this
 * reducer):
 *   - `visual_render` → ContentBlock { type: 'viz_render' }
 *   - `app_render`    → ContentBlock { type: 'app_render' }
 *   - `artifact_render` → routed via `kind`:
 *       react / html / python_plot → app_render block
 *       svg                        → viz_render block
 *
 * group_id is the hot-swap key — re-emitting a frame with the same
 * group_id REPLACES the existing block at its current index (preserves
 * chronological position), not append.
 */

import { describe, it, expect } from 'vitest';
import {
  applyCanonicalFrame,
  initialFrameState,
  type FrameState,
} from '../applyCanonicalFrame';

describe('applyCanonicalFrame — visual_render', () => {
  it('appends a viz_render ContentBlock with template + kind + content', () => {
    const next = applyCanonicalFrame(initialFrameState(), {
      type: 'visual_render',
      _ts: 100,
      artifact_id: 'abc',
      template: 'sankey',
      kind: 'chart',
      content: '<svg/>',
      title: 'Cost flow',
    });
    expect(next.contentBlocks).toHaveLength(1);
    const b = next.contentBlocks[0];
    expect(b.type).toBe('viz_render');
    expect(b.id).toBe('abc');
    expect(b.template).toBe('sankey');
    expect(b.kind).toBe('chart');
    expect(b.content).toBe('<svg/>');
    expect(b.title).toBe('Cost flow');
    expect(b.isComplete).toBe(true);
  });

  it('preserves chronological order — emits AFTER a prior tool_use block', () => {
    let s: FrameState = initialFrameState();
    s = applyCanonicalFrame(s, {
      type: 'content_block_start',
      _ts: 10,
      index: 0,
      content_block: { type: 'tool_use', id: 'tu1', name: 'compose_visual', input: {} },
    });
    s = applyCanonicalFrame(s, {
      type: 'tool_result',
      _ts: 20,
      tool_use_id: 'tu1',
      content: { summary: 'ok' },
    });
    s = applyCanonicalFrame(s, {
      type: 'visual_render',
      _ts: 30,
      artifact_id: 'v1',
      template: 'bar_chart',
      kind: 'chart',
      content: '<svg/>',
    });
    const types = s.contentBlocks.map((b) => b.type);
    expect(types).toEqual(['tool_use', 'viz_render']);
  });

  it('hot-swaps a viz_render block when group_id matches (replace, not append)', () => {
    let s: FrameState = initialFrameState();
    s = applyCanonicalFrame(s, {
      type: 'visual_render',
      _ts: 10,
      artifact_id: 'v1',
      template: 'sankey',
      kind: 'chart',
      content: '<svg>v1</svg>',
      group_id: 'g1',
    });
    s = applyCanonicalFrame(s, {
      type: 'visual_render',
      _ts: 20,
      artifact_id: 'v2',
      template: 'sankey',
      kind: 'chart',
      content: '<svg>v2</svg>',
      group_id: 'g1',
    });
    expect(s.contentBlocks).toHaveLength(1);
    expect(s.contentBlocks[0].content).toBe('<svg>v2</svg>');
    expect(s.contentBlocks[0].groupId).toBe('g1');
  });

  it('drops malformed frames (empty content or empty artifact_id)', () => {
    let s: FrameState = initialFrameState();
    s = applyCanonicalFrame(s, {
      type: 'visual_render',
      _ts: 10,
      artifact_id: '',
      template: 'sankey',
      kind: 'chart',
      content: '<svg/>',
    });
    s = applyCanonicalFrame(s, {
      type: 'visual_render',
      _ts: 20,
      artifact_id: 'v2',
      template: 'sankey',
      kind: 'chart',
      content: '',
    });
    expect(s.contentBlocks).toHaveLength(0);
  });
});

describe('applyCanonicalFrame — app_render', () => {
  it('appends an app_render ContentBlock with html + title + pyodideRequired + nonce', () => {
    const next = applyCanonicalFrame(initialFrameState(), {
      type: 'app_render',
      _ts: 100,
      artifact_id: 'app1',
      html: '<!doctype html><html><body>hi</body></html>',
      title: 'Mini App',
      pyodide_required: true,
      nonce: 'abc123',
    });
    expect(next.contentBlocks).toHaveLength(1);
    const b = next.contentBlocks[0];
    expect(b.type).toBe('app_render');
    expect(b.id).toBe('app1');
    expect(b.html).toBe('<!doctype html><html><body>hi</body></html>');
    expect(b.title).toBe('Mini App');
    expect(b.pyodideRequired).toBe(true);
    expect(b.nonce).toBe('abc123');
    expect(b.isComplete).toBe(true);
  });

  it('hot-swaps an app_render block when group_id matches', () => {
    let s: FrameState = initialFrameState();
    s = applyCanonicalFrame(s, {
      type: 'app_render',
      _ts: 10,
      artifact_id: 'a1',
      html: '<html>v1</html>',
      group_id: 'g',
    });
    s = applyCanonicalFrame(s, {
      type: 'app_render',
      _ts: 20,
      artifact_id: 'a2',
      html: '<html>v2</html>',
      group_id: 'g',
    });
    expect(s.contentBlocks).toHaveLength(1);
    expect(s.contentBlocks[0].html).toBe('<html>v2</html>');
  });
});

describe('applyCanonicalFrame — artifact_render', () => {
  it('routes kind=react|html|python_plot to an app_render block', () => {
    let s: FrameState = initialFrameState();
    s = applyCanonicalFrame(s, {
      type: 'artifact_render',
      _ts: 10,
      artifact_id: 'art1',
      kind: 'react',
      content: 'const App = () => <div/>;',
      title: 'react comp',
    });
    expect(s.contentBlocks).toHaveLength(1);
    expect(s.contentBlocks[0].type).toBe('app_render');
    expect(s.contentBlocks[0].kind).toBe('react');
    expect(s.contentBlocks[0].title).toBe('react comp');
  });

  it('routes kind=svg to a viz_render block', () => {
    let s: FrameState = initialFrameState();
    s = applyCanonicalFrame(s, {
      type: 'artifact_render',
      _ts: 10,
      artifact_id: 'art2',
      kind: 'svg',
      content: '<svg/>',
    });
    expect(s.contentBlocks).toHaveLength(1);
    expect(s.contentBlocks[0].type).toBe('viz_render');
    expect(s.contentBlocks[0].kind).toBe('svg');
  });
});
