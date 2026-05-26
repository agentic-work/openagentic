import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

import { rehypeSemanticTokens } from '@/features/shared/markdown/rehypeSemanticTokens';
import { normalizeLatexDelimiters } from '@/features/shared/markdown/normalizeLatexDelimiters';
import { useFileStatusStore } from '../../../codemode/state/fileStatusStore';
import '../../../codemode/components/FilePanel.css';

import type {
  AssistantBlock,
  UiTextBlock,
  UiThinkingBlock,
  UiToolUseBlock,
  UiToolResultBlock,
  UiTodoBlock,
  UiInkDomViewBlock,
  UiBoundaryBlock,
  UiParallelGroupBlock,
  UiPreviewBlock,
  UiToolResult,
} from '../types/uiState';

import { formatElapsed } from '../chat/sdkAdapter';
import { summarizeToolGroup } from '../utils/summarizeToolGroup';
import { InkDomView } from './InkDomView';
import { CodeModePreviewPanel } from './CodeModePreviewPanel';
import { renderToolInputSummary } from './chat-messages/toolRenderers';
import { usePermissionsContext } from '../state/PermissionsContext';
import type { PermissionMode } from '../permissionMode';

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

export interface PartProps {
  part: AssistantBlock;
  /**
   * Nesting depth — 0 for top-level blocks, increments by 1 for each
   * level of subBlocks recursion. Drives `data-depth` so tests and
   * debug overlays can introspect the tree, and CSS can render an
   * indent / left-border per level.
   */
  depth?: number;
  /**
   * True when this Part is rendered inside the subBlocks of a parent
   * Task tool — drives subagent-flavoured chrome (▸ glyph for assistant
   * text deltas, more compact spacing) so the inline transcript reads
   * like the Claude Code TUI rather than a flat block list.
   */
  inSubagent?: boolean;
}

export const Part: React.FC<PartProps> = ({ part, depth = 0, inSubagent = false }) => {
  switch (part.kind) {
    case 'text':
      return <TextPart part={part} depth={depth} inSubagent={inSubagent} />;
    case 'thinking':
      // User feedback 2026-05-08: 'i know it never keeps the thinking
      // lines inline in the chats like we are — so we need to ditch
      // those — only THINKING that matters is the LIVE one'.
      // Claude Code TUI doesn't render past thinking content inline
      // either; the spinner-style live indicator is the only thinking
      // surface. Drop the collapsible block from the transcript.
      return null;
    case 'tool_use':
      return <ToolUsePart part={part} depth={depth} inSubagent={inSubagent} />;
    case 'tool_result':
      return <ToolResultPart part={part} depth={depth} />;
    case 'todo':
      return <TodoPart part={part} depth={depth} />;
    case 'inkdom_view':
      return <InkDomViewPart part={part} depth={depth} />;
    case 'boundary':
      return <BoundaryPart part={part} depth={depth} />;
    case 'parallel_group':
      return <ParallelGroupPart part={part} depth={depth} inSubagent={inSubagent} />;
    case 'preview':
      return <PreviewBlockPart part={part} depth={depth} />;
    default:
      return null;
  }
};

/**
 * Inline live-preview iframe block. Rendered when the daemon detects
 * a dev-server boot URL via `system/preview_ready`. The block itself
 * carries only `{port, url, framework, toolUseId}`; the actual proxy
 * URL composition (and the live sessionId pull) lives in
 * CodeModePreviewPanel so this Part stays a thin wrapper.
 */
const PreviewBlockPart: React.FC<{ part: UiPreviewBlock; depth: number }> = ({ part, depth }) => {
  return (
    <div data-part="preview" data-depth={depth} data-port={part.port}>
      <CodeModePreviewPanel
        port={part.port}
        displayUrl={part.url}
        framework={part.framework}
      />
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────
// Visual constants — match MessageTree.tsx so themes apply uniformly
// ────────────────────────────────────────────────────────────────────

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const SUCCESS = 'var(--cm-success, #3fb950)';
const ERROR_COLOR = 'var(--cm-error, #f85149)';
const BORDER = 'var(--cm-border, #30363d)';
const BG_SURFACE = 'var(--cm-bg-secondary, #161b22)';

const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

// ────────────────────────────────────────────────────────────────────
// OpenInPanelLink — wraps a file path to make it clickable
// ────────────────────────────────────────────────────────────────────

function OpenInPanelLink({ path, children }: { path: string; children: React.ReactNode }) {
  const openTab = useFileStatusStore((s) => s.openTab);
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    openTab(path);
  };
  return (
    <a
      href="#"
      onClick={onClick}
      data-testid="cm-tool-path-link"
      className="cm-tool-path-link"
      title={`Open ${path} in file panel`}
    >
      {children}
    </a>
  );
}

// ────────────────────────────────────────────────────────────────────
// Text part
// ────────────────────────────────────────────────────────────────────

/**
 * Custom ReactMarkdown `pre` renderer that intercepts fenced code
 * blocks marked with `language-html-artifact` and renders them as a
 * sandboxed inline iframe (srcdoc) sized to a chat bubble. Used by
 * /selftest and any slash command that wants to surface a rich HTML
 * artifact next to its text output without leaving the codemode
 * transcript.
 *
 * In react-markdown v10, the `code` component no longer receives
 * `inline`. Overriding `pre` is the canonical way to swap out fenced
 * blocks: the `<pre>` wraps a single `<code className="language-…">`
 * which we introspect to find the language. All other fenced blocks
 * fall through to the default `<pre><code>` rendering.
 */
const HtmlArtifactCodeRenderer: React.FC<{
  className?: string;
  children?: React.ReactNode;
}> = ({ className, children, ...rest }) => {
  // pre > code: the child carries the language- class
  const codeChild = React.Children.toArray(children).find(
    (c): c is React.ReactElement<{ className?: string; children?: React.ReactNode }> =>
      React.isValidElement(c) && (c as React.ReactElement).type === 'code',
  );
  const codeClass = codeChild?.props.className ?? '';
  const isArtifact = /\blanguage-html-artifact\b/.test(codeClass);
  if (!isArtifact) {
    return <pre className={className} {...rest}>{children}</pre>;
  }
  const srcdoc = React.Children.toArray(codeChild?.props.children ?? [])
    .map((c) => (typeof c === 'string' ? c : ''))
    .join('');
  return (
    <div
      data-part="html-artifact"
      className="cm-html-artifact"
      style={{
        margin: '10px 0',
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        overflow: 'hidden',
        background: '#06070a',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: `1px solid ${BORDER}`,
          background: BG_SURFACE,
          fontFamily: MONO_FONT,
          fontSize: 11,
          color: DIM,
          letterSpacing: '0.04em',
        }}
      >
        <span style={{ color: ACCENT, fontWeight: 600 }}>◉</span>
        <span>html artifact</span>
        <span style={{ color: '#3a3f47', margin: '0 4px' }}>·</span>
        <span>{(srcdoc.length / 1024).toFixed(1)}KB</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            const w = window.open('', '_blank', 'noopener,noreferrer');
            if (w) {
              w.document.open();
              w.document.write(srcdoc);
              w.document.close();
            }
          }}
          style={{
            background: 'transparent',
            border: `1px solid ${BORDER}`,
            color: DIM,
            padding: '2px 8px',
            borderRadius: 4,
            fontFamily: MONO_FONT,
            fontSize: 10,
            letterSpacing: '0.06em',
            cursor: 'pointer',
          }}
        >
          open in tab ↗
        </button>
      </div>
      <iframe
        title="html-artifact"
        srcDoc={srcdoc}
        sandbox="allow-scripts allow-same-origin"
        loading="lazy"
        style={{
          display: 'block',
          width: '100%',
          height: 480,
          border: 0,
          background: '#06070a',
        }}
      />
    </div>
  );
};

const TextPart: React.FC<{
  part: UiTextBlock & { streaming?: boolean };
  depth: number;
  inSubagent?: boolean;
}> = ({ part, depth, inSubagent = false }) => {
  // Only emit data-streaming when the block carries a streaming hint
  // (the reducer's UiTextBlock doesn't currently have this field, but
  // a few callers attach one — Part respects it forward-compat).
  const isStreaming = part.streaming === true;
  return (
    <div
      data-part="text"
      data-depth={depth}
      data-streaming={isStreaming || undefined}
      data-in-subagent={inSubagent || undefined}
      className={`cm-part cm-part-text${inSubagent ? ' cm-part-text-subagent' : ''}`}
      style={{
        color: TEXT_COLOR,
        padding: inSubagent ? '2px 0' : '4px 0',
        fontFamily: 'var(--cm-prose-font, Inter, system-ui, sans-serif)',
        lineHeight: 1.6,
        display: inSubagent ? 'flex' : undefined,
        gap: inSubagent ? '0.6ch' : undefined,
        alignItems: inSubagent ? 'flex-start' : undefined,
      }}
    >
      {inSubagent && (
        <span
          aria-hidden
          data-glyph="subagent-text"
          style={{
            color: DIM,
            flexShrink: 0,
            fontFamily: MONO_FONT,
            fontSize: 12,
            lineHeight: 1.6,
            paddingTop: 1,
          }}
        >
          ▸
        </span>
      )}
      <div className="cm-markdown" style={{ flex: inSubagent ? 1 : undefined, minWidth: 0 }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
          rehypePlugins={[rehypeSemanticTokens, [rehypeKatex as any, { strict: false, throwOnError: false, output: 'html' }]]}
          components={{ pre: HtmlArtifactCodeRenderer as React.ComponentType<{ className?: string; children?: React.ReactNode }> }}
        >
          {normalizeLatexDelimiters(part.text)}
        </ReactMarkdown>
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────
// Thinking part — collapsible <details> body
// ────────────────────────────────────────────────────────────────────

const ThinkingPart: React.FC<{ part: UiThinkingBlock; depth: number }> = ({ part, depth }) => {
  // Default CLOSED — user feedback 2026-05-02: "huge walls of fucking
  // cot/thought from models no one gives a fuck about and won't read".
  // Match Claude Code TUI: thinking blocks are collapsed by default,
  // user clicks the summary if they want to read the chain-of-thought.
  // Streaming dots in the summary still indicate live activity.
  const [open, setOpen] = useState(false);
  if (!part.thinking && !part.streaming) return null;
  return (
    <div
      data-part="thinking"
      data-depth={depth}
      data-streaming={part.streaming || undefined}
      className="cm-part cm-part-thinking cm-msg-thinking"
      style={{
        margin: '4px 0',
        color: DIM,
        fontFamily: 'var(--cm-prose-font, Inter, system-ui, sans-serif)',
      }}
    >
      <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary
          style={{
            cursor: 'pointer',
            listStyle: 'none',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            color: DIM,
            fontSize: 12,
          }}
        >
          <span aria-hidden className="cm-thinking-symbol" style={{ fontSize: 11 }}>∴</span>
          <span>Thinking{part.streaming ? '…' : ''}</span>
        </summary>
        {/* Same crop+fade primitive as tool bodies — long chain-of-thought
            walls clip at 280px with a gradient fade and Show More toggle.
            User feedback 2026-05-06: "inline thinking needs the same fade/
            height as you did for tool outputs". CSS in codeMode.css
            mirrors the cm-tool-body rules onto cm-thinking-body. */}
        <CroppedToolBody
          className="cm-thinking-body"
          toggleClassName="cm-thinking-body-toggle"
          style={{
            marginTop: 4,
            marginLeft: 14,
            paddingLeft: 10,
            borderLeft: `1px solid ${BORDER}`,
            color: 'var(--cm-text-secondary, #8b949e)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          {part.thinking}
        </CroppedToolBody>
      </details>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────
// Tool-use part — TOOL_RENDERERS map + subBlocks recursion
// ────────────────────────────────────────────────────────────────────

/**
 * Per-tool inline renderer. Receives the live block + (optional) result
 * and returns the React node shown inside the tool card body. The
 * one-line summary (renderToolInputSummary) is rendered by the wrapper;
 * the renderer is responsible for the body / card content.
 */
export interface ToolRenderProps {
  block: UiToolUseBlock;
  result?: UiToolResult;
}

export type ToolRenderer = React.FC<ToolRenderProps>;

// ── Generic body shared across most tools ──────────────────────────

const ToolBody: React.FC<{ block: UiToolUseBlock }> = ({ block }) => {
  const summary = renderToolInputSummary(block.name, block.input);
  return (
    <span
      style={{
        color: TEXT_COLOR,
        fontFamily: MONO_FONT,
        fontSize: 13,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {summary || '(no summary)'}
    </span>
  );
};

/**
 * Match the openagentic permission-denied tool_result body. Format
 * captured live (2026-05-03 audit): "OpenAgentic requested permissions
 * to write to /workspaces/.../foo.txt, but you haven't granted it yet."
 *
 * The check is loose on purpose — openagentic v0.7.x and earlier slot
 * the same template across Write/Edit/Bash/MultiEdit, but the leading
 * "requested permissions" + trailing "haven't granted it" are stable.
 */
function isPermissionDeniedError(result: UiToolResult): boolean {
  if (!result.isError) return false;
  const text = (result.text || '').toLowerCase();
  return (
    text.includes('requested permission') &&
    (text.includes("haven't granted") || text.includes('have not granted'))
  );
}

/**
 * Inline mode-switch affordance shown next to a permission-denied
 * tool_result. The openagentic child currently fails fast on a
 * permission-required tool when it isn't given a `canUseTool` callback
 * — it doesn't emit a `can_use_tool` control_request that the UI
 * could turn into an Allow/Deny card. Until the daemon-side bridge
 * registers that callback (see audit notes for Bug 3 follow-up),
 * this component lets the user one-click switch to a less-restrictive
 * mode and re-prompt, instead of being stuck.
 */
const PermissionDeniedSwitcher: React.FC = () => {
  const ctx = usePermissionsContext();
  if (!ctx) return null;
  // Don't render the switcher when we're already in the most-permissive
  // mode (the error wouldn't have happened, this would just be confusing).
  if (ctx.mode === 'bypassPermissions') return null;
  // Plan mode is intentionally read-only. Switching out of it on a
  // permission-denied error is the user's call but they can do it from
  // the chip — don't surface it inline because plan mode is its own
  // distinct UX (refusal-by-design).
  if (ctx.mode === 'plan') return null;

  const allTargets: { id: PermissionMode; label: string }[] = [
    { id: 'acceptEdits', label: 'Accept edits' },
    { id: 'bypassPermissions', label: 'Permissive (allow all)' },
  ];
  const targets = allTargets.filter((t) => t.id !== ctx.mode);

  return (
    <div
      className="cm-permission-switcher"
      data-testid="cm-permission-denied-switcher"
      style={{
        margin: '4px 0 0 14px',
        padding: '6px 10px',
        background: 'rgba(248, 81, 73, 0.08)',
        border: `1px solid ${ERROR_COLOR}55`,
        borderRadius: 4,
        fontFamily: MONO_FONT,
        fontSize: 11,
        color: 'var(--cm-text-muted, #6e7681)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <span>To unblock, switch mode:</span>
      {targets.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => ctx.setMode(t.id)}
          style={{
            padding: '3px 10px',
            background: 'transparent',
            border: '1px solid var(--cm-accent, #58a6ff)',
            borderRadius: 999,
            color: 'var(--cm-accent, #58a6ff)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 11,
          }}
        >
          {t.label}
        </button>
      ))}
      <span style={{ opacity: 0.7 }}>then re-send your request.</span>
    </div>
  );
};

const ResultBody: React.FC<{ result: UiToolResult }> = ({ result }) => {
  const rawText = result.text || (result.isError ? '(error)' : '(no output)');
  // B.2 — when the result is errored, prefix "Error: " on the first line
  // unless the text already begins with /^(error|Error)/ (avoid doubling).
  const text =
    result.isError && !/^\s*error/i.test(rawText) ? `Error: ${rawText}` : rawText;
  const className = `cm-tool-result${result.isError ? ' cm-tool-result-error' : ''}`;
  const showSwitcher = isPermissionDeniedError(result);
  return (
    <>
      <pre
        className={className}
        data-tool-result-error={result.isError ? 'true' : undefined}
        data-permission-denied={showSwitcher ? 'true' : undefined}
        style={{
          margin: '4px 0 0 14px',
          padding: '4px 8px',
          background: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderLeft: `2px solid ${result.isError ? ERROR_COLOR : SUCCESS}`,
          borderRadius: 3,
          color: result.isError ? ERROR_COLOR : TEXT_COLOR,
          fontFamily: MONO_FONT,
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 240,
          overflow: 'auto',
        }}
      >
        {text}
      </pre>
      {showSwitcher && <PermissionDeniedSwitcher />}
    </>
  );
};

/**
 * Wraps `.cm-tool-body` with a measure-driven crop+fade overlay and a
 * single Show More / Show Less toggle outside the cut. Replaces the
 * legacy nested-scrollbox pattern (max-height + overflow-y:auto) that
 * created the "scroll inside scroll" double-window UX. CSS does the
 * crop + gradient (codeMode.css `.cm-tool-body{,.cm-cropped,.expanded}`);
 * the wrapper is responsible for (a) detecting whether the natural
 * content height exceeds the cap so we can skip the chrome on small
 * results, and (b) toggling `.expanded` on click.
 *
 * Cap is read from the live computed style of the body so design
 * tokens stay the single source of truth — bumping the CSS clamp
 * propagates without code changes.
 */
const CROP_THRESHOLD_PX = 280;
/**
 * Generic crop+fade wrapper. Default className is `cm-tool-body` (the
 * original use site — every tool-result body in the chat). The same
 * primitive is reused for thinking blocks (className=`cm-thinking-body`)
 * which have an analogous CSS rule pair in codeMode.css. Keeping ONE
 * measurement+toggle component keeps the visual contract identical
 * across surfaces — same threshold, same fade, same toggle label.
 */
const CroppedToolBody: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  toggleClassName?: string;
}> = ({ children, style, className = 'cm-tool-body', toggleClassName = 'cm-tool-body-toggle' }) => {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);

  // Re-measure on mount + whenever children change. ResizeObserver covers
  // text streaming into the body; the [children] dep covers React swaps.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // scrollHeight is the natural (uncropped) content height.
      const natural = el.scrollHeight;
      setIsClamped(natural > CROP_THRESHOLD_PX + 8);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, [children]);

  const cls = [className];
  if (isClamped) cls.push('cm-cropped');
  if (expanded) cls.push('expanded');
  return (
    <>
      <div ref={ref} className={cls.join(' ')} style={style}>
        {children}
      </div>
      {isClamped && (
        <div className={toggleClassName}>
          <span className="cm-tool-body-toggle-meta">
            {expanded ? 'expanded' : 'clamped at 280px'}
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            data-testid="cm-tool-body-toggle"
            aria-expanded={expanded}
          >
            {expanded ? 'Show Less ▲' : 'Show More ▼'}
          </button>
        </div>
      )}
    </>
  );
};

// Generic per-tool renderer — used for every tool whose body is "header
// + summary + result". Specialised renderers can replace this for
// tools that need richer chrome (FileWrite line-numbered diff, etc.).
const GenericTool: ToolRenderer = ({ block, result }) => (
  <CroppedToolBody>
    <ToolBody block={block} />
    {result && <ResultBody result={result} />}
  </CroppedToolBody>
);

// Explicit aliases for the well-known tool names. Each one is the same
// generic body for now — the switch-on-name dispatch + data-tool attr
// is what unlocks future per-tool customisation without churning the
// Part dispatcher.
//
// BashTool, EditTool, and WriteTool ship richer chrome — see the
// `BashResultBody` / `DiffBody` renderers below.
/**
 * Read tool — generic body PLUS a small one-line headline at the top
 * of the body summarizing `<basename> · lines O-O+L · N lines`. Same
 * cognitive-load goal as the Bash headline: scan-friendly summary
 * survives even when CroppedToolBody clips long file output.
 */
const ReadTool: ToolRenderer = ({ block, result }) => {
  const input = (block.input ?? {}) as Record<string, unknown>;
  const filePath = (input.file_path as string) || '';
  const basename = filePath.split('/').pop() || filePath;
  const offset = typeof input.offset === 'number' ? (input.offset as number) : 0;
  const limit = typeof input.limit === 'number' ? (input.limit as number) : 0;
  const lineCount = result?.text ? result.text.split('\n').length : 0;
  return (
    <CroppedToolBody>
      <ToolBody block={block} />
      {result && (
        <>
          <div
            data-testid="cm-read-headline"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 4,
              marginLeft: 14,
              marginBottom: 4,
              fontFamily: MONO_FONT,
              fontSize: 10.5,
              color: DIM,
              flexWrap: 'wrap',
            }}
          >
            {basename && (
              <span
                title={filePath}
                style={{ fontWeight: 600, color: 'var(--cm-accent, #58a6ff)' }}
              >
                {basename}
              </span>
            )}
            {limit > 0 && (
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                lines {offset + 1}–{offset + limit}
              </span>
            )}
            {lineCount > 0 && (
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {lineCount} {lineCount === 1 ? 'line' : 'lines'} returned
              </span>
            )}
          </div>
          <ResultBody result={result} />
        </>
      )}
    </CroppedToolBody>
  );
};
const GrepTool: ToolRenderer = (props) => <GenericTool {...props} />;
const TaskTool: ToolRenderer = (props) => <GenericTool {...props} />;
const TodoWriteTool: ToolRenderer = (props) => <GenericTool {...props} />;

// ── Bash result body — exit-code pill + duration ──────────────────
//
// Mock-1 (mocks/codemode-tui-parity/mock-1-deploy-debug.html) renders
// every Bash result with a coloured `✓ Exit 0` / `✕ Exit N` pill plus
// a small `1.21s` duration so the user can scan exit status at a
// glance. We surface the exit code from result.detail (when the
// daemon attaches one) and fall back to inferring 0/1 from `isError`.
function inferBashExitCode(result: UiToolResult): number {
  // Future: the daemon may attach `detail.exitCode` directly. Today
  // we infer from isError so the pill always renders.
  const detail = result.detail as { exitCode?: number } | undefined;
  if (detail && typeof detail.exitCode === 'number') return detail.exitCode;
  return result.isError ? 1 : 0;
}

// Bash duration rendering needs sub-second precision (mock-1 shows
// "0.31s", "1.21s", "3m 12s") whereas formatElapsed rounds to whole
// seconds. We format ourselves for <60s, then defer to formatElapsed
// for minute / hour scale durations.
function formatBashDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) {
    // 1 decimal for ≥1s, 2 decimals for <1s — keeps the pill tight.
    return seconds >= 1 ? `${seconds.toFixed(2)}s` : `${seconds.toFixed(2)}s`;
  }
  return formatElapsed(seconds);
}

const BashResultBody: React.FC<{
  block: UiToolUseBlock;
  result: UiToolResult;
}> = ({ block, result }) => {
  const exitCode = inferBashExitCode(result);
  const ok = exitCode === 0 && !result.isError;
  // Bash output: prefer detail.stdout if present, else flat text.
  const stdout = result.detail?.stdout ?? '';
  const stderr = result.detail?.stderr ?? '';
  // Only fall back to result.text when neither stdout nor stderr were
  // attached — avoids double-rendering the same string.
  const flatText = stdout || stderr ? '' : result.text || '';
  const elapsed = block.elapsedSec;
  // Per-tool headline summary (2026-05-07): give the user a one-line
  // "Bash · ✓ Exit 0 · 47 lines · 1.21s" scannable header at the TOP
  // of the body so exit status + size + duration are visible even
  // when CroppedToolBody clips the body at 280px. Counts visible
  // lines (skipping empty lines doesn't help the user judge size).
  const stdoutLines = stdout ? stdout.split('\n').length : 0;
  const stderrLines = stderr ? stderr.split('\n').length : 0;
  const flatLines = flatText ? flatText.split('\n').length : 0;
  const totalLines = stdoutLines + stderrLines + flatLines;
  return (
    <div
      className={`cm-bash-output${result.isError ? ' cm-tool-result-error' : ''}`}
      data-tool-renderer="bash"
      data-tool-result-error={result.isError ? 'true' : undefined}
      style={{
        margin: '4px 0 0 14px',
        padding: '4px 8px',
        background: 'var(--cm-bash-bg, rgba(243,139,168,0.06))',
        border: `1px solid ${BORDER}`,
        borderLeft: `2px solid ${ok ? 'var(--cm-bash-prefix, #f38ba8)' : ERROR_COLOR}`,
        borderRadius: 3,
        color: TEXT_COLOR,
        fontFamily: MONO_FONT,
        fontSize: 12,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 360,
        overflow: 'auto',
      }}
    >
      <div
        data-testid="cm-bash-headline"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
          paddingBottom: 4,
          borderBottom: `1px dashed ${BORDER}`,
          fontSize: 10.5,
          fontFamily: MONO_FONT,
          color: DIM,
          flexWrap: 'wrap',
        }}
      >
        <span
          data-bash-exit={String(exitCode)}
          className={`cm-exit ${ok ? 'ok' : 'fail'}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '1px 7px',
            borderRadius: 4,
            fontWeight: 600,
            background: ok
              ? 'rgba(166,227,161,0.18)'
              : 'rgba(243,139,168,0.18)',
            color: ok ? SUCCESS : ERROR_COLOR,
          }}
        >
          {ok ? '✓' : '✕'} Exit {exitCode}
        </span>
        {totalLines > 0 && (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {totalLines} {totalLines === 1 ? 'line' : 'lines'}
          </span>
        )}
        {stderrLines > 0 && stdoutLines > 0 && (
          <span title="Stderr lines included" style={{ color: ERROR_COLOR, fontVariantNumeric: 'tabular-nums' }}>
            ({stderrLines} stderr)
          </span>
        )}
        {typeof elapsed === 'number' && elapsed > 0 && (
          <span data-bash-duration className="cm-duration" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatBashDuration(elapsed)}
          </span>
        )}
      </div>
      {stdout && (
        <pre
          className="cm-bash-stdout"
          data-bash-stream="stdout"
          style={{
            margin: 0,
            color: TEXT_COLOR,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {stdout}
        </pre>
      )}
      {stderr && (
        <pre
          className="cm-bash-stderr"
          data-bash-stream="stderr"
          style={{
            margin: stdout ? '4px 0 0 0' : 0,
            color: ERROR_COLOR,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {stderr}
        </pre>
      )}
      {flatText && (
        <pre
          className="cm-bash-flat"
          data-bash-stream="flat"
          style={{
            margin: 0,
            color: result.isError ? ERROR_COLOR : TEXT_COLOR,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {flatText}
        </pre>
      )}
    </div>
  );
};

const BashTool: ToolRenderer = ({ block, result }) => (
  <CroppedToolBody>
    <ToolBody block={block} />
    {result && <BashResultBody block={block} result={result} />}
  </CroppedToolBody>
);

// ── Edit / Write diff body — old/new two-side patch ───────────────
//
// Mock-1 lines 240-253 (the .slice(0,16) → .slice(0,12) patch) and
// 287-309 (the new test-file Write) render a row-per-line diff with
// red `−` markers for removed lines and green `+` markers for added
// lines. We reuse the same chrome for Edit (`old_string` → `new_string`)
// and Write / FileWrite (whole `content`, treated as add-only since
// the file is new).

interface DiffRow {
  marker: '+' | '-' | ' ';
  text: string;
}

function diffRowsForEditTool(input: Record<string, unknown> | undefined): {
  rows: DiffRow[];
  filePath: string | undefined;
} {
  const oldText = typeof input?.old_string === 'string' ? (input.old_string as string) : '';
  const newText = typeof input?.new_string === 'string' ? (input.new_string as string) : '';
  const filePath =
    typeof input?.file_path === 'string' ? (input.file_path as string) : undefined;
  const rows: DiffRow[] = [];
  if (oldText) {
    for (const line of oldText.split('\n')) rows.push({ marker: '-', text: line });
  }
  if (newText) {
    for (const line of newText.split('\n')) rows.push({ marker: '+', text: line });
  }
  return { rows, filePath };
}

function diffRowsForWriteTool(input: Record<string, unknown> | undefined): {
  rows: DiffRow[];
  filePath: string | undefined;
} {
  const content = typeof input?.content === 'string' ? (input.content as string) : '';
  const filePath =
    typeof input?.file_path === 'string' ? (input.file_path as string) : undefined;
  const rows: DiffRow[] = [];
  for (const line of content.split('\n')) rows.push({ marker: '+', text: line });
  return { rows, filePath };
}

/**
 * MultiEdit input is `{ file_path, edits: [{old_string, new_string}, ...] }`.
 * Concatenate all edits into a single rendered diff: each edit contributes
 * its removed lines (red `-`) followed by its added lines (green `+`),
 * with the next edit immediately appended below. Mirrors the way
 * Claude Code TUI renders a MultiEdit diff as one combined patch view.
 */
function diffRowsForMultiEditTool(input: Record<string, unknown> | undefined): {
  rows: DiffRow[];
  filePath: string | undefined;
} {
  const filePath =
    typeof input?.file_path === 'string' ? (input.file_path as string) : undefined;
  const edits = Array.isArray(input?.edits) ? (input!.edits as unknown[]) : [];
  const rows: DiffRow[] = [];
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object') continue;
    const e = edit as Record<string, unknown>;
    const oldText = typeof e.old_string === 'string' ? (e.old_string as string) : '';
    const newText = typeof e.new_string === 'string' ? (e.new_string as string) : '';
    if (oldText) {
      for (const line of oldText.split('\n')) rows.push({ marker: '-', text: line });
    }
    if (newText) {
      for (const line of newText.split('\n')) rows.push({ marker: '+', text: line });
    }
  }
  return { rows, filePath };
}

const DiffBody: React.FC<{
  rows: DiffRow[];
  filePath?: string;
  variant: 'edit' | 'write';
}> = ({ rows, filePath, variant }) => {
  const adds = rows.filter((r) => r.marker === '+').length;
  const rems = rows.filter((r) => r.marker === '-').length;
  return (
    <div
      data-tool-diff={variant}
      className="cm-diff cm-diff-block"
      style={{
        margin: '6px 0 0 14px',
        border: `1px solid ${BORDER}`,
        borderRadius: 6,
        overflow: 'hidden',
        fontFamily: MONO_FONT,
        fontSize: 12,
        background: BG_SURFACE,
      }}
    >
      {filePath && (
        <div
          className="filehdr cm-diff-block-header"
          style={{
            padding: '6px 12px',
            background: 'var(--cm-bg-tertiary, #11161e)',
            color: 'var(--cm-text-secondary, #a6adc8)',
            borderBottom: `1px solid ${BORDER}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11.5,
          }}
        >
          <span aria-hidden>📁</span>
          <span className="cm-diff-filename" style={{ color: ACCENT }}>{filePath}</span>
          <span style={{ color: DIM, marginLeft: 'auto' }}>
            {variant === 'write'
              ? `+${adds} (new file)`
              : `−${rems} +${adds}`}
          </span>
        </div>
      )}
      {rows.map((row, i) => {
        const variantRow = row.marker === '+' ? 'add' : row.marker === '-' ? 'rem' : 'ctx';
        const lineKind =
          row.marker === '+' ? 'added' : row.marker === '-' ? 'removed' : 'context';
        const bg =
          row.marker === '+'
            ? 'var(--cm-diff-added-bg, rgba(166,227,161,0.14))'
            : row.marker === '-'
              ? 'var(--cm-diff-removed-bg, rgba(243,139,168,0.14))'
              : 'transparent';
        const markerColor =
          row.marker === '+'
            ? 'var(--cm-diff-added-marker, #a6e3a1)'
            : row.marker === '-'
              ? 'var(--cm-diff-removed-marker, #f38ba8)'
              : DIM;
        return (
          <div
            key={i}
            data-diff-row={variantRow}
            className={`row ${variantRow} cm-diff-line cm-diff-line-${lineKind}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '18px 1fr',
              alignItems: 'baseline',
              background: bg,
              minHeight: 18,
            }}
          >
            <div
              className="marker cm-diff-ln"
              style={{ textAlign: 'center', userSelect: 'none', color: markerColor }}
            >
              {row.marker === ' ' ? ' ' : row.marker}
            </div>
            <div
              className="content"
              style={{
                padding: '0 10px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: row.marker === ' ' ? DIM : TEXT_COLOR,
              }}
            >
              {row.text || ' '}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const EditTool: ToolRenderer = ({ block, result }) => {
  const { rows, filePath } = diffRowsForEditTool(block.input);
  return (
    <CroppedToolBody>
      <ToolBody block={block} />
      {rows.length > 0 && <DiffBody rows={rows} filePath={filePath} variant="edit" />}
      {result && <ResultBody result={result} />}
    </CroppedToolBody>
  );
};

const WriteTool: ToolRenderer = ({ block, result }) => {
  const { rows, filePath } = diffRowsForWriteTool(block.input);
  return (
    <CroppedToolBody>
      <ToolBody block={block} />
      {rows.length > 0 && <DiffBody rows={rows} filePath={filePath} variant="write" />}
      {result && <ResultBody result={result} />}
    </CroppedToolBody>
  );
};

// ── Provider tool body — pretty-print structured JSON result ────────
//
// Live bug 2026-04-30: the openagentic `Provider` tool's
// `mapToolResultToToolResultBlockParam` serializes its structured
// payload via JSON.stringify, so the wire delivers JSON-as-a-string
// (`{"action":"current","model":"gpt-oss:20b","isOverride":true}`).
// The generic `<ResultBody>` rendered that as a raw `<pre>` block,
// leaking implementation detail (quote marks, key names, braces) into
// the user's transcript. This renderer parses the payload and prints
// it as a small key/value summary that matches the rest of the TUI's
// glanceable style.
//
// Fail-soft: if `JSON.parse` throws (daemon ever ships a plain string),
// fall through to the raw text in the existing `<ResultBody>` rather
// than blank-screening the user.
type ProviderResultPayload =
  | { action: 'current'; model: string; isOverride: boolean }
  | { action: 'switch'; previousModel: string; newModel: string; reason?: string }
  | { action: 'reset'; previousModel: string; initialModel: string };

function tryParseProviderResult(text: string | undefined): ProviderResultPayload | null {
  if (!text) return null;
  const trimmed = text.trim();
  // Very cheap shape-check before paying for JSON.parse — Provider's
  // result always starts with `{` and contains an `action` key.
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

// ── TodoWrite body — inline status-aware list ──────────────────────
//
// Mirrors mocks/codemode-mockup.html lines 232-244 and the
// existing UiTodoBlock list, but rendered for the `TodoWrite` /
// `Todo` tool body so the user can SEE the todos under the boxed
// header instead of just a "1 todo" summary string. Each item
// surfaces a status glyph (☐ pending, ◐ in-progress, ✓ completed)
// + content text, with completed items struck through.
const TodoWriteBody: React.FC<{ todos: Array<Record<string, unknown>> }> = ({ todos }) => {
  return (
    <ul
      className="cm-todo-list"
      data-tool-renderer="todowrite"
      style={{
        listStyle: 'none',
        margin: '4px 0 0 14px',
        padding: '4px 8px',
        background: BG_SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 3,
        fontFamily: MONO_FONT,
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      {todos.map((raw, i) => {
        const status =
          raw.status === 'completed' || raw.status === 'in_progress' || raw.status === 'pending'
            ? (raw.status as 'completed' | 'in_progress' | 'pending')
            : 'pending';
        const content = typeof raw.content === 'string' ? (raw.content as string) : '';
        const activeForm = typeof raw.activeForm === 'string' ? (raw.activeForm as string) : '';
        const glyph = status === 'completed' ? '✓' : status === 'in_progress' ? '◐' : '☐';
        const color =
          status === 'completed'
            ? SUCCESS
            : status === 'in_progress'
              ? 'var(--accent-warning, #d29922)'
              : DIM;
        return (
          <li
            key={(typeof raw.id === 'string' ? (raw.id as string) : String(i))}
            data-status={status}
            className="cm-todo-item"
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              padding: '2px 0',
              color: status === 'completed' ? DIM : TEXT_COLOR,
              textDecoration: status === 'completed' ? 'line-through' : 'none',
            }}
          >
            <span aria-hidden style={{ color, flexShrink: 0, width: 14 }}>
              {glyph}
            </span>
            <span style={{ flex: 1 }}>{content}</span>
            {activeForm && status === 'in_progress' && (
              <span style={{ color, fontSize: 11, flexShrink: 0 }}>← {activeForm}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
};

const ProviderResultBody: React.FC<{ payload: ProviderResultPayload; isError: boolean }> = ({
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

  return (
    <div
      data-tool-result-error={isError ? 'true' : undefined}
      data-tool-renderer="provider"
      style={{
        margin: '4px 0 0 14px',
        padding: '4px 8px',
        background: BG_SURFACE,
        border: `1px solid ${BORDER}`,
        borderLeft: `2px solid ${isError ? ERROR_COLOR : SUCCESS}`,
        borderRadius: 3,
        color: isError ? ERROR_COLOR : TEXT_COLOR,
        fontFamily: MONO_FONT,
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      {lines.map(({ label, value }, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.6ch' }}>
          <span style={{ color: DIM, width: '8ch', flexShrink: 0 }}>{label}:</span>
          <span style={{ color: TEXT_COLOR }}>{value}</span>
        </div>
      ))}
    </div>
  );
};

const ProviderTool: ToolRenderer = ({ block, result }) => {
  // No result yet — show just the input summary line (matches GenericTool).
  if (!result) {
    return (
      <CroppedToolBody>
        <ToolBody block={block} />
      </CroppedToolBody>
    );
  }
  const payload = tryParseProviderResult(result.text);
  if (!payload) {
    // Defensive fallback — not a JSON payload (e.g. plain error
    // string). Render via the existing generic body so the user still
    // sees what came back instead of a blank card.
    return (
      <CroppedToolBody>
        <ToolBody block={block} />
        <ResultBody result={result} />
      </CroppedToolBody>
    );
  }
  return (
    <CroppedToolBody>
      <ToolBody block={block} />
      <ProviderResultBody payload={payload} isError={result.isError === true} />
    </CroppedToolBody>
  );
};

// ────────────────────────────────────────────────────────────────────
// WebSearch — render results as clickable cards with favicon + hostname
// ────────────────────────────────────────────────────────────────────

interface WebSearchLink {
  title: string;
  url: string;
}

function tryParseWebSearchResult(text: string | undefined): WebSearchLink[] | null {
  if (!text) return null;
  // Daemon emits `Web search results for query: "..."\n  \nLinks: [{...}]\n…`
  // We extract the JSON array following `Links:` and parse it. We
  // bracket-balance manually since the string can contain commas inside
  // titles that confuse a lazy regex.
  const idx = text.indexOf('Links:');
  if (idx < 0) return null;
  const after = text.slice(idx + 'Links:'.length).trimStart();
  if (!after.startsWith('[')) return null;
  let depth = 0;
  let end = -1;
  for (let i = 0; i < after.length; i++) {
    const ch = after[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return null;
  const m: [string, string] = ['', after.slice(0, end + 1)];
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (!Array.isArray(parsed)) return null;
    const valid: WebSearchLink[] = [];
    for (const item of parsed) {
      if (item && typeof item.title === 'string' && typeof item.url === 'string') {
        valid.push({ title: item.title, url: item.url });
      }
    }
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function getFaviconUrl(url: string): string {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch {
    return '';
  }
}

const WebSearchResultBody: React.FC<{ links: WebSearchLink[] }> = ({ links }) => (
  <div
    data-tool-renderer="websearch"
    style={{
      margin: '6px 0 0 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}
  >
    {links.map((link, i) => (
      <a
        key={i}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          background: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 4,
          textDecoration: 'none',
          color: TEXT_COLOR,
          fontFamily: 'var(--cm-prose-font, Inter, system-ui, sans-serif)',
          fontSize: 13,
          lineHeight: 1.4,
        }}
      >
        <img
          src={getFaviconUrl(link.url)}
          alt=""
          width={16}
          height={16}
          style={{ flexShrink: 0, borderRadius: 2 }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {link.title}
        </span>
        <span style={{ color: DIM, fontSize: 11, flexShrink: 0 }}>
          {getHostname(link.url)}
        </span>
      </a>
    ))}
  </div>
);

const WebSearchTool: ToolRenderer = ({ block, result }) => {
  if (!result) {
    return (
      <CroppedToolBody>
        <ToolBody block={block} />
      </CroppedToolBody>
    );
  }
  const links = tryParseWebSearchResult(result.text);
  if (!links) {
    return (
      <CroppedToolBody>
        <ToolBody block={block} />
        <ResultBody result={result} />
      </CroppedToolBody>
    );
  }
  return (
    <CroppedToolBody>
      <ToolBody block={block} />
      <WebSearchResultBody links={links} />
    </CroppedToolBody>
  );
};

/**
 * Generic fallback for unknown tool names. Identical body to
 * GenericTool, but flagged with data-tool-renderer="generic" so the
 * test harness can assert the fallback path fired (and a future debug
 * overlay can highlight uncovered tools for a cleanup pass).
 */
const GenericToolRender: ToolRenderer = ({ block, result }) => (
  <CroppedToolBody>
    <ToolBody block={block} />
    {result && <ResultBody result={result} />}
  </CroppedToolBody>
);

/**
 * The TOOL_RENDERERS map — keyed by the tool's wire name. Order
 * mirrors openagentic's tool catalog (chat-messages/toolRenderers.ts).
 * Adding a new specialised renderer is a one-line drop here; the Part
 * dispatcher needs no changes.
 */
export const TOOL_RENDERERS: Record<string, ToolRenderer> = {
  Bash: BashTool,
  Read: ReadTool,
  Write: WriteTool,
  FileWrite: WriteTool,
  Edit: EditTool,
  FileEdit: EditTool,
  Grep: GrepTool,
  Task: TaskTool,
  Agent: TaskTool,
  TodoWrite: TodoWriteTool,
  Todo: TodoWriteTool,
  Provider: ProviderTool,
  WebSearch: WebSearchTool,
};

/**
 * Build the user-visible Bash head argument: the literal command verbatim,
 * NOT the LLM-supplied `description` field. Mirrors Claude Code TUI's
 * `Bash(<command>)` head exactly. We deliberately ignore description so
 * the head reflects the actual operation, matching the parent agent's
 * own `● Bash(<cmd>)` rendering shown in this very session.
 *
 * Long commands wrap on width but the test asserts substring containment
 * — we keep them as a single string and let CSS handle wrapping.
 */
function bashHeadArgument(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const cmd = typeof input.command === 'string' ? (input.command as string) : '';
  return cmd;
}

/**
 * Extract the file path from a tool's input, if any. Used to render a
 * click-to-open link in the tool head for file-manipulating tools.
 * Returns undefined for tools that don't operate on a single file.
 */
function toolFilePath(name: string, input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  // Tools that use `file_path`
  if (
    name === 'Read' ||
    name === 'Write' ||
    name === 'FileWrite' ||
    name === 'Edit' ||
    name === 'FileEdit' ||
    name === 'MultiEdit'
  ) {
    const fp = input.file_path;
    return typeof fp === 'string' ? fp : undefined;
  }
  // NotebookEdit uses `notebook_path`
  if (name === 'NotebookEdit') {
    const fp = input.notebook_path;
    return typeof fp === 'string' ? fp : undefined;
  }
  return undefined;
}

/**
 * Format a top-level tool head following Claude Code TUI: `<ToolName>(<arg>)`.
 * For Bash, `<arg>` is the raw command (NOT description). For other tools,
 * fall back to renderToolInputSummary which already produces a one-line
 * label sized for the head row.
 */
function toolHeadLabel(name: string, input: Record<string, unknown> | undefined): string {
  if (name === 'Bash') {
    const arg = bashHeadArgument(input);
    return arg ? `${name}(${arg})` : name;
  }
  const summary = renderToolInputSummary(name, input);
  return summary ? `${name}(${summary})` : name;
}

// Truncation budget for tool result bodies — mirrors Claude Code TUI which
// keeps tool output to a couple of lines + a "+N more" footer.
const TOOL_RESULT_MAX_VISIBLE_LINES = 3;

/**
 * Split a tool-result body into the visible head lines + a hidden tail
 * count. Always normalises trailing newlines so a `\n` at EOL doesn't
 * inflate the count. Never returns an empty visible array if the input
 * has any content at all.
 */
function truncateResultLines(text: string): { visible: string[]; hiddenCount: number } {
  const trimmed = text.replace(/\s+$/, '');
  if (!trimmed) return { visible: [], hiddenCount: 0 };
  const lines = trimmed.split('\n');
  if (lines.length <= TOOL_RESULT_MAX_VISIBLE_LINES) {
    return { visible: lines, hiddenCount: 0 };
  }
  return {
    visible: lines.slice(0, TOOL_RESULT_MAX_VISIBLE_LINES),
    hiddenCount: lines.length - TOOL_RESULT_MAX_VISIBLE_LINES,
  };
}

/**
 * Pick the user-visible body for a tool result. Bash prefers stdout/stderr
 * detail when attached (matches the TUI which shows the actual stream).
 * Other tools fall through to the flat result.text.
 */
function toolResultBodyText(part: UiToolUseBlock): string {
  const result = part.result;
  if (!result) return '';
  if (part.name === 'Bash') {
    const detail = result.detail as { stdout?: string; stderr?: string } | undefined;
    const stdout = detail?.stdout ?? '';
    const stderr = detail?.stderr ?? '';
    if (stdout || stderr) {
      // Concatenate streams in display order — stdout, then stderr.
      return [stdout, stderr].filter(Boolean).join('\n').replace(/\n+$/, '');
    }
  }
  return result.text || (result.isError ? '(error)' : '(no output)');
}

/**
 * Claude Code TUI corner-prefix result body. First line carries the `⎿  `
 * (BOTTOM LEFT CORNER + 2 spaces) glyph; continuation lines indent by
 * 5 spaces so the visual gutter aligns under the body text. Long output
 * truncates to TOOL_RESULT_MAX_VISIBLE_LINES + a footer the user can
 * expand with ctrl+o.
 *
 * The `data-part-section` attributes are the test contract.
 */
const CornerResultBody: React.FC<{ part: UiToolUseBlock }> = ({ part }) => {
  const result = part.result!;
  const rawBody = toolResultBodyText(part);
  // B.2 — prefix "Error: " on the first line of an errored body unless
  // the text already begins with /^(error|Error)/ (avoid doubling).
  const body =
    result.isError && rawBody && !/^\s*error/i.test(rawBody)
      ? `Error: ${rawBody}`
      : rawBody;
  const allLines = body ? body.split('\n') : [];
  const { visible: truncated, hiddenCount } = truncateResultLines(body);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? allLines : truncated;

  return (
    <div
      className={`cm-tool-result${result.isError ? ' cm-tool-result-error' : ''}`}
      data-part-section="tool-result-corner"
      data-tool-result-error={result.isError ? 'true' : undefined}
      data-expanded={expanded || undefined}
      style={{
        marginTop: 2,
        color: result.isError ? ERROR_COLOR : 'var(--cm-text-secondary, #a6adc8)',
        fontFamily: MONO_FONT,
        fontSize: 12,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {visible.length === 0 ? (
        <div>
          <span aria-hidden style={{ color: DIM }}>⎿</span>
          <span>{'  '}</span>
          <span>{result.isError ? '(error)' : '(no output)'}</span>
        </div>
      ) : (
        visible.map((line, i) => (
          <div key={i}>
            {i === 0 ? (
              <>
                <span aria-hidden style={{ color: DIM }}>⎿</span>
                <span>{'  '}</span>
              </>
            ) : (
              // 5-space continuation indent (`⎿` + 2 spaces ≈ 5 cells in
              // the TUI's monospace column metrics).
              <span>{'     '}</span>
            )}
            <span>{line || ' '}</span>
          </div>
        ))
      )}
      {hiddenCount > 0 && !expanded && (
        <button
          type="button"
          data-part-section="tool-result-truncated"
          onClick={() => setExpanded(true)}
          style={{
            color: DIM,
            fontSize: 11,
            paddingLeft: '5ch',
            marginTop: 1,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            font: 'inherit',
          }}
        >
          {`… +${hiddenCount} line${hiddenCount === 1 ? '' : 's'} (click to expand)`}
        </button>
      )}
      {expanded && allLines.length > truncated.length && (
        <button
          type="button"
          data-part-section="tool-result-collapse"
          onClick={() => setExpanded(false)}
          style={{
            color: DIM,
            fontSize: 11,
            paddingLeft: '5ch',
            marginTop: 1,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            font: 'inherit',
          }}
        >
          {`▴ collapse (showing ${allLines.length} lines)`}
        </button>
      )}
      {/* Bug 3 (audit 2026-05-03): when the corner result body carries
          a permission-denied error from openagentic, surface the inline
          mode-switch affordance so the user can one-click to a less-
          restrictive mode and re-prompt. Without this the user sees the
          error and is stuck (no Allow/Deny card today; daemon-side
          canUseTool wiring is the deeper follow-up). */}
      {isPermissionDeniedError(result) && <PermissionDeniedSwitcher />}
    </div>
  );
};

/**
 * Compute Grep summary stats from a tool_use input + result. Match
 * count semantics depend on `output_mode`:
 * - `content` (default): each non-empty result line is one match; the
 *   leading `file:` prefix tells us how many distinct files matched.
 * - `files_with_matches`: each non-empty line is one matching file.
 * - `count`: each line is `file:N`; sum N for total matches.
 */
function computeGrepStats(
  input: Record<string, unknown>,
  result: UiToolResult | undefined,
): { matchCount: number; fileCount: number } {
  if (!result?.text) return { matchCount: 0, fileCount: 0 };
  const outputMode =
    typeof input.output_mode === 'string' ? (input.output_mode as string) : 'content';
  const lines = result.text.split('\n').filter((l) => l.length > 0);
  if (outputMode === 'files_with_matches') {
    return { matchCount: lines.length, fileCount: lines.length };
  }
  if (outputMode === 'count') {
    let total = 0;
    for (const line of lines) {
      const m = line.match(/:(\d+)$/);
      if (m) total += parseInt(m[1], 10);
    }
    return { matchCount: total, fileCount: lines.length };
  }
  const files = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^([^:]+):/);
    if (m) files.add(m[1]);
  }
  return { matchCount: lines.length, fileCount: files.size };
}

/**
 * Grep specialised body — one-line scannable headline summarising
 * `/pattern/ · in <path> · N matches in M files · <elapsed>`. Same
 * cognitive-load goal as the Bash + Read headlines: judge match
 * volume without un-cropping the body. CornerResultBody still renders
 * the raw `⎿`-prefixed match list immediately below.
 */
const GrepHeadlineBody: React.FC<{ part: UiToolUseBlock }> = ({ part }) => {
  const input = (part.input ?? {}) as Record<string, unknown>;
  const pattern = typeof input.pattern === 'string' ? (input.pattern as string) : '';
  const searchPath = typeof input.path === 'string' ? (input.path as string) : '';
  const glob = typeof input.glob === 'string' ? (input.glob as string) : '';
  const elapsed = part.elapsedSec;
  const { matchCount, fileCount } = computeGrepStats(input, part.result);
  return (
    <div
      data-testid="cm-grep-headline"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 2,
        marginBottom: 4,
        fontFamily: MONO_FONT,
        fontSize: 10.5,
        color: DIM,
        flexWrap: 'wrap',
      }}
    >
      {pattern && (
        <span
          title={pattern}
          style={{
            fontWeight: 600,
            color: ACCENT,
            maxWidth: 320,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          /{pattern}/
        </span>
      )}
      {searchPath && (
        <span
          title={searchPath}
          style={{
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          in {searchPath}
        </span>
      )}
      {glob && (
        <span style={{ color: 'var(--cm-text-secondary, #a6adc8)' }}>· {glob}</span>
      )}
      {matchCount > 0 ? (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {matchCount} {matchCount === 1 ? 'match' : 'matches'}
          {fileCount > 0 && fileCount !== matchCount && (
            <> in {fileCount} {fileCount === 1 ? 'file' : 'files'}</>
          )}
        </span>
      ) : (
        <span style={{ color: DIM }}>no matches</span>
      )}
      {typeof elapsed === 'number' && elapsed > 0 && (
        <span className="cm-duration" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatBashDuration(elapsed)}
        </span>
      )}
    </div>
  );
};

/**
 * Specialised tool body — chrome that lives BETWEEN the head row and the
 * `⎿`-prefixed corner result. Edit / Write render a two-side diff;
 * Provider renders a structured KV summary on TUI-side. Other tools
 * render nothing — their head + corner result is enough.
 *
 * Crucially, this never renders the raw tool result `<pre>` block (the
 * old fenced "TEXT" code block from the bug screenshot) — that path
 * belongs to CornerResultBody now.
 */
const SpecialisedToolBody: React.FC<{ part: UiToolUseBlock }> = ({ part }) => {
  if (part.name === 'Edit' || part.name === 'FileEdit') {
    const { rows, filePath } = diffRowsForEditTool(part.input);
    if (rows.length === 0) return null;
    return <DiffBody rows={rows} filePath={filePath} variant="edit" />;
  }
  if (part.name === 'MultiEdit') {
    const { rows, filePath } = diffRowsForMultiEditTool(part.input);
    if (rows.length === 0) return null;
    return <DiffBody rows={rows} filePath={filePath} variant="edit" />;
  }
  if (part.name === 'Write' || part.name === 'FileWrite') {
    const { rows, filePath } = diffRowsForWriteTool(part.input);
    if (rows.length === 0) return null;
    return <DiffBody rows={rows} filePath={filePath} variant="write" />;
  }
  if (part.name === 'TodoWrite' || part.name === 'Todo') {
    const todos = Array.isArray((part.input as Record<string, unknown> | undefined)?.todos)
      ? ((part.input as Record<string, unknown>).todos as Array<Record<string, unknown>>)
      : [];
    if (todos.length === 0) return null;
    return <TodoWriteBody todos={todos} />;
  }
  if (part.name === 'Bash' && part.result) {
    // Only render the Bash specialised body when the daemon attached
    // structured stdout/stderr — flat-text Bash results fall through to
    // the existing corner-prefix render so we don't double-render the
    // same payload.
    const detail = part.result.detail as
      | { stdout?: string; stderr?: string }
      | undefined;
    if (detail?.stdout || detail?.stderr) {
      return <BashResultBody block={part} result={part.result} />;
    }
  }
  if (part.name === 'Provider' && part.result) {
    const payload = tryParseProviderResult(part.result.text);
    if (payload) {
      return <ProviderResultBody payload={payload} isError={part.result.isError === true} />;
    }
  }
  if (part.name === 'WebSearch' && part.result) {
    const links = tryParseWebSearchResult(part.result.text);
    if (links) {
      return <WebSearchResultBody links={links} />;
    }
  }
  // Grep headline (2026-05-07): summarise pattern + path + match counts
  // ABOVE the corner-prefix result body. Renders only once a result is
  // attached (we need its text to compute counts). The corner result
  // still renders below this — Grep is "specialised: headline + corner".
  if (part.name === 'Grep' && part.result) {
    return <GrepHeadlineBody part={part} />;
  }
  return null;
};

/**
 * For tools that have a fully self-contained specialised body (e.g.
 * Provider's parsed KV summary), the raw corner-prefix result would
 * just leak the original wire payload — so we suppress it. Everything
 * else (Bash, Read, Grep, generic tools, even Edit/Write whose diff
 * body summarises the input but not the success/failure outcome) keeps
 * the corner-prefix so the user sees what came back.
 */
function suppressCornerResult(part: UiToolUseBlock): boolean {
  if (part.name === 'Provider' && part.result) {
    const payload = tryParseProviderResult(part.result.text);
    if (payload) return true;
  }
  if (part.name === 'WebSearch' && part.result) {
    const links = tryParseWebSearchResult(part.result.text);
    if (links) return true;
  }
  return false;
}

// ── Bash exit-code badge — auxiliary chrome rendered alongside the
// corner-prefix result body so the existing `data-bash-exit` /
// `data-bash-duration` test surface continues to work. We surface the
// exit code from result.detail (or infer 0/1 from isError) and the
// elapsed seconds from block.elapsedSec.
const BashExitBadge: React.FC<{ part: UiToolUseBlock }> = ({ part }) => {
  if (!part.result) return null;
  const exitCode = inferBashExitCode(part.result);
  const ok = exitCode === 0 && !part.result.isError;
  const elapsed = part.elapsedSec;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 4,
        paddingLeft: '5ch',
      }}
    >
      <span
        data-bash-exit={String(exitCode)}
        className={`cm-exit ${ok ? 'ok' : 'fail'}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '1px 7px',
          borderRadius: 4,
          fontSize: 10.5,
          fontWeight: 600,
          fontFamily: MONO_FONT,
          background: ok ? 'rgba(166,227,161,0.18)' : 'rgba(243,139,168,0.18)',
          color: ok ? SUCCESS : ERROR_COLOR,
        }}
      >
        {ok ? '✓' : '✕'} Exit {exitCode}
      </span>
      {typeof elapsed === 'number' && elapsed > 0 && (
        <span
          data-bash-duration
          className="cm-duration"
          style={{
            fontSize: 10.5,
            color: DIM,
            fontVariantNumeric: 'tabular-nums',
            fontFamily: MONO_FONT,
          }}
        >
          {formatBashDuration(elapsed)}
        </span>
      )}
    </div>
  );
};

/**
 * Per-tool icon glyph for the boxed mock-parity header.
 *
 * IMPORTANT: every glyph here MUST be a Unicode TEXT codepoint
 * (Misc Symbols & Arrows / Geometric Shapes ranges), NOT an emoji.
 * Browsers render emoji codepoints (U+1F300+, U+1F600+) with the
 * platform's full-color emoji font, which IGNORES `color:` CSS —
 * captured 2026-05-02 in codemode-mock-parity-audit.report.md item
 * #12: live tool icon was rgb(30,64,175) (default emoji blue for
 * 📖) instead of var(--cm-prompt) #d77757 (coral) the mock requires.
 *
 * Mock (mocks/codemode-mockup.html lines 622+) only ships ✎ (Write)
 * and ▶ (Bash) — both text glyphs. Other tools fall back to ● to
 * match the new combined-parity mockup
 * (mocks/codemode-claude-code-parity-mockup.html). All glyphs below
 * accept CSS color and pin to var(--cm-prompt).
 */
export function toolIconGlyph(name: string): string {
  switch (name) {
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return '✎'; // U+270E PENCIL — text glyph, colorable
    case 'Bash':
      return '▶'; // U+25B6 BLACK RIGHT-POINTING TRIANGLE — text glyph
    default:
      // Read / Grep / Glob / TodoWrite / WebSearch / WebFetch / Task /
      // anything plugin-supplied. Single bullet matches Claude Code TUI
      // and the new combined-parity mockup. CSS color wins.
      return '●'; // U+25CF BLACK CIRCLE — text glyph
  }
}

const ToolUsePart: React.FC<{
  part: UiToolUseBlock;
  depth: number;
  inSubagent?: boolean;
}> = ({ part, depth, inSubagent = false }) => {
  // Task / Agent tools render with the Claude Code-style chrome: header
  // line with ● glyph + description + elapsed time; collapsible body
  // hosting the full subagent transcript indented beneath a `│` rule;
  // ✓ result line at the bottom. All other tools keep the existing
  // generic ToolUseRow body for backwards compatibility.
  if (part.name === 'Task' || part.name === 'Agent') {
    return <TaskTranscriptPart part={part} depth={depth} inSubagent={inSubagent} />;
  }

  const isFallback = !TOOL_RENDERERS[part.name];

  // Row-style header glyph. Top-level uses ●; in-subagent uses ⎿ to mirror
  // mocks/codemode-tui-parity/mock-1-deploy-debug.html line 73-79 ("⎿
  // Bash <arg> ✓ 1.2s [hide]") — the corner glyph signals "this entry
  // is nested under a parent".
  const headGlyph = inSubagent ? '⎿' : '●';
  // Bug-fix 2026-04-30: head label MUST mirror Claude Code TUI's
  // `Bash(<command>)` format (or `<ToolName>(<summary>)` for non-Bash).
  // Previously rendered the agent-supplied description, which leaked
  // model-side labels into the user's transcript.
  const headLabel = toolHeadLabel(part.name, part.input);
  const hasResult = part.result !== undefined;
  // A.7: file path for click-to-open. Only defined for file-touching tools.
  const filePath = toolFilePath(part.name, part.input);

  // P2 mock-parity status pill — ✓ success / ✕ Error / ● running. Only
  // emitted for non-subagent renders (subagent tools are nested under
  // their parent's tool-block, so they reuse the corner-prefix glyph).
  type StatusPill = { kind: 'success' | 'error' | 'running'; glyph: string; text: string };
  let statusPill: StatusPill | null = null;
  if (!inSubagent) {
    if (hasResult && part.result!.isError) {
      statusPill = { kind: 'error', glyph: '✕', text: ' Error' };
      if (part.name === 'Bash') {
        statusPill.text = ` Error Exit ${inferBashExitCode(part.result!)}`;
      }
    } else if (hasResult) {
      statusPill = { kind: 'success', glyph: '✓', text: '' };
      if (part.name === 'Bash') {
        statusPill.text = ` Exit ${inferBashExitCode(part.result!)}`;
      }
    } else if (part.streaming) {
      statusPill = { kind: 'running', glyph: '●', text: '' };
    }
  }
  const statusColor =
    statusPill?.kind === 'error'
      ? ERROR_COLOR
      : statusPill?.kind === 'success'
        ? SUCCESS
        : 'var(--cm-prompt, #d77757)';

  // Header inner content — shared between subagent (corner-prefix) and
  // top-level (boxed mock-parity) renders. Adds icon/name/path/status
  // spans alongside the existing label so legacy text-content assertions
  // (e.g. `Bash(echo hi)`) continue to match.
  const headerInner = (
    <>
      <span
        aria-hidden
        data-glyph={inSubagent ? 'subagent-tool' : 'tool'}
        style={{ color: inSubagent ? DIM : ACCENT, flexShrink: 0, fontSize: 12 }}
      >
        {headGlyph}
      </span>
      {/* Mock-parity colors live in codeMode.css — drop inline `color`
          here so .cm-tool-icon (orange #d77757), .cm-tool-name (accent
          blue #58a6ff bold), and .cm-tool-path (muted #8b949e) actually
          win. Inline styles always beat class CSS, which is why the
          tools were rendering monochrome before. */}
      {!inSubagent && (
        <span
          aria-hidden
          className="cm-tool-icon"
          style={{ flexShrink: 0, fontSize: 12 }}
        >
          {toolIconGlyph(part.name)}
        </span>
      )}
      {!inSubagent && (
        <span
          className="cm-tool-name"
          style={{ flexShrink: 0 }}
        >
          {part.name}
        </span>
      )}
      {!inSubagent && filePath && (
        <span
          className="cm-tool-path"
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
            flexShrink: 1,
          }}
        >
          <OpenInPanelLink path={filePath}>{filePath}</OpenInPanelLink>
        </span>
      )}
      <span
        data-part-section="tool-head-label"
        style={{
          color: TEXT_COLOR,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
          flex: 1,
          fontWeight: 500,
          // C.2 P8 — in the boxed (non-subagent) render the canonical
          // visible label is split across .cm-tool-name + .cm-tool-path.
          // The legacy span stays in the DOM for tests that query
          // data-part-section, but visually collapse it so the user
          // doesn't see "Read(/path) Read(/path)" duplicates.
          display: !inSubagent && filePath ? 'none' : undefined,
        }}
      >
        {filePath ? (
          <>
            {`${part.name}(`}
            {inSubagent ? (
              <OpenInPanelLink path={filePath}>{filePath}</OpenInPanelLink>
            ) : (
              filePath
            )}
            {')'}
          </>
        ) : (
          headLabel
        )}
      </span>
      {statusPill && (
        <span
          className={`cm-tool-status cm-tool-status-${statusPill.kind}`}
          aria-hidden
          style={{
            color: statusColor,
            flexShrink: 0,
            fontWeight: 600,
            marginLeft: '0.6ch',
            fontSize: 12,
          }}
        >
          {statusPill.kind === 'running' ? (
            <span className="cm-tool-spinner">
              <span className="cm-tool-spinner-dot">{statusPill.glyph}</span>
            </span>
          ) : (
            statusPill.glyph
          )}
          {statusPill.text}
        </span>
      )}
      {/* Legacy ✓/✕ glyph — kept for subagent renders and for any tests
          that query `[data-glyph="tool-check"]`. Suppressed when the new
          `.cm-tool-status` pill already conveys the same state to avoid
          a double-tick in the boxed header. */}
      {hasResult && !statusPill && (
        <span
          aria-hidden
          data-glyph="tool-check"
          style={{
            color: part.result!.isError ? ERROR_COLOR : SUCCESS,
            flexShrink: 0,
            fontWeight: 600,
            marginLeft: '0.6ch',
          }}
        >
          {part.result!.isError ? '✕' : '✓'}
        </span>
      )}
      {typeof part.elapsedSec === 'number' && part.elapsedSec > 0 && (
        <span
          data-part-section="tool-elapsed"
          style={{
            color: DIM,
            fontVariantNumeric: 'tabular-nums',
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          {formatElapsed(part.elapsedSec)}
        </span>
      )}
    </>
  );

  return (
    <div
      data-part="tool_use"
      data-tool={part.name}
      data-depth={depth}
      data-streaming={part.streaming || undefined}
      data-tool-renderer={isFallback ? 'generic' : undefined}
      data-in-subagent={inSubagent || undefined}
      className="cm-part cm-part-tool-use cm-tool"
      style={{
        padding: inSubagent ? '2px 0' : '4px 0',
        color: TEXT_COLOR,
        fontFamily: MONO_FONT,
        fontSize: 13,
      }}
    >
      {inSubagent ? (
        <div
          className="head"
          data-part-section="tool-head"
          style={{ display: 'flex', alignItems: 'baseline', gap: '0.6ch' }}
        >
          {headerInner}
        </div>
      ) : (
        <div
          className="cm-tool-block"
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            background: BG_SURFACE,
            overflow: 'hidden',
          }}
        >
          <div
            className="head cm-tool-header"
            data-part-section="tool-head"
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.6ch',
              padding: '6px 10px',
              borderBottom: `1px solid ${BORDER}`,
            }}
          >
            {headerInner}
          </div>
          <CroppedToolBody style={{ padding: '6px 10px' }}>
            {/* Specialised body — diff for Edit/Write, structured KV for Provider.
                Renders for tools that have richer chrome BEYOND the head + result
                corner-prefix. Bash falls through to CornerResultBody for the
                ⎿-prefixed stdout/stderr AND ALSO renders BashExitBadge below to
                keep the existing `data-bash-exit` / `data-bash-duration`
                surface (Bash is "specialised: ⎿ + badge", not either/or). */}
            <SpecialisedToolBody part={part} />
            {/* Inline result body — Claude Code TUI corner-prefix format.
                First line carries the `⎿  ` glyph; continuations indent 5
                spaces; long output truncates to N visible lines + a footer.
                Suppressed for tools whose specialised body fully owns the
                result (e.g. Provider parses its JSON into KV lines — the raw
                payload would just leak). */}
            {hasResult && !suppressCornerResult(part) && <CornerResultBody part={part} />}
            {/* Bash exit-code badge — auxiliary chrome alongside the corner
                body. Provides the `data-bash-exit` / `data-bash-duration`
                test surface and visual exit-status pill. */}
            {hasResult && part.name === 'Bash' && <BashExitBadge part={part} />}
          </CroppedToolBody>
        </div>
      )}
      {inSubagent && part.result && (
        <pre
          data-tool-result-error={part.result.isError ? 'true' : undefined}
          style={{
            margin: '2px 0 4px 18px',
            padding: '4px 8px',
            background: 'var(--cm-bash-bg, rgba(243,139,168,0.06))',
            borderLeft: `2px solid ${
              part.result.isError ? ERROR_COLOR : 'var(--cm-bash-prefix, #f38ba8)'
            }`,
            borderRadius: 3,
            color: part.result.isError ? ERROR_COLOR : 'var(--cm-text-secondary, #a6adc8)',
            fontFamily: MONO_FONT,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 200,
            overflow: 'auto',
          }}
        >
          {part.result.text || (part.result.isError ? '(error)' : '(no output)')}
        </pre>
      )}
      {/* Sub-transcript recursion — parallel subagents render INLINE
          beneath their parent Task tool, NOT in a sidebar tree.
          Recurses through Part so each sub-block's dispatch fires its
          own renderer (and its own depth attribute increments). */}
      {part.subBlocks && part.subBlocks.length > 0 && (
        <div
          className="cm-subtranscript"
          style={{
            marginLeft: 12,
            paddingLeft: 10,
            marginTop: 4,
            borderLeft: `2px solid ${BORDER}`,
          }}
        >
          {part.subBlocks.map((sub, idx) => (
            <Part key={idx} part={sub} depth={depth + 1} inSubagent />
          ))}
        </div>
      )}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────
// TaskTranscriptPart — Claude Code-style chrome for Task / Agent tools
//
// Visual contract (see PartProps docs above for the unicode shapes):
//   ● Task ⎯ Research Diablo 4 Necromancer builds                ↑ 12.4s
//   │ ▸ assistant: I'll research necromancer builds...
//   │ ● WebFetch ⎯ https://...
//   │ ● Read ⎯ ./notes/dnd.md
//   │ ▸ assistant: The dominant builds in Season 13 are…
//   ✓ result: Dominant builds: blood lance, bone spirit, …
//
// Header is clickable: collapses/expands the inner transcript. Defaults
// to expanded while running (block is streaming with no result yet) and
// collapsed once the Task has a result attached — matches the Claude
// Code TUI which keeps in-flight work visible and folds completed work.
// ────────────────────────────────────────────────────────────────────

/**
 * Summarize the subagent's run for the panel header — `N turns, M tools`
 * derived from the materialized subBlocks. Mirrors the mock-1 status
 * line "◆ root-cause-investigator — 4 turns, 2 tools, completed".
 */
function countStages(subBlocks: AssistantBlock[]): string {
  let textTurns = 0;
  let tools = 0;
  for (const b of subBlocks) {
    if (b.kind === 'text') textTurns += 1;
    else if (b.kind === 'tool_use') tools += 1;
  }
  const turns = textTurns + tools;
  return `${turns} turn${turns === 1 ? '' : 's'}, ${tools} tool${tools === 1 ? '' : 's'}`;
}

const TaskTranscriptPart: React.FC<{
  part: UiToolUseBlock;
  depth: number;
  inSubagent?: boolean;
}> = ({ part, depth, inSubagent = false }) => {
  const hasResult = part.result !== undefined;
  // Auto-collapse when the Task has finished (no longer streaming AND
  // a result is attached). Auto-expand otherwise so in-flight work
  // remains visible. The user can override either default by clicking
  // the header — `userToggled` pins their preference.
  const finished = hasResult && !part.streaming;
  const [userToggled, setUserToggled] = useState(false);
  const [open, setOpen] = useState<boolean>(!finished);
  // Transition from running → finished should auto-collapse, but only
  // if the user hasn't manually toggled.
  React.useEffect(() => {
    if (!userToggled) {
      setOpen(!finished);
    }
  }, [finished, userToggled]);

  const description = String(
    (part.input as Record<string, unknown> | undefined)?.description ?? '',
  );
  const summary = renderToolInputSummary(part.name, part.input);
  const titleText = description || summary || part.name;

  const showElapsed = typeof part.elapsedSec === 'number' && part.elapsedSec > 0;
  const subBlocks = part.subBlocks ?? [];

  const onHeaderClick = () => {
    setUserToggled(true);
    setOpen((v) => !v);
  };

  return (
    <div
      data-part="tool_use"
      data-tool={part.name}
      data-tool-use-id={part.toolUseId}
      data-depth={depth}
      data-streaming={part.streaming || undefined}
      data-collapsed={!open ? 'true' : undefined}
      data-in-subagent={inSubagent || undefined}
      className="cm-part cm-part-tool-use cm-part-task"
      style={{
        padding: inSubagent ? '2px 0' : '4px 0',
        color: TEXT_COLOR,
        fontFamily: MONO_FONT,
        fontSize: 13,
      }}
    >
      {/* Header line: clickable, mirrors the TUI's `● Task ⎯ <desc>` */}
      <div
        data-part-section="task-header"
        role="button"
        tabIndex={0}
        onClick={onHeaderClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onHeaderClick();
          }
        }}
        aria-expanded={open}
        title={open ? 'Click to collapse' : 'Click to expand'}
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.6ch',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span aria-hidden style={{ color: ACCENT, flexShrink: 0, fontSize: 12 }}>
          ●
        </span>
        <span style={{ color: ACCENT, fontWeight: 600, flexShrink: 0 }}>{part.name}</span>
        <span aria-hidden style={{ color: DIM, flexShrink: 0 }}>⎯</span>
        <span
          style={{
            color: TEXT_COLOR,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
            flex: 1,
          }}
        >
          {titleText}
        </span>
        {showElapsed && (
          <span
            data-part-section="task-elapsed"
            style={{
              color: DIM,
              fontVariantNumeric: 'tabular-nums',
              fontSize: 11,
              flexShrink: 0,
              marginLeft: 'auto',
              paddingLeft: '1ch',
            }}
            aria-label={`elapsed ${part.elapsedSec} seconds`}
          >
            {formatElapsed(part.elapsedSec!)}
          </span>
        )}
        <span
          aria-hidden
          style={{ color: DIM, fontSize: 10, flexShrink: 0, marginLeft: showElapsed ? 6 : 'auto' }}
        >
          {open ? '▾' : '▸'}
        </span>
      </div>
      {/* Sub-transcript — `.cm-subagent` panel matching mocks/codemode-tui-
          parity/mock-1-deploy-debug.html lines 193-223. Header bar with
          ◆ glyph + agent name + status, indented body with the inner
          Part recursion. The `.cm-subtranscript` className is preserved
          on the body so existing tests/themes that target the left rule
          continue to work. When the Task is collapsed the panel isn't
          rendered at all — the user sees just the header + (if present)
          the result line. */}
      {open && subBlocks.length > 0 && (
        <div
          className="cm-subagent"
          data-part-section="task-subagent-panel"
          style={{
            margin: '4px 0 4px 18px',
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            background: BG_SURFACE,
            overflow: 'hidden',
          }}
        >
          <div
            className="hdr"
            style={{
              padding: '6px 12px',
              borderBottom: `1px solid ${BORDER}`,
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              fontFamily: MONO_FONT,
              fontSize: 12,
              color: 'var(--cm-prompt, #cba6f7)',
            }}
          >
            <span aria-hidden style={{ flexShrink: 0 }}>◆</span>
            <span style={{ fontWeight: 600 }}>{titleText || 'subagent'}</span>
            <span style={{ color: DIM, fontSize: 11 }}>
              — {countStages(subBlocks)}
            </span>
          </div>
          <div
            className="body cm-subtranscript"
            style={{
              padding: '6px 12px',
              borderLeft: '2px solid var(--cm-prompt, #cba6f7)',
            }}
          >
            {subBlocks.map((sub, idx) => (
              <Part key={idx} part={sub} depth={depth + 1} inSubagent />
            ))}
          </div>
        </div>
      )}
      {/* ✓ / ✕ result line. Shown whenever the Task has a result attached
          AND the body is expanded, so the user always has a single
          glanceable outcome under the indented transcript. */}
      {open && part.result && (
        <div
          data-part-section="task-result"
          data-tool-result-error={part.result.isError ? 'true' : undefined}
          style={{
            marginTop: 4,
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.6ch',
            color: part.result.isError ? ERROR_COLOR : TEXT_COLOR,
            fontFamily: MONO_FONT,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          <span
            aria-hidden
            style={{
              color: part.result.isError ? ERROR_COLOR : SUCCESS,
              flexShrink: 0,
              fontWeight: 600,
            }}
          >
            {part.result.isError ? '✕' : '✓'}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {part.result.text || (part.result.isError ? '(error)' : '(no output)')}
          </span>
        </div>
      )}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────
// Tool_result part — orphan / standalone replay path
// ────────────────────────────────────────────────────────────────────

const ToolResultPart: React.FC<{ part: UiToolResultBlock; depth: number }> = ({
  part,
  depth,
}) => (
  <div
    data-part="tool_result"
    data-depth={depth}
    data-tool-result-error={part.result.isError ? 'true' : undefined}
    className="cm-part cm-part-tool-result"
    style={{
      margin: '4px 0',
      fontFamily: MONO_FONT,
      fontSize: 12,
      color: part.result.isError ? ERROR_COLOR : TEXT_COLOR,
    }}
  >
    {part.toolName && (
      <div style={{ color: DIM, fontSize: 11, marginBottom: 2 }}>
        ⎿ result for <span style={{ color: ACCENT }}>{part.toolName}</span>
      </div>
    )}
    <pre
      style={{
        margin: 0,
        padding: '4px 8px',
        background: BG_SURFACE,
        border: `1px solid ${BORDER}`,
        borderLeft: `2px solid ${part.result.isError ? ERROR_COLOR : SUCCESS}`,
        borderRadius: 3,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 240,
        overflow: 'auto',
      }}
    >
      {part.result.text || (part.result.isError ? '(error)' : '(no output)')}
    </pre>
  </div>
);

// ────────────────────────────────────────────────────────────────────
// Todo part — status-aware list
// ────────────────────────────────────────────────────────────────────

const STATUS_GLYPH: Record<UiTodoBlock['todos'][number]['status'], string> = {
  pending: '☐',
  in_progress: '◐',
  completed: '✓',
};

const STATUS_COLOR: Record<UiTodoBlock['todos'][number]['status'], string> = {
  pending: DIM,
  in_progress: 'var(--accent-warning, #d29922)',
  completed: SUCCESS,
};

const TodoPart: React.FC<{ part: UiTodoBlock; depth: number }> = ({ part, depth }) => (
  <div
    data-part="todo"
    data-depth={depth}
    className="cm-part cm-part-todo"
    style={{
      margin: '4px 0',
      padding: '6px 8px',
      border: `1px solid ${BORDER}`,
      borderRadius: 4,
      background: BG_SURFACE,
      fontFamily: MONO_FONT,
      fontSize: 13,
    }}
  >
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {part.todos.map((t, i) => (
        <li
          key={t.id ?? i}
          data-status={t.status}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            padding: '2px 0',
            color: t.status === 'completed' ? DIM : TEXT_COLOR,
            textDecoration: t.status === 'completed' ? 'line-through' : 'none',
          }}
        >
          <span aria-hidden style={{ color: STATUS_COLOR[t.status], width: 14, flexShrink: 0 }}>
            {STATUS_GLYPH[t.status]}
          </span>
          <span style={{ flex: 1 }}>{t.content}</span>
          {t.activeForm && t.status === 'in_progress' && (
            <span style={{ color: STATUS_COLOR[t.status], fontSize: 11 }}>
              ← {t.activeForm}
            </span>
          )}
        </li>
      ))}
    </ul>
  </div>
);

// ────────────────────────────────────────────────────────────────────
// Ink-DOM view part — renders a daemon-mounted local-jsx slash-command
// UI inline beneath the assistant message that triggered it. Phase E.
// ────────────────────────────────────────────────────────────────────

const InkDomViewPart: React.FC<{ part: UiInkDomViewBlock; depth: number }> = ({
  part,
  depth,
}) => (
  <div
    data-part="inkdom_view"
    data-depth={depth}
    data-view-id={part.viewId}
    data-command={part.command}
    className="cm-part cm-part-inkdom-view"
    style={{
      margin: '6px 0',
      padding: '8px 10px',
      border: `1px solid ${BORDER}`,
      borderRadius: 6,
      background: BG_SURFACE,
      fontFamily: MONO_FONT,
      fontSize: 13,
    }}
  >
    <InkDomView viewId={part.viewId} />
  </div>
);

// ────────────────────────────────────────────────────────────────────
// BoundaryPart — visual divider for plugin/skill/compact system events.
//
// Mirrors `mocks/codemode-tui-parity/mock-2-fullstack-build.html` lines
// 39-50 and the `.cm-boundary` rules in `_shared.css`. The dashed
// top/bottom rule + glyph-coloured-by-subtype + bold label + body text.
// ────────────────────────────────────────────────────────────────────

const BOUNDARY_SUBTYPE_GLYPH: Record<UiBoundaryBlock['subtype'], string> = {
  plugin: '↻',
  skill: '✦',
  compact: '⚯',
  // Mock-1 line 338 — the `⤳` arrow for "model swap" (slash command or
  // smart-router auto-rotation mid-turn).
  'model-swap': '⤳',
  generic: '•',
};

const BoundaryPart: React.FC<{ part: UiBoundaryBlock; depth: number }> = ({ part, depth }) => {
  return (
    <div
      data-part="boundary"
      data-boundary-subtype={part.subtype}
      data-depth={depth}
      className={`cm-part cm-part-boundary cm-boundary ${part.subtype}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 14px',
        margin: '14px 0',
        fontFamily: MONO_FONT,
        fontSize: 11.5,
        color: DIM,
        borderTop: `1px dashed ${BORDER}`,
        borderBottom: `1px dashed ${BORDER}`,
        background: BG_SURFACE,
      }}
    >
      <span
        aria-hidden
        className="glyph"
        style={{
          color:
            part.subtype === 'plugin'
              ? 'var(--cm-info, #89dceb)'
              : part.subtype === 'skill'
                ? SUCCESS
                : part.subtype === 'compact'
                  ? 'var(--cm-warning, #f9e2af)'
                  : part.subtype === 'model-swap'
                    ? 'var(--cm-prompt, #cba6f7)'
                    : 'var(--cm-prompt, #cba6f7)',
          flexShrink: 0,
        }}
      >
        {BOUNDARY_SUBTYPE_GLYPH[part.subtype]}
      </span>
      <span
        className="label"
        style={{
          fontWeight: 600,
          color: 'var(--cm-text-secondary, #a6adc8)',
          flexShrink: 0,
        }}
      >
        {part.label}
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{part.body}</span>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────
// ParallelGroupPart — collapse N consecutive tool_use blocks behind a
// single rolled-up button mirroring claude.ai/code's chat surface
// (e.g. `Created 4 files, ran a command, updated todos`). Click to
// expand inline; expanded children render the same Part chain at
// depth+1. Visually trims the transcript so the assistant's prose
// dominates the conversation flow rather than tool exhaust.
// ────────────────────────────────────────────────────────────────────

const ParallelGroupPart: React.FC<{
  part: UiParallelGroupBlock;
  depth: number;
  inSubagent?: boolean;
}> = ({ part, depth, inSubagent = false }) => {
  const count = part.tools.length;
  const [expanded, setExpanded] = React.useState<boolean>(false);
  const summary = summarizeToolGroup(part.tools);
  return (
    <div
      data-part="parallel_group"
      data-parallel-count={count}
      data-depth={depth}
      className="cm-part cm-part-parallel-group cm-parallel"
      style={{ margin: '6px 0' }}
    >
      <button
        type="button"
        data-part-section="parallel-group-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="cm-parallel-toggle"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          background: 'transparent',
          border: `1px solid ${BORDER}`,
          borderRadius: 6,
          color: DIM,
          fontFamily: MONO_FONT,
          fontSize: 12,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 10,
            transition: 'transform 120ms ease',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            color: ACCENT,
          }}
        >
          ▸
        </span>
        <span style={{ color: 'var(--cm-text, #e6edf3)' }}>{summary}</span>
        <span data-part-section="parallel-group-count" style={{ color: ACCENT, marginLeft: 4 }}>
          ({count})
        </span>
      </button>
      {expanded && (
        <div
          data-part-section="parallel-group-children"
          style={{
            marginTop: 6,
            borderLeft: `2px solid ${BORDER}`,
            paddingLeft: 12,
          }}
        >
          {part.tools.map((tool, idx) => (
            <Part
              key={tool.toolUseId ?? idx}
              part={tool}
              depth={depth + 1}
              inSubagent={inSubagent}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────
// Default export for ergonomic imports
// ────────────────────────────────────────────────────────────────────

export default Part;
