import React from 'react';

import { extractTag } from '../../utils/extractTag';
import { NO_CONTENT_MESSAGE } from '../../utils/messageSentinels';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

const BOTTOM_LEFT_CORNER = '⎿';

const Indented: React.FC<{ body: string }> = ({ body }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
    <span style={{ color: DIM }} aria-hidden>{`  ${BOTTOM_LEFT_CORNER}  `}</span>
    <pre
      style={{
        margin: 0,
        color: TEXT_COLOR,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: MONO_FONT,
        fontSize: 12,
        flex: 1,
      }}
    >
      {body}
    </pre>
  </div>
);

export interface UserLocalCommandOutputMessageProps {
  text: string;
}

export const UserLocalCommandOutputMessage: React.FC<
  UserLocalCommandOutputMessageProps
> = ({ text }) => {
  const stdout = extractTag(text, 'local-command-stdout');
  const stderr = extractTag(text, 'local-command-stderr');

  if (!stdout?.trim() && !stderr?.trim()) {
    return (
      <div
        data-part="local_command_output"
        className="cm-part cm-local-command"
        style={{
          color: DIM,
          fontFamily: MONO_FONT,
          fontSize: 12,
          fontStyle: 'italic',
        }}
      >
        {NO_CONTENT_MESSAGE}
      </div>
    );
  }

  return (
    <div
      data-part="local_command_output"
      className="cm-part cm-local-command"
      style={{
        margin: '4px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {stdout?.trim() && <Indented body={stdout.trim()} />}
      {stderr?.trim() && <Indented body={stderr.trim()} />}
    </div>
  );
};

export default UserLocalCommandOutputMessage;
