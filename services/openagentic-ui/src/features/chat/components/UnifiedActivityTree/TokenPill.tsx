import React from 'react';

interface TokenPillProps {
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  live?: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function TokenPill({ tokensIn, tokensOut, cost, live }: TokenPillProps) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 10,
      fontFamily: 'SF Mono, JetBrains Mono, monospace',
      color: 'rgba(255,255,255,0.4)',
      padding: '1px 6px',
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.03)',
      animation: live ? 'pulse 2s ease-in-out infinite' : undefined,
    }}>
      {tokensIn !== undefined && <span style={{ color: '#58a6ff' }}>↓{formatTokens(tokensIn)}</span>}
      {tokensOut !== undefined && <span style={{ color: '#3fb950' }}>↑{formatTokens(tokensOut)}</span>}
      {cost !== undefined && cost > 0 && <span>${cost.toFixed(3)}</span>}
    </span>
  );
}
