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

import React, { useState } from 'react';

interface ToolDetailPanelProps {
  toolName: string;
  serverName: string;
  args?: string;
  result?: any;
  durationMs?: number;
}

export function ToolDetailPanel({ toolName, serverName, args, result, durationMs }: ToolDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<'request' | 'response'>('request');

  const tabStyle = (isActive: boolean) => ({
    padding: '4px 12px',
    fontSize: 11,
    fontFamily: 'SF Mono, JetBrains Mono, monospace',
    border: 'none',
    background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
    color: isActive ? '#e6edf3' : 'rgba(255,255,255,0.4)',
    cursor: 'pointer' as const,
    borderRadius: '4px 4px 0 0',
  });

  return (
    <div style={{
      backgroundColor: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 6,
      marginTop: 4,
      overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        gap: 2,
        padding: '4px 4px 0',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <button onClick={() => setActiveTab('request')} style={tabStyle(activeTab === 'request')}>Request</button>
        <button onClick={() => setActiveTab('response')} style={tabStyle(activeTab === 'response')}>Response</button>
        {durationMs !== undefined && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.3)', padding: '4px 8px' }}>
            {durationMs}ms
          </span>
        )}
      </div>
      {/* Content */}
      <pre style={{
        margin: 0,
        padding: 8,
        fontSize: 11,
        fontFamily: 'SF Mono, JetBrains Mono, monospace',
        color: '#e6edf3',
        maxHeight: 200,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {activeTab === 'request'
          ? args || '{}'
          : typeof result === 'string' ? result : JSON.stringify(result, null, 2) || 'null'}
      </pre>
    </div>
  );
}
