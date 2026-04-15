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
 * Embedding Provider Section — Configuration and testing for the embedding provider.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Layers } from '@/shared/icons';
import { type DbProvider, inputCls, inputStyle, btnPrimary } from './types';
import { type useToast } from './ToastSystem';
import { apiRequest } from '@/utils/api';

export const EmbeddingProviderSection: React.FC<{
  providers: DbProvider[];
  toast: ReturnType<typeof useToast>;
}> = ({ providers, toast }) => {
  const [embeddingConfig, setEmbeddingConfig] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('');

  useEffect(() => {
    apiRequest('/admin/embeddings/config').then(async res => {
      if (res.ok) {
        const data = await res.json();
        setEmbeddingConfig(data);
        setSelectedProvider(data.providerName || '');
      }
    }).catch(() => {});
  }, []);

  const embeddingProviders = useMemo(() =>
    providers.filter(p => p.enabled), [providers]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiRequest('/admin/embeddings/test', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
      if (data.success) toast.show('success', `Embedding test passed (${data.latencyMs}ms, ${data.dimensions}d)`);
      else toast.show('error', `Embedding test failed: ${data.error}`);
    } catch (err: any) {
      toast.show('error', `Embedding test error: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedProvider) return;
    try {
      const res = await apiRequest('/admin/embeddings/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerName: selectedProvider }),
      });
      if (res.ok) {
        toast.show('success', 'Embedding provider updated');
        const configRes = await apiRequest('/admin/embeddings/config');
        if (configRes.ok) setEmbeddingConfig(await configRes.json());
      } else {
        const err = await res.json();
        toast.show('error', err.error || 'Update failed');
      }
    } catch (err: any) {
      toast.show('error', err.message);
    }
  };

  return (
    <div className="mt-6 rounded-xl border p-5" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Layers size={18} style={{ color: 'var(--color-primary)' }} />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Embedding Provider</h3>
        </div>
        <button onClick={handleTest} disabled={testing} className={btnPrimary + ' text-xs !px-3 !py-1.5'}>
          {testing ? 'Testing...' : 'Test'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Provider</label>
          <select
            value={selectedProvider}
            onChange={e => setSelectedProvider(e.target.value)}
            className={inputCls}
            style={inputStyle}
          >
            <option value="">Select provider...</option>
            {embeddingProviders.map(p => (
              <option key={p.name} value={p.name}>{p.display_name} ({p.provider_type})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Model</label>
          <div className="px-3 py-2 rounded-lg border text-sm" style={{ backgroundColor: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}>
            {embeddingConfig?.embeddingModel || 'Not configured'}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Dimensions</label>
          <div className="px-3 py-2 rounded-lg border text-sm" style={{ backgroundColor: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}>
            {embeddingConfig?.dimensions || 'Auto-detect'}
          </div>
        </div>
      </div>

      {selectedProvider && selectedProvider !== embeddingConfig?.providerName && (
        <div className="mt-3 flex justify-end">
          <button onClick={handleUpdate} className={btnPrimary + ' text-xs'}>Save Changes</button>
        </div>
      )}

      {testResult && (
        <div className={`mt-3 p-3 rounded-lg text-xs ${testResult.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {testResult.success
            ? `${testResult.provider} / ${testResult.model} — ${testResult.dimensions}d, ${testResult.latencyMs}ms`
            : `Error: ${testResult.error}`
          }
        </div>
      )}

      <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        Source: {embeddingConfig?.source || 'unknown'} | Runtime: {embeddingConfig?.runtime?.provider || 'N/A'}
      </div>
    </div>
  );
};
