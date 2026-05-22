import React from 'react';

const ERROR_COLOR = 'var(--cm-error, #f85149)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

export const UserToolCanceledMessage: React.FC = () => (
  <div
    data-part="tool_result_canceled"
    className="cm-part cm-tool-canceled"
    style={{
      padding: '4px 0',
      color: ERROR_COLOR,
      fontFamily: MONO_FONT,
      fontSize: 12,
      fontStyle: 'italic',
      display: 'flex',
      alignItems: 'baseline',
      gap: 6,
    }}
  >
    <span aria-hidden>⊘</span>
    <span>Interrupted by user</span>
  </div>
);

export default UserToolCanceledMessage;
