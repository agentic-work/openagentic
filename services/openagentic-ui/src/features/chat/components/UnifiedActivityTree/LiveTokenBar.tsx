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
  const contextColor = contextPercent < 50 ? '#3fb950' : contextPercent < 80 ? '#d29922' : '#f85149';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '6px 12px',
      fontSize: 11,
      fontFamily: 'SF Mono, JetBrains Mono, monospace',
      color: 'rgba(255,255,255,0.5)',
      backgroundColor: 'rgba(255,255,255,0.02)',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      animation: isStreaming ? 'pulse 3s ease-in-out infinite' : undefined,
    }}>
      {/* Token counts */}
      <span>
        <span style={{ color: '#58a6ff' }}>↓{formatTokens(tokensIn)}</span>
        {' '}
        <span style={{ color: '#3fb950' }}>↑{formatTokens(tokensOut)}</span>
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
          backgroundColor: 'rgba(255,255,255,0.06)',
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
