/**
 * ApiEndpointContent — shows the workflow's HTTP execute endpoint, curl
 * snippets, and any configured webhook endpoints.
 */

import React, { useState, useEffect } from 'react';
import { Terminal, Link, Play, Check, Copy } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { workflowEndpoint } from '@/utils/api';
import type { Webhook } from '../sectionShared';

export const ApiEndpointContent: React.FC<{ workflowId?: string }> = ({ workflowId }) => {
  const { getAuthHeaders } = useAuth();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: number; time: number; preview: string } | null>(null);

  useEffect(() => {
    if (!workflowId) return;
    fetch(workflowEndpoint(`/workflows/${workflowId}/webhooks`), { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setWebhooks(Array.isArray(data) ? data : data.webhooks || []); })
      .catch(() => {});
  }, [workflowId, getAuthHeaders]);

  const baseUrl = window.location.origin;
  const executeUrl = `${baseUrl}/api/workflows/${workflowId}/execute`;
  const curlDirect = `curl -sN -X POST '${executeUrl}' \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"input":{"message":"Hello"}}'`;

  const copy = (text: string, field: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const handleTest = async () => {
    if (!workflowId) return;
    setTesting(true);
    setTestResult(null);
    const start = performance.now();
    try {
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/execute`), {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      });
      const time = Math.round(performance.now() - start);
      const text = await res.text();
      setTestResult({ status: res.status, time, preview: text.slice(0, 500) });
    } catch (e) {
      setTestResult({ status: 0, time: Math.round(performance.now() - start), preview: e.message });
    } finally {
      setTesting(false);
    }
  };

  if (!workflowId) {
    return <div className="py-12 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Save workflow first to see API endpoints</div>;
  }

  const CopyBtn: React.FC<{ field: string; text: string }> = ({ field, text }) => (
    <button onClick={() => copy(text, field)} className="p-1 rounded transition-colors hover:bg-[var(--color-surface)]" style={{ color: 'var(--color-text-tertiary)' }}>
      {copiedField === field ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Direct Execute */}
      <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Direct Execute</h3>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full font-mono font-bold" style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)' }}>POST</span>
        </div>

        <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: 'var(--color-bg-primary)' }}>
          <code className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>{executeUrl}</code>
          <CopyBtn field="exec-url" text={executeUrl} />
        </div>

        <div className="text-xs space-y-1" style={{ color: 'var(--color-text-tertiary)' }}>
          <p><strong style={{ color: 'var(--color-text-secondary)' }}>Authentication:</strong> <code className="font-mono px-1" style={{ color: 'var(--color-accent)' }}>Authorization: Bearer &lt;api_key&gt;</code></p>
          <p><strong style={{ color: 'var(--color-text-secondary)' }}>Content-Type:</strong> <code className="font-mono px-1">application/json</code></p>
          <p><strong style={{ color: 'var(--color-text-secondary)' }}>Response:</strong> SSE stream (<code className="font-mono px-1">text/event-stream</code>)</p>
        </div>

        <div className="relative">
          <pre className="text-xs font-mono p-3 rounded-lg overflow-x-auto" style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{curlDirect}</pre>
          <div className="absolute top-2 right-2"><CopyBtn field="curl" text={curlDirect} /></div>
        </div>

        <button onClick={handleTest} disabled={testing} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50" style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>
          <Play className="w-3 h-3" />
          {testing ? 'Running...' : 'Try it'}
        </button>

        {testResult && (
          <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-mono font-bold" style={{ color: testResult.status >= 200 && testResult.status < 300 ? 'var(--color-success)' : 'var(--color-error)' }}>{testResult.status || 'Error'}</span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>{testResult.time}ms</span>
            </div>
            <pre className="text-[10px] font-mono p-2 rounded-lg overflow-auto max-h-48" style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-tertiary)' }}>{testResult.preview}</pre>
          </div>
        )}
      </div>

      {/* Webhook Endpoints */}
      {webhooks.length > 0 && (
        <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="flex items-center gap-2">
            <Link className="w-4 h-4" style={{ color: 'var(--color-warning)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Webhook Endpoints</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-tertiary)' }}>No auth required</span>
          </div>
          {webhooks.map((wh: Webhook) => {
            const whCurl = `curl -sN -X POST '${wh.url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"input":{"message":"Hello"}}'`;
            return (
              <div key={wh.id} className="p-3 rounded-lg border space-y-2" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{wh.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--color-info) 12%, transparent)', color: 'var(--color-info)' }}>{wh.response_mode}</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--color-bg-primary)' }}>
                  <code className="text-[11px] font-mono flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>{wh.url}</code>
                  <CopyBtn field={`wh-${wh.id}`} text={wh.url} />
                </div>
                <div className="relative">
                  <pre className="text-[10px] font-mono p-2 rounded overflow-x-auto" style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>{whCurl}</pre>
                  <div className="absolute top-1 right-1"><CopyBtn field={`wh-curl-${wh.id}`} text={whCurl} /></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Workflow ID */}
      <div className="flex items-center justify-between text-xs p-3 rounded-lg" style={{ background: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>
        <span>Workflow ID</span>
        <div className="flex items-center gap-1 font-mono">{workflowId}<CopyBtn field="wfid" text={workflowId} /></div>
      </div>
    </div>
  );
};
