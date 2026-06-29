/**
 * WebhooksContent — list / add / test / delete workflow webhooks.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, Check, Copy, RefreshCw, Play, Clock, Link } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { workflowEndpoint } from '@/utils/api';
import {
  btnPrimary, btnPrimaryStyle, inputClass, inputStyle,
  tableHeaderClass, tableHeaderStyle, tableCellClass, tableCellStyle,
  methodColors, StatusDot,
  type Webhook, type WebhookCall,
} from '../sectionShared';

interface WebhookTestResult { id: string; status: number; time: number }

export const WebhooksContent: React.FC<{ workflowId?: string }> = ({ workflowId }) => {
  const { getAuthHeaders } = useAuth();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newWebhook, setNewWebhook] = useState({ name: '', method: 'POST', response_mode: 'async' });
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<WebhookTestResult | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchWebhooks = useCallback(async () => {
    if (!workflowId) return;
    try {
      setLoading(true);
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/webhooks`), { headers });
      if (res.ok) {
        const data = await res.json();
        setWebhooks(Array.isArray(data) ? data : data.webhooks || []);
      }
    } catch { /* silently handle */ }
    finally { setLoading(false); }
  }, [workflowId, getAuthHeaders]);

  useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

  const handleAdd = useCallback(async () => {
    if (!workflowId || !newWebhook.name.trim()) return;
    try {
      setSaving(true);
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/webhooks`), {
        method: 'POST', headers,
        body: JSON.stringify(newWebhook),
      });
      if (res.ok) { setNewWebhook({ name: '', method: 'POST', response_mode: 'async' }); setShowAdd(false); fetchWebhooks(); }
    } catch { /* silently handle */ }
    finally { setSaving(false); }
  }, [workflowId, newWebhook, getAuthHeaders, fetchWebhooks]);

  const handleDelete = useCallback(async (webhookId: string) => {
    if (!workflowId) return;
    try {
      const headers = getAuthHeaders();
      await fetch(workflowEndpoint(`/workflows/${workflowId}/webhooks/${webhookId}`), { method: 'DELETE', headers });
      fetchWebhooks();
    } catch { /* silently handle */ }
  }, [workflowId, getAuthHeaders, fetchWebhooks]);

  const handleTest = useCallback(async (wh: Webhook) => {
    setTestingId(wh.id);
    setTestResult(null);
    const start = performance.now();
    try {
      const res = await fetch(wh.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true, timestamp: new Date().toISOString() }) });
      setTestResult({ id: wh.id, status: res.status, time: Math.round(performance.now() - start) });
    } catch {
      setTestResult({ id: wh.id, status: 0, time: Math.round(performance.now() - start) });
    }
    finally { setTestingId(null); }
  }, []);

  const handleCopy = useCallback((url: string, id: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  if (!workflowId) {
    return <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Save workflow first to configure webhooks</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {webhooks.length} webhook{webhooks.length !== 1 ? 's' : ''} configured
        </span>
        <button onClick={() => setShowAdd(!showAdd)} className={btnPrimary} style={btnPrimaryStyle}>
          <span className="flex items-center gap-1.5">
            {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showAdd ? 'Cancel' : 'Add Webhook'}
          </span>
        </button>
      </div>

      {/* Add form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="p-4 rounded-lg border space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <input type="text" value={newWebhook.name} onChange={e => setNewWebhook(w => ({ ...w, name: e.target.value }))} placeholder="Webhook name" className={inputClass} style={inputStyle} />
              <div className="grid grid-cols-2 gap-3">
                <select value={newWebhook.method} onChange={e => setNewWebhook(w => ({ ...w, method: e.target.value }))} className={inputClass} style={inputStyle}>
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>
                <select value={newWebhook.response_mode} onChange={e => setNewWebhook(w => ({ ...w, response_mode: e.target.value }))} className={inputClass} style={inputStyle}>
                  <option value="async">Async</option>
                  <option value="sync">Sync</option>
                </select>
              </div>
              <button onClick={handleAdd} disabled={saving || !newWebhook.name.trim()} className={`${btnPrimary} w-full`} style={btnPrimaryStyle}>
                {saving ? 'Creating...' : 'Add Webhook'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Webhooks list */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ backgroundColor: 'var(--color-surface)' }}>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Name</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Method</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>URL</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Status</th>
              <th className={`${tableHeaderClass} text-right`} style={tableHeaderStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading...</td></tr>
            ) : webhooks.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No webhooks configured</td></tr>
            ) : (
              webhooks.map(wh => (
                <React.Fragment key={wh.id}>
                  <tr className="transition-colors hover:bg-[var(--color-surface)]">
                    <td className={tableCellClass} style={tableCellStyle}>
                      <div className="flex items-center gap-2">
                        <Link className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                        <span className="font-medium">{wh.name}</span>
                      </div>
                    </td>
                    <td className={tableCellClass} style={tableCellStyle}>
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded" style={{ backgroundColor: `${methodColors[wh.method]}20`, color: methodColors[wh.method] }}>
                        {wh.method}
                      </span>
                    </td>
                    <td className={tableCellClass} style={tableCellStyle}>
                      <code className="text-xs font-mono truncate max-w-[200px] block" style={{ color: 'var(--color-text-tertiary)' }}>
                        {wh.url}
                      </code>
                    </td>
                    <td className={tableCellClass} style={tableCellStyle}>
                      <div className="flex items-center gap-2">
                        <StatusDot color={wh.status === 'active' ? 'var(--color-success)' : 'var(--color-fg-muted)'} />
                        <span className="text-xs">{wh.status}</span>
                      </div>
                    </td>
                    <td className={tableCellClass} style={tableCellStyle}>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleTest(wh)} disabled={testingId === wh.id} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]" title="Test webhook" style={{ color: 'var(--color-accent)' }}>
                          {testingId === wh.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        </button>
                        <button onClick={() => handleCopy(wh.url, wh.id)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]" title="Copy URL" style={{ color: 'var(--color-text-tertiary)' }}>
                          {copiedId === wh.id ? <Check className="w-4 h-4" style={{ color: 'var(--color-success)' }} /> : <Copy className="w-4 h-4" />}
                        </button>
                        {wh.stats?.last_calls?.length > 0 && (
                          <button onClick={() => setExpandedId(expandedId === wh.id ? null : wh.id)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]" title="Request history" style={{ color: 'var(--color-text-tertiary)' }}>
                            <Clock className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => handleDelete(wh.id)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]" title="Delete" style={{ color: 'var(--color-error)' }}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* Test result + history */}
                  {(testResult?.id === wh.id || expandedId === wh.id) && (
                    <tr>
                      <td colSpan={5} className="px-4 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
                        {testResult?.id === wh.id && (
                          <div className="text-xs font-mono mb-2" style={{ color: testResult.status >= 200 && testResult.status < 300 ? 'var(--color-success)' : 'var(--color-error)' }}>
                            Test: {testResult.status === 0 ? 'Failed' : `${testResult.status}`} ({testResult.time}ms)
                          </div>
                        )}
                        {expandedId === wh.id && wh.stats?.last_calls && (
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Recent Calls</div>
                            <div className="space-y-1">
                              {wh.stats.last_calls.slice(0, 10).map((call: WebhookCall, i: number) => (
                                <div key={i} className="flex items-center gap-3 text-xs">
                                  <span style={{ color: 'var(--color-text-tertiary)' }}>{new Date(call.timestamp).toLocaleString()}</span>
                                  <span className="font-mono font-bold" style={{ color: call.status_code >= 200 && call.status_code < 300 ? 'var(--color-success)' : 'var(--color-error)' }}>{call.status_code}</span>
                                  <span style={{ color: 'var(--color-text-tertiary)' }}>{call.response_time_ms}ms</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
