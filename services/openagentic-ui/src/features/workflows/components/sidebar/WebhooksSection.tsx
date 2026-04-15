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
 * WebhooksSection - Webhook management with test execution and request history
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Link,
  Plus,
  X,
  Copy,
  Check,
  Play,
  Trash2,
  Clock,
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { workflowEndpoint } from '@/utils/api';

interface WebhooksSectionProps {
  workflowId?: string;
}

interface WebhookEntry {
  id: string;
  name: string;
  method: 'POST' | 'GET' | 'PUT' | 'DELETE';
  url: string;
  response_mode: 'sync' | 'async';
  status: 'active' | 'inactive';
  stats?: {
    last_calls?: Array<{
      timestamp: string;
      status_code: number;
      response_time_ms: number;
    }>;
  };
}

const methodColors: Record<string, string> = {
  POST: '#22c55e',
  GET: '#2196f3',
  PUT: '#ff9800',
  DELETE: '#ef5350',
};

export const WebhooksSection: React.FC<WebhooksSectionProps> = ({ workflowId }) => {
  const { getAuthHeaders } = useAuth();

  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; status: number; time: number } | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newMethod, setNewMethod] = useState<'POST' | 'GET'>('POST');
  const [newResponseMode, setNewResponseMode] = useState<'sync' | 'async'>('async');
  const [saving, setSaving] = useState(false);

  // Fetch webhooks
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
    } catch {
      /* silently handle */
    } finally {
      setLoading(false);
    }
  }, [workflowId, getAuthHeaders]);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  // Copy webhook URL
  const handleCopyUrl = useCallback((url: string, id: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  // Add webhook
  const handleAdd = useCallback(async () => {
    if (!workflowId || !newName.trim()) return;
    try {
      setSaving(true);
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/webhooks`), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: newName.trim(),
          method: newMethod,
          response_mode: newResponseMode,
        }),
      });
      if (res.ok) {
        setNewName('');
        setNewMethod('POST');
        setNewResponseMode('async');
        setShowAddForm(false);
        fetchWebhooks();
      }
    } catch {
      /* silently handle */
    } finally {
      setSaving(false);
    }
  }, [workflowId, newName, newMethod, newResponseMode, getAuthHeaders, fetchWebhooks]);

  // Delete webhook
  const handleDelete = useCallback(async (webhookId: string) => {
    if (!workflowId) return;
    try {
      const headers = getAuthHeaders();
      await fetch(workflowEndpoint(`/workflows/${workflowId}/webhooks/${webhookId}`), {
        method: 'DELETE',
        headers,
      });
      fetchWebhooks();
    } catch {
      /* silently handle */
    }
  }, [workflowId, getAuthHeaders, fetchWebhooks]);

  // Test webhook
  const handleTest = useCallback(async (webhook: WebhookEntry) => {
    setTestingId(webhook.id);
    setTestResult(null);
    const start = performance.now();
    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true, timestamp: new Date().toISOString() }),
      });
      const time = Math.round(performance.now() - start);
      setTestResult({ id: webhook.id, status: res.status, time });
    } catch {
      const time = Math.round(performance.now() - start);
      setTestResult({ id: webhook.id, status: 0, time });
    } finally {
      setTestingId(null);
    }
  }, []);

  if (!workflowId) {
    return (
      <div className="px-4 py-3 text-[12px]" style={{ color: 'var(--color-text-tertiary, #999)' }}>
        Save workflow first to configure webhooks
      </div>
    );
  }

  return (
    <div className="px-4 py-2 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary, #777)' }}>
          Webhooks
        </span>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="p-0.5 rounded transition-colors hover:bg-[var(--color-surface)]"
          style={{ color: 'var(--color-text-tertiary, #999)' }}
        >
          {showAddForm ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
        </button>
      </div>

      {/* Add Form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div
              className="p-2 rounded-lg border space-y-1.5"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Webhook name"
                className="w-full px-2 py-1 text-[12px] rounded border focus:outline-none focus:ring-1"
                style={{
                  backgroundColor: 'var(--color-bg-primary)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)',
                }}
              />
              <div className="flex gap-1.5">
                <select
                  value={newMethod}
                  onChange={e => setNewMethod(e.target.value as 'POST' | 'GET')}
                  className="flex-1 px-2 py-1 text-[12px] rounded border focus:outline-none focus:ring-1"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                >
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                </select>
                <select
                  value={newResponseMode}
                  onChange={e => setNewResponseMode(e.target.value as 'sync' | 'async')}
                  className="flex-1 px-2 py-1 text-[12px] rounded border focus:outline-none focus:ring-1"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                >
                  <option value="async">Async</option>
                  <option value="sync">Sync</option>
                </select>
              </div>
              <button
                onClick={handleAdd}
                disabled={saving || !newName.trim()}
                className="w-full py-1 text-[12px] font-medium rounded transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--user-accent-primary, #2196f3)',
                  color: '#fff',
                }}
              >
                {saving ? 'Creating...' : 'Add Webhook'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Webhooks List */}
      {loading ? (
        <div className="text-[12px] py-1" style={{ color: 'var(--color-text-tertiary, #999)' }}>
          Loading webhooks...
        </div>
      ) : webhooks.length === 0 ? (
        <div className="text-[12px] py-2 text-center" style={{ color: 'var(--color-text-tertiary, #999)' }}>
          <Link className="w-5 h-5 mx-auto mb-1" style={{ color: 'var(--color-text-tertiary, #777)' }} />
          No webhooks configured
        </div>
      ) : (
        <div className="space-y-1.5">
          {webhooks.map(wh => (
            <div
              key={wh.id}
              className="p-2 rounded-lg border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              {/* Webhook header */}
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: wh.status === 'active' ? '#22c55e' : '#9e9e9e' }}
                />
                <span className="text-[12px] font-medium flex-1 truncate" style={{ color: 'var(--color-text)' }}>
                  {wh.name}
                </span>
                <span
                  className="text-[10px] px-1 py-0.5 rounded font-mono font-bold"
                  style={{
                    backgroundColor: `${methodColors[wh.method]}20`,
                    color: methodColors[wh.method],
                  }}
                >
                  {wh.method}
                </span>
              </div>

              {/* URL */}
              <div className="flex items-center gap-1 mb-1">
                <code
                  className="text-[10px] font-mono flex-1 truncate"
                  style={{ color: 'var(--color-text-tertiary, #999)' }}
                >
                  {wh.url}
                </code>
                <button
                  onClick={() => handleCopyUrl(wh.url, wh.id)}
                  className="p-0.5 rounded transition-colors hover:bg-[var(--color-bg-primary)]"
                  style={{ color: 'var(--color-text-tertiary, #999)' }}
                >
                  {copiedId === wh.id ? (
                    <Check className="w-2.5 h-2.5" style={{ color: '#22c55e' }} />
                  ) : (
                    <Copy className="w-2.5 h-2.5" />
                  )}
                </button>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleTest(wh)}
                  disabled={testingId === wh.id}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors hover:opacity-80 disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--user-accent-primary, #2196f3)',
                    color: '#fff',
                  }}
                >
                  <Play className="w-2.5 h-2.5" />
                  {testingId === wh.id ? 'Testing...' : 'Test'}
                </button>

                {/* Show test result inline */}
                {testResult && testResult.id === wh.id && (
                  <span
                    className="text-[10px] font-mono"
                    style={{ color: testResult.status >= 200 && testResult.status < 300 ? '#22c55e' : '#ef5350' }}
                  >
                    {testResult.status === 0 ? 'Failed' : testResult.status} ({testResult.time}ms)
                  </span>
                )}

                <div className="flex-1" />

                {/* History toggle */}
                {wh.stats?.last_calls && wh.stats.last_calls.length > 0 && (
                  <button
                    onClick={() => setExpandedHistory(expandedHistory === wh.id ? null : wh.id)}
                    className="p-0.5 rounded transition-colors hover:bg-[var(--color-bg-primary)]"
                    style={{ color: 'var(--color-text-tertiary, #999)' }}
                    title="Request history"
                  >
                    <Clock className="w-2.5 h-2.5" />
                  </button>
                )}

                <button
                  onClick={() => handleDelete(wh.id)}
                  className="p-0.5 rounded transition-colors hover:bg-[var(--color-bg-primary)]"
                  style={{ color: 'var(--color-text-tertiary, #999)' }}
                  title="Delete webhook"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>

              {/* Request history */}
              <AnimatePresence>
                {expandedHistory === wh.id && wh.stats?.last_calls && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden mt-1.5 pt-1.5 border-t"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-tertiary, #777)' }}>
                      Recent Calls
                    </div>
                    <div className="space-y-0.5">
                      {wh.stats.last_calls.slice(0, 5).map((call, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[10px]">
                          <span style={{ color: 'var(--color-text-tertiary, #999)' }}>
                            {new Date(call.timestamp).toLocaleTimeString()}
                          </span>
                          <span
                            className="font-mono font-bold"
                            style={{
                              color: call.status_code >= 200 && call.status_code < 300 ? '#22c55e' : '#ef5350',
                            }}
                          >
                            {call.status_code}
                          </span>
                          <span style={{ color: 'var(--color-text-tertiary, #999)' }}>
                            {call.response_time_ms}ms
                          </span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
