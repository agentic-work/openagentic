import React from 'react';

import { extractTag } from '../../utils/extractTag';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const SUCCESS = 'var(--cm-success, #3fb950)';
const ERROR_COLOR = 'var(--cm-error, #f85149)';
const WARNING = 'var(--cm-warning, #d29922)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

const BLACK_CIRCLE = '●';

function statusColor(status: string | null): string {
  switch (status) {
    case 'completed':
      return SUCCESS;
    case 'failed':
      return ERROR_COLOR;
    case 'killed':
      return WARNING;
    default:
      return TEXT_COLOR;
  }
}

export interface UserAgentNotificationMessageProps {
  text: string;
  addMargin?: boolean;
}

export const UserAgentNotificationMessage: React.FC<
  UserAgentNotificationMessageProps
> = ({ text, addMargin }) => {
  const summary = extractTag(text, 'summary');
  if (!summary) return null;
  const status = extractTag(text, 'status');
  return (
    <div
      data-part="user_agent_notification"
      data-status={status ?? undefined}
      className="cm-part cm-agent-notification"
      style={{
        marginTop: addMargin ? 8 : 0,
        padding: '2px 0',
        color: TEXT_COLOR,
        fontFamily: MONO_FONT,
        fontSize: 13,
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
      }}
    >
      <span style={{ color: statusColor(status) }} aria-hidden>
        {BLACK_CIRCLE}
      </span>
      <span>{summary}</span>
    </div>
  );
};

export default UserAgentNotificationMessage;
