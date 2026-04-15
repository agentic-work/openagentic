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

import React, { useState, useCallback } from 'react';

interface PipelineLogData {
  stageTimings: Record<string, number>;
  modelRouting: { requested: string; selected: string; reason: string; slider: number };
  systemPrompt: { totalTokens: number; sections: { name: string; tokens: number }[] };
  mcpTools: { matched: number; injected: number; toolNames: string[] };
  toolCallRounds: { round: number; tools: { name: string; duration: number; status: string }[] }[];
  tokenUsage: { input: number; output: number; cost: number };
  hitlEvents: { id: string; tool: string; approved: boolean; waitMs: number }[];
}

interface PipelineLogViewerProps {
  sessionId?: string;
  messageId?: string;
}

export function PipelineLogViewer({ sessionId: initialSessionId, messageId: initialMessageId }: PipelineLogViewerProps) {
  const [sessionId, setSessionId] = useState(initialSessionId || '');
  const [messageId, setMessageId] = useState(initialMessageId || '');
  const [data, setData] = useState<PipelineLogData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchLog = useCallback(async () => {
    if (!sessionId || !messageId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pipeline-log/${sessionId}/${messageId}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.error || errData.message || 'Failed to fetch');
      }
      setData(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId, messageId]);

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    fontSize: 12,
    fontFamily: 'SF Mono, JetBrains Mono, monospace',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    color: '#e6edf3',
    flex: 1,
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  };

  const labelStyle: React.CSSProperties = { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 };
  const valueStyle: React.CSSProperties = { fontSize: 13, color: '#e6edf3', fontFamily: 'SF Mono, JetBrains Mono, monospace' };

  return (
    <div style={{ fontFamily: 'SF Mono, JetBrains Mono, monospace', color: '#e6edf3' }}>
      <h3 style={{ fontSize: 14, marginBottom: 12, color: 'rgba(255,255,255,0.7)' }}>Pipeline Log Viewer</h3>

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input style={inputStyle} placeholder="Session ID" value={sessionId} onChange={e => setSessionId(e.target.value)} />
        <input style={inputStyle} placeholder="Message ID" value={messageId} onChange={e => setMessageId(e.target.value)} />
        <button
          onClick={fetchLog}
          disabled={loading || !sessionId || !messageId}
          style={{
            padding: '6px 16px', fontSize: 12, border: 'none', borderRadius: 4,
            backgroundColor: '#238636', color: '#fff', cursor: 'pointer',
            opacity: loading || !sessionId || !messageId ? 0.5 : 1,
          }}
        >
          {loading ? 'Loading...' : 'Fetch'}
        </button>
      </div>

      {error && <div style={{ color: '#f85149', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {data && (
        <>
          {/* Model Routing */}
          <div style={cardStyle}>
            <div style={labelStyle}>Model Routing</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
              <div><div style={labelStyle}>Requested</div><div style={valueStyle}>{data.modelRouting.requested}</div></div>
              <div><div style={labelStyle}>Selected</div><div style={valueStyle}>{data.modelRouting.selected}</div></div>
              <div><div style={labelStyle}>Reason</div><div style={valueStyle}>{data.modelRouting.reason}</div></div>
              <div><div style={labelStyle}>Slider</div><div style={valueStyle}>{data.modelRouting.slider}%</div></div>
            </div>
          </div>

          {/* Stage Timings */}
          <div style={cardStyle}>
            <div style={labelStyle}>Stage Timings</div>
            {Object.entries(data.stageTimings).map(([stage, ms]) => (
              <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ width: 120, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{stage}</span>
                <div style={{ flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                  <div style={{
                    width: `${Math.min((ms / Math.max(...Object.values(data.stageTimings))) * 100, 100)}%`,
                    height: '100%', backgroundColor: '#58a6ff', borderRadius: 2,
                  }} />
                </div>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', width: 50, textAlign: 'right' }}>{ms}ms</span>
              </div>
            ))}
          </div>

          {/* Token Usage */}
          <div style={cardStyle}>
            <div style={labelStyle}>Token Usage</div>
            <div style={{ display: 'flex', gap: 16 }}>
              <span style={{ color: '#58a6ff' }}>↓ {data.tokenUsage.input.toLocaleString()}</span>
              <span style={{ color: '#3fb950' }}>↑ {data.tokenUsage.output.toLocaleString()}</span>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>${data.tokenUsage.cost.toFixed(4)}</span>
            </div>
          </div>

          {/* System Prompt */}
          {data.systemPrompt && (
            <div style={cardStyle}>
              <div style={labelStyle}>System Prompt ({data.systemPrompt.totalTokens} tokens)</div>
              {data.systemPrompt.sections.map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
                  <span style={{ color: 'rgba(255,255,255,0.6)' }}>{s.name}</span>
                  <span style={{ color: 'rgba(255,255,255,0.4)' }}>{s.tokens} tokens</span>
                </div>
              ))}
            </div>
          )}

          {/* Tool Call Rounds */}
          {data.toolCallRounds.length > 0 && (
            <div style={cardStyle}>
              <div style={labelStyle}>Tool Calls</div>
              {data.toolCallRounds.map(round => (
                <div key={round.round} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>Round {round.round}</div>
                  {round.tools.map((t, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, padding: '2px 0' }}>
                      <span style={{ color: '#58a6ff' }}>{t.name}</span>
                      <span style={{ color: 'rgba(255,255,255,0.3)' }}>{t.duration}ms</span>
                      <span style={{ color: t.status === 'success' ? '#3fb950' : '#f85149' }}>{t.status}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* MCP Tools */}
          <div style={cardStyle}>
            <div style={labelStyle}>MCP Tools</div>
            <div style={{ fontSize: 11 }}>
              Matched: {data.mcpTools.matched} | Injected: {data.mcpTools.injected}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
              {data.mcpTools.toolNames.join(', ')}
            </div>
          </div>

          {/* HITL Events */}
          {data.hitlEvents.length > 0 && (
            <div style={cardStyle}>
              <div style={labelStyle}>HITL Events</div>
              {data.hitlEvents.map(h => (
                <div key={h.id} style={{ display: 'flex', gap: 8, fontSize: 11, padding: '2px 0' }}>
                  <span style={{ color: '#d29922' }}>{h.tool}</span>
                  <span style={{ color: h.approved ? '#3fb950' : '#f85149' }}>{h.approved ? 'Approved' : 'Denied'}</span>
                  <span style={{ color: 'rgba(255,255,255,0.3)' }}>{(h.waitMs / 1000).toFixed(1)}s wait</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
