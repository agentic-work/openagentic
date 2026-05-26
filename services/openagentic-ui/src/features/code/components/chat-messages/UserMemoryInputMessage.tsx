import React, { useMemo } from 'react';

import { extractTag } from '../../utils/extractTag';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const REMEMBER_TONE = 'var(--cm-accent, #58a6ff)';
const MEMORY_BG = 'color-mix(in srgb, var(--cm-accent, #58a6ff) 10%, transparent)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

const SAVING_VERBS = ['Got it.', 'Good to know.', 'Noted.'];

function pickSavingVerb(): string {
  // Mirrors openagentic's `lodash.sample` — random selection from the pool.
  const idx = Math.floor(Math.random() * SAVING_VERBS.length);
  return SAVING_VERBS[idx] ?? SAVING_VERBS[0]!;
}

export interface UserMemoryInputMessageProps {
  text: string;
  addMargin?: boolean;
}

export const UserMemoryInputMessage: React.FC<UserMemoryInputMessageProps> = ({
  text,
  addMargin,
}) => {
  const input = extractTag(text, 'user-memory-input');
  const savingText = useMemo(() => pickSavingVerb(), []);

  if (!input) return null;

  return (
    <div
      data-part="user_memory_input"
      className="cm-part cm-memory-input"
      style={{
        marginTop: addMargin ? 8 : 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div
        style={{
          padding: '4px 10px',
          background: MEMORY_BG,
          color: TEXT_COLOR,
          fontFamily: MONO_FONT,
          fontSize: 13,
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
        }}
      >
        <span style={{ color: REMEMBER_TONE }} aria-hidden>
          #
        </span>
        <span>{input}</span>
      </div>
      <div
        data-part="memory_ack"
        style={{
          color: DIM,
          fontSize: 11,
          marginLeft: 14,
          fontFamily: 'var(--cm-prose-font, Inter, system-ui, sans-serif)',
        }}
      >
        {savingText}
      </div>
    </div>
  );
};

export default UserMemoryInputMessage;
