/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  <Row gutter={PROMPT_CARET} gutterColor={DIM} marginTop={8}>
    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: TEXT }}>
      {text}
    </div>
  </Row>
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
const MarkdownPre: React.FC<React.HTMLAttributes<HTMLPreElement>> = ({
  children,
  ...rest
}) => {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const el = preRef.current;
    if (!el) return;
    const text = el.innerText;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard denied — no-op, keep button hidden */
    }
  };
  return (
    <pre ref={preRef} {...rest}>
      {children}
      <button
        type="button"
        className={copied ? 'cm-copy-btn copied' : 'cm-copy-btn'}
        onClick={handleCopy}
        aria-label="Copy code to clipboard"
      >
        {copied ? '✓ copied' : 'copy'}
      </button>
    </pre>
  );
};

const MARKDOWN_COMPONENTS = {
  pre: MarkdownPre,
};

const AssistantTextRow: React.FC<{ text: string; isFirstBlock: boolean }> = ({
  text,
  isFirstBlock,
}) => {
  if (!text) return null;
  return (
    <Row
      gutter={isFirstBlock ? BLACK_CIRCLE : ''}
      gutterColor={TEXT}
      marginTop={isFirstBlock ? 8 : 0}
    >
      <div className="cm-markdown" style={{ color: TEXT }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
          {text}
        </ReactMarkdown>
      </div>
    </Row>
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
 * Animated thinking indicator — uses ThinkingSphere (canvas-based sparkle
 * globe animation) for visual consistency with chat mode.
 */
const ThinkingGlobe: React.FC<{ streaming: boolean; size?: number }> = ({ streaming, size = 18 }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      flexShrink: 0,
    }}
  >
    <ThinkingSphere state={streaming ? 'thinking' : 'hidden'} size={size} />
  </span>
);

/**
 * Animated placeholder shown immediately on submit, before any stream
 * data arrives. Shows ThinkingSphere globe + rotating verb + bouncing
 * dots so the user knows something is happening.
 */
const StreamingPlaceholder: React.FC = () => {
  const [verbIdx, setVerbIdx] = useState(() => Math.floor(Math.random() * THINKING_VERBS.length));
  const elapsed = useElapsedTimer(true);

  // Rotate verb every ~2.5 seconds
  useEffect(() => {
    const id = setInterval(() => {
      setVerbIdx((i) => (i + 1) % THINKING_VERBS.length);
    }, 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="cm-think-glow"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        borderLeft: '2px solid ' + PURPLE_COLOR,
        padding: '8px 12px',
        background: 'linear-gradient(90deg, rgba(163,113,247,0.06) 0%, transparent 100%)',
        borderRadius: '0 6px 6px 0',
      }}
    >
      <ThinkingGlobe streaming={true} size={20} />
      <span
        className="cm-splash-gradient"
        style={{ fontSize: 14, fontWeight: 600, fontStyle: 'italic' }}
      >
        {THINKING_VERBS[verbIdx]}
      </span>
      <span className="cm-dot-bounce">
        <span style={{ color: PURPLE_COLOR, fontSize: 16 }}>&#183;</span>
        <span style={{ color: PURPLE_COLOR, fontSize: 16 }}>&#183;</span>
        <span style={{ color: PURPLE_COLOR, fontSize: 16 }}>&#183;</span>
      </span>
      {elapsed > 0.5 && (
        <span style={{
          color: PURPLE_COLOR,
          fontSize: 11,
          padding: '1px 6px',
          borderRadius: 3,
          backgroundColor: 'rgba(163,113,247,0.1)',
          marginLeft: 'auto',
        }}>
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
  const [userCollapsed, setUserCollapsed] = useState(false);
  const elapsed = useElapsedTimer(block.streaming);
  const charCount = block.thinking.length;
  const tokCount = Math.round(charCount / 4);
  const speed = elapsed > 0.2 ? Math.round(tokCount / elapsed) : 0;
  const showBody = block.streaming ? !userCollapsed : !userCollapsed && charCount > 0;

  if (!block.thinking && !block.streaming) return null;

  const timerStr = elapsed > 0 ? `${elapsed.toFixed(1)}s` : '';
  const tokenHint = tokCount > 5 ? `~${tokCount} tok` : '';
  const speedHint = speed > 0 ? `${speed} tok/s` : '';

  return (
    <div
      className={block.streaming ? 'cm-think-glow' : ''}
      style={{
        ...MONO_STYLE,
        marginTop,
        borderLeft: `2px solid ${block.streaming ? PURPLE_COLOR : 'var(--cm-border, #30363d)'}`,
        paddingLeft: 10,
        padding: '6px 10px',
        background: block.streaming
          ? 'linear-gradient(90deg, rgba(163,113,247,0.05) 0%, transparent 100%)'
          : 'transparent',
        borderRadius: '0 4px 4px 0',
        transition: 'border-color 0.3s, background 0.3s',
      }}
    >
      <button
        type="button"
        onClick={() => setUserCollapsed((v) => !v)}
        style={{
          ...MONO_STYLE,
          background: 'none',
          border: 'none',
          padding: 0,
          color: DIM,
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
        title={showBody ? 'Click to collapse' : 'Click to expand'}
      >
        <ThinkingGlobe streaming={block.streaming} size={18} />
        <span style={{ fontStyle: 'italic' }}>
          Thinking{block.streaming ? '…' : ''}
        </span>
        {timerStr && (
          <span style={{
            color: PURPLE_COLOR,
            fontSize: 11,
            padding: '0 6px',
            borderRadius: 3,
            backgroundColor: 'rgba(163,113,247,0.1)',
          }}>
            {timerStr}
          </span>
        )}
        {tokenHint && (
          <span style={{ color: 'var(--cm-text-muted, #484f58)', fontSize: 11 }}>
            {tokenHint}
          </span>
        )}
        {speedHint && (
          <span style={{ color: 'var(--cm-text-muted, #484f58)', fontSize: 10 }}>
            {speedHint}
          </span>
        )}
        {!showBody && !block.streaming && charCount > 0 && (
          <span style={{ opacity: 0.5, fontSize: 11 }}>(expand)</span>
        )}
        {block.streaming && (
          <span className="cm-dot-bounce" style={{ marginLeft: 2 }}>
            <span style={{ color: PURPLE_COLOR }}>·</span>
            <span style={{ color: PURPLE_COLOR }}>·</span>
            <span style={{ color: PURPLE_COLOR }}>·</span>
          </span>
        )}
      </button>
      {showBody && block.thinking && (
        <div
          style={{
            marginTop: 6,
            color: DIM,
            fontStyle: 'italic',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: block.streaming ? 200 : 400,
            overflowY: 'auto',
            fontSize: 12,
            lineHeight: 1.5,
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
  const [expanded, setExpanded] = useState(false);
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

  const header = (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline' }}>
      <span style={{ color: ACCENT, fontWeight: 600 }}>{block.name}</span>
      {summary && (
        <>
          <span style={{ color: DIM }}>(</span>
          <span style={{ color: TEXT }}>{summary}</span>
          <span style={{ color: DIM }}>)</span>
        </>
      )}
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
        {expanded && (
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
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {block.input && Object.keys(block.input).length > 0
              ? JSON.stringify(block.input, null, 2)
              : block.partialInputJson || '(no input)'}
          </pre>
        )}
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
              maxHeight: 200,
              overflowY: 'auto',
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

const ToolResultSubRow: React.FC<{ result: UiToolResult; toolName?: string }> = ({ result, toolName }) => {
  const [expanded, setExpanded] = useState(false);

  const text = result.text || (result.isError ? '(error)' : '(no output)');
  const lines = text.split('\n');
  const isLong = lines.length > 3 || text.length > 160;
  const previewLine = lines.find((l) => l.trim().length > 0) || lines[0] || '';
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
        <div
          style={{
            ...MONO_STYLE,
            color: bodyColor,
            whiteSpace: 'pre',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {previewLine.slice(0, 160)}
          {previewLine.length > 160 ? '...' : ''}
        </div>
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
          {expanded ? '[collapse]' : '[show ' + lines.length + ' lines]'}
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

const AssistantMessageBody: React.FC<{ message: AssistantChatMessage }> = ({
  message,
}) => {
  // Find the index of the first block with any visible content — used so
  // only the leading block gets the `●` gutter (matches openagentic where
  // shouldShowDot is true only for the first rendered block of the turn).
  const firstContentIndex = message.blocks.findIndex((b) => {
    if (b.kind === 'text') return b.text.length > 0;
    if (b.kind === 'thinking') return b.thinking.length > 0;
    return true; // tool_use always shows
  });

  const hasAny = firstContentIndex >= 0;

  return (
    <>
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
      {message.streaming && hasAny && (
        <Row gutter="" marginTop={0}>
          <span className="cm-caret" aria-hidden="true" />
        </Row>
      )}
      {/* Cost readout removed per user feedback — footer shows session totals */}
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

export const MessageRow: React.FC<{ message: ChatMessage }> = ({ message }) => {
  if (message.role === 'user') return <UserRow text={message.text} />;
  if (message.role === 'system') return <SystemRow text={message.text} />;
  if (message.role === 'error') return <ErrorRow text={message.text} />;
  return <AssistantMessageBody message={message as AssistantChatMessage} />;
};

export default MessageRow;
