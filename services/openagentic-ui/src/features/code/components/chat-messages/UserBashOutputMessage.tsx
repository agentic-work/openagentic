import React from 'react';

import { extractTag } from '../../utils/extractTag';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const ERROR_COLOR = 'var(--cm-error, #f85149)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const BG_SURFACE = 'var(--cm-bg-secondary, #161b22)';
const BORDER = 'var(--cm-border, #30363d)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

export interface UserBashOutputMessageProps {
  text: string;
  verbose?: boolean;
}

const Pre: React.FC<{
  body: string;
  isError: boolean;
}> = ({ body, isError }) => (
  <pre
    data-bash-stream={isError ? 'stderr' : 'stdout'}
    style={{
      margin: 0,
      padding: '4px 8px',
      background: BG_SURFACE,
      border: `1px solid ${BORDER}`,
      borderLeft: `2px solid ${isError ? ERROR_COLOR : DIM}`,
      borderRadius: 3,
      color: isError ? ERROR_COLOR : TEXT_COLOR,
      fontFamily: MONO_FONT,
      fontSize: 12,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}
  >
    {body}
  </pre>
);

export const UserBashOutputMessage: React.FC<UserBashOutputMessageProps> = ({
  text,
}) => {
  const rawStdout = extractTag(text, 'bash-stdout') ?? '';
  const stdout = extractTag(rawStdout, 'persisted-output') ?? rawStdout;
  const stderr = extractTag(text, 'bash-stderr') ?? '';

  if (!stdout && !stderr) return null;

  return (
    <div
      data-part="user_bash_output"
      className="cm-part cm-bash-output"
      style={{ margin: '4px 0', display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      {stdout && <Pre body={stdout} isError={false} />}
      {stderr && <Pre body={stderr} isError={true} />}
    </div>
  );
};

export default UserBashOutputMessage;
