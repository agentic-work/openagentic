/**
 * Wraps a slash-command mock in the same chrome the live codemode chat
 * uses for an assistant turn — the `●` gutter, the user-input echo at the
 * top, the dimmed metadata footer. Keeps the side-by-side comparison
 * honest: the LEFT panel shows the TUI; the RIGHT panel shows what
 * codemode renders, including the surrounding chat chrome.
 */

import * as React from 'react';

export const MockChatBubble: React.FC<{
  userInput: string;
  children: React.ReactNode;
  /** Optional hint shown under the bubble — e.g. "static text" or
   *  "interactive picker (arrow keys + enter)". Tells the reviewer what
   *  category they're looking at. */
  affordanceLabel?: string;
}> = ({ userInput, children, affordanceLabel }) => (
  <div
    style={{
      backgroundColor: 'var(--cm-bg, #0d1117)',
      border: '1px solid var(--cm-border, #30363d)',
      borderRadius: 8,
      padding: '12px 16px',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: 'var(--cm-text, #e6edf3)',
      maxWidth: 720,
    }}
  >
    {/* user echo — matches the chat transcript's user-message rendering */}
    <div
      style={{
        display: 'inline-block',
        backgroundColor: 'rgba(88,166,255,0.10)',
        color: 'var(--cm-accent, #58a6ff)',
        padding: '2px 10px',
        borderRadius: 12,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 12,
        marginBottom: 10,
        marginLeft: 'auto',
        float: 'right',
        clear: 'both',
      }}
    >
      {userInput}
    </div>
    <div style={{ clear: 'both' }} />

    {/* assistant turn — leading gutter dot + content */}
    <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
      <div
        style={{
          color: 'var(--cm-accent, #58a6ff)',
          fontSize: 14,
          lineHeight: 1.2,
          paddingTop: 4,
        }}
      >
        ●
      </div>
      <div style={{ flexGrow: 1, minWidth: 0 }}>{children}</div>
    </div>

    {affordanceLabel && (
      <div
        style={{
          marginTop: 12,
          paddingTop: 8,
          borderTop: '1px dashed var(--cm-border, #30363d)',
          fontSize: 11,
          color: 'var(--cm-text-muted, #8b949e)',
          fontStyle: 'italic',
        }}
      >
        {affordanceLabel}
      </div>
    )}
  </div>
);

/** Fake terminal pane — the LEFT side of every comparison. Renders the
 *  expected TUI output as monospace text in a dark pane. */
export const MockTuiPane: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      backgroundColor: '#0a0e13',
      border: '1px solid #1d232b',
      borderRadius: 8,
      padding: '12px 16px',
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.5,
      color: '#c9d1d9',
      whiteSpace: 'pre-wrap',
      maxWidth: 720,
      minHeight: 80,
    }}
  >
    {children}
  </div>
);

/** Section wrapper — title, description, side-by-side grid. */
export const MockSection: React.FC<{
  title: string;
  command: string;
  category: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, command, category, description, children }) => (
  <section
    style={{
      marginBottom: 48,
      paddingBottom: 32,
      borderBottom: '1px solid var(--cm-border, #30363d)',
    }}
  >
    <header style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--cm-text, #e6edf3)',
          }}
        >
          {title}
        </h2>
        <code
          style={{
            backgroundColor: 'var(--cm-bg-secondary, #161b22)',
            color: 'var(--cm-accent, #58a6ff)',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 13,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          }}
        >
          {command}
        </code>
        <span
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            color: 'var(--cm-text-muted, #8b949e)',
            border: '1px solid var(--cm-border, #30363d)',
            padding: '1px 6px',
            borderRadius: 3,
          }}
        >
          {category}
        </span>
      </div>
      <p
        style={{
          margin: '6px 0 0 0',
          fontSize: 13,
          color: 'var(--cm-text-muted, #8b949e)',
          lineHeight: 1.5,
        }}
      >
        {description}
      </p>
    </header>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 24,
        alignItems: 'start',
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            color: 'var(--cm-text-muted, #8b949e)',
            marginBottom: 8,
          }}
        >
          ◀  Today: openagentic TUI in a terminal
        </div>
        {Array.isArray(children) ? children[0] : children}
      </div>
      <div>
        <div
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            color: 'var(--cm-accent, #58a6ff)',
            marginBottom: 8,
          }}
        >
          Tomorrow: codemode browser  ▶
        </div>
        {Array.isArray(children) ? children[1] : null}
      </div>
    </div>
  </section>
);
