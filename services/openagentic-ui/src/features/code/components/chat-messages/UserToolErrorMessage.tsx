import React from 'react';

import {
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  PLAN_REJECTION_PREFIX,
  REJECT_MESSAGE_WITH_REASON_PREFIX,
  isClassifierDenial,
} from '../../utils/messageSentinels';

import { RejectedPlanMessage } from './RejectedPlanMessage';
import { UserToolRejectMessage } from './UserToolRejectMessage';

const ERROR_COLOR = 'var(--cm-error, #f85149)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const BG_SURFACE = 'var(--cm-bg-secondary, #161b22)';
const BORDER = 'var(--cm-border, #30363d)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

export interface UserToolErrorMessageProps {
  content: string;
}

export const UserToolErrorMessage: React.FC<UserToolErrorMessageProps> = ({
  content,
}) => {
  if (typeof content === 'string' && content.includes(INTERRUPT_MESSAGE_FOR_TOOL_USE)) {
    return (
      <div
        data-part="tool_result_interrupted"
        className="cm-part cm-tool-interrupted"
        style={{
          padding: '4px 0',
          color: ERROR_COLOR,
          fontFamily: MONO_FONT,
          fontSize: 12,
          fontStyle: 'italic',
        }}
      >
        Interrupted by user
      </div>
    );
  }

  if (typeof content === 'string' && content.startsWith(PLAN_REJECTION_PREFIX)) {
    const planContent = content.substring(PLAN_REJECTION_PREFIX.length);
    return <RejectedPlanMessage plan={planContent} />;
  }

  if (typeof content === 'string' && content.startsWith(REJECT_MESSAGE_WITH_REASON_PREFIX)) {
    return <UserToolRejectMessage />;
  }

  if (typeof content === 'string' && isClassifierDenial(content)) {
    return (
      <div
        data-part="tool_result_classifier_denial"
        className="cm-part cm-classifier-denial"
        style={{
          padding: '4px 0',
          color: DIM,
          fontFamily: MONO_FONT,
          fontSize: 12,
          fontStyle: 'italic',
        }}
      >
        Denied by auto mode classifier · /feedback if incorrect
      </div>
    );
  }

  // Generic error fallback.
  return (
    <pre
      data-part="tool_result_generic_error"
      className="cm-part cm-tool-generic-error"
      style={{
        margin: '4px 0',
        padding: '4px 8px',
        background: BG_SURFACE,
        border: `1px solid ${BORDER}`,
        borderLeft: `2px solid ${ERROR_COLOR}`,
        borderRadius: 3,
        color: ERROR_COLOR,
        fontFamily: MONO_FONT,
        fontSize: 12,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 240,
        overflow: 'auto',
      }}
    >
      {content || '(error)'}
    </pre>
  );
};

export default UserToolErrorMessage;
