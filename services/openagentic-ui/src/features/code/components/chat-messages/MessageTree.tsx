import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { rehypeSemanticTokens } from '@/features/shared/markdown/rehypeSemanticTokens';
import { rehypeRainbowInlineCode } from '@/features/shared/markdown/rehypeRainbowInlineCode';
import { normalizeLatexDelimiters } from '@/features/shared/markdown/normalizeLatexDelimiters';
import { Highlight, themes as prismThemes } from 'prism-react-renderer';
import { ThinkingSphere } from '@/shared/components/ThinkingSphere';
import type {
  AssistantBlock,
  AssistantChatMessage,
  ChatMessage,
  UiThinkingBlock,
  UiToolResult,
  UiToolUseBlock,
} from '../../types/uiState';
import type { CanUseToolRequest } from '../../types/_sdk-bindings';
import { renderToolInputSummary } from './toolRenderers';
import { formatElapsed } from '../../chat/sdkAdapter';
import { deriveCurrentActivity } from '../../utils/deriveCurrentActivity';
import { Part } from '../Part';
import { groupParallelTools } from '../../state/streamReducer';
import {
  InlinePermissionCard,
  type PermissionDecision,
} from './InlinePermissionCard';
import { UserTextMessageDispatch } from './UserTextMessageDispatch';

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
// already used by CodeModeChatView and CodeModeLayout so themes apply
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

// C.2 P1 — matches mocks/codemode-mockup.html .msg-user pattern:
//   <div class="msg-user">
//     <span class="prompt-marker">❯</span>
//     <span class="content">…</span>
//   </div>
// Drops the prior teal pill bubble; user wants the OpenAgentic TUI feel.
const UserRow: React.FC<{ text: string }> = ({ text }) => (
  <div
    data-part="user-prompt"
    className="cm-msg-row cm-msg-user"
    style={{
      margin: '12px 0 8px 0',
      fontFamily: 'var(--cm-mono-font, JetBrains Mono, monospace)',
      fontSize: 13,
      lineHeight: 1.5,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}
  >
    <span className="cm-prompt-marker">❯</span>
    <span className="cm-prompt-content" style={{ color: 'var(--fg-0, #e6edf3)' }}>
      {text}
    </span>
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
  // `html-artifact` is a special fence used by slash commands (e.g.
  // /selftest) to embed a sandboxed inline HTML preview directly in the
  // transcript. Renders as an iframe with `srcdoc` so the artifact
  // displays without leaving the codemode view.
  if ((langMatch?.[1] || '') === 'html-artifact') {
    // MARKER_HTML_ARTIFACT_BLOCK_v2
    return <HtmlArtifactBlock html={text} />;
  }
  return <SyntaxCodeBlock code={text} lang={langMatch?.[1] || ''} />;
};

const HtmlArtifactBlock: React.FC<{ html: string }> = ({ html }) => {
  const openInTab = () => {
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  };
  return (
    <div className="cm-html-artifact" data-part="html-artifact" style={{
      margin: '10px 0',
      border: '1px solid var(--cm-border, #30363d)',
      borderRadius: 8,
      overflow: 'hidden',
      background: '#06070a',
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        borderBottom: '1px solid var(--cm-border, #30363d)',
        background: 'var(--cm-bg-secondary, #161b22)',
        fontFamily: 'var(--cm-mono-font, ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace)',
        fontSize: 11,
        color: 'var(--cm-text-muted, #8b949e)',
        letterSpacing: '0.04em',
      }}>
        <span style={{ color: 'var(--cm-accent, #58a6ff)', fontWeight: 600 }}>◉</span>
        <span>html artifact</span>
        <span style={{ color: '#3a3f47', margin: '0 4px' }}>·</span>
        <span>{(html.length / 1024).toFixed(1)}KB</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={openInTab} style={{
          background: 'transparent',
          border: '1px solid var(--cm-border, #30363d)',
          color: 'var(--cm-text-muted, #8b949e)',
          padding: '2px 8px',
          borderRadius: 4,
          fontFamily: 'inherit',
          fontSize: 10,
          letterSpacing: '0.06em',
          cursor: 'pointer',
        }}>open in tab ↗</button>
      </div>
      <iframe
        title="html-artifact"
        srcDoc={html}
        sandbox="allow-scripts allow-same-origin"
        loading="lazy"
        style={{ display: 'block', width: '100%', height: 480, border: 0, background: '#06070a' }}
      />
    </div>
  );
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
      // TODO(codemode): wire up a pop-out window listener that receives
      // 'openInEditor' and jumps to the referenced file+line location.
      // Until then we postMessage + console.log so any future listener
      // works without touching callers.
      window.postMessage({ type: 'openInEditor', path, line }, window.location.origin);
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
  li: ({ children }: { children?: React.ReactNode }) => {
    // mock-3 parity: a list item that opens with a ReAct stage marker
    // (e.g. `OBSERVE: …`, `PLAN: …`) wears the same colored pill as
    // paragraph-level marker handling above. ReactMarkdown wraps the
    // <li> body's loose text in a <p>, so the first child is often a
    // <p>; we peek into it for the leading text.
    const arr = React.Children.toArray(children);
    if (arr.length > 0) {
      // Find the first text node, descending one level into a <p> if
      // the first child is one. We never go deeper — if remarkGfm wraps
      // it in something else we just fall through to the no-badge path.
      let firstString: string | undefined;
      let consumeFromIdx = -1;
      let extractFromP = false;
      const first = arr[0];
      if (typeof first === 'string') {
        firstString = first;
        consumeFromIdx = 0;
      } else if (
        React.isValidElement<{ children?: React.ReactNode }>(first) &&
        first.type === 'p'
      ) {
        const pChildren = React.Children.toArray(first.props.children);
        if (pChildren.length > 0 && typeof pChildren[0] === 'string') {
          firstString = pChildren[0];
          consumeFromIdx = 0;
          extractFromP = true;
        }
      }
      if (firstString !== undefined) {
        const m = firstString.match(REACT_STAGE_REGEX);
        if (m) {
          const [, leadingWs, stage, restOfFirstChild] = m;
          const stageKey = stage as keyof typeof REACT_STAGE_TONES;
          if (extractFromP) {
            // Replace the first <p>'s leading text with badge + rest,
            // keep the rest of the <p>'s children, then any siblings.
            const firstEl = first as React.ReactElement<{ children?: React.ReactNode }>;
            const pChildren = React.Children.toArray(firstEl.props.children);
            const remainingPChildren = [restOfFirstChild, ...pChildren.slice(consumeFromIdx + 1)];
            const newP = React.cloneElement(
              firstEl,
              { key: 'li-stage-p' },
              <>
                {leadingWs}
                <ReactStageBadge
                  stage={stageKey}
                  rest={renderFileLineRefs(remainingPChildren)}
                />
              </>,
            );
            return <li>{[newP, ...arr.slice(1)]}</li>;
          }
          const remainingChildren = [restOfFirstChild, ...arr.slice(1)];
          return (
            <li>
              {leadingWs}
              <ReactStageBadge stage={stageKey} rest={renderFileLineRefs(remainingChildren)} />
            </li>
          );
        }
      }
    }
    return <li>{renderFileLineRefs(children)}</li>;
  },
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
        <ReactMarkdown
          remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
          rehypePlugins={[rehypeSemanticTokens, [rehypeKatex as any, { strict: false, throwOnError: false, output: 'html' }]]}
          components={MARKDOWN_COMPONENTS}
        >
          {normalizeLatexDelimiters(text)}
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

/**
 * Extract the first sentence of a thinking blob for the collapsed-row
 * preview. Bounded at 140 chars so a sentence-less monologue still gives
 * the user a glanceable hint instead of an empty button.
 */
export function firstSentencePreview(text: string): string {
  if (!text) return '';
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const m = trimmed.match(/^.+?[.!?](?=\s|$)/);
  const sentence = (m ? m[0] : trimmed).trim();
  return sentence.length <= 140 ? sentence : sentence.slice(0, 137).trimEnd() + '…';
}

const ThinkingRow: React.FC<{ block: UiThinkingBlock; marginTop: number }> = ({
  block,
  marginTop,
}) => {
  // Default-COLLAPSED to match openagentic/Claude Code TUI parity. User
  // feedback 2026-05-07: "thinking bar is printing the whole thing- and
  // how does ~/anthropic/src and openagentic show thinking- we want
  // thinking to be more like claude/openagentic not blocks inline users
  // will never read." Reference: openagentic
  // src/components/messages/AssistantThinkingMessage.tsx — single
  // `∴ Thinking <Ctrl-O to expand>` dim-italic line by default; full
  // body only when user toggles. Streaming thinking still shows the
  // animated dot + `Thinking…` label so the user knows reasoning is
  // in flight, but the wall of CoT is gated behind one click.
  const [userExpanded, setUserExpanded] = useState(false);
  const elapsed = useElapsedTimer(block.streaming);
  const charCount = block.thinking.length;
  const tokCount = Math.round(charCount / 4);
  const showBody = userExpanded && charCount > 0;
  const preview = '';

  if (!block.thinking && !block.streaming) return null;

  const timerStr = elapsed > 0 ? `${elapsed.toFixed(1)}s` : '';

  return (
    <div
      style={{
        marginTop,
        padding: '2px 0',
      }}
    >
      <button
        type="button"
        onClick={() => setUserExpanded((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          color: 'var(--cm-text-muted, #8b949e)',
          cursor: charCount > 0 ? 'pointer' : 'default',
          textAlign: 'left',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12.5,
          fontStyle: 'italic',
          fontFamily: 'var(--cm-prose-font, Inter, system-ui, sans-serif)',
        }}
        title={charCount === 0 ? '' : showBody ? 'Click to collapse' : 'Click to expand'}
      >
        <span aria-hidden style={{ fontStyle: 'normal', opacity: 0.7 }}>∴</span>
        <span>{block.streaming ? 'Thinking…' : 'Thinking'}</span>
        {timerStr && (
          <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.55, fontStyle: 'normal' }}>
            {timerStr}
          </span>
        )}
        {!showBody && charCount > 0 && (
          <span style={{ opacity: 0.45, fontStyle: 'normal' }}>· click to expand</span>
        )}
        {showBody && charCount > 0 && (
          <span style={{ opacity: 0.45, fontStyle: 'normal' }}>· click to collapse</span>
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
          <ReactMarkdown
            remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
            rehypePlugins={[rehypeSemanticTokens, rehypeRainbowInlineCode, [rehypeKatex as any, { strict: false, throwOnError: false, output: 'html' }]]}
            components={MARKDOWN_COMPONENTS}
          >{normalizeLatexDelimiters(block.thinking)}</ReactMarkdown>
          {block.streaming && <span className="cm-cursor-blink" />}
        </div>
      )}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// Tool use row: `● Bash(npm install)` + expandable JSON card
// ────────────────────────────────────────────────────────────────────────────

const ToolUseRow: React.FC<{
  block: UiToolUseBlock;
  isFirstBlock: boolean;
  /**
   * Phase F (codemode-permanent-plan §4) — when set, renders an
   * `InlinePermissionCard` inside this Tool's panel (after the
   * sub-transcript and live output, before the tool_result row). The
   * caller is `AssistantMessageBody`, which routes the panel based on
   * `pendingPermission.parent_tool_use_id`. Optional + null-default
   * preserves the single-agent path (tail mount in
   * `AssistantMessageBody`).
   */
  inlinePermission?: {
    request: CanUseToolRequest & { request_id: string };
    onRespond: (decision: PermissionDecision) => void;
  } | null;
}> = ({ block, isFirstBlock, inlinePermission }) => {
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
      {block.streaming && !block.result && typeof block.elapsedSec === 'number' && block.elapsedSec > 0 && (
        <span
          style={{ color: DIM, marginLeft: '1ch', fontSize: 11 }}
          aria-label={`running for ${block.elapsedSec} seconds`}
        >
          · {formatElapsed(block.elapsedSec)}
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
    // Phase F: wrap in a transparent (`display: contents`) container that
    // tags the panel with `data-tool-use-id`. Visual layout is unchanged
    // (children flow exactly as siblings of the parent), but the DOM now
    // exposes a stable selector the InlinePermissionCard can use to
    // resolve which subagent's panel a permission request belongs to.
    <div data-tool-use-id={block.toolUseId} style={{ display: 'contents' }}>
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
      {/* Phase F: subagent-scoped permission card. Mounts inline at the
          end of THIS Task panel when the daemon-side
          `parent_tool_use_id` envelope flag matches this block's id.
          The single-agent / root case (parent_tool_use_id == null) is
          handled by `AssistantMessageBody` below — it keeps rendering
          the card at the message tail so single-turn flows are
          unchanged. */}
      {inlinePermission && (
        <InlinePermissionCard
          request={inlinePermission.request}
          onRespond={inlinePermission.onRespond}
        />
      )}
    </div>
  );
};

/**
 * Nested child transcript for Task / Agent tool invocations. openagentic
 * spawns a sub-LLM whose stream_event records arrive on the parent
 * stream with `parent_tool_use_id` pointing at the Task tool_use id —
 * see useCodeModeChat.applyStreamEventRouted. As of Phase 3 of the
 * codemode-bridge plan we render each sub-block through `<Part />` so
 * parallel subagents and their tool calls flow through the same
 * dispatcher as the top-level transcript — matching Claude Code's
 * inline rendering. The `cm-subtranscript` className lets the styling
 * system add the indented left-border on every nesting level.
 */
const SubagentTranscript: React.FC<{ blocks: AssistantBlock[]; depth?: number }> = ({
  blocks,
  depth = 1,
}) => (
  <div
    className="cm-subtranscript"
    style={{
      marginLeft: 12,
      paddingLeft: 10,
      marginTop: 4,
      borderLeft: `2px solid ${BORDER}`,
    }}
  >
    {blocks.map((b, idx) => (
      <Part key={idx} part={b} depth={depth} />
    ))}
  </div>
);

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

// Provider-tool result body — pretty-prints structured JSON the
// openagentic `Provider` tool emits via JSON.stringify. Live bug
// 2026-04-30: the raw payload `{"action":"current","model":"gpt-oss:20b",
// "isOverride":true}` was leaking into the transcript; this renderer
// parses it and prints `Model: gpt-oss:20b / Override: yes` instead.
//
// Also exported so unit tests in Part.test.tsx can drive the same
// formatter without depending on MessageTree's private internals (the
// Part.tsx `ProviderTool` renderer uses a sibling implementation —
// keep both in sync).
type ProviderResultPayload =
  | { action: 'current'; model: string; isOverride: boolean }
  | { action: 'switch'; previousModel: string; newModel: string; reason?: string }
  | { action: 'reset'; previousModel: string; initialModel: string };

function tryParseProviderResult(text: string | undefined): ProviderResultPayload | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes('"action"')) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && typeof parsed.action === 'string') {
      return parsed as ProviderResultPayload;
    }
  } catch {
    // not JSON or malformed — fall back to raw text
  }
  return null;
}

const ProviderResultSubRow: React.FC<{ payload: ProviderResultPayload; isError: boolean }> = ({
  payload,
  isError,
}) => {
  const lines: Array<{ label: string; value: string }> = [];
  if (payload.action === 'current') {
    lines.push({ label: 'Model', value: payload.model });
    lines.push({ label: 'Override', value: payload.isOverride ? 'yes' : 'no' });
  } else if (payload.action === 'switch') {
    lines.push({ label: 'From', value: payload.previousModel || '(default)' });
    lines.push({ label: 'To', value: payload.newModel });
    if (payload.reason && payload.reason.trim().length > 0) {
      lines.push({ label: 'Reason', value: payload.reason });
    }
  } else if (payload.action === 'reset') {
    lines.push({ label: 'Reset', value: payload.previousModel });
    lines.push({ label: 'Initial', value: payload.initialModel });
  }
  const color = isError ? ERROR_COLOR : DIM;
  return (
    <div className="cm-fade-in">
      <Row gutter={BOTTOM_LEFT_CORNER} gutterColor={color} marginTop={2}>
        <div
          data-tool-result-error={isError ? 'true' : undefined}
          data-tool-renderer="provider"
          style={{
            ...MONO_STYLE,
            color: isError ? ERROR_COLOR : TEXT,
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          {lines.map(({ label, value }, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.6ch' }}>
              <span style={{ color: DIM, width: '8ch', flexShrink: 0 }}>{label}:</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      </Row>
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

  // Provider tool: pretty-print structured JSON instead of rendering
  // the raw `{"action":"current","model":"gpt-oss:20b",...}` payload.
  // Live bug 2026-04-30 user filed against codemode render parity.
  if (toolName === 'Provider') {
    const payload = tryParseProviderResult(text);
    if (payload) {
      return <ProviderResultSubRow payload={payload} isError={result.isError === true} />;
    }
    // Fall-through to the raw renderer when the payload doesn't parse
    // (defensive — keeps non-JSON error strings visible).
  }

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
    className="cm-msg-row cm-msg-system"
    data-part="system"
    style={{
      ...MONO_STYLE,
      marginTop: 8,
    }}
  >
    <span className="cm-msg-glyph" aria-hidden>◆</span>
    {text}
  </div>
);

const ErrorRow: React.FC<{ text: string }> = ({ text }) => (
  <div
    className="cm-msg-row cm-msg-error"
    data-part="error"
    style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}
  >
    <span className="cm-msg-glyph" aria-hidden>✗</span>
    {text}
  </div>
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

/**
 * Single per-block dispatcher. As of Phase 3 of the codemode-bridge
 * plan, every block renders through `<Part />` — including subBlocks
 * recursion for parallel-subagent inline transcripts. The
 * `firstContentIndex` is preserved as a presentation hint so the
 * leading content block can still get the `●` gutter chrome via the
 * row wrappers below; specialised rendering for thinking / tool_use
 * still flows through the existing local components for visual parity
 * with the openagentic TUI.
 *
 * Phase 3 contract:
 *   - text & sub-transcript blocks always go through Part
 *   - thinking & top-level tool_use keep their existing chrome (gutter
 *     bullet, expand/collapse, FileWrite diff body) — these are NOT
 *     migrated yet; P4+ will collapse the duplication once the
 *     specialised renderers move into TOOL_RENDERERS
 *   - new block kinds (tool_result orphan, todo) flow through Part
 */
const AssistantBlockRow: React.FC<{
  block: AssistantBlock;
  index: number;
  firstContentIndex: number;
  /**
   * Phase F (codemode-permanent-plan §4) — when the active permission
   * request was triggered by a subagent (i.e., its envelope-level
   * `parent_tool_use_id` matches THIS block's `toolUseId`), the
   * `AssistantMessageBody` parent forwards the card payload here so
   * `ToolUseRow` can render it inline within its panel. `null` /
   * undefined means this row is not the routing target — current
   * behaviour preserved.
   */
  inlinePermission?: {
    request: CanUseToolRequest & { request_id: string };
    onRespond: (decision: PermissionDecision) => void;
  } | null;
}> = ({ block, index, firstContentIndex, inlinePermission }) => {
  const isFirstBlock = index === firstContentIndex;

  if (block.kind === 'text') {
    return <AssistantTextRow text={block.text} isFirstBlock={isFirstBlock} />;
  }
  if (block.kind === 'thinking') {
    return <ThinkingRow block={block} marginTop={isFirstBlock ? 8 : 4} />;
  }
  if (block.kind === 'tool_use') {
    // Bug-fix 2026-04-30: route ALL top-level tool_use blocks through
    // the new Part renderer. Part now matches Claude Code TUI's exact
    // `Bash(<command>)` head format + `⎿  `-prefixed result body, while
    // ToolUseRow had drifted into a `description [show]` head + fenced
    // TEXT code-block result.
    void ToolUseRow; // keep the symbol referenced for any direct callers
    return (
      <div data-tool-use-id={block.toolUseId} style={{ display: 'contents' }}>
        <Part part={block} depth={0} />
        {inlinePermission && (
          <InlinePermissionCard
            request={inlinePermission.request}
            onRespond={inlinePermission.onRespond}
          />
        )}
      </div>
    );
  }
  // tool_result / todo (and any future block kinds) — route directly
  // through the new Part component.
  return <Part part={block} depth={0} />;
};

const AssistantMessageBody: React.FC<{
  message: AssistantChatMessage;
  isFirstAssistantTurn?: boolean;
  /**
   * Active permission request for THIS streaming message. When set,
   * an InlinePermissionCard mounts at the END of the message body —
   * Cline-style. Only honoured when the message is currently streaming
   * (inline approvals don't make sense on closed turns). Phase 4 of the
   * codemode-bridge plan replaces the portal'd PermissionDialog modal.
   *
   * Phase F (codemode-permanent-plan §4): when the request envelope
   * carries a `parent_tool_use_id` matching one of THIS message's
   * top-level tool_use blocks, the card is routed INTO that block's
   * panel instead of mounting at the message tail — so a permission
   * triggered by a parallel subagent shows up next to the right
   * subagent rather than at the bottom of the assistant message.
   */
  pendingPermission?:
    | (CanUseToolRequest & {
        request_id: string;
        parent_tool_use_id?: string | null;
      })
    | null;
  onRespondToPermission?: (decision: PermissionDecision) => void;
}> = ({
  message,
  isFirstAssistantTurn = false,
  pendingPermission,
  onRespondToPermission,
}) => {
  // Apply the parallel-tool grouping pass once so `firstContentIndex`
  // and the per-row index align with what's actually rendered (the
  // .map below also uses the grouped view).
  const groupedBlocks = groupParallelTools(message.blocks);
  // Find the index of the first block with any visible content — used so
  // only the leading block gets the `●` gutter (matches openagentic where
  // shouldShowDot is true only for the first rendered block of the turn).
  const firstContentIndex = groupedBlocks.findIndex((b) => {
    if (b.kind === 'text') return b.text.length > 0;
    if (b.kind === 'thinking') return b.thinking.length > 0;
    return true; // tool_use / boundary / parallel_group always shows
  });

  const hasAny = firstContentIndex >= 0;

  // Breadcrumb pills — lifecycle summary for the turn's setup events.
  const breadcrumbs = deriveBreadcrumbs(message, isFirstAssistantTurn);
  // Tool uses for the "Ran N commands" summary card.
  const toolUses = message.blocks.filter(
    (b): b is UiToolUseBlock => b.kind === 'tool_use',
  );

  const isPermissionActive =
    !!pendingPermission && message.streaming && !!onRespondToPermission;

  // Phase F routing: when the daemon flagged the control_request envelope
  // with `parent_tool_use_id`, find the matching top-level tool_use. If
  // the id matches a block, the card mounts inside that block's panel
  // (see ToolUseRow / AssistantBlockRow). Otherwise (id null or no
  // match) we fall back to the message-tail mount — the historical
  // single-agent behaviour.
  const routedParentToolUseId =
    isPermissionActive && pendingPermission?.parent_tool_use_id
      ? pendingPermission.parent_tool_use_id
      : null;
  const routedBlockId = (() => {
    if (!routedParentToolUseId) return null;
    const match = message.blocks.find(
      (b): b is UiToolUseBlock =>
        b.kind === 'tool_use' && b.toolUseId === routedParentToolUseId,
    );
    return match ? match.toolUseId : null;
  })();
  const showTailPermission = isPermissionActive && routedBlockId === null;

  return (
    <div
      className="cm-msg-row cm-msg-assistant"
      data-part="assistant"
      data-testid={message.streaming ? 'cm-streaming-message' : undefined}
    >
      {/* StreamingPlaceholder removed 2026-05-07 — was rendering a
          DUPLICATE heartbeat ('Considering… 68.7s' on its own row)
          alongside the real InlineActivityHeartbeat below
          ('almost done thinking 68.7s ↑14.9k'). User feedback: 'two
          lines'. The InlineActivityHeartbeat now mounts from second 1
          of streaming and is the single source of truth. */}
      {groupedBlocks.map((block, i) => {
        // Route the permission card into THIS block when its toolUseId
        // matches the resolved parent_tool_use_id. Other blocks pass
        // null so they don't render the card. Note: parallel_group
        // blocks NEVER carry a permission card directly — the card
        // would land on a child tool_use INSIDE the group, which the
        // generic Part render handles via its own dispatch.
        const inlinePermission =
          isPermissionActive &&
          pendingPermission &&
          onRespondToPermission &&
          block.kind === 'tool_use' &&
          routedBlockId === block.toolUseId
            ? {
                request: pendingPermission,
                onRespond: onRespondToPermission,
              }
            : null;
        return (
          <AssistantBlockRow
            key={i}
            block={block}
            index={i}
            firstContentIndex={firstContentIndex}
            inlinePermission={inlinePermission}
          />
        );
      })}
      {/* Live heartbeat ONLY — no per-turn footer. openagentic/Claude Code
          show the live counter while the model is thinking and drop it
          on completion; a frozen post-turn readout is just chrome that
          could be filled with anything (user feedback 2026-05-08). */}
      {message.streaming && <InlineActivityHeartbeat message={message} />}
      {/* Inline permission affordance — replaces the portal'd PermissionDialog
          modal. Mounted at the END of the streaming assistant message so the
          user stays in the transcript scoped to the exact tool that needs
          permission. See Phase 4 of the codemode-bridge plan and
          chat-messages/InlinePermissionCard.tsx.
          Phase F: this tail mount fires only when the request is NOT
          routed into a specific subagent panel — root-level permission
          (parent_tool_use_id null) or unknown id (graceful fallback). */}
      {showTailPermission && pendingPermission && onRespondToPermission && (
        <InlinePermissionCard
          request={pendingPermission}
          onRespond={onRespondToPermission}
        />
      )}
      {/* Blinking caret removed — was rendering per streaming assistant
          message, causing multiple cursors throughout the interleave.
          Claude code CLI (PTY) shows a single spinner in the footer
          while streaming; the InlineActivityHeartbeat above keeps the
          user oriented mid-turn — pulsing dot + the live action line
          ("Bash: ls", "Writing /a/b.tsx", "Reasoning: …"). */}
    </div>
  );
};

/**
 * InlineActivityHeartbeat — pulsing bullet + the live action line, mounted
 * at the bottom of the latest streaming assistant message so the user
 * always sees a moving indicator inline where the work is happening
 * (parity with claude code TUI's persistent activity strip). Uses
 * deriveCurrentActivity to pull the right phrase from the message's
 * blocks (Bash/Writing/Reasoning/etc.). Falls back to "Working…" when
 * no specific phase can be derived.
 */
/**
 * Estimate the live output token count for the streaming assistant
 * message. Matches claude code's `responseLength / 4` heuristic
 * (anthropic/src/components/Spinner/SpinnerAnimationRow.tsx) which sums
 * the visible streaming chars (text + thinking + tool input json) and
 * divides by 4 — close enough to GPT-style tokenization for a live
 * counter that just needs to feel alive while the model streams.
 */
function streamingResponseChars(message: AssistantChatMessage): number {
  let chars = 0;
  for (const b of message.blocks) {
    if (b.kind === 'text') chars += (b.text || '').length;
    else if (b.kind === 'thinking') chars += (b.text || '').length;
    else if (b.kind === 'tool_use') chars += (b.partialInputJson || '').length;
  }
  return chars;
}

/**
 * Smooth, monotonic token counter — mirrors Claude Code TUI's
 * `tokenCounterRef` ramp from
 *   ~/anthropic/src/components/Spinner/SpinnerAnimationRow.tsx:142-160.
 *
 * The ref's stored value is in CHARS (not tokens) so the increments
 * match the upstream stream rate. The displayed value divides by 4 for
 * GPT-style approximate tokens.
 *
 * Why a ref + ramp instead of just `chars / 4`: the AIF/gpt-oss-120b
 * provider restarts message_delta usage between tool-loop sub-messages
 * with output_tokens=0, which makes a snapshot-based counter jitter
 * (e.g. 406 → 166 → 67 → 156 → 199). The ref-based ramp is monotonic
 * — the displayed value can only ever climb because each frame does
 * `Math.min(ref + increment, currentChars)`. Drops of input simply
 * stall the counter; they never reverse it.
 */
function useSmoothLiveTokens(currentChars: number): number {
  // Bump on every animation frame (50ms via useElapsedTimer's 100ms
  // tick is plenty fast for the visual). The ref is mutated and we
  // force a render via the elapsed timer subscription so React picks
  // up the new value.
  const counterRef = useRef(0);
  const gap = currentChars - counterRef.current;
  if (gap > 0) {
    let increment: number;
    if (gap < 70) increment = 3;
    else if (gap < 200) increment = Math.max(8, Math.ceil(gap * 0.15));
    else increment = 50;
    counterRef.current = Math.min(counterRef.current + increment, currentChars);
  } else if (currentChars < counterRef.current) {
    // Edge: a fresh message resets chars to 0. Reset the ref too so
    // the next streaming turn doesn't start with a stale value.
    counterRef.current = currentChars;
  }
  return Math.round(counterRef.current / 4);
}

/**
 * 2s minimum dwell on each thinking state — mirrors Claude Code TUI's
 * `useEffect` thinking-status state machine in
 *   ~/anthropic/src/components/Spinner.tsx:125-159.
 *
 * State transitions:
 *   none           → 'thinking…' (immediate when thinkingStartedAt set)
 *   'thinking…'    → 'thought for Ns' (after thinkingEndedAt + 2s min display of 'thinking…')
 *   'thought for'  → null (2s after that flip)
 *
 * Without the dwell, fast-thinking models (≤500ms) make the label
 * flicker through three states in a single render and the user can't
 * read what's happening.
 */
function useThinkingLabel(
  startedAt: number | undefined,
  endedAt: number | undefined,
  isLive: boolean,
): string | null {
  const [label, setLabel] = useState<string | null>(null);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    let toDuration: ReturnType<typeof setTimeout> | null = null;
    let toClear: ReturnType<typeof setTimeout> | null = null;
    if (isLive && startedAt) {
      if (startRef.current === null) {
        startRef.current = startedAt;
        setLabel('thinking…');
      }
    } else if (startRef.current !== null && endedAt) {
      const duration = endedAt - startRef.current;
      const elapsed = Date.now() - startRef.current;
      const remaining = Math.max(0, 2000 - elapsed);
      startRef.current = null;
      const flip = () => {
        const dur = Math.max(1, Math.round(duration / 1000));
        setLabel(`thought for ${dur}s`);
        toClear = setTimeout(() => setLabel(null), 2000);
      };
      if (remaining > 0) toDuration = setTimeout(flip, remaining);
      else flip();
    }
    return () => {
      if (toDuration) clearTimeout(toDuration);
      if (toClear) clearTimeout(toClear);
    };
  }, [isLive, startedAt, endedAt]);
  return label;
}

function formatLiveTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000).toFixed(0)}k`;
}

const InlineActivityHeartbeat: React.FC<{
  message: AssistantChatMessage;
}> = ({ message }) => {
  const elapsed = useElapsedTimer(true);
  const chars = streamingResponseChars(message);
  const liveTokens = useSmoothLiveTokens(chars);

  // Activity verb (the bit BEFORE the parens). Cycles through verbs
  // until tools/text arrive, then settles to a derived activity name.
  const hasBlocks = message.blocks.length > 0;
  const isThinkingLive = message.blocks.some((b) => b.kind === 'thinking' && b.streaming);
  const derived = deriveCurrentActivity([message]);
  const thinkingLiveSec = message.thinkingStartedAt && isThinkingLive
    ? (Date.now() - message.thinkingStartedAt) / 1000
    : 0;
  let activity: string;
  if (thinkingLiveSec > 25) {
    activity = 'almost done thinking';
  } else if (derived && derived !== 'Working…') {
    activity = derived;
  } else if (!hasBlocks && elapsed > 12) {
    activity = 'almost done thinking';
  } else if (!hasBlocks) {
    const idx = Math.floor(elapsed / 2.5) % THINKING_VERBS.length;
    activity = `${THINKING_VERBS[idx]}…`;
  } else if (isThinkingLive) {
    activity = 'Reasoning…';
  } else {
    activity = derived || 'Working…';
  }

  // Thinking label — `thinking…` while live, `thought for Ns` after
  // (held for 2s before clearing). State machine in useThinkingLabel.
  const thinkingLabel = useThinkingLabel(
    message.thinkingStartedAt,
    message.thinkingEndedAt,
    isThinkingLive,
  );

  // Build the parenthesized status string Claude-Code-style:
  //   `(12.3s · ↓ 1.3k tokens · thought for 2s)`
  // Drop chips that don't have data yet — under 0.4s elapsed reads as
  // 0.0s which adds noise; tokens=0 isn't useful; thinking is null
  // when no thinking happened or after the 2s clear timeout.
  const parts: string[] = [];
  if (elapsed > 0.4) parts.push(`${elapsed.toFixed(1)}s`);
  if (liveTokens > 0) parts.push(`↓ ${formatLiveTokens(liveTokens)} tokens`);
  if (thinkingLabel) parts.push(thinkingLabel);

  return (
    <div
      data-testid="codemode-inline-activity-heartbeat"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 6,
        padding: '4px 0 4px 14px',
        fontFamily: 'var(--cm-mono-font, ui-monospace, Menlo, Monaco, Consolas, monospace)',
        fontSize: 11.5,
        color: 'var(--cm-text-muted, #8b949e)',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: '#b25cff',
          boxShadow: '0 0 6px rgba(178, 92, 255, 0.55)',
          animation: 'cm-inline-activity-pulse 1s ease-in-out infinite',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          color: 'var(--cm-text, #e7ecf5)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
          flex: 1,
        }}
      >
        {activity}
      </span>
      {parts.length > 0 && (
        <span
          data-testid="codemode-inline-status"
          style={{
            fontVariantNumeric: 'tabular-nums',
            opacity: 0.7,
            flexShrink: 0,
          }}
        >
          ({parts.join(' · ')})
        </span>
      )}
      <style>{`
        @keyframes cm-inline-activity-pulse {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.25); }
        }
      `}</style>
    </div>
  );
};

/**
 * TurnStatsFooter — persistent one-line summary that mounts under each
 * completed assistant turn. User feedback 2026-05-06: "token count isnt
 * working" — the live heartbeat unmounts when streaming ends and the
 * user lost visibility into the turn's token + duration totals.
 *
 * Renders: `↑<input> · ↓<output> · <elapsed>s · <model> · thought for Ns`
 * — only the fields that exist for this message. If the daemon never
 * surfaced usage (e.g. AIF mid-rollout) we render nothing instead of
 * showing zero-tokens (avoids misleading the user).
 */
/**
 * TurnStatsFooter — minimal one-liner under each completed turn.
 *
 * Fields per the user's spec: `(elapsed · ↑input · ↓output · thinking)`.
 * Renders all four even at zero so each turn's row is structurally
 * identical (no shifty "where did the chip go" feel between turns).
 * Model + cost trail to the right when available.
 *
 * Design goal: low cognitive drain. Compact 12px monospace, dim color
 * via --cm-text-muted, dot separators dimmed further (opacity 0.4) so
 * the eye groups the data not the separators. Tabular-num digits keep
 * the row from jittering as values tick.
 */
const TurnStatsFooter: React.FC<{ message: AssistantChatMessage }> = ({ message }) => {
  const u = message.usage;
  const inTok = u?.inputTokens ?? 0;
  const outTok = u?.outputTokens ?? 0;
  const cost = u?.totalCostUsd ?? 0;
  // Total turn elapsed: turnStartedAt → turnEndedAt (frozen on result),
  // falls back to createdAt on the start side and Date.now() on the end
  // side for in-flight messages — though in practice this footer only
  // mounts after streaming, so end is always frozen.
  const start = message.turnStartedAt ?? message.createdAt;
  const end = message.turnEndedAt ?? Date.now();
  const elapsedSec = Math.max(0, (end - start) / 1000);
  // Reasoning sub-segment.
  const thinkSec = message.thinkingStartedAt
    ? Math.max(0, ((message.thinkingEndedAt ?? Date.now()) - message.thinkingStartedAt) / 1000)
    : 0;
  // Hide when there's literally nothing useful to show.
  if (inTok === 0 && outTok === 0 && !message.turnModel && elapsedSec < 0.1) return null;

  // Dot-separator helper — renders a bullet between chips, dimmed so
  // the eye groups the chips not the separators (Claude's exact trick).
  const dot = (key: string) => (
    <span
      key={key}
      aria-hidden
      style={{ opacity: 0.4, padding: '0 1px' }}
    >
      ·
    </span>
  );

  const chips: React.ReactNode[] = [];
  // Elapsed — always.
  chips.push(
    <span
      key="elapsed"
      data-testid="codemode-turn-elapsed"
      style={{ fontVariantNumeric: 'tabular-nums' }}
      title="Total turn elapsed (first byte → message_stop)"
    >
      {elapsedSec < 60
        ? `${elapsedSec.toFixed(1)}s`
        : `${Math.floor(elapsedSec / 60)}m ${Math.round(elapsedSec % 60)}s`}
    </span>,
  );
  chips.push(dot('d1'));
  // ↑ Input.
  chips.push(
    <span
      key="in"
      data-testid="codemode-turn-input-tokens"
      style={{ fontVariantNumeric: 'tabular-nums' }}
      title="Input tokens for this turn"
    >
      <span aria-hidden style={{ opacity: 0.6 }}>↑</span>
      {formatLiveTokens(inTok)}
    </span>,
  );
  chips.push(dot('d2'));
  // ↓ Output.
  chips.push(
    <span
      key="out"
      data-testid="codemode-turn-output-tokens"
      style={{ fontVariantNumeric: 'tabular-nums' }}
      title="Output tokens for this turn"
    >
      <span aria-hidden style={{ opacity: 0.6 }}>↓</span>
      {formatLiveTokens(outTok)}
    </span>,
  );
  if (thinkSec > 0) {
    chips.push(dot('d3'));
    chips.push(
      <span
        key="thinking"
        data-testid="codemode-turn-thinking-duration"
        style={{ fontVariantNumeric: 'tabular-nums' }}
        title="Reasoning duration for this turn"
      >
        thought {thinkSec < 60 ? `${Math.max(1, Math.round(thinkSec))}s` : `${Math.round(thinkSec / 60)}m`}
      </span>,
    );
  }
  if (message.turnModel) {
    chips.push(dot('d4'));
    chips.push(
      <span key="model" style={{ opacity: 0.7 }} title="Model that produced this turn">
        {message.turnModel}
      </span>,
    );
  }
  if (cost > 0) {
    chips.push(dot('d5'));
    chips.push(
      <span
        key="cost"
        style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.6 }}
        title="USD cost for this turn"
      >
        ${cost.toFixed(4)}
      </span>,
    );
  }

  return (
    <div
      data-testid="codemode-turn-stats-footer"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginTop: 6,
        marginBottom: 4,
        padding: '3px 0 3px 14px',
        fontFamily: 'var(--cm-mono-font, ui-monospace, Menlo, Monaco, Consolas, monospace)',
        fontSize: 12,
        color: 'var(--cm-text-muted, #8b949e)',
        flexWrap: 'wrap',
      }}
    >
      {chips}
    </div>
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
            <ReactMarkdown
              remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
              rehypePlugins={[rehypeSemanticTokens, [rehypeKatex as any, { strict: false, throwOnError: false, output: 'html' }]]}
              components={MARKDOWN_COMPONENTS}
            >{normalizeLatexDelimiters(planText)}</ReactMarkdown>
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
  /**
   * Active permission request from the codemode hook. When set AND
   * this message is the streaming-in-flight assistant turn, an
   * InlinePermissionCard mounts at the end of the message — replaces
   * the portal'd PermissionDialog modal (Phase 4 of the codemode-bridge
   * plan). Callers should only pass this on the message where the
   * permission belongs (typically the most-recent streaming message).
   *
   * Phase F (codemode-permanent-plan §4): the augmented type includes
   * an optional `parent_tool_use_id` that, when present, routes the
   * card into the matching subagent panel instead of the message
   * tail. Optional + null-default keeps single-agent flows unchanged.
   */
  pendingPermission?:
    | (CanUseToolRequest & {
        request_id: string;
        parent_tool_use_id?: string | null;
      })
    | null;
  /** Callback wired to useCodeModeChat.respondToPermission. */
  respondToPermission?: (decision: PermissionDecision) => void;
}> = ({
  message,
  isFirstAssistantTurn,
  pendingPermission,
  respondToPermission,
}) => {
  if (message.role === 'user') {
    // Phase D: route XML-tagged user-message bodies (slash command,
    // bash input/output, memory input, channel push, mcp resource
    // updates, task notifications, etc.) through UserTextMessageDispatch.
    // The dispatcher returns null for plain text so the user bubble
    // continues to render via UserRow.
    const dispatched = (
      <UserTextMessageDispatch text={message.text} addMargin />
    );
    // Cheap check so we don't render an empty fragment for plain text.
    // If the dispatcher would return null, fall through to UserRow.
    if (mightHaveDispatchTag(message.text)) {
      return dispatched;
    }
    return <UserRow text={message.text} />;
  }
  if (message.role === 'system') {
    // Phase D: surface system messages through SystemTextMessage so
    // subtype-specific tones (turn_duration, bridge_status, thinking,
    // memory_saved, stop_hook_summary, api_retry, etc.) render with
    // their proper visual treatment when the hook injects a structured
    // SystemChatMessage. Today the hook injects plain text, so the
    // generic branch lights up.
    return <SystemRow text={message.text} />;
  }
  if (message.role === 'error') return <ErrorRow text={message.text} />;
  return (
    <AssistantMessageBody
      message={message as AssistantChatMessage}
      isFirstAssistantTurn={isFirstAssistantTurn}
      pendingPermission={pendingPermission}
      onRespondToPermission={respondToPermission}
    />
  );
};

/**
 * Cheap pre-check: returns true if the user-message text contains any
 * of the XML tag wrappers UserTextMessageDispatch knows how to render.
 * Avoids the React reconciler returning null when 99% of user messages
 * are plain text typed into the composer.
 */
function mightHaveDispatchTag(text: string): boolean {
  if (text.length === 0) return false;
  return (
    text.startsWith('<bash-stdout') ||
    text.startsWith('<bash-stderr') ||
    text.startsWith('<local-command-stdout') ||
    text.startsWith('<local-command-stderr') ||
    text.includes('<bash-input>') ||
    text.includes('<command-message>') ||
    text.includes('<user-memory-input>') ||
    text.includes('<task-notification') ||
    text.includes('<mcp-resource-update') ||
    text.includes('<mcp-polling-update') ||
    text.includes('<channel source="') ||
    text === '[Request interrupted by user]' ||
    text === '[Request interrupted by user for tool use]'
  );
}

export default MessageRow;
