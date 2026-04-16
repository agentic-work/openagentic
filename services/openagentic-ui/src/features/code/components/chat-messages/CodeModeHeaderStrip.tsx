import React from 'react';
import { ThemeSelectorPill } from './ThemeSelectorPill';

interface CodeModeHeaderStripProps {
  sessionId: string | null;
}

export const CodeModeHeaderStrip: React.FC<CodeModeHeaderStripProps> = () => {
  return (
    <div
      className="shrink-0 flex items-center px-4 py-1 border-b"
      style={{
        fontFamily:
          'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)',
        fontSize: 11,
        color: 'var(--cm-text, #e6edf3)',
        backgroundColor: 'var(--cm-bg-secondary, #161b22)',
        borderColor: 'var(--cm-border, #30363d)',
        lineHeight: 1.4,
      }}
    >
      <ThemeSelectorPill />
    </div>
  );
};

export default CodeModeHeaderStrip;
