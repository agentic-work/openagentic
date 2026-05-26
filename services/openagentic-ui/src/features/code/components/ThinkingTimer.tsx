import React, { useState, useEffect } from 'react';
import { useCodeModeStore } from '../../../stores/useCodeModeStore';
import { InlineCLISpinner } from './CLIActivitySpinner';

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

export const ThinkingTimer: React.FC = () => {
  const thinkingStartTime = useCodeModeStore(s => s.thinkingStartTime);
  const requestStartTime = useCodeModeStore(s => s.requestStartTime);
  const activityState = useCodeModeStore(s => s.activityState);
  const tokensIn = useCodeModeStore(s => s.requestTokensInput ?? 0);
  const tokensOut = useCodeModeStore(s => s.requestTokensOutput ?? 0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = thinkingStartTime || requestStartTime;
    if (!start) { setElapsed(0); return; }
    const interval = setInterval(() => setElapsed(Date.now() - start), 100);
    return () => clearInterval(interval);
  }, [thinkingStartTime, requestStartTime]);

  // Only show when LLM is actively working
  if (!activityState || activityState === 'idle' || activityState === 'complete') return null;
  if (!thinkingStartTime && !requestStartTime) return null;

  const isThinking = !!thinkingStartTime;
  const label = isThinking ? 'Thinking' : 'Responding';

  return (
    <div
      className="flex items-center gap-3 px-4 py-1.5"
      style={{
        borderTop: '1px solid var(--cm-border, rgba(255,255,255,0.08))',
        background: 'var(--cm-surface, #1a1a1a)',
        fontSize: 12,
        fontFamily: 'var(--font-mono, monospace)',
        minHeight: 28,
      }}
    >
      <InlineCLISpinner state={activityState} size="sm" />
      <span style={{ color: isThinking ? 'var(--cm-accent, #39c5cf)' : 'var(--cm-success, #22C55E)' }}>
        {label}
      </span>
      <span style={{ color: 'var(--cm-muted, #6c7086)' }}>
        {(elapsed / 1000).toFixed(1)}s
      </span>
      {(tokensIn > 0 || tokensOut > 0) && (
        <>
          <span style={{ color: 'var(--cm-border, #333)' }}>{'\u00B7'}</span>
          <span style={{ color: 'var(--cm-muted, #6c7086)' }}>
            {'\u2193'}{formatTokens(tokensIn)} {'\u2191'}{formatTokens(tokensOut)}
          </span>
        </>
      )}
    </div>
  );
};

export default ThinkingTimer;
