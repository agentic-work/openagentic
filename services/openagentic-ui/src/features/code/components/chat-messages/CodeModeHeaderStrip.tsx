import React, { useCallback } from 'react';
import { ExternalLink } from '@/shared/icons';
import { ThemeSelectorPill } from './ThemeSelectorPill';
import { buildPopoutUrl } from '../../utils/popoutUrl';

interface CodeModeHeaderStripProps {
  sessionId: string | null;
}

export const CodeModeHeaderStrip: React.FC<CodeModeHeaderStripProps> = ({ sessionId }) => {
  const handlePopout = useCallback(() => {
    if (!sessionId) return;
    const url = buildPopoutUrl(sessionId);
    window.open(
      url,
      `openagentic-${sessionId}`,
      'width=1200,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no'
    );
  }, [sessionId]);

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
      <div style={{ flex: 1 }} />
      {sessionId && (
        <button
          onClick={handlePopout}
          title="Pop out openagentic in a new window"
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono transition-all hover:bg-white/5 opacity-60 hover:opacity-100"
          style={{ color: 'var(--cm-text-muted, #888)' }}
        >
          <ExternalLink size={12} />
          <span>pop out</span>
        </button>
      )}
    </div>
  );
};

export default CodeModeHeaderStrip;
