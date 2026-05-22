/**
 * Inline-only Ink-DOM stand-ins for the Phase-0 visual mock.
 *
 * These are NOT the real Phase-3 ink-dom primitives. They exist solely so
 * the SlashMocksPage can render an approximation of "what the actual Ink
 * tree will look like once it round-trips through the daemon and back as
 * JSON". Same prop names as Ink (so when Phase 3 lands, we can swap the
 * import and the section files keep working) but rendered as styled DOM
 * with no flex-layout sophistication beyond what flexbox gives us for
 * free.
 *
 * If you find yourself reaching for behavior here (focus rings, keyboard
 * subscriptions, theme context) — STOP. Those belong in Phase 3, behind
 * the real wire protocol. The mock is intentionally dumb.
 */

import * as React from 'react';

type ColorProp = string | undefined;

const TUI_COLOR_MAP: Record<string, string> = {
  // Anthropic-Ink color name → CSS hex. Mirrors the subset the local-jsx
  // commands actually use; expand as needed when sections need more.
  red: '#f85149',
  green: '#7ee787',
  yellow: '#e3b341',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#e6edf3',
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

function resolveColor(c: ColorProp): string | undefined {
  if (!c) return undefined;
  if (c.startsWith('#') || c.startsWith('rgb')) return c;
  return TUI_COLOR_MAP[c] ?? c;
}

export interface MockBoxProps {
  flexDirection?: 'row' | 'column';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch';
  paddingX?: number;
  paddingY?: number;
  padding?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  gap?: number;
  borderStyle?: 'single' | 'double' | 'round' | 'none';
  borderColor?: ColorProp;
  width?: number | string;
  flexGrow?: number;
  children?: React.ReactNode;
}

export const MockBox: React.FC<MockBoxProps> = ({
  flexDirection = 'row',
  justifyContent,
  alignItems,
  paddingX,
  paddingY,
  padding,
  marginTop,
  marginBottom,
  marginLeft,
  gap,
  borderStyle,
  borderColor,
  width,
  flexGrow,
  children,
}) => {
  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection,
    justifyContent,
    alignItems,
    paddingLeft: paddingX != null ? `${paddingX * 8}px` : padding != null ? `${padding * 8}px` : undefined,
    paddingRight: paddingX != null ? `${paddingX * 8}px` : padding != null ? `${padding * 8}px` : undefined,
    paddingTop: paddingY != null ? `${paddingY * 4}px` : padding != null ? `${padding * 4}px` : undefined,
    paddingBottom: paddingY != null ? `${paddingY * 4}px` : padding != null ? `${padding * 4}px` : undefined,
    marginTop: marginTop != null ? `${marginTop * 4}px` : undefined,
    marginBottom: marginBottom != null ? `${marginBottom * 4}px` : undefined,
    marginLeft: marginLeft != null ? `${marginLeft * 8}px` : undefined,
    gap: gap != null ? `${gap * 4}px` : undefined,
    width,
    flexGrow,
  };
  if (borderStyle && borderStyle !== 'none') {
    style.border = `1px solid ${resolveColor(borderColor) ?? '#30363d'}`;
    style.borderRadius = borderStyle === 'round' ? '6px' : 0;
  }
  return <div style={style}>{children}</div>;
};

export interface MockTextProps {
  color?: ColorProp;
  backgroundColor?: ColorProp;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  dimColor?: boolean;
  inverse?: boolean;
  children?: React.ReactNode;
}

export const MockText: React.FC<MockTextProps> = ({
  color,
  backgroundColor,
  bold,
  italic,
  underline,
  strikethrough,
  dimColor,
  inverse,
  children,
}) => {
  const fg = resolveColor(color) ?? 'var(--cm-text, #e6edf3)';
  const bg = resolveColor(backgroundColor);
  const style: React.CSSProperties = {
    color: dimColor ? 'var(--cm-text-muted, #8b949e)' : fg,
    backgroundColor: inverse ? fg : bg,
    fontWeight: bold ? 600 : 400,
    fontStyle: italic ? 'italic' : 'normal',
    textDecoration: [underline && 'underline', strikethrough && 'line-through'].filter(Boolean).join(' ') || undefined,
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    fontSize: '13px',
    whiteSpace: 'pre-wrap',
  };
  if (inverse) style.color = 'var(--cm-bg, #0d1117)';
  return <span style={style}>{children}</span>;
};

export const MockNewline: React.FC<{ count?: number }> = ({ count = 1 }) => (
  <>{Array.from({ length: count }).map((_, i) => <br key={i} />)}</>
);

export const MockSpacer: React.FC = () => <div style={{ flexGrow: 1 }} />;

/** A focus ring that mimics the cyan/blue outline the TUI uses on focused
 *  picker rows. */
export const MockFocusRow: React.FC<{ focused?: boolean; children?: React.ReactNode }> = ({
  focused,
  children,
}) => (
  <div
    style={{
      padding: '4px 8px',
      borderLeft: focused
        ? '2px solid var(--cm-accent, #58a6ff)'
        : '2px solid transparent',
      backgroundColor: focused ? 'rgba(88,166,255,0.08)' : 'transparent',
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: '13px',
      color: focused ? 'var(--cm-text, #e6edf3)' : 'var(--cm-text-muted, #8b949e)',
    }}
  >
    {focused ? '› ' : '  '}
    {children}
  </div>
);

/** Footer hint strip — replicates the TUI's "↑↓ navigate · enter select"
 *  affordance. */
export const MockKeyHints: React.FC<{ hints: Array<[key: string, label: string]> }> = ({ hints }) => (
  <div
    style={{
      marginTop: 6,
      paddingTop: 6,
      borderTop: '1px solid var(--cm-border, #30363d)',
      display: 'flex',
      gap: 12,
      fontSize: '11px',
      color: 'var(--cm-text-muted, #8b949e)',
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    }}
  >
    {hints.map(([k, label], i) => (
      <span key={i}>
        <span style={{ color: 'var(--cm-text, #e6edf3)' }}>{k}</span> {label}
      </span>
    ))}
  </div>
);
