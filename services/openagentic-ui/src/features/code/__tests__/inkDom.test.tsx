/**
 * Phase 3 of openagentic:~/.claude/plans/sprightly-percolating-brook.md.
 *
 * The browser-side ink-dom primitives convert wire VdomNode payloads
 * into styled DOM. These tests render each primitive in isolation via
 * the recursive `renderChild` callback that InkVdomMount (Phase 4) will
 * provide, and assert the resulting DOM tree.
 *
 * jsdom env is required (uses default vitest config — already set up
 * in this repo). No browser features beyond DOM are touched.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';
import {
  INK_DOM_REGISTRY,
  Box,
  Text,
  Link,
  Progress,
  RawAnsi,
  InkText,
  lookupInkDom,
} from '../ink-dom/index.js';
import type { VdomNode } from '../types/_sdk-bindings';

function node(
  type: string,
  props: Record<string, unknown> = {},
  children: VdomNode[] = [],
): VdomNode {
  return { id: `n-${Math.random().toString(36).slice(2, 8)}`, type, props, children };
}

function recursiveRenderer(): (
  child: VdomNode,
  key: React.Key,
) => React.ReactNode {
  // Reuse the registry to render children — same lookup logic
  // InkVdomMount will use.
  const r = (child: VdomNode, key: React.Key): React.ReactNode => {
    const C = lookupInkDom(child.type);
    if (C === 'text-leaf') {
      return <InkText key={key} node={child} />;
    }
    return <C key={key} node={child} renderChild={r} />;
  };
  return r;
}

describe('lookupInkDom — registry resolution', () => {
  it('returns Box for ink-box and box', () => {
    expect(lookupInkDom('ink-box')).toBe(INK_DOM_REGISTRY['ink-box']);
    expect(lookupInkDom('box')).toBe(INK_DOM_REGISTRY['box']);
  });

  it('returns Text for ink-text and text', () => {
    expect(lookupInkDom('ink-text')).toBe(INK_DOM_REGISTRY['ink-text']);
    expect(lookupInkDom('text')).toBe(INK_DOM_REGISTRY['text']);
  });

  it('returns the text-leaf sentinel for #text', () => {
    expect(lookupInkDom('#text')).toBe('text-leaf');
  });

  it('returns the Unknown fallback for an unrecognized type', () => {
    const C = lookupInkDom('ink-fancy-thing-2099');
    expect(typeof C).toBe('function'); // it's a component, not 'text-leaf'
  });
});

describe('Box', () => {
  it('renders a flexbox div with children', () => {
    const root = node('ink-box', { flexDirection: 'column', padding: 1 }, [
      node('ink-text', {}, [
        node('#text', { value: 'hello' }, []),
      ]),
    ]);
    const { container } = render(
      <Box node={root} renderChild={recursiveRenderer()} />,
    );
    const div = container.firstChild as HTMLElement;
    expect(div.tagName).toBe('DIV');
    expect(div.style.display).toBe('flex');
    expect(div.style.flexDirection).toBe('column');
    expect(div.dataset.inkNodeId).toBe(root.id);
    expect(div.textContent).toBe('hello');
  });

  it('applies borderStyle:round as a rounded border', () => {
    const root = node('ink-box', {
      borderStyle: 'round',
      borderColor: 'cyan',
    });
    const { container } = render(
      <Box node={root} renderChild={recursiveRenderer()} />,
    );
    const div = container.firstChild as HTMLElement;
    expect(div.style.borderRadius).toBe('6px');
    // cyan resolves to its hex
    expect(div.style.border).toContain('1px');
  });

  it('marshals tabIndex through to the rendered DIV for focus support', () => {
    const root = node('ink-box', { tabIndex: 0 });
    const { container } = render(
      <Box node={root} renderChild={recursiveRenderer()} />,
    );
    const div = container.firstChild as HTMLElement;
    expect(div.tabIndex).toBe(0);
  });
});

describe('Text', () => {
  it('renders bold + colored text from the wire prop bag', () => {
    const root = node(
      'ink-text',
      { bold: true, color: 'green' },
      [node('#text', { value: 'success' }, [])],
    );
    const { container } = render(
      <Text node={root} renderChild={recursiveRenderer()} />,
    );
    const span = container.firstChild as HTMLElement;
    expect(span.tagName).toBe('SPAN');
    expect(span.style.fontWeight).toBe('600');
    expect(span.textContent).toBe('success');
    // green resolves to a hex value
    expect(span.style.color).toMatch(/^(#7ee787|rgb)/);
  });

  it('respects dimColor for muted text', () => {
    const root = node('ink-text', { dimColor: true }, [
      node('#text', { value: 'hint' }, []),
    ]);
    const { container } = render(
      <Text node={root} renderChild={recursiveRenderer()} />,
    );
    const span = container.firstChild as HTMLElement;
    expect(span.style.color).toContain('var(--cm-text-muted');
  });
});

describe('text leaf (#text)', () => {
  it('renders as bare text content with no wrapping span', () => {
    const leaf = node('#text', { value: 'plain' }, []);
    const { container } = render(<InkText node={leaf} />);
    expect(container.textContent).toBe('plain');
    // No element child — just a text node — so firstElementChild is null.
    expect(container.firstElementChild).toBeNull();
  });
});

describe('Link', () => {
  it('renders an anchor with href and target=_blank', () => {
    const root = node('ink-link', { href: 'https://example.com' }, [
      node('#text', { value: 'click me' }, []),
    ]);
    const { container } = render(
      <Link node={root} renderChild={recursiveRenderer()} />,
    );
    const a = container.firstChild as HTMLAnchorElement;
    expect(a.tagName).toBe('A');
    expect(a.href).toBe('https://example.com/');
    expect(a.target).toBe('_blank');
    expect(a.textContent).toBe('click me');
  });
});

describe('Progress', () => {
  it('renders a filled bar at the given fraction', () => {
    const root = node('ink-progress', { value: 0.6, width: 20 });
    const { container } = render(
      <Progress node={root} renderChild={recursiveRenderer()} />,
    );
    const outer = container.firstChild as HTMLElement;
    const fill = outer.firstChild as HTMLElement;
    expect(fill.style.width).toBe('60%');
  });

  it('clamps values >1 and <0', () => {
    const high = node('ink-progress', { value: 5 });
    const low = node('ink-progress', { value: -1 });
    const r1 = render(<Progress node={high} renderChild={recursiveRenderer()} />);
    const r2 = render(<Progress node={low} renderChild={recursiveRenderer()} />);
    const fill1 = (r1.container.firstChild as HTMLElement)
      .firstChild as HTMLElement;
    const fill2 = (r2.container.firstChild as HTMLElement)
      .firstChild as HTMLElement;
    expect(fill1.style.width).toBe('100%');
    expect(fill2.style.width).toBe('0%');
  });
});

describe('RawAnsi', () => {
  it('strips ANSI escape codes and renders inside <pre>', () => {
    const root = node('ink-raw-ansi', {
      rawText: '\x1B[31mred\x1B[0m and \x1B[1mbold\x1B[0m',
    });
    const { container } = render(
      <RawAnsi node={root} renderChild={recursiveRenderer()} />,
    );
    const pre = container.firstChild as HTMLElement;
    expect(pre.tagName).toBe('PRE');
    expect(pre.textContent).toBe('red and bold');
  });
});

describe('full-tree round-trip', () => {
  it('renders a nested ink tree with mixed primitives', () => {
    const tree = node(
      'ink-box',
      { flexDirection: 'column', padding: 1 },
      [
        node('ink-text', { bold: true }, [
          node('#text', { value: 'Header' }, []),
        ]),
        node('ink-text', {}, [
          node('#text', { value: 'Body line' }, []),
        ]),
        node('ink-link', { href: 'https://docs' }, [
          node('#text', { value: 'docs' }, []),
        ]),
      ],
    );
    const r = recursiveRenderer();
    const { container } = render(<>{r(tree, 'root')}</>);
    expect(container.querySelector('a')?.textContent).toBe('docs');
    expect(container.textContent).toContain('Header');
    expect(container.textContent).toContain('Body line');
    expect(container.textContent).toContain('docs');
  });
});
