/**
 * Browser-side Ink-DOM primitive registry.
 *
 * Phase 3 of openagentic:~/.claude/plans/sprightly-percolating-brook.md.
 *
 * The daemon's InkVdom reconciler emits a JSON tree whose node `type`
 * matches one of Ink's intrinsic host elements (`ink-box`, `ink-text`,
 * `ink-link`, etc). Phase 4's `InkVdomMount` walks that tree and looks
 * up each node's `type` in the `INK_DOM_REGISTRY` here to render the
 * appropriate React component.
 *
 * The components here are the BROWSER half of the Ink surface: they
 * accept the wire-prop bag straight from the VdomNode and render styled
 * HTML/CSS that visually matches the TUI. No yoga, no terminal escape
 * codes — just plain DOM that reflows naturally inside a chat bubble.
 *
 * Compatibility surface (matches `openagentic/src/ink.ts` exports):
 *   - ink-box           → Box.tsx (flexbox container)
 *   - ink-text          → Text.tsx (styled span)
 *   - ink-virtual-text  → Text-like span used by Ink for inline runs
 *   - ink-link          → Link.tsx (anchor)
 *   - ink-progress      → ProgressBar.tsx (filled bar)
 *   - ink-raw-ansi      → RawAnsi.tsx (escape-stripped pre)
 *   - #text             → raw text leaf (renders props.value as a
 *                         React text node — never wraps in span so
 *                         parent <Text> styling cascades)
 *
 * Color resolution: openagentic's Ink color names (red, brightBlue, etc)
 * map to dark-theme-friendly hex values. Hex/rgb pass through. Unknown
 * colors fall through to the literal value (`color: '#abc'` works).
 */

import * as React from 'react';
import type { VdomNode } from '../types/_sdk-bindings';

// ────────────────────────────────────────────────────────────────────────
// Color + style helpers
// ────────────────────────────────────────────────────────────────────────

const TUI_COLOR_MAP: Record<string, string> = {
  red: '#f85149',
  green: '#7ee787',
  yellow: '#e3b341',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#e6edf3',
  black: '#0d1117',
  gray: '#8b949e',
  grey: '#8b949e',
  brightBlack: '#484f58',
  brightRed: '#ff7b72',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
};

function resolveColor(c: unknown): string | undefined {
  if (typeof c !== 'string' || !c) return undefined;
  if (c.startsWith('#') || c.startsWith('rgb(') || c.startsWith('ansi256(')) {
    return c.startsWith('ansi256(') ? '#8b949e' : c; // collapse ansi256 to gray
  }
  return TUI_COLOR_MAP[c] ?? c;
}

/** Convert Ink's "cell" units (terminal columns) to pixels. Ink rows ≈
 *  half the height of columns (typical monospace cell aspect). The
 *  conversion factor (8/4) is borrowed from the dev-mock and visually
 *  matches the TUI when rendered in JetBrains Mono 13px. */
const CELL_W = 8;
const CELL_H = 4;

interface BoxStyleProps {
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  flexGrow?: number;
  flexShrink?: number;
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  justifyContent?: string;
  alignItems?: string;
  alignSelf?: string;
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  width?: number | string;
  height?: number | string;
  minWidth?: number | string;
  minHeight?: number | string;
  maxWidth?: number | string;
  maxHeight?: number | string;
  display?: 'flex' | 'none';
  padding?: number;
  paddingX?: number;
  paddingY?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  margin?: number;
  marginX?: number;
  marginY?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  borderStyle?: string;
  borderColor?: string;
  borderTopColor?: string;
  borderBottomColor?: string;
  borderLeftColor?: string;
  borderRightColor?: string;
  overflow?: 'visible' | 'hidden';
  overflowX?: 'visible' | 'hidden';
  overflowY?: 'visible' | 'hidden';
}

function dimToCss(v: unknown, axis: 'w' | 'h'): string | number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return `${v * (axis === 'w' ? CELL_W : CELL_H)}px`;
  return v as string;
}

function boxStyle(props: Record<string, unknown>): React.CSSProperties {
  const p = props as BoxStyleProps;
  const style: React.CSSProperties = {
    display: p.display === 'none' ? 'none' : 'flex',
    flexDirection: p.flexDirection ?? 'row',
    flexGrow: p.flexGrow,
    flexShrink: p.flexShrink,
    flexWrap: p.flexWrap,
    justifyContent: p.justifyContent,
    alignItems: p.alignItems,
    alignSelf: p.alignSelf,
    gap:
      p.gap != null
        ? `${p.gap * CELL_W}px`
        : undefined,
    rowGap: p.rowGap != null ? `${p.rowGap * CELL_H}px` : undefined,
    columnGap: p.columnGap != null ? `${p.columnGap * CELL_W}px` : undefined,
    width: dimToCss(p.width, 'w'),
    height: dimToCss(p.height, 'h'),
    minWidth: dimToCss(p.minWidth, 'w'),
    minHeight: dimToCss(p.minHeight, 'h'),
    maxWidth: dimToCss(p.maxWidth, 'w'),
    maxHeight: dimToCss(p.maxHeight, 'h'),
    overflow: p.overflow,
    overflowX: p.overflowX,
    overflowY: p.overflowY,
  };

  // Padding — `padding` shorthand → all four; `paddingX/Y` → horiz/vert.
  if (p.padding != null) {
    style.padding = `${p.padding * CELL_H}px ${p.padding * CELL_W}px`;
  }
  if (p.paddingX != null) {
    style.paddingLeft = `${p.paddingX * CELL_W}px`;
    style.paddingRight = `${p.paddingX * CELL_W}px`;
  }
  if (p.paddingY != null) {
    style.paddingTop = `${p.paddingY * CELL_H}px`;
    style.paddingBottom = `${p.paddingY * CELL_H}px`;
  }
  if (p.paddingTop != null) style.paddingTop = `${p.paddingTop * CELL_H}px`;
  if (p.paddingBottom != null)
    style.paddingBottom = `${p.paddingBottom * CELL_H}px`;
  if (p.paddingLeft != null)
    style.paddingLeft = `${p.paddingLeft * CELL_W}px`;
  if (p.paddingRight != null)
    style.paddingRight = `${p.paddingRight * CELL_W}px`;

  // Margin
  if (p.margin != null) {
    style.margin = `${p.margin * CELL_H}px ${p.margin * CELL_W}px`;
  }
  if (p.marginX != null) {
    style.marginLeft = `${p.marginX * CELL_W}px`;
    style.marginRight = `${p.marginX * CELL_W}px`;
  }
  if (p.marginY != null) {
    style.marginTop = `${p.marginY * CELL_H}px`;
    style.marginBottom = `${p.marginY * CELL_H}px`;
  }
  if (p.marginTop != null) style.marginTop = `${p.marginTop * CELL_H}px`;
  if (p.marginBottom != null)
    style.marginBottom = `${p.marginBottom * CELL_H}px`;
  if (p.marginLeft != null) style.marginLeft = `${p.marginLeft * CELL_W}px`;
  if (p.marginRight != null) style.marginRight = `${p.marginRight * CELL_W}px`;

  // Border — Ink's named styles all collapse to a single 1px line; the
  // visual "double" / "round" affordances are approximated via radius.
  if (p.borderStyle && p.borderStyle !== 'none') {
    const borderColor = resolveColor(p.borderColor) ?? '#30363d';
    style.border = `1px solid ${borderColor}`;
    if (p.borderStyle === 'round') style.borderRadius = '6px';
    if (p.borderStyle === 'double') style.borderWidth = '2px';
    if (p.borderTopColor)
      style.borderTopColor = resolveColor(p.borderTopColor);
    if (p.borderBottomColor)
      style.borderBottomColor = resolveColor(p.borderBottomColor);
    if (p.borderLeftColor)
      style.borderLeftColor = resolveColor(p.borderLeftColor);
    if (p.borderRightColor)
      style.borderRightColor = resolveColor(p.borderRightColor);
  }

  return style;
}

// ────────────────────────────────────────────────────────────────────────
// Component definitions
// ────────────────────────────────────────────────────────────────────────

export interface InkDomNodeProps {
  node: VdomNode;
  /** Recursive renderer — passed in by InkVdomMount (Phase 4) so each
   *  primitive can render its children without circular imports. */
  renderChild: (child: VdomNode, key: React.Key) => React.ReactNode;
}

export const Box: React.FC<InkDomNodeProps> = ({ node, renderChild }) => {
  // Ink's `style` prop bag (computed by the Box JSX layer) overrides the
  // top-level shortcut props when present — the daemon's reconciler
  // strips it through unchanged.
  const explicitStyle =
    typeof node.props.style === 'object' && node.props.style !== null
      ? (node.props.style as Record<string, unknown>)
      : null;
  const merged = { ...node.props, ...(explicitStyle ?? {}) };
  const tabIndex = typeof node.props.tabIndex === 'number'
    ? (node.props.tabIndex as number)
    : undefined;
  return (
    <div
      data-ink-node-id={node.id}
      data-ink-type="box"
      tabIndex={tabIndex}
      style={boxStyle(merged)}
    >
      {node.children.map((c, i) => renderChild(c, c.id ?? i))}
    </div>
  );
};

export const Text: React.FC<InkDomNodeProps> = ({ node, renderChild }) => {
  const p = node.props as Record<string, unknown>;
  const fg = resolveColor(p.color) ?? 'var(--cm-text, #e6edf3)';
  const bg = resolveColor(p.backgroundColor);
  const dim = p.dimColor === true;
  const inverse = p.inverse === true;
  const style: React.CSSProperties = {
    color: dim ? 'var(--cm-text-muted, #8b949e)' : inverse ? 'var(--cm-bg, #0d1117)' : fg,
    backgroundColor: inverse ? fg : bg,
    fontWeight: p.bold ? 600 : 400,
    fontStyle: p.italic ? 'italic' : 'normal',
    textDecoration:
      [p.underline && 'underline', p.strikethrough && 'line-through']
        .filter(Boolean)
        .join(' ') || undefined,
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    fontSize: '13px',
    whiteSpace:
      p.wrap === 'truncate' ||
      p.wrap === 'truncate-start' ||
      p.wrap === 'truncate-middle' ||
      p.wrap === 'truncate-end'
        ? 'nowrap'
        : 'pre-wrap',
    overflow:
      p.wrap?.toString().startsWith('truncate') ? 'hidden' : undefined,
    textOverflow:
      p.wrap?.toString().startsWith('truncate') ? 'ellipsis' : undefined,
  };
  return (
    <span
      data-ink-node-id={node.id}
      data-ink-type="text"
      style={style}
    >
      {node.children.map((c, i) => renderChild(c, c.id ?? i))}
    </span>
  );
};

/** `ink-virtual-text` is Ink's inline run wrapper. Same as Text but
 *  rendered as a span and inherits enclosing Text styling rather than
 *  asserting its own. */
export const VirtualText: React.FC<InkDomNodeProps> = ({
  node,
  renderChild,
}) => (
  <span data-ink-node-id={node.id} data-ink-type="virtual-text">
    {node.children.map((c, i) => renderChild(c, c.id ?? i))}
  </span>
);

export const Link: React.FC<InkDomNodeProps> = ({ node, renderChild }) => {
  const href =
    typeof node.props.href === 'string' ? (node.props.href as string) : '#';
  return (
    <a
      data-ink-node-id={node.id}
      data-ink-type="link"
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        color: 'var(--cm-accent, #58a6ff)',
        textDecoration: 'underline',
      }}
    >
      {node.children.map((c, i) => renderChild(c, c.id ?? i))}
    </a>
  );
};

export const Progress: React.FC<InkDomNodeProps> = ({ node }) => {
  const p = node.props as Record<string, unknown>;
  const value =
    typeof p.value === 'number' ? Math.max(0, Math.min(1, p.value)) : 0;
  const width =
    typeof p.width === 'number' ? `${(p.width as number) * CELL_W}px` : '120px';
  return (
    <div
      data-ink-node-id={node.id}
      data-ink-type="progress"
      style={{
        width,
        height: 6,
        background: 'var(--cm-surface-2, rgba(255,255,255,0.06))',
        borderRadius: 3,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${value * 100}%`,
          height: '100%',
          background: 'var(--cm-accent, #58a6ff)',
          transition: 'width 120ms ease-out',
        }}
      />
    </div>
  );
};

export const RawAnsi: React.FC<InkDomNodeProps> = ({ node }) => {
  const text =
    typeof node.props.rawText === 'string'
      ? (node.props.rawText as string)
      : '';
  // Strip ANSI escape sequences for now — full SGR parsing is a Phase
  // 3.5 luxury. The daemon's TUI commands rarely emit raw ANSI in their
  // local-jsx output anyway (it's mostly Ink's styled-Text).
  const clean = text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
  return (
    <pre
      data-ink-node-id={node.id}
      data-ink-type="raw-ansi"
      style={{
        margin: 0,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: '13px',
        color: 'var(--cm-text, #e6edf3)',
        whiteSpace: 'pre',
      }}
    >
      {clean}
    </pre>
  );
};

/** Render a raw text leaf. The daemon's reconciler creates a host node
 *  of type `'#text'` for every string child of a host parent
 *  (`createTextInstance(text)` → `{ type:'#text', props:{value}, children:[] }`).
 *  We render it as a React text node — NO wrapping span, so parent
 *  Text/VirtualText styling cascades naturally. */
export const InkText: React.FC<{ node: VdomNode }> = ({ node }) => {
  const value = node.props.value;
  return <>{typeof value === 'string' ? value : ''}</>;
};

/** Fallback for unknown types — renders the children, surrounded by a
 *  data-attribute. Lets newly-introduced Ink primitives degrade
 *  gracefully instead of crashing the whole mount. */
export const Unknown: React.FC<InkDomNodeProps> = ({ node, renderChild }) => (
  <span
    data-ink-node-id={node.id}
    data-ink-type={`unknown-${node.type}`}
    style={{ outline: '1px dashed var(--cm-warn, #e3b341)' }}
  >
    {node.children.map((c, i) => renderChild(c, c.id ?? i))}
  </span>
);

// ────────────────────────────────────────────────────────────────────────
// Registry
// ────────────────────────────────────────────────────────────────────────

export type InkDomComponent = React.FC<InkDomNodeProps>;

export const INK_DOM_REGISTRY: Record<string, InkDomComponent> = {
  'ink-root': Box, // root behaves like a box on the wire
  'ink-box': Box,
  'ink-text': Text,
  'ink-virtual-text': VirtualText,
  'ink-link': Link,
  'ink-progress': Progress,
  'ink-raw-ansi': RawAnsi,
  // Lowercase aliases — the test reconciler emits these for plain JSX
  // (`<box>`, `<text>` without going through Ink's host component layer).
  box: Box,
  text: Text,
  link: Link,
  'virtual-text': VirtualText,
  progress: Progress,
  'raw-ansi': RawAnsi,
};

/** Look up a component for the given vdom type. Falls back to Unknown
 *  for anything not in the registry. `#text` is special-cased (text
 *  leaf has a different prop shape — no `renderChild`). */
export function lookupInkDom(type: string): InkDomComponent | 'text-leaf' {
  if (type === '#text') return 'text-leaf';
  return INK_DOM_REGISTRY[type] ?? Unknown;
}
