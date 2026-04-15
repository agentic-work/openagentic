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

/**
 * ApiEndpointSection — Shows API endpoint info with copy-paste curl commands
 * Displays both the direct execute endpoint and webhook URLs
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Copy, Check, Play, Terminal, Link, ChevronDown } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { workflowEndpoint } from '@/utils/api';

interface ApiEndpointSectionProps {
  workflowId?: string;
  workflowName?: string;
}

interface WebhookInfo {
  id: string;
  name: string;
  url: string;
  method: string;
  response_mode: string;
}

export const ApiEndpointSection: React.FC<ApiEndpointSectionProps> = ({ workflowId, workflowName }) => {
  const { getAuthHeaders } = useAuth();
  const [webhooks, setWebhooks] = useState<WebhookInfo[]>([]);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [testResult, setTestResult] = useState<{ status: number; time: number; preview: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // Fetch webhooks for this workflow
  useEffect(() => {
    if (!workflowId) return;
    const headers = getAuthHeaders();
    fetch(workflowEndpoint(`/workflows/${workflowId}/webhooks`), { headers })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) setWebhooks(Array.isArray(data) ? data : data.webhooks || []);
      })
      .catch(() => {});
  }, [workflowId, getAuthHeaders]);

  const baseUrl = window.location.origin;
  const executeUrl = `${baseUrl}/api/workflows/${workflowId}/execute`;

  const copyToClipboard = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }, []);

  const curlDirect = `curl -sN -X POST '${executeUrl}' \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{"input":{"message":"Hello"}}'`;

  const handleTestExecute = useCallback(async () => {
    if (!workflowId) return;
    setTesting(true);
    setTestResult(null);
    const start = performance.now();
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/execute`), {
        method: 'POST',
        headers,
        body: JSON.stringify({ input: {} }),
      });
      const time = Math.round(performance.now() - start);
      const text = await res.text();
      setTestResult({
        status: res.status,
        time,
        preview: text.slice(0, 300),
      });
    } catch (e: any) {
      const time = Math.round(performance.now() - start);
      setTestResult({ status: 0, time, preview: e.message });
    } finally {
      setTesting(false);
    }
  }, [workflowId, getAuthHeaders]);

  if (!workflowId) {
    return (
      <div className="px-4 py-3 text-[12px]" style={{ color: 'var(--color-text-tertiary, #999)' }}>
        Save workflow first to see API endpoints
      </div>
    );
  }

  return (
    <div className="px-4 py-2 space-y-3">
      {/* Section Header */}
      <div className="flex items-center gap-1.5">
        <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary, #777)' }} />
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary, #777)' }}>
          API Endpoints
        </span>
      </div>

      {/* Direct Execute Endpoint */}
      <div
        className="p-2.5 rounded-lg border space-y-2"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>
            Direct Execute
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold"
            style={{ backgroundColor: '#22c55e20', color: '#22c55e' }}
          >
            POST
          </span>
        </div>

        {/* URL */}
        <div className="flex items-center gap-1">
          <code
            className="text-[10px] font-mono flex-1 truncate"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            /api/workflows/{workflowId?.slice(0, 8)}…/execute
          </code>
          <button
            onClick={() => copyToClipboard(executeUrl, 'url')}
            className="p-0.5 rounded transition-colors hover:bg-[var(--color-bg-primary)]"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {copiedField === 'url' ? <Check className="w-2.5 h-2.5" style={{ color: '#22c55e' }} /> : <Copy className="w-2.5 h-2.5" />}
          </button>
        </div>

        {/* Auth hint */}
        <button
          onClick={() => setShowAuth(!showAuth)}
          className="flex items-center gap-1 text-[10px]"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          <ChevronDown className={`w-2.5 h-2.5 transition-transform ${showAuth ? '' : '-rotate-90'}`} />
          Authentication required
        </button>
        {showAuth && (
          <p className="text-[10px] pl-3.5" style={{ color: 'var(--color-text-tertiary)' }}>
            Pass <code className="font-mono px-0.5" style={{ color: '#bc8cff' }}>Authorization: Bearer &lt;api_key&gt;</code> header.
            Generate API keys in Settings → API Keys.
          </p>
        )}

        {/* Curl command */}
        <div className="relative">
          <pre
            className="text-[10px] font-mono p-2 rounded overflow-x-auto whitespace-pre-wrap"
            style={{
              backgroundColor: 'var(--color-bg-primary)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.5,
            }}
          >
            {curlDirect}
          </pre>
          <button
            onClick={() => copyToClipboard(curlDirect, 'curl')}
            className="absolute top-1 right-1 p-1 rounded transition-colors hover:bg-[var(--color-surface)]"
            style={{ color: 'var(--color-text-tertiary)' }}
            title="Copy curl command"
          >
            {copiedField === 'curl' ? <Check className="w-3 h-3" style={{ color: '#22c55e' }} /> : <Copy className="w-3 h-3" />}
          </button>
        </div>

        {/* Try it button */}
        <button
          onClick={handleTestExecute}
          disabled={testing}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded transition-colors hover:opacity-80 disabled:opacity-50"
          style={{
            backgroundColor: 'var(--user-accent-primary, #2196f3)',
            color: '#fff',
          }}
        >
          <Play className="w-2.5 h-2.5" />
          {testing ? 'Running...' : 'Try it'}
        </button>

        {/* Test result */}
        {testResult && (
          <div className="text-[10px] space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="font-mono font-bold"
                style={{ color: testResult.status >= 200 && testResult.status < 300 ? '#22c55e' : '#f85149' }}
              >
                {testResult.status || 'Error'}
              </span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>{testResult.time}ms</span>
            </div>
            <pre
              className="p-1.5 rounded overflow-auto max-h-32 text-[9px]"
              style={{
                backgroundColor: 'var(--color-bg-primary)',
                color: 'var(--color-text-tertiary)',
              }}
            >
              {testResult.preview}
            </pre>
          </div>
        )}
      </div>

      {/* Webhook Endpoints */}
      {webhooks.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Link className="w-3 h-3" style={{ color: 'var(--color-text-tertiary, #777)' }} />
            <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-tertiary, #777)' }}>
              Webhooks (no auth required)
            </span>
          </div>
          {webhooks.map(wh => {
            const whCurl = `curl -sN -X POST '${wh.url}' \\
  -H 'Content-Type: application/json' \\
  -d '{"input":{"message":"Hello"}}'`;
            return (
              <div
                key={wh.id}
                className="p-2 rounded-lg border space-y-1.5"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {wh.name}
                  </span>
                  <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: '#2196f320', color: '#2196f3' }}>
                    {wh.response_mode}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <code className="text-[10px] font-mono flex-1 truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                    {wh.url}
                  </code>
                  <button
                    onClick={() => copyToClipboard(wh.url, `wh-${wh.id}`)}
                    className="p-0.5 rounded transition-colors hover:bg-[var(--color-bg-primary)]"
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
                    {copiedField === `wh-${wh.id}` ? <Check className="w-2.5 h-2.5" style={{ color: '#22c55e' }} /> : <Copy className="w-2.5 h-2.5" />}
                  </button>
                </div>
                <div className="relative">
                  <pre
                    className="text-[9px] font-mono p-1.5 rounded overflow-x-auto whitespace-pre-wrap"
                    style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}
                  >
                    {whCurl}
                  </pre>
                  <button
                    onClick={() => copyToClipboard(whCurl, `wh-curl-${wh.id}`)}
                    className="absolute top-0.5 right-0.5 p-0.5 rounded transition-colors hover:bg-[var(--color-surface)]"
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
                    {copiedField === `wh-curl-${wh.id}` ? <Check className="w-2.5 h-2.5" style={{ color: '#22c55e' }} /> : <Copy className="w-2.5 h-2.5" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Workflow ID */}
      <div className="pt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between">
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Workflow ID</span>
          <button
            onClick={() => copyToClipboard(workflowId!, 'id')}
            className="flex items-center gap-1 text-[10px] font-mono"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {workflowId?.slice(0, 12)}…
            {copiedField === 'id' ? <Check className="w-2.5 h-2.5" style={{ color: '#22c55e' }} /> : <Copy className="w-2.5 h-2.5" />}
          </button>
        </div>
      </div>
    </div>
  );
};
