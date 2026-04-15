/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
