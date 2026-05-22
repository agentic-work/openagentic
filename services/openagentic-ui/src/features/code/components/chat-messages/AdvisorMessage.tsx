import React from 'react';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const ERROR_COLOR = 'var(--cm-error, #f85149)';
const SUCCESS = 'var(--cm-success, #3fb950)';

const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

export type AdvisorServerToolUseBlock = {
  type: 'server_tool_use';
  id: string;
  input?: Record<string, unknown>;
};

export type AdvisorToolResultBlock = {
  type: 'tool_result';
  id: string;
  content:
    | { type: 'advisor_result'; text: string }
    | { type: 'advisor_redacted_result' }
    | { type: 'advisor_tool_result_error'; error_code: string };
};

export type AdvisorBlock = AdvisorServerToolUseBlock | AdvisorToolResultBlock;

export interface AdvisorMessageProps {
  block: AdvisorBlock;
  advisorModel?: string;
  isUnresolved?: boolean;
  isError?: boolean;
  verbose?: boolean;
}

export const AdvisorMessage: React.FC<AdvisorMessageProps> = ({
  block,
  advisorModel,
  isUnresolved = false,
  isError = false,
  verbose = false,
}) => {
  if (block.type === 'server_tool_use') {
    const input =
      block.input && Object.keys(block.input).length > 0
        ? JSON.stringify(block.input)
        : null;
    const dotColor = isError ? ERROR_COLOR : isUnresolved ? ACCENT : SUCCESS;
    return (
      <div
        data-part="advisor_calling"
        className="cm-part cm-advisor-calling"
        style={{
          padding: '4px 0',
          color: TEXT_COLOR,
          fontFamily: MONO_FONT,
          fontSize: 12,
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
        }}
      >
        <span style={{ color: dotColor }} aria-hidden>
          ●
        </span>
        <span style={{ fontWeight: 600 }}>Advising</span>
        {advisorModel && <span style={{ color: DIM }}> using {advisorModel}</span>}
        {input && <span style={{ color: DIM }}> · {input}</span>}
      </div>
    );
  }

  // tool_result advisory variants.
  switch (block.content.type) {
    case 'advisor_tool_result_error':
      return (
        <div
          data-part="advisor_error"
          className="cm-part cm-advisor-error"
          style={{
            padding: '4px 0',
            color: ERROR_COLOR,
            fontFamily: MONO_FONT,
            fontSize: 12,
          }}
        >
          Advisor unavailable ({block.content.error_code})
        </div>
      );
    case 'advisor_result':
      return verbose ? (
        <div
          data-part="advisor_result"
          className="cm-part cm-advisor-result"
          style={{
            padding: '4px 0',
            color: DIM,
            fontFamily: MONO_FONT,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {block.content.text}
        </div>
      ) : (
        <div
          data-part="advisor_result"
          className="cm-part cm-advisor-result"
          style={{
            padding: '4px 0',
            color: DIM,
            fontFamily: MONO_FONT,
            fontSize: 12,
          }}
        >
          ✓ Advisor has reviewed the conversation and will apply the feedback
        </div>
      );
    case 'advisor_redacted_result':
      return (
        <div
          data-part="advisor_result"
          className="cm-part cm-advisor-result"
          style={{
            padding: '4px 0',
            color: DIM,
            fontFamily: MONO_FONT,
            fontSize: 12,
          }}
        >
          ✓ Advisor has reviewed the conversation and will apply the feedback
        </div>
      );
    default:
      return null;
  }
};

export default AdvisorMessage;
