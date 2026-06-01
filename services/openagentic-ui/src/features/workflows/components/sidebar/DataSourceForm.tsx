/**
 * DataSourceForm - Compact form for adding/editing data sources
 * Supports PostgreSQL, MySQL, REST API, S3/MinIO, Redis, GraphQL
 */

import React, { useState, useCallback } from 'react';
import {
  Database,
  Plus,
  X,
  Check,
  Loader,
  Zap,
} from '@/shared/icons';

type DataSourceType = 'postgresql' | 'mysql' | 'rest' | 's3' | 'redis' | 'graphql';

interface DataSourceFormData {
  name: string;
  type: DataSourceType;
  host?: string;
  port?: number;
  database?: string;
  baseUrl?: string;
  endpoint?: string;
  bucket?: string;
  credentialId?: string;
  shared?: boolean;
}

interface DataSourceFormProps {
  onSubmit: (data: DataSourceFormData) => Promise<void>;
  onCancel: () => void;
  initial?: Partial<DataSourceFormData>;
  secrets?: Array<{ id: string; name: string }>;
}

const TYPE_OPTIONS: Array<{ value: DataSourceType; label: string; icon: string }> = [
  { value: 'postgresql', label: 'PostgreSQL', icon: 'PG' },
  { value: 'mysql', label: 'MySQL', icon: 'MY' },
  { value: 'rest', label: 'REST API', icon: 'RE' },
  { value: 's3', label: 'S3/MinIO', icon: 'S3' },
  { value: 'redis', label: 'Redis', icon: 'RD' },
  { value: 'graphql', label: 'GraphQL', icon: 'GQ' },
];

const DEFAULT_PORTS: Record<DataSourceType, number> = {
  postgresql: 5432,
  mysql: 3306,
  rest: 443,
  s3: 9000,
  redis: 6379,
  graphql: 443,
};

export const DataSourceForm: React.FC<DataSourceFormProps> = ({
  onSubmit,
  onCancel,
  initial,
  secrets,
}) => {
  const [form, setForm] = useState<DataSourceFormData>({
    name: initial?.name || '',
    type: initial?.type || 'postgresql',
    host: initial?.host || '',
    port: initial?.port || DEFAULT_PORTS[initial?.type || 'postgresql'],
    database: initial?.database || '',
    baseUrl: initial?.baseUrl || '',
    endpoint: initial?.endpoint || '',
    bucket: initial?.bucket || '',
    credentialId: initial?.credentialId || '',
    shared: initial?.shared || false,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const updateField = useCallback(<K extends keyof DataSourceFormData>(key: K, value: DataSourceFormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setFeedback(null);
  }, []);

  const setType = useCallback((type: DataSourceType) => {
    setForm(prev => ({
      ...prev,
      type,
      port: DEFAULT_PORTS[type],
    }));
    setFeedback(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!form.name.trim()) {
      setFeedback({ type: 'error', message: 'Name is required' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await onSubmit(form);
      setFeedback({ type: 'success', message: 'Data source saved' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }, [form, onSubmit]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/data-sources/probe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok && data.connected) {
        setFeedback({ type: 'success', message: `Connected — ${data.tableCount || 0} tables found` });
      } else {
        setFeedback({ type: 'error', message: data.error || 'Connection failed' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Test failed' });
    } finally {
      setTesting(false);
    }
  }, [form]);

  const isSqlType = form.type === 'postgresql' || form.type === 'mysql';
  const isUrlType = form.type === 'rest' || form.type === 'graphql';
  const isS3Type = form.type === 's3';
  const isRedisType = form.type === 'redis';

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '4px 8px',
    fontSize: '12px',
    border: '1px solid var(--color-border)',
    borderRadius: '4px',
    background: 'var(--color-surface)',
    color: 'var(--text-primary)',
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    marginBottom: '2px',
    display: 'block',
  };

  return (
    <div style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
          {initial ? 'Edit Data Source' : 'New Data Source'}
        </span>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
          <X className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
        </button>
      </div>

      {/* Name */}
      <div style={{ marginBottom: '6px' }}>
        <label style={labelStyle}>Name</label>
        <input
          value={form.name}
          onChange={e => updateField('name', e.target.value)}
          placeholder="My Database"
          style={inputStyle}
        />
      </div>

      {/* Type selector grid */}
      <div style={{ marginBottom: '6px' }}>
        <label style={labelStyle}>Type</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3px' }}>
          {TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setType(opt.value)}
              style={{
                padding: '4px 2px',
                fontSize: '10px',
                fontWeight: 500,
                border: '1px solid',
                borderColor: form.type === opt.value ? 'var(--color-primary)' : 'var(--color-border)',
                borderRadius: '4px',
                background: form.type === opt.value ? 'var(--color-primary)' : 'transparent',
                color: form.type === opt.value ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer',
                textAlign: 'center',
                lineHeight: 1.2,
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 700, display: 'block' }}>{opt.icon}</span>
              <span style={{ fontSize: '9px' }}>{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Connection fields — SQL types */}
      {(isSqlType || isRedisType) && (
        <>
          <div style={{ marginBottom: '4px' }}>
            <label style={labelStyle}>Host</label>
            <input
              value={form.host}
              onChange={e => updateField('host', e.target.value)}
              placeholder="localhost"
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Port</label>
              <input
                type="number"
                value={form.port}
                onChange={e => updateField('port', parseInt(e.target.value) || 0)}
                style={inputStyle}
              />
            </div>
            {isSqlType && (
              <div style={{ flex: 2 }}>
                <label style={labelStyle}>Database</label>
                <input
                  value={form.database}
                  onChange={e => updateField('database', e.target.value)}
                  placeholder="mydb"
                  style={inputStyle}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* Connection fields — URL types */}
      {isUrlType && (
        <div style={{ marginBottom: '4px' }}>
          <label style={labelStyle}>Base URL</label>
          <input
            value={form.baseUrl}
            onChange={e => updateField('baseUrl', e.target.value)}
            placeholder="https://api.example.com"
            style={inputStyle}
          />
        </div>
      )}

      {/* Connection fields — S3 */}
      {isS3Type && (
        <>
          <div style={{ marginBottom: '4px' }}>
            <label style={labelStyle}>Endpoint</label>
            <input
              value={form.endpoint}
              onChange={e => updateField('endpoint', e.target.value)}
              placeholder="http://minio:9000"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: '4px' }}>
            <label style={labelStyle}>Bucket</label>
            <input
              value={form.bucket}
              onChange={e => updateField('bucket', e.target.value)}
              placeholder="my-bucket"
              style={inputStyle}
            />
          </div>
        </>
      )}

      {/* Credential selector */}
      {secrets && secrets.length > 0 && (
        <div style={{ marginBottom: '4px' }}>
          <label style={labelStyle}>Credential</label>
          <select
            value={form.credentialId}
            onChange={e => updateField('credentialId', e.target.value)}
            style={{ ...inputStyle, appearance: 'auto' as any }}
          >
            <option value="">None</option>
            {secrets.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Share toggle */}
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={form.shared}
          onChange={e => updateField('shared', e.target.checked)}
          style={{ margin: 0 }}
        />
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Share with team</span>
      </label>

      {/* Feedback */}
      {feedback && (
        <div style={{
          fontSize: '11px',
          padding: '4px 6px',
          marginBottom: '6px',
          borderRadius: '4px',
          color: feedback.type === 'success' ? 'var(--color-success, #22c55e)' : 'var(--color-error, #ef5350)',
          background: feedback.type === 'success' ? 'color-mix(in srgb, var(--color-success) 10%, transparent)' : 'rgba(239,83,80,0.1)',
        }}>
          {feedback.message}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: '4px' }}>
        <button
          onClick={handleTest}
          disabled={testing}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            padding: '5px 8px',
            fontSize: '11px',
            fontWeight: 500,
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: testing ? 'wait' : 'pointer',
            opacity: testing ? 0.6 : 1,
          }}
        >
          {testing ? <Loader className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          Test
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            padding: '5px 8px',
            fontSize: '11px',
            fontWeight: 500,
            border: 'none',
            borderRadius: '4px',
            background: 'var(--color-primary)',
            color: 'var(--color-on-accent)',
            cursor: saving ? 'wait' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? <Loader className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          Save
        </button>
      </div>
    </div>
  );
};
