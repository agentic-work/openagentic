import React from 'react';

interface LiveTokenBarProps {
  tokensIn: number;
  tokensOut: number;
  cost: number;
  agentCount: number;
  toolCount: number;
  contextUsed: number;
  contextMax: number;
  isStreaming: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function LiveTokenBar({
  tokensIn, tokensOut, cost, agentCount, toolCount,
  contextUsed, contextMax, isStreaming,
}: LiveTokenBarProps) {
  const contextPercent = contextMax > 0 ? Math.round((contextUsed / contextMax) * 100) : 0;
  const contextColor = contextPercent < 50 ? 'var(--cm-success)' : contextPercent < 80 ? 'var(--cm-warning)' : 'var(--cm-error)';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '6px 12px',
      fontSize: 11,
      fontFamily: 'SF Mono, JetBrains Mono, monospace',
      color: 'var(--cm-text-secondary)',
      backgroundColor: 'var(--cm-bg-secondary)',
      borderTop: '1px solid var(--cm-border)',
      animation: isStreaming ? 'pulse 3s ease-in-out infinite' : undefined,
    }}>
      {/* Token counts */}
      <span>
        <span style={{ color: 'var(--cm-accent)' }}>↓{formatTokens(tokensIn)}</span>
        {' '}
        <span style={{ color: 'var(--cm-success)' }}>↑{formatTokens(tokensOut)}</span>
      </span>

      {/* Cost */}
      <span>${cost.toFixed(3)}</span>

      {/* Agent/Tool counts */}
      {agentCount > 0 && <span>{agentCount} agent{agentCount !== 1 ? 's' : ''}</span>}
      <span>{toolCount} tool{toolCount !== 1 ? 's' : ''}</span>

      {/* Context meter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
        <div style={{
          width: 60,
          height: 4,
          backgroundColor: 'var(--cm-bg-tertiary)',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${Math.min(contextPercent, 100)}%`,
            height: '100%',
            backgroundColor: contextColor,
            transition: 'width 0.3s, background-color 0.3s',
          }} />
        </div>
        <span style={{ color: contextColor }}>
          {formatTokens(contextUsed)} / {formatTokens(contextMax)}
        </span>
      </div>
    </div>
  );
}
