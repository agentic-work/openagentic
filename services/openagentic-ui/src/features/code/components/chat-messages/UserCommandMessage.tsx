import React from 'react';

import { extractTag } from '../../utils/extractTag';

const PROMPT_CARET = '❯';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const USER_BG =
  'color-mix(in srgb, var(--cm-accent, #58a6ff) 8%, transparent)';

const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

export interface UserCommandMessageProps {
  text: string;
  addMargin?: boolean;
}

export const UserCommandMessage: React.FC<UserCommandMessageProps> = ({
  text,
  addMargin,
}) => {
  const commandMessage = extractTag(text, 'command-message');
  const args = extractTag(text, 'command-args');
  const isSkillFormat = extractTag(text, 'skill-format') === 'true';

  if (!commandMessage) return null;

  const content = isSkillFormat
    ? `Skill(${commandMessage})`
    : `/${[commandMessage, args].filter(Boolean).join(' ').trim()}`;

  return (
    <div
      data-part="user_command"
      className="cm-part cm-user-command"
      style={{
        marginTop: addMargin ? 8 : 0,
        padding: '4px 10px',
        background: USER_BG,
        color: TEXT_COLOR,
        fontFamily: MONO_FONT,
        fontSize: 13,
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
      }}
    >
      <span style={{ color: DIM }} aria-hidden>
        {PROMPT_CARET}
      </span>
      <span>{content}</span>
    </div>
  );
};

export default UserCommandMessage;
