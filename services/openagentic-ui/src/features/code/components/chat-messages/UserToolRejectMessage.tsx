import React from 'react';

const DIM = 'var(--cm-text-muted, #8b949e)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

export const UserToolRejectMessage: React.FC = () => (
  <div
    data-part="tool_result_rejected"
    className="cm-part cm-tool-rejected"
    style={{
      padding: '4px 0',
      color: DIM,
      fontFamily: MONO_FONT,
      fontSize: 12,
      fontStyle: 'italic',
    }}
  >
    Tool use rejected
  </div>
);

export default UserToolRejectMessage;
