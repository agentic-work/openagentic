import React from 'react';

const DIM = 'var(--cm-text-muted, #8b949e)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

export interface HookProgressMessageProps {
  hookEvent: string;
  inProgressCount: number;
  resolvedCount: number;
  isTranscriptMode?: boolean;
}

export const HookProgressMessage: React.FC<HookProgressMessageProps> = ({
  hookEvent,
  inProgressCount,
  resolvedCount,
  isTranscriptMode,
}) => {
  if (inProgressCount === 0) return null;

  if (hookEvent === 'PreToolUse' || hookEvent === 'PostToolUse') {
    if (!isTranscriptMode) return null;
    return (
      <div
        data-part="hook_progress"
        className="cm-part cm-hook-progress"
        style={{
          padding: '2px 0',
          color: DIM,
          fontFamily: MONO_FONT,
          fontSize: 11,
          display: 'flex',
          alignItems: 'baseline',
          gap: 4,
        }}
      >
        <span>{inProgressCount}</span>
        <span style={{ fontWeight: 600 }}>{hookEvent}</span>
        <span>{inProgressCount === 1 ? 'hook' : 'hooks'} ran</span>
      </div>
    );
  }

  if (resolvedCount === inProgressCount) return null;

  return (
    <div
      data-part="hook_progress"
      className="cm-part cm-hook-progress"
      style={{
        padding: '2px 0',
        color: DIM,
        fontFamily: MONO_FONT,
        fontSize: 11,
        display: 'flex',
        alignItems: 'baseline',
        gap: 4,
      }}
    >
      <span>Running</span>
      <span style={{ fontWeight: 600 }}>{hookEvent}</span>
      <span>{inProgressCount === 1 ? 'hook…' : 'hooks…'}</span>
    </div>
  );
};

export default HookProgressMessage;
