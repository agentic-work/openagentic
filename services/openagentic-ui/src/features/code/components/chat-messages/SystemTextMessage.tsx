import React from 'react';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const SUCCESS = 'var(--cm-success, #3fb950)';
const ERROR_COLOR = 'var(--cm-error, #f85149)';
const WARNING = 'var(--cm-warning, #d29922)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const BG_SURFACE = 'var(--cm-bg-secondary, #161b22)';
const BORDER = 'var(--cm-border, #30363d)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

const REFERENCE_MARK = '※';
const TEARDROP_ASTERISK = '✻';
const BLACK_CIRCLE = '●';

export interface SystemTextMessageProps {
  /**
   * The shape of a SDKSystemMessage as forwarded into the renderer. We
   * accept a loose object here because the upstream union spans many
   * subtype-specific shapes; the relevant fields per subtype are read
   * with optional chaining.
   */
  message: {
    subtype?: string;
    content?: string;
    level?: 'info' | 'warning' | 'error';
    [key: string]: unknown;
  };
  addMargin?: boolean;
  verbose?: boolean;
}

const Generic: React.FC<{
  testId: string;
  body: string;
  color?: string;
  glyph?: string;
  glyphColor?: string;
}> = ({ testId, body, color = DIM, glyph, glyphColor }) => (
  <div
    data-part={testId}
    className={`cm-part cm-${testId}`}
    style={{
      padding: '4px 0',
      color,
      fontFamily: MONO_FONT,
      fontSize: 12,
      display: 'flex',
      alignItems: 'baseline',
      gap: 6,
    }}
  >
    {glyph && (
      <span style={{ color: glyphColor ?? color }} aria-hidden>
        {glyph}
      </span>
    )}
    <span>{body}</span>
  </div>
);

export const SystemTextMessage: React.FC<SystemTextMessageProps> = ({
  message,
  addMargin,
}) => {
  const content = typeof message.content === 'string' ? message.content : '';
  const subtype = message.subtype ?? '';

  const wrap = (node: React.ReactNode): React.ReactNode => (
    <div style={{ marginTop: addMargin ? 8 : 0 }}>{node}</div>
  );

  if (subtype === 'turn_duration') {
    if (!content) return null;
    return wrap(
      <Generic
        testId="system_turn_duration"
        body={content}
        glyph={REFERENCE_MARK}
      />,
    );
  }

  if (subtype === 'memory_saved') {
    if (!content) return null;
    return wrap(
      <Generic
        testId="system_memory_saved"
        body={content}
        color={TEXT_COLOR}
        glyph="✓"
        glyphColor={SUCCESS}
      />,
    );
  }

  if (subtype === 'thinking') {
    if (!content) return null;
    return wrap(
      <Generic testId="system_thinking" body={content} glyph={REFERENCE_MARK} />,
    );
  }

  if (subtype === 'bridge_status') {
    if (!content) return null;
    return wrap(
      <Generic
        testId="system_bridge_status"
        body={content}
        color={TEXT_COLOR}
        glyph={BLACK_CIRCLE}
        glyphColor={ACCENT}
      />,
    );
  }

  if (subtype === 'scheduled_task_fire') {
    if (!content) return null;
    return wrap(
      <Generic
        testId="system_scheduled_task_fire"
        body={content}
        glyph={TEARDROP_ASTERISK}
      />,
    );
  }

  if (subtype === 'permission_retry') {
    return wrap(
      <Generic
        testId="system_permission_retry"
        body={content || 'permission retried'}
        glyph={TEARDROP_ASTERISK}
      />,
    );
  }

  if (subtype === 'agents_killed') {
    return wrap(
      <Generic
        testId="system_agents_killed"
        body={content || 'All background agents stopped'}
        color={TEXT_COLOR}
        glyph={BLACK_CIRCLE}
        glyphColor={ERROR_COLOR}
      />,
    );
  }

  if (subtype === 'away_summary') {
    if (!content) return null;
    return wrap(
      <Generic
        testId="system_away_summary"
        body={content}
        glyph={REFERENCE_MARK}
      />,
    );
  }

  if (subtype === 'api_error') {
    return wrap(
      <Generic
        testId="system_api_error"
        body={content || 'API error'}
        color={ERROR_COLOR}
        glyph="✕"
      />,
    );
  }

  if (subtype === 'api_retry') {
    return wrap(
      <Generic
        testId="system_api_retry"
        body={content || 'Retrying API request'}
        color={WARNING}
        glyph="↻"
      />,
    );
  }

  if (subtype === 'stop_hook_summary') {
    if (!content) return null;
    return wrap(
      <div
        data-part="system_stop_hook_summary"
        className="cm-part cm-system-stop-hook-summary"
        style={{
          margin: '4px 0',
          padding: '4px 8px',
          background: BG_SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 3,
          color: TEXT_COLOR,
          fontFamily: MONO_FONT,
          fontSize: 12,
        }}
      >
        <div style={{ color: DIM, fontSize: 11, marginBottom: 2 }}>
          Stop hook summary
        </div>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {content}
        </pre>
      </div>,
    );
  }

  // Generic fallback — plain dim italic line, only when content present.
  if (!content) return null;
  return wrap(
    <Generic testId="system_generic" body={content} color={DIM} />,
  );
};

export default SystemTextMessage;
