import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Highlight, themes as prismThemes } from 'prism-react-renderer';
import { ThinkingSphere } from '@/shared/components/ThinkingSphere';
import type {
  AssistantBlock,
  AssistantChatMessage,
  ChatMessage,
  UiThinkingBlock,
  UiToolResult,
  UiToolUseBlock,
} from '../../types/streamJson';
import { renderToolInputSummary } from './toolRenderers';

// ────────────────────────────────────────────────────────────────────────────
// Visual constants — match openagentic/src/constants/figures.ts
// ────────────────────────────────────────────────────────────────────────────

// Verified against /tmp/openagentic-ref/boot3.raw — the live openagentic
// TUI uses these exact glyphs:
const BLACK_CIRCLE = '●';
const THINKING_GLYPH = '∴';
const BOTTOM_LEFT_CORNER = '⎿';
// U+276F HEAVY RIGHT-POINTING ANGLE QUOTATION MARK — openagentic's
// input prompt and user-message caret glyph.
const PROMPT_CARET = '❯';

// Theme-agnostic colors via CSS vars (--cm-*). These match the palette
// already used by CodeModeChatView and CodeModeLayoutV2 so themes apply
// uniformly.
const TEXT = 'var(--cm-text, #e6edf3)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const SUCCESS = 'var(--cm-success, #3fb950)';
const ERROR_COLOR = 'var(--cm-error, #f85149)';
const BORDER = 'var(--cm-border, #30363d)';
const BG_SURFACE = 'var(--cm-bg-secondary, #161b22)';

// Monospace stack — matches the TUI aesthetic. Users can override via CSS
// variable --cm-mono-font if they want to match their terminal font.
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

const MONO_STYLE: React.CSSProperties = {
  fontFamily: MONO_FONT,
  fontSize: 14,
  lineHeight: 1.6,
};

// ────────────────────────────────────────────────────────────────────────────
// Layout helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * A "row" is one logical message in the transcript. Left column is the
 * 2-char gutter (symbol + space), right column is the body — matching
 * openagentic's `<Box flexDirection="row">` with a 2-col-wide
 * `<NoSelect minWidth={2}>` followed by the content.
 */
const Row: React.FC<{
  gutter: React.ReactNode;
  gutterColor?: string;
  children: React.ReactNode;
  marginTop?: number;
}> = ({ gutter, gutterColor = TEXT, children, marginTop = 0 }) => (
  <div
    style={{
      ...MONO_STYLE,
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginTop,
      color: TEXT,
      width: '100%',
    }}
  >
    <div
      aria-hidden="true"
      style={{
        flex: '0 0 auto',
        width: '2ch',
        color: gutterColor,
        userSelect: 'none',
      }}
    >
      {gutter}
    </div>
    <div style={{ flex: '1 1 auto', minWidth: 0 }}>{children}</div>
  </div>
);

// ────────────────────────────────────────────────────────────────────────────
// User row: `> say hi in one word`
// ────────────────────────────────────────────────────────────────────────────

const UserRow: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'flex-end',
      margin: '14px 0 6px 0',
    }}
  >
    <div
      style={{
        maxWidth: '85%',
        padding: '8px 14px',
        borderRadius: 14,
        background: 'color-mix(in srgb, var(--cm-accent, #58a6ff) 14%, transparent)',
        border: '1px solid color-mix(in srgb, var(--cm-accent, #58a6ff) 22%, transparent)',
        color: 'var(--cm-text, #e6edf3)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'var(--cm-prose-font, Inter, system-ui, sans-serif)',
        fontSize: 14,
        lineHeight: 1.5,
        boxShadow: '0 1px 0 rgba(0,0,0,0.08)',
      }}
    >
      {text}
    </div>
  </div>
);

// ────────────────────────────────────────────────────────────────────────────
// Assistant text row: `● <markdown>`
// ────────────────────────────────────────────────────────────────────────────

/**
 * Custom <pre> renderer used by both AssistantTextRow and
 * PlanProposalCard. Wraps the code block in a relative container and
 * renders a hoverable "copy" button in the top-right. Click copies
 * the raw text to the clipboard and briefly flashes confirmation.
 */
// Map a few common aliases prism-react-renderer doesn't know about
// to ones it does. Keeps the language label readable too.
const LANG_ALIASES: Record<string, string> = {
  sh: 'bash', shell: 'bash', zsh: 'bash',
  yml: 'yaml', dockerfile: 'docker',
  ts: 'tsx', javascript: 'jsx', js: 'jsx',
  py: 'python', rs: 'rust',
};

// Determine whether the current codemode palette is a light theme by
// parsing the computed --cm-bg variable. Light backgrounds need a
// light prism theme (otherwise VSCode-dark tokens are near-invisible).
function useIsLightCmTheme(): boolean {
  const [isLight, setIsLight] = useState(false);
  useEffect(() => {
    const check = () => {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--cm-bg').trim();
      // Parse hex or rgb; light = relative-luminance > 0.5
      let r = 0, g = 0, b = 0;
      const hex = bg.match(/^#([0-9a-f]{6})$/i);
      const rgb = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (hex) {
        const n = parseInt(hex[1], 16);
        r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
      } else if (rgb) {
        r = +rgb[1]; g = +rgb[2]; b = +rgb[3];
      } else {
        return;
      }
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      setIsLight(lum > 0.6);
    };
    check();
    // Re-evaluate on theme change. The theme picker sets cm-theme via
    // inline style on <html>, which MutationObserver catches.
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-cm-theme'] });
    return () => obs.disconnect();
  }, []);
  return isLight;
}

const SyntaxCodeBlock: React.FC<{ code: string; lang: string }> = ({ code, lang }) => {
  const [copied, setCopied] = useState(false);
  const isLight = useIsLightCmTheme();
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard denied */ }
  };
  const prismLang = LANG_ALIASES[lang.toLowerCase()] || lang.toLowerCase() || 'plaintext';
  // Swap prism theme by luminance of --cm-bg: light themes get github
  // (dark tokens on light bg); dark themes get vsDark.
  const prismTheme = isLight ? prismThemes.github : prismThemes.vsDark;
  return (
    <div className="cm-codeblock">
      <div className="cm-codeblock-header">
        <span className="cm-codeblock-lang">{lang || 'text'}</span>
        <button
          type="button"
          className={copied ? 'cm-copy-btn copied' : 'cm-copy-btn'}
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied ? '✓ copied' : 'copy'}
        </button>
      </div>
      <Highlight code={code} language={prismLang} theme={prismTheme}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre className={`cm-codeblock-pre ${className}`} style={{ ...style, background: 'transparent', margin: 0, padding: '12px 14px', overflow: 'auto' }}>
            {tokens.map((line, i) => {
              const lineProps = getLineProps({ line });
              return (
                <div key={i} {...lineProps}>
                  {line.map((token, j) => {
                    const tokenProps = getTokenProps({ token });
                    return <span key={j} {...tokenProps} />;
                  })}
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
};

const MarkdownCode: React.FC<{
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}> = ({ inline, className, children }) => {
  const text = String(children ?? '').replace(/\n$/, '');
  const langMatch = /language-([\w+-]+)/.exec(className || '');
  // Inline code: keep the existing tinted-pill style from .cm-markdown code.
  // ReactMarkdown sets `inline` for `single backticks`. When `inline` is
  // undefined (some setups), fall back to "no language match AND no newline".
  const isInline = inline ?? (!langMatch && !text.includes('\n'));
  if (isInline) {
    return <code className={className}>{children}</code>;
  }
  return <SyntaxCodeBlock code={text} lang={langMatch?.[1] || ''} />;
};

// ReAct cognitive-loop markers — detect `THINK: foo` / `ACT: foo` /
// `OBSERVE: foo` / `REFLECT: foo` / `PLAN: foo` / `VERIFY: foo` at the
// start of a paragraph and render a colored pill in front. Mirrors the
// chat-mode override in SharedMarkdownRenderer.tsx so codemode reads
// agent reasoning flows the same way. See commit c61d4eb0.
const REACT_STAGE_TONES: Record<string, { bg: string; fg: string; label: string }> = {
  THINK:   { bg: 'rgba(33, 150, 243, 0.18)', fg: '#2196f3', label: 'THINK' },
  ACT:     { bg: 'rgba(255, 152, 0, 0.18)',  fg: '#ff9800', label: 'ACT' },
  OBSERVE: { bg: 'rgba(63, 185, 80, 0.18)',  fg: '#3fb950', label: 'OBSERVE' },
  REFLECT: { bg: 'rgba(124, 77, 255, 0.18)', fg: '#7c4dff', label: 'REFLECT' },
  PLAN:    { bg: 'rgba(0, 188, 212, 0.18)',  fg: '#00bcd4', label: 'PLAN' },
  VERIFY:  { bg: 'rgba(255, 193, 7, 0.18)',  fg: '#ffc107', label: 'VERIFY' },
};
const REACT_STAGE_REGEX = new RegExp(
  `^(\\s*)(${Object.keys(REACT_STAGE_TONES).join('|')}):\\s*(.*)$`,
);

const ReactStageBadge: React.FC<{ stage: keyof typeof REACT_STAGE_TONES; rest: React.ReactNode }> = ({ stage, rest }) => {
  const tone = REACT_STAGE_TONES[stage];
  return (
    <>
      <span
        className={`react-stage react-stage-${stage.toLowerCase()}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '1px 7px',
          marginRight: 6,
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.4px',
          background: tone.bg,
          color: tone.fg,
          verticalAlign: 'middle',
        }}
      >
        {tone.label}
      </span>
      {rest}
    </>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// `file:line` inline reference pill — claude.ai/code-style clickable ref
// ────────────────────────────────────────────────────────────────────────────

// Matches tokens like `sudoku.py:30`, `src/foo.tsx:123`, `Makefile:10` (only
// when a dotted extension exists — deliberately excludes bare `Makefile`).
// Extension is 1–5 lowercase letters. Path chars: word, dot, slash, dash.
const FILE_LINE_REF_REGEX = /\b([\w.\-/]+\.[a-z]{1,5}):(\d+)\b/g;

const FileLineRefPill: React.FC<{ path: string; line: number }> = ({ path, line }) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      // EditorPanel does not yet listen for 'openInEditor' — TODO(codemode):
      // wire this into EditorPanel.tsx so the click actually jumps to the
      // referenced location. Until then we postMessage + console.log so
      // any listener that gets added later works without touching callers.
      window.postMessage({ type: 'openInEditor', path, line }, '*');
      // eslint-disable-next-line no-console
      console.log('[codemode] openInEditor', { path, line });
    } catch { /* noop */ }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      title={`Open ${path}:${line}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 6px',
        margin: '0 2px',
        border: '1px solid var(--cm-border, #30363d)',
        borderRadius: 4,
        background: 'var(--cm-bg-secondary, #161b22)',
        color: 'var(--cm-accent, #58a6ff)',
        fontFamily: MONO_FONT,
        fontSize: '0.92em',
        lineHeight: 1.4,
        cursor: 'pointer',
        verticalAlign: 'baseline',
      }}
    >
      <span>{path}</span>
      <span style={{ color: 'var(--cm-text-muted, #8b949e)' }}>:{line}</span>
    </button>
  );
};

/**
 * Walk a ReactMarkdown children array, replacing `file:line` tokens in
 * plain-text nodes with FileLineRefPill elements. Leaves nested React
 * elements (links, code, etc.) untouched so we don't double-process.
 */
function renderFileLineRefs(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child, idx) => {
    if (typeof child !== 'string') return child;
    FILE_LINE_REF_REGEX.lastIndex = 0;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    let pillIdx = 0;
    while ((m = FILE_LINE_REF_REGEX.exec(child)) !== null) {
      if (m.index > lastIndex) parts.push(child.slice(lastIndex, m.index));
      parts.push(
        <FileLineRefPill
          key={`fl-${idx}-${pillIdx++}`}
          path={m[1]}
          line={parseInt(m[2], 10)}
        />,
      );
      lastIndex = m.index + m[0].length;
    }
    if (parts.length === 0) return child;
    if (lastIndex < child.length) parts.push(child.slice(lastIndex));
    return <>{parts}</>;
  });
}

const MARKDOWN_COMPONENTS = {
  // Pass-through pre so prism's inner <pre> (inside SyntaxCodeBlock)
  // owns the styling. ReactMarkdown wraps fenced code in <pre><code>;
  // we render a fragment so SyntaxCodeBlock's wrapper isn't double-nested.
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  code: MarkdownCode,
  p: ({ children }: { children?: React.ReactNode }) => {
    const arr = React.Children.toArray(children);
    if (arr.length > 0 && typeof arr[0] === 'string') {
      const m = (arr[0] as string).match(REACT_STAGE_REGEX);
      if (m) {
        const [, leadingWs, stage, restOfFirstChild] = m;
        const stageKey = stage as keyof typeof REACT_STAGE_TONES;
        const remainingChildren = [restOfFirstChild, ...arr.slice(1)];
        return (
          <p>
            {leadingWs}
            <ReactStageBadge stage={stageKey} rest={renderFileLineRefs(remainingChildren)} />
          </p>
        );
      }
    }
    return <p>{renderFileLineRefs(children)}</p>;
  },
  li: ({ children }: { children?: React.ReactNode }) => (
    <li>{renderFileLineRefs(children)}</li>
  ),
};

const AssistantTextRow: React.FC<{ text: string; isFirstBlock: boolean }> = ({
  text,
  isFirstBlock,
}) => {
  if (!text) return null;
  // Document-style assistant block: no left bullet/gutter, full-width prose
  // with claude.ai-grade vertical rhythm. Keeps the .cm-markdown typography
  // (Inter + JetBrains Mono + syntax highlighter) but drops the CLI chrome.
  return (
    <div
      style={{
        margin: isFirstBlock ? '14px 0 6px 0' : '4px 0 6px 0',
        padding: '0 4px',
      }}
    >
      <div className="cm-markdown" style={{ color: 'var(--cm-text, #e6edf3)' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// Thinking row: `∴ Thinking` (collapsed) or `∴ Thinking…` + indented body
// ────────────────────────────────────────────────────────────────────────────

/**
 * Live elapsed-time hook: ticks every ~100ms while `active` is true,
 * returns seconds elapsed since mount/first-active. Used for the
 * thinking timer — matches openagentic TUI's live `Thinking… (3.2s)`.
 */
/**
 * Rotating verb phrases shown before actual thinking content arrives —
 * matches the openagentic chat mode's "Forging…" / "Reasoning…" style.
 */
const THINKING_VERBS = [
  'Thinking',
  'Reasoning',
  'Analyzing',
  'Considering',
  'Processing',
  'Evaluating',
  'Formulating',
  'Forging',
];

/**
 * Subtle thinking indicator — small pulsing ✶ to match claude.ai/code's
 * minimal in-flight ux. Replaces the prior canvas globe + glow strip.
 */
const ThinkingGlobe: React.FC<{ streaming: boolean; size?: number }> = ({ streaming, size = 10 }) => (
  <span
    aria-hidden
    style={{
      display: 'inline-block',
      width: size,
      height: size,
      borderRadius: '50%',
      background: 'currentColor',
      opacity: streaming ? 0.55 : 0,
      animation: streaming ? 'cm-thinking-pulse 1.4s ease-in-out infinite' : undefined,
      flexShrink: 0,
    }}
  />
);

/**
 * Streaming placeholder — claude.ai-style minimal indicator. A tiny
 * pulsing dot, a single muted verb, and the elapsed timer pushed all the
 * way right with no chrome. No border, no gradient, no glow.
 */
const StreamingPlaceholder: React.FC = () => {
  const [verbIdx, setVerbIdx] = useState(() => Math.floor(Math.random() * THINKING_VERBS.length));
  const elapsed = useElapsedTimer(true);

  useEffect(() => {
    const id = setInterval(() => {
      setVerbIdx((i) => (i + 1) % THINKING_VERBS.length);
    }, 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0',
        color: 'var(--cm-text-muted, #8b949e)',
        fontSize: 12,
        fontFamily: 'var(--cm-prose-font, Inter, system-ui, sans-serif)',
        fontWeight: 400,
      }}
    >
      <ThinkingGlobe streaming={true} size={6} />
      <span>{THINKING_VERBS[verbIdx]}…</span>
      {elapsed > 0.5 && (
        <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>
          {elapsed.toFixed(1)}s
        </span>
      )}
    </div>
  );
};

function useElapsedTimer(active: boolean): number {
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (startRef.current === null) startRef.current = Date.now();
    const tick = () => {
      setElapsed((Date.now() - startRef.current!) / 1000);
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [active]);
  return elapsed;
}

const PURPLE_COLOR = '#a371f7';

const ThinkingRow: React.FC<{ block: UiThinkingBlock; marginTop: number }> = ({
  block,
  marginTop,
}) => {
  // Collapse thinking by default to match claude.ai/code ref — large
  // local models (e.g. gpt-oss:20b) produce long internal monologues
  // that drown the transcript. User clicks to expand.
  const [userCollapsed, setUserCollapsed] = useState(true);
  const elapsed = useElapsedTimer(block.streaming);
  const charCount = block.thinking.length;
  const tokCount = Math.round(charCount / 4);
  const speed = elapsed > 0.2 ? Math.round(tokCount / elapsed) : 0;
  const showBody = !userCollapsed && (block.streaming || charCount > 0);

  if (!block.thinking && !block.streaming) return null;

  const timerStr = elapsed > 0 ? `${elapsed.toFixed(1)}s` : '';
  const tokenHint = tokCount > 5 ? `~${tokCount} tok` : '';
  const speedHint = speed > 0 ? `${speed} tok/s` : '';

  return (
    <div
      style={{
        marginTop,
        padding: '2px 0',
      }}
    >
      <button
        type="button"
        onClick={() => setUserCollapsed((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          color: 'var(--cm-text-muted, #8b949e)',
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          fontFamily: 'var(--cm-prose-font, Inter, system-ui, sans-serif)',
        }}
        title={showBody ? 'Click to collapse' : 'Click to expand'}
      >
        <ThinkingGlobe streaming={block.streaming} size={6} />
        <span>Thinking{block.streaming ? '…' : ''}</span>
        {timerStr && (
          <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>
            {timerStr}
          </span>
        )}
        {!showBody && !block.streaming && charCount > 0 && (
          <span style={{ opacity: 0.5 }}>(expand)</span>
        )}
      </button>
      {showBody && block.thinking && (
        <div
          style={{
            marginTop: 4,
            marginLeft: 14,
            paddingLeft: 10,
            borderLeft: '1px solid var(--cm-border, #30363d)',
            color: 'var(--cm-text-secondary, #8b949e)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 13,
            lineHeight: 1.55,
            fontFamily: 'var(--cm-prose-font, Inter, system-ui, sans-serif)',
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{block.thinking}</ReactMarkdown>
          {block.streaming && <span className="cm-cursor-blink" />}
        </div>
      )}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// Tool use row: `● Bash(npm install)` + expandable JSON card
// ────────────────────────────────────────────────────────────────────────────

const ToolUseRow: React.FC<{ block: UiToolUseBlock; isFirstBlock: boolean }> = ({
  block,
  isFirstBlock,
}) => {
  // Write/Edit/NotebookEdit show a line-numbered diff body that's
  // auto-expanded on render (matches claude.ai/code). Other tools stay
  // collapsed — the JSON body is rarely interesting for Bash/Read/etc.
  const isFileWrite = block.name === 'Write' || block.name === 'FileWrite' ||
    block.name === 'Edit' || block.name === 'FileEdit' || block.name === 'NotebookEdit';
  const [expanded, setExpanded] = useState(isFileWrite);
  const summary = renderToolInputSummary(block.name, block.input);

  // Plan-mode tools get a distinct card treatment (bordered + markdown-
  // rendered plan body) so the user visually understands the tool
  // invocation is a plan proposal, not a normal operation. Matches
  // openagentic's PlanApprovalMessage rendering.
  if (block.name === 'ExitPlanMode' || block.name === 'ExitPlanModeV2') {
    return (
      <PlanProposalCard block={block} isFirstBlock={isFirstBlock} />
    );
  }
  if (block.name === 'EnterPlanMode') {
    return (
      <Row gutter={isFirstBlock ? BLACK_CIRCLE : ''} gutterColor={'#5faec1'} marginTop={8}>
        <div
          style={{
            ...MONO_STYLE,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5ch',
            padding: '4px 10px',
            border: '1px solid #5faec1',
            borderRadius: 4,
            backgroundColor: 'rgba(95, 174, 193, 0.08)',
            color: '#5faec1',
            fontSize: 12,
          }}
        >
          <span>⏸</span>
          <span>entering plan mode</span>
        </div>
      </Row>
    );
  }

  const description = String((block.input as any)?.description ?? '');
  const titleText = description || summary || block.name;

  const header = (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline' }}>
      <span style={{ color: TEXT }}>{titleText}</span>
      {block.streaming && !block.result && (
        <span
          className="cm-spin"
          style={{ color: DIM, marginLeft: '1ch', fontSize: 11 }}
          aria-label="running"
        >
          ◐
        </span>
      )}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          ...MONO_STYLE,
          background: 'none',
          border: 'none',
          padding: 0,
          marginLeft: '1ch',
          color: DIM,
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        {expanded ? '[hide]' : '[show]'}
      </button>
    </div>
  );

  const hasSubTranscript =
    (block.name === 'Task' || block.name === 'Agent') &&
    Array.isArray(block.subBlocks) &&
    block.subBlocks.length > 0;

  return (
    <>
      <Row
        gutter={isFirstBlock ? BLACK_CIRCLE : ''}
        gutterColor={TEXT}
        marginTop={isFirstBlock ? 8 : 4}
      >
        {header}
        {expanded && isFileWrite ? (
          <FileWriteDiffBody block={block} />
        ) : expanded ? (
          <pre
            style={{
              ...MONO_STYLE,
              marginTop: 4,
              padding: '6px 8px',
              backgroundColor: BG_SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 4,
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: TEXT,
              fontSize: 12,
            }}
          >
            {block.input && Object.keys(block.input).length > 0
              ? JSON.stringify(block.input, null, 2)
              : block.partialInputJson || '(no input)'}
          </pre>
        ) : null}
      </Row>
      {hasSubTranscript && (
        <SubagentTranscript blocks={block.subBlocks!} />
      )}
      {/* Live stdout while tool is running — replaced by ToolResultSubRow when done */}
      {!block.result && block.liveOutput && (
        <Row gutter={BOTTOM_LEFT_CORNER} gutterColor={DIM} marginTop={2}>
          <pre
            style={{
              ...MONO_STYLE,
              color: DIM,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontSize: 12,
              margin: 0,
            }}
          >
            {block.liveOutput}
          </pre>
        </Row>
      )}
      {block.result && <ToolResultSubRow result={block.result} toolName={block.name} />}
    </>
  );
};

/**
 * Nested child transcript for Task / Agent tool invocations. openagentic
 * spawns a sub-LLM whose stream_event records arrive on the parent
 * stream with `parent_tool_use_id` pointing at the Task tool_use id —
 * see useCodeModeChat.applyStreamEventRouted. We render the resulting
 * subBlocks indented to the right with a vertical rule so the user can
 * see what the subagent is doing inside the parent card.
 */
const SubagentTranscript: React.FC<{ blocks: AssistantBlock[] }> = ({ blocks }) => {
  // Reuse the same first-content-index rule as the top-level assistant
  // body, so only the leading subagent block gets the `●` gutter.
  const firstContentIndex = blocks.findIndex((b) => {
    if (b.kind === 'text') return b.text.length > 0;
    if (b.kind === 'thinking') return b.thinking.length > 0;
    return true;
  });
  return (
    <div
      style={{
        marginLeft: 12,
        paddingLeft: 10,
        marginTop: 4,
        borderLeft: `2px solid ${BORDER}`,
      }}
    >
      {blocks.map((b, idx) => (
        <AssistantBlockRow
          key={idx}
          block={b}
          index={idx}
          firstContentIndex={firstContentIndex}
        />
      ))}
    </div>
  );
};

/**
 * Rendered beneath a ToolUseRow once the result arrives. Matches
 * openagentic's `⎿` indent marker. Long output collapses to a single
 * preview line with a [show more] toggle, to keep the transcript
 * scannable. Errors are styled red.
 */
/**
 * Extract URLs from text for WebSearch favicon rendering.
 */
function extractUrls(text: string): Array<{ url: string; domain: string; snippet: string }> {
  const urlRe = /https?:\/\/[^\s<>"')\]]+/g;
  const results: Array<{ url: string; domain: string; snippet: string }> = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = urlRe.exec(text)) !== null) {
    const raw = match[0].replace(/[.,;:!?]+$/, '');
    try {
      const parsed = new URL(raw);
      if (seen.has(parsed.hostname)) continue;
      seen.add(parsed.hostname);
      const start = Math.max(0, match.index - 40);
      const end = Math.min(text.length, match.index + raw.length + 60);
      const snippet = text.slice(start, end).replace(raw, '').trim().slice(0, 80);
      results.push({ url: raw, domain: parsed.hostname, snippet });
    } catch { /* skip */ }
  }
  return results;
}

/**
 * Line-numbered diff body for Write/Edit/NotebookEdit tool cards.
 * Mirrors claude.ai/code's inline file-creation card: shows the new
 * content with a `+` gutter and line numbers, collapsed after 20 lines
 * with a `Show full diff (N more lines)` affordance.
 */
const FILE_DIFF_PREVIEW_LINES = 20;
const FileWriteDiffBody: React.FC<{ block: UiToolUseBlock }> = ({ block }) => {
  const [showAll, setShowAll] = useState(false);
  let input = (block.input || {}) as Record<string, unknown>;
  // Some provider streams (e.g. Responses API via AIF) accumulate
  // input_json_delta fragments without ever flushing a final parsed
  // object onto block.input. Fall back to parsing partialInputJson.
  // We take the LAST complete JSON object in the buffer because the
  // stream sometimes emits `{}{real}` — the real payload is the tail.
  if (Object.keys(input).length === 0 && block.partialInputJson) {
    const raw = block.partialInputJson.trim();
    const lastOpen = raw.lastIndexOf('{');
    for (let start = 0; start <= lastOpen; start++) {
      if (raw[start] !== '{') continue;
      try {
        const parsed = JSON.parse(raw.slice(start));
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          input = parsed as Record<string, unknown>;
          break;
        }
      } catch { /* try next offset */ }
    }
  }
  // Write → input.content; Edit → input.new_string; NotebookEdit → input.new_source
  const body = (input.content ?? input.new_string ?? input.new_source ?? input.text ?? '') as string;
  if (typeof body !== 'string' || body.length === 0) {
    return (
      <div style={{ ...MONO_STYLE, marginTop: 4, color: DIM, fontSize: 12 }}>
        (empty write)
      </div>
    );
  }
  const lines = body.split('\n');
  const visible = showAll ? lines : lines.slice(0, FILE_DIFF_PREVIEW_LINES);
  const hiddenCount = lines.length - visible.length;
  const gutterWidth = String(lines.length).length + 1;
  const isEdit = block.name === 'Edit' || block.name === 'FileEdit';
  const addColor = '#3fb950';
  return (
    <div
      style={{
        ...MONO_STYLE,
        marginTop: 4,
        padding: '6px 0',
        backgroundColor: BG_SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 4,
        fontSize: 12,
        color: TEXT,
      }}
    >
      {visible.map((line, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            padding: '0 10px',
            backgroundColor: 'rgba(63, 185, 80, 0.08)',
            whiteSpace: 'pre',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: `${gutterWidth}ch`,
              color: DIM,
              textAlign: 'right',
              marginRight: 8,
              flexShrink: 0,
              userSelect: 'none',
            }}
          >
            {i + 1}
          </span>
          <span style={{ color: addColor, marginRight: 8, flexShrink: 0, userSelect: 'none' }}>
            +
          </span>
          <span style={{ flex: 1, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
            {line || '\u00A0'}
          </span>
        </div>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          style={{
            ...MONO_STYLE,
            background: 'none',
            border: 'none',
            padding: '6px 10px',
            color: ACCENT,
            cursor: 'pointer',
            fontSize: 12,
            textAlign: 'left',
            width: '100%',
          }}
        >
          Show full {isEdit ? 'edit' : 'diff'} ({hiddenCount} more line{hiddenCount === 1 ? '' : 's'})
        </button>
      )}
    </div>
  );
};

const ToolResultSubRow: React.FC<{ result: UiToolResult; toolName?: string }> = ({ result, toolName }) => {
  const [expanded, setExpanded] = useState(false);

  const text = result.text || (result.isError ? '(error)' : '(no output)');
  const lines = text.split('\n');
  const isLong = lines.length > 5 || text.length > 500;
  const previewLines = lines.slice(0, 5);
  const showExpanded = expanded || !isLong;

  const color = result.isError ? ERROR_COLOR : DIM;
  const bodyColor = result.isError ? ERROR_COLOR : TEXT;

  // WebSearch: render with favicons
  const isSearch = toolName === 'WebSearch';
  const urls = isSearch ? extractUrls(text) : [];

  if (isSearch && urls.length > 0) {
    return (
      <div className="cm-fade-in">
        <Row gutter={BOTTOM_LEFT_CORNER} gutterColor={color} marginTop={2}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '6px 8px',
              backgroundColor: BG_SURFACE,
              border: '1px solid ' + BORDER,
              borderRadius: 5,
            }}
          >
            {urls.slice(0, 5).map((u) => (
              <div
                key={u.domain}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
              >
                <img
                  src={'https://www.google.com/s2/favicons?sz=32&domain=' + u.domain}
                  alt=""
                  style={{ width: 14, height: 14, borderRadius: 2, flexShrink: 0 }}
                />
                <a
                  href={u.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: ACCENT,
                    textDecoration: 'none',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {u.domain}
                </a>
                {u.snippet && (
                  <span
                    style={{
                      color: DIM,
                      fontSize: 11,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {u.snippet}
                  </span>
                )}
              </div>
            ))}
            {urls.length > 5 && (
              <div style={{ fontSize: 11, color: DIM }}>+{urls.length - 5} more</div>
            )}
          </div>
        </Row>
      </div>
    );
  }

  return (
    <div className="cm-fade-in">
    <Row gutter={BOTTOM_LEFT_CORNER} gutterColor={color} marginTop={2}>
      {showExpanded ? (
        <pre
          style={{
            ...MONO_STYLE,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: bodyColor,
          }}
        >
          {text}
        </pre>
      ) : (
        <pre
          style={{
            ...MONO_STYLE,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: bodyColor,
          }}
        >
          {previewLines.join('\n')}
        </pre>
      )}
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            ...MONO_STYLE,
            background: 'none',
            border: 'none',
            padding: 0,
            marginTop: 2,
            color: DIM,
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          {expanded ? 'Show less' : `Show ${lines.length - 5} more`}
        </button>
      )}
    </Row>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// System / error rows
// ────────────────────────────────────────────────────────────────────────────

const SystemRow: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      ...MONO_STYLE,
      color: DIM,
      fontStyle: 'italic',
      textAlign: 'center',
      marginTop: 8,
    }}
  >
    {text}
  </div>
);

const ErrorRow: React.FC<{ text: string }> = ({ text }) => (
  <Row gutter="!" gutterColor={ERROR_COLOR} marginTop={8}>
    <div style={{ color: ERROR_COLOR, whiteSpace: 'pre-wrap' }}>{text}</div>
  </Row>
);

// ────────────────────────────────────────────────────────────────────────────
// Assistant block dispatcher
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Breadcrumb pills (top of assistant turn) — lifecycle summary
// ────────────────────────────────────────────────────────────────────────────

/**
 * Small "chip" pill used for breadcrumb events and the Ran-N-commands
 * summary. Matches claude.ai/code's muted capsule style.
 */
const CmChip: React.FC<{
  icon?: React.ReactNode;
  label: string;
  tone?: 'default' | 'success';
  onClick?: () => void;
  title?: string;
}> = ({ icon, label, tone = 'default', onClick, title }) => {
  const color = tone === 'success' ? 'var(--cm-success, #3fb950)' : 'var(--cm-text-muted, #8b949e)';
  return (
    <span
      onClick={onClick}
      title={title}
      role={onClick ? 'button' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 999,
        border: '1px solid var(--cm-border, #30363d)',
        background: 'var(--cm-bg-secondary, #161b22)',
        color,
        fontSize: 11,
        lineHeight: 1.5,
        fontFamily: 'var(--cm-prose-font, Inter, system-ui, sans-serif)',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {icon && <span aria-hidden style={{ display: 'inline-flex' }}>{icon}</span>}
      <span>{label}</span>
    </span>
  );
};

/**
 * Derive the lifecycle breadcrumb labels for an assistant turn.
 * Heuristics:
 *   - "Initialized session" + "Started Openagentic" → only on the first
 *     assistant turn (the one that carried the system_init).
 *   - "Cloned repository" → any Bash tool whose command string contains
 *     `git clone`.
 *   - "Created a file" → any Write / FileWrite tool.
 *   - "Edited a file" → any Edit / FileEdit / NotebookEdit tool.
 *   - "Ran a command" → any Bash tool that isn't already folded in as
 *     a clone (to avoid duplicate chips).
 */
function deriveBreadcrumbs(
  message: AssistantChatMessage,
  isFirstAssistantTurn: boolean,
): string[] {
  const out: string[] = [];
  if (isFirstAssistantTurn) {
    out.push('Initialized session');
    out.push('Started Openagentic');
  }
  const toolUses = message.blocks.filter((b): b is UiToolUseBlock => b.kind === 'tool_use');
  let sawClone = false;
  let sawWrite = false;
  let sawEdit = false;
  let sawOtherBash = false;
  for (const t of toolUses) {
    const name = t.name;
    if (name === 'Bash' || name === 'BashTool') {
      const cmd = String(t.input?.command ?? '');
      if (/\bgit\s+clone\b/.test(cmd)) sawClone = true;
      else sawOtherBash = true;
    } else if (name === 'Write' || name === 'FileWrite') {
      sawWrite = true;
    } else if (name === 'Edit' || name === 'FileEdit' || name === 'NotebookEdit') {
      sawEdit = true;
    }
  }
  if (sawClone) out.push('Cloned repository');
  if (sawWrite) out.push('Created a file');
  if (sawEdit) out.push('Edited a file');
  if (sawOtherBash) out.push('Ran a command');
  return out;
}

const BreadcrumbPills: React.FC<{ labels: string[] }> = ({ labels }) => {
  if (labels.length === 0) return null;
  return (
    <details
      style={{
        margin: '6px 0 4px 4px',
        color: 'var(--cm-text-muted, #7d8590)',
        fontSize: 13,
      }}
    >
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: 'var(--cm-success, #3fb950)' }}>●</span>
        <span>{labels[labels.length - 1]}</span>
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0 0 16px' }}>
        {labels.map((l) => (
          <span key={l} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
            <span style={{ fontSize: 8, color: 'var(--cm-success, #3fb950)' }}>●</span> {l}
          </span>
        ))}
      </div>
    </details>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// "Ran N commands" summary (bottom of assistant turn) — collapsible card
// ────────────────────────────────────────────────────────────────────────────

const RanNCommandsSummary: React.FC<{ toolUses: UiToolUseBlock[] }> = ({ toolUses }) => {
  const [expanded, setExpanded] = useState(false);
  const n = toolUses.length;
  if (n === 0) return null;
  return (
    <div style={{ margin: '6px 4px 10px 4px' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 6,
          border: '1px solid var(--cm-border, #30363d)',
          background: 'var(--cm-bg-secondary, #161b22)',
          color: 'var(--cm-text-muted, #8b949e)',
          fontSize: 12,
          lineHeight: 1.4,
          fontFamily: 'var(--cm-prose-font, Inter, system-ui, sans-serif)',
          cursor: 'pointer',
        }}
        aria-expanded={expanded}
      >
        <span aria-hidden>{expanded ? '▾' : '▸'}</span>
        <span>Ran {n} command{n === 1 ? '' : 's'}</span>
      </button>
      {expanded && (
        <ul
          style={{
            listStyle: 'none',
            margin: '6px 0 0 0',
            padding: '6px 10px',
            border: '1px solid var(--cm-border, #30363d)',
            borderRadius: 6,
            background: 'var(--cm-bg-secondary, #161b22)',
            fontSize: 12,
            fontFamily: MONO_FONT,
            color: 'var(--cm-text, #e6edf3)',
          }}
        >
          {toolUses.map((t, i) => {
            const summary = renderToolInputSummary(t.name, t.input || {});
            const isError = t.result?.isError === true;
            return (
              <li
                key={t.toolUseId || i}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  padding: '2px 0',
                  borderTop: i === 0 ? 'none' : '1px dashed var(--cm-border, #30363d)',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    color: isError ? 'var(--cm-error, #f85149)' : 'var(--cm-success, #3fb950)',
                    fontSize: 10,
                  }}
                >
                  {isError ? '✕' : '✓'}
                </span>
                <span style={{ color: 'var(--cm-accent, #58a6ff)', fontWeight: 600 }}>{t.name}</span>
                {summary && (
                  <span
                    style={{
                      color: 'var(--cm-text-muted, #8b949e)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {summary}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const AssistantBlockRow: React.FC<{
  block: AssistantBlock;
  index: number;
  firstContentIndex: number;
}> = ({ block, index, firstContentIndex }) => {
  const isFirstBlock = index === firstContentIndex;

  if (block.kind === 'text') {
    return <AssistantTextRow text={block.text} isFirstBlock={isFirstBlock} />;
  }
  if (block.kind === 'thinking') {
    return <ThinkingRow block={block} marginTop={isFirstBlock ? 8 : 4} />;
  }
  return <ToolUseRow block={block} isFirstBlock={isFirstBlock} />;
};

const AssistantMessageBody: React.FC<{
  message: AssistantChatMessage;
  isFirstAssistantTurn?: boolean;
}> = ({ message, isFirstAssistantTurn = false }) => {
  // Find the index of the first block with any visible content — used so
  // only the leading block gets the `●` gutter (matches openagentic where
  // shouldShowDot is true only for the first rendered block of the turn).
  const firstContentIndex = message.blocks.findIndex((b) => {
    if (b.kind === 'text') return b.text.length > 0;
    if (b.kind === 'thinking') return b.thinking.length > 0;
    return true; // tool_use always shows
  });

  const hasAny = firstContentIndex >= 0;

  // Breadcrumb pills — lifecycle summary for the turn's setup events.
  const breadcrumbs = deriveBreadcrumbs(message, isFirstAssistantTurn);
  // Tool uses for the "Ran N commands" summary card.
  const toolUses = message.blocks.filter(
    (b): b is UiToolUseBlock => b.kind === 'tool_use',
  );

  return (
    <>
      {/* Breadcrumb pills removed — claude code CLI shows each tool
          inline without a per-turn setup summary. */}
      {!hasAny && message.streaming && (
        <Row gutter={BLACK_CIRCLE} gutterColor={ACCENT} marginTop={8}>
          <StreamingPlaceholder />
        </Row>
      )}
      {message.blocks.map((block, i) => (
        <AssistantBlockRow
          key={i}
          block={block}
          index={i}
          firstContentIndex={firstContentIndex}
        />
      ))}
      {/* Blinking caret removed — was rendering per streaming assistant
          message, causing multiple cursors throughout the interleave.
          Claude code CLI (PTY) shows a single spinner in the footer
          while streaming; the StreamingPlaceholder at the top of a new
          turn serves that purpose here. */}
      {/* Claude code CLI (PTY) renders tools inline without any per-turn
          rollup summary. "Ran N commands" + the startup breadcrumb are
          both off by default — each tool_use + tool_result reads cleanly
          on its own inline. Cost/session stats live in the bottom status bar. */}
    </>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// Top-level MessageRow — dispatch by role
// ────────────────────────────────────────────────────────────────────────────

/**
 * Plan proposal card — rendered in place of the generic tool_use card
 * when the assistant invokes ExitPlanMode (or the v2 variant). Shows:
 *   - a distinctive bordered frame with the plan mode teal color
 *   - the plan text rendered as markdown
 *   - Accept / Reject buttons (currently visual only — see task #40 for
 *     the bidirectional control_response backend wire-up; today the
 *     buttons are informational)
 *
 * Source (for 1:1 parity): openagentic/src/components/permissions/ExitPlanModePermissionRequest/
 */
const PlanProposalCard: React.FC<{
  block: UiToolUseBlock;
  isFirstBlock: boolean;
}> = ({ block, isFirstBlock }) => {
  const planText = (block.input?.plan as string) ?? '';
  const planFilePath = (block.input?.planFilePath as string) ?? '';
  const streaming = block.streaming && !block.result;

  return (
    <Row
      gutter={isFirstBlock ? BLACK_CIRCLE : ''}
      gutterColor={'#5faec1'}
      marginTop={10}
    >
      <div
        className="cm-fade-in"
        style={{
          ...MONO_STYLE,
          border: '1px solid #5faec1',
          borderRadius: 6,
          backgroundColor: 'rgba(95, 174, 193, 0.06)',
          padding: 10,
          marginRight: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '0.6ch',
            borderBottom: '1px solid rgba(95, 174, 193, 0.35)',
            paddingBottom: 6,
            marginBottom: 8,
            color: '#5faec1',
            fontWeight: 600,
          }}
        >
          <span>⏸</span>
          <span>Plan proposal</span>
          {streaming && (
            <span className="cm-thinking-pulse" style={{ color: DIM, marginLeft: '1ch', fontWeight: 'normal' }}>
              drafting…
            </span>
          )}
          {planFilePath && (
            <span style={{ flex: 1, textAlign: 'right', fontSize: 11, color: DIM, fontWeight: 'normal' }}>
              {planFilePath.replace(/^.*\//, '')}
            </span>
          )}
        </div>
        {planText ? (
          <div className="cm-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{planText}</ReactMarkdown>
          </div>
        ) : (
          <div style={{ color: DIM, fontStyle: 'italic', fontSize: 12 }}>
            (plan content not yet available — openagentic injects it from
            {planFilePath ? ` ${planFilePath}` : ' the plan file'})
          </div>
        )}
        {block.result ? (
          <div
            style={{
              marginTop: 8,
              paddingTop: 6,
              borderTop: '1px solid rgba(95, 174, 193, 0.35)',
              color: block.result.isError ? ERROR_COLOR : SUCCESS,
              fontSize: 11,
            }}
          >
            {block.result.isError ? '✕ plan rejected' : '✓ plan accepted'}
          </div>
        ) : !streaming ? (
          // Informational hint — full interactive Accept/Reject wiring
          // is task #40 (needs bidirectional exec daemon channel).
          // Until then, the user replies in natural language.
          <div
            style={{
              marginTop: 8,
              paddingTop: 6,
              borderTop: '1px solid rgba(95, 174, 193, 0.35)',
              color: DIM,
              fontSize: 11,
              display: 'flex',
              gap: '1ch',
              alignItems: 'center',
            }}
          >
            <span>reply with </span>
            <span
              style={{
                color: SUCCESS,
                border: `1px solid ${SUCCESS}`,
                borderRadius: 3,
                padding: '1px 6px',
              }}
            >
              yes / approve
            </span>
            <span> or </span>
            <span
              style={{
                color: ERROR_COLOR,
                border: `1px solid ${ERROR_COLOR}`,
                borderRadius: 3,
                padding: '1px 6px',
              }}
            >
              reject
            </span>
          </div>
        ) : null}
      </div>
    </Row>
  );
};

export const MessageRow: React.FC<{
  message: ChatMessage;
  /** True if this is the first assistant-role message in the transcript —
   *  drives the "Initialized session / Started Openagentic" breadcrumb
   *  chips. The parent computes this in one pass so we don't have to
   *  scan the entire transcript per-row. */
  isFirstAssistantTurn?: boolean;
}> = ({ message, isFirstAssistantTurn }) => {
  if (message.role === 'user') return <UserRow text={message.text} />;
  if (message.role === 'system') return <SystemRow text={message.text} />;
  if (message.role === 'error') return <ErrorRow text={message.text} />;
  return (
    <AssistantMessageBody
      message={message as AssistantChatMessage}
      isFirstAssistantTurn={isFirstAssistantTurn}
    />
  );
};

export default MessageRow;
