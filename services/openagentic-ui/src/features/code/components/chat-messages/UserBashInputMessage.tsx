import React from 'react';

import { extractTag } from '../../utils/extractTag';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const BASH_TONE = 'var(--cm-warning, #d29922)';
const BASH_BG = 'color-mix(in srgb, var(--cm-warning, #d29922) 10%, transparent)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

export interface UserBashInputMessageProps {
  text: string;
  addMargin?: boolean;
}

export const UserBashInputMessage: React.FC<UserBashInputMessageProps> = ({
  text,
  addMargin,
}) => {
  const input = extractTag(text, 'bash-input');
  if (!input) return null;
  return (
    <div
      data-part="user_bash_input"
      className="cm-part cm-bash-input"
      style={{
        marginTop: addMargin ? 8 : 0,
        padding: '4px 10px',
        background: BASH_BG,
        color: TEXT_COLOR,
        fontFamily: MONO_FONT,
        fontSize: 13,
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
      }}
    >
      <span style={{ color: BASH_TONE }} aria-hidden>
        !
      </span>
      <span>{input}</span>
    </div>
  );
};

export default UserBashInputMessage;
