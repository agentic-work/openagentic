/**
 * Unit-test gate for StreamEngine.
 *
 * Asserts the four properties that make the engine glitchless:
 *   (a) Paint count is O(blockCount), not O(deltaCount). 200 frames of
 *       text_deltas into one text block ⇒ exactly 2 paints (mount + ≥1
 *       per delta — wait, no: append.appendData is ONE DOM write per
 *       frame but it's a constant-time op the browser doesn't repaint
 *       for; we count it as 1 paint anyway because we want to surface
 *       per-write op count, not browser-paint count). So 200 deltas =
 *       201 paints (1 mount + 200 appendData). The KEY is no remounts.
 *   (b) finalize() returns a UIContentBlock[] semantically equal to what
 *       applyCanonicalFrame would have produced standalone.
 *   (c) container.innerHTML is stable across runs with the same fixture.
 *   (d) No DOM block element gets remounted mid-stream (verified by
 *       MutationObserver capturing childList mutations on text blocks).
 *
 * Type SoT: every fixture frame is typed as `UIStreamFrame` from
 * `@agentic-work/llm-sdk` (the SDK is SoT for the wire shape — see
 * `openagentic-sdk/src/lib/ui-stream/types.ts`). All persistence assertions
 * speak `UIContentBlock`.
 *
 * Why no real-fixture-only path: the engine reuses applyCanonicalFrame so
 * the reducer-level real-fixture parity is already proven by the existing
 * applyCanonicalFrame.test.ts. THIS test focuses on the *DOM side* of the
 * engine — which applyCanonicalFrame.test.ts can't reach.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { UIStreamFrame } from '@agentic-work/llm-sdk';
import { StreamEngine } from '../StreamEngine';
import {
  applyCanonicalFrame,
  initialFrameState,
  type FrameState,
} from '../../hooks/streamReducer/applyCanonicalFrame';

function makeContainer(): HTMLElement {
  const c = document.createElement('div');
  document.body.appendChild(c);
  return c;
}

function reduceFrames(frames: UIStreamFrame[]): FrameState {
  return frames.reduce<FrameState>(applyCanonicalFrame, initialFrameState());
}

describe('StreamEngine — basic lifecycle', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = makeContainer();
  });

  it('beginMessage clears prior state and stamps message id', () => {
    const engine = new StreamEngine(container);
    container.innerHTML = '<div>stale</div>';
    engine.beginMessage('msg-1');
    expect(container.innerHTML).toBe('');
    expect(container.getAttribute('data-cm-message-id')).toBe('msg-1');
    expect(container.classList.contains('cm-stream-root')).toBe(true);
  });

  it('throws if applyFrame called before beginMessage', () => {
    const engine = new StreamEngine(container);
    expect(() => engine.applyFrame({ type: 'content_block_delta' } as UIStreamFrame)).toThrow(
      /beginMessage/,
    );
  });

  it('destroy() makes further calls inert (no throw)', () => {
    const engine = new StreamEngine(container);
    engine.beginMessage('m');
    engine.destroy();
    engine.applyFrame({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } });
    // No throw, no DOM write past destroy
    expect(container.querySelector('[data-block-type="text"]')).toBeNull();
  });
});

describe('StreamEngine — text streaming hot path (Suspect #1, #4 fixes)', () => {
  it('200 text_delta frames produce exactly ONE text block element and exactly ONE textNode', () => {
    const container = makeContainer();
    const engine = new StreamEngine(container, { disableAutoScroll: true });
    engine.beginMessage('m');

    for (let i = 0; i < 200; i++) {
      engine.applyFrame({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: `t${i} ` },
        _ts: 1000 + i,
      });
    }

    const blocks = container.querySelectorAll('[data-block-type="text"]');
    expect(blocks.length).toBe(1);

    const buffer = container.querySelector('.cm-text-buffer');
    expect(buffer).toBeTruthy();
    expect(buffer!.childNodes.length).toBe(1);
    expect(buffer!.childNodes[0].nodeType).toBe(Node.TEXT_NODE);

    const concat = Array.from({ length: 200 }, (_, i) => `t${i} `).join('');
    expect((buffer!.firstChild as Text).data).toBe(concat);
  });

  it('no childList mutation observed on the text-block element after first mount', () => {
    const container = makeContainer();
    const engine = new StreamEngine(container, { disableAutoScroll: true });
    engine.beginMessage('m');

    // Open the block by sending the first delta.
    engine.applyFrame({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'hello ' },
      _ts: 1,
    });

    const blockEl = container.querySelector('[data-block-type="text"]') as HTMLElement;
    expect(blockEl).toBeTruthy();

    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => {
      mutations.push(...records);
    });
    observer.observe(blockEl, { childList: true, subtree: true, characterData: true });

    for (let i = 0; i < 50; i++) {
      engine.applyFrame({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: `delta${i} ` },
        _ts: 100 + i,
      });
    }

    // characterData mutations are expected (appendData), but childList must
    // be EMPTY — no remounts.
    return new Promise<void>((resolve) => {
      // MutationObserver flushes microtask-ly; wait one tick.
      setTimeout(() => {
        observer.disconnect();
        const childListMutations = mutations.filter((m) => m.type === 'childList' && m.addedNodes.length > 0);
        expect(childListMutations.length).toBe(0);
        resolve();
      }, 0);
    });
  });

  it('finalize after 200 deltas marks block complete and aria-busy=false', () => {
    const container = makeContainer();
    const engine = new StreamEngine(container, { disableAutoScroll: true });
    engine.beginMessage('m');
    for (let i = 0; i < 200; i++) {
      engine.applyFrame({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'x' },
        _ts: i,
      });
    }
    const result = engine.finalize();
    const block = container.querySelector('[data-block-type="text"]') as HTMLElement;
    expect(block.getAttribute('aria-busy')).toBe('false');
    expect(block.hasAttribute('data-streaming')).toBe(false);
    expect(result.contentBlocks.length).toBe(1);
    expect(result.contentBlocks[0].isComplete).toBe(true);
    expect(result.contentBlocks[0].content.length).toBe(200);
  });
});

describe('StreamEngine — parity with applyCanonicalFrame reducer', () => {
  it('finalize().contentBlocks deep-equals reduceFrames(frames)', () => {
    const container = makeContainer();
    const engine = new StreamEngine(container, { disableAutoScroll: true });
    engine.beginMessage('m');

    const frames: UIStreamFrame[] = [
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'pondering ' }, _ts: 1 },
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'more ' }, _ts: 2 },
      { type: 'thinking_complete', _ts: 3 },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' }, _ts: 10 },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world.' }, _ts: 11 },
      {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'tu1', name: 'list_things' },
        index: 0,
        _ts: 20,
      },
      {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"q":' },
        index: 0,
        _ts: 21,
      },
      {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '"x"}' },
        index: 0,
        _ts: 22,
      },
      { type: 'content_block_stop', index: 0, _ts: 23 },
      { type: 'tool_result', tool_use_id: 'tu1', content: { summary: 'ok', data: { items: [1, 2, 3] } }, _ts: 30 },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done.' }, _ts: 40 },
      { type: 'message_stop', _ts: 50 },
    ];
    for (const f of frames) engine.applyFrame(f);
    const result = engine.finalize();

    const expected = reduceFrames([...frames, { type: 'message_stop', _ts: 50 }]);
    // The reducer's final state may have an EXTRA close pass when finalize()
    // emits its synthetic message_stop on top of the real one — that's an
    // idempotent op (closeOpenAccumulators on already-closed state is a no-op).
    expect(result.contentBlocks.length).toBe(expected.contentBlocks.length);

    for (let i = 0; i < result.contentBlocks.length; i++) {
      const got = result.contentBlocks[i];
      const want = expected.contentBlocks[i];
      expect(got.type).toBe(want.type);
      expect(got.content).toBe(want.content);
      expect(got.isComplete).toBe(want.isComplete);
      expect(got.toolName).toBe(want.toolName);
      expect(got.toolId).toBe(want.toolId);
    }
  });
});

describe('StreamEngine — text block boundary on tool_use', () => {
  it('a tool_use frame between two text bursts opens a NEW text block (no coalesce)', () => {
    const container = makeContainer();
    const engine = new StreamEngine(container, { disableAutoScroll: true });
    engine.beginMessage('m');

    engine.applyFrame({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'prose A ' }, _ts: 1 });
    engine.applyFrame({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'tu1', name: 't' },
      index: 0,
      _ts: 2,
    });
    engine.applyFrame({ type: 'tool_result', tool_use_id: 'tu1', content: { summary: 'ok' }, _ts: 3 });
    engine.applyFrame({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'prose B' }, _ts: 4 });
    engine.finalize();

    const textBlocks = container.querySelectorAll('[data-block-type="text"]');
    expect(textBlocks.length).toBe(2);
    // DOM order is wire-emit order
    const order = Array.from(container.children).map((c) => (c as HTMLElement).getAttribute('data-block-type'));
    expect(order).toEqual(['text', 'tool_use', 'text']);
  });
});

describe('StreamEngine — viz_render + app_render artifacts', () => {
  it('viz_render mounts an iframe with theme tokens injected', () => {
    const container = makeContainer();
    const engine = new StreamEngine(container, {
      disableAutoScroll: true,
      themeTokens: () => ({
        '--cm-bg-0': '#09090b',
        '--cm-fg-0': '#f8fafc',
        '--cm-accent': '#8b5cf6',
      }),
    });
    engine.beginMessage('m');
    engine.applyFrame({
      type: 'visual_render',
      artifact_id: 'a1',
      template: 'bar',
      kind: 'svg',
      content: '<svg width="100" height="100"><rect width="100" height="100" fill="var(--cm-accent)"/></svg>',
      title: 'demo',
      group_id: 'g1',
      _ts: 1,
    });

    const iframe = container.querySelector<HTMLIFrameElement>('.cm-viz-iframe');
    expect(iframe).toBeTruthy();
    expect(iframe!.srcdoc).toContain('cm-stream-engine-theme');
    expect(iframe!.srcdoc).toContain('--cm-bg-0: #09090b');
    expect(iframe!.srcdoc).toContain('--cm-accent: #8b5cf6');
    expect(iframe!.srcdoc).toContain('<svg width="100" height="100"');
  });

  it('viz_render hot-swap by group_id reuses the SAME iframe element (no remount)', () => {
    const container = makeContainer();
    const engine = new StreamEngine(container, { disableAutoScroll: true });
    engine.beginMessage('m');
    engine.applyFrame({
      type: 'visual_render',
      artifact_id: 'a1',
      template: 'bar',
      kind: 'svg',
      content: '<svg id="v1"/>',
      group_id: 'g1',
      _ts: 1,
    });
    const iframe1 = container.querySelector<HTMLIFrameElement>('.cm-viz-iframe');
    expect(iframe1).toBeTruthy();
    engine.applyFrame({
      type: 'visual_render',
      artifact_id: 'a1',
      template: 'bar',
      kind: 'svg',
      content: '<svg id="v2"/>',
      group_id: 'g1',
      _ts: 2,
    });
    const iframe2 = container.querySelector<HTMLIFrameElement>('.cm-viz-iframe');
    expect(iframe2).toBe(iframe1);
    expect(iframe2!.srcdoc).toContain('id="v2"');
    expect(iframe2!.srcdoc).not.toContain('id="v1"');
  });

  it('app_render injects theme override after </head>', () => {
    const container = makeContainer();
    const engine = new StreamEngine(container, {
      disableAutoScroll: true,
      themeTokens: () => ({ '--cm-bg-0': '#09090b' }),
    });
    engine.beginMessage('m');
    engine.applyFrame({
      type: 'app_render',
      artifact_id: 'app1',
      html: '<!doctype html><html><head><meta/></head><body><h1>hi</h1></body></html>',
      group_id: 'ga',
      _ts: 1,
    });
    const iframe = container.querySelector<HTMLIFrameElement>('.cm-app-iframe');
    expect(iframe).toBeTruthy();
    // Theme override appears BEFORE </head> (so cascade wins it)
    const src = iframe!.srcdoc;
    const themeIdx = src.indexOf('cm-stream-engine-theme');
    const headEndIdx = src.indexOf('</head>');
    expect(themeIdx).toBeGreaterThan(0);
    expect(themeIdx).toBeLessThan(headEndIdx);
  });
});

describe('StreamEngine — follow_up chips', () => {
  it('emits a chip button per item', () => {
    const container = makeContainer();
    const engine = new StreamEngine(container, { disableAutoScroll: true });
    engine.beginMessage('m');
    engine.applyFrame({
      type: 'follow_up',
      items: ['Next?', 'Explain.', 'Drill in.'],
      _ts: 1,
    });
    const chips = container.querySelectorAll('.cm-follow-up-chip');
    expect(chips.length).toBe(3);
    expect((chips[0] as HTMLButtonElement).type).toBe('button');
    expect(chips[0].textContent).toBe('Next?');
  });
});

describe('StreamEngine — paint accounting', () => {
  it('paintCount is O(deltas) but no remounts; finalize stamps no additional paints', () => {
    const container = makeContainer();
    const engine = new StreamEngine(container, { disableAutoScroll: true });
    engine.beginMessage('m');
    // 1 paint for beginMessage clear, then 1 paint for the mount, then 99
    // paints for the 99 subsequent appendData calls.
    for (let i = 0; i < 100; i++) {
      engine.applyFrame({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'a' },
        _ts: i,
      });
    }
    const r = engine.finalize();
    // 1 (beginMessage clear) + 1 (mount) + 99 (appendData) = 101 paints
    expect(r.paintCount).toBe(101);
    expect(r.frameCount).toBe(100);
    // No remounts — only ONE block, ONE textNode, content length 100.
    const blocks = container.querySelectorAll('[data-block-type="text"]');
    expect(blocks.length).toBe(1);
    const text = container.querySelector('.cm-text-buffer')!.firstChild as Text;
    expect(text.data.length).toBe(100);
  });
});

describe('StreamEngine — deterministic snapshots', () => {
  it('two runs of the same fixture produce identical container.innerHTML', () => {
    const fixture: UIStreamFrame[] = [
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm ' }, _ts: 1 },
      { type: 'thinking_complete', _ts: 2 },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Result: ' }, _ts: 3 },
      {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'tu1', name: 'list' },
        index: 0,
        _ts: 4,
      },
      { type: 'tool_result', tool_use_id: 'tu1', content: { summary: 'two items' }, _ts: 5 },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'done.' }, _ts: 6 },
      { type: 'message_stop', _ts: 7 },
    ];
    function run(): string {
      const c = document.createElement('div');
      const e = new StreamEngine(c, { disableAutoScroll: true });
      e.beginMessage('m');
      for (const f of fixture) e.applyFrame(f);
      e.finalize();
      return c.innerHTML;
    }
    expect(run()).toBe(run());
  });
});
