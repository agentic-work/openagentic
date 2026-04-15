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
 * Module Editor
 *
 * SlideInPanel for editing a composable prompt module.
 * Supports injection rules, model variants, priority, and enabled toggle.
 */

import React, { useState, useEffect } from 'react';
import { SlideInPanel, PanelButton } from '../Shared/SlideInPanel';
import { apiRequestJson } from '@/utils/api';

interface InjectionRules {
  toolPatterns?: string[];
  requiresCapabilities?: string[];
  requiresModes?: string[];
  alwaysInject?: boolean;
  semanticMatch?: boolean;
}

interface PromptModule {
  id: string;
  name: string;
  category: 'core' | 'domain' | 'mode' | 'capability';
  description?: string;
  content: string;
  priority: number;
  tokenCost: number;
  enabled: boolean;
  injection: InjectionRules;
  variants?: Record<string, string>;
  updatedAt?: string;
  createdAt?: string;
}

const ALL_CAPABILITIES = [
  'thinking', 'tools', 'vision', 'grounding', 'longContext',
  'audio', 'video', 'documents', 'streaming', 'imageGen', 'embedding', 'codeExecution',
];

const ALL_MODES = ['chat', 'code', 'flow'];

const MODEL_VARIANT_TABS = ['Claude', 'Gemini', 'OpenAI', 'Local'] as const;
const VARIANT_KEYS: Record<string, string> = {
  Claude: 'claude',
  Gemini: 'gemini',
  OpenAI: 'openai',
  Local: 'local',
};

interface ModuleEditorProps {
  isOpen: boolean;
  module: PromptModule;
  onClose: () => void;
  onSaved: (updated: PromptModule) => void;
}

export const ModuleEditor: React.FC<ModuleEditorProps> = ({
  isOpen,
  module,
  onClose,
  onSaved,
}) => {
  const [form, setForm] = useState<PromptModule>(module);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeVariantTab, setActiveVariantTab] = useState<typeof MODEL_VARIANT_TABS[number]>('Claude');

  // Sync form when module changes
  useEffect(() => {
    setForm({ ...module });
    setSaveError(null);
  }, [module]);

  const setInjection = (patch: Partial<InjectionRules>) => {
    setForm((f) => ({ ...f, injection: { ...f.injection, ...patch } }));
  };

  const handleCapabilityToggle = (cap: string) => {
    const current = form.injection.requiresCapabilities || [];
    const next = current.includes(cap)
      ? current.filter((c) => c !== cap)
      : [...current, cap];
    setInjection({ requiresCapabilities: next });
  };

  const handleModeToggle = (mode: string) => {
    const current = form.injection.requiresModes || [];
    const next = current.includes(mode)
      ? current.filter((m) => m !== mode)
      : [...current, mode];
    setInjection({ requiresModes: next });
  };

  const setVariant = (key: string, value: string) => {
    setForm((f) => ({
      ...f,
      variants: { ...(f.variants || {}), [key]: value },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await apiRequestJson<any>(`/admin/prompts/modules/${form.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          content: form.content,
          description: form.description,
          priority: form.priority,
          enabled: form.enabled,
          injection: form.injection,
          variants: form.variants,
        }),
      });
      onSaved(updated.module || updated);
    } catch (err: any) {
      setSaveError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const fieldLabel = (label: string) => (
    <div
      style={{
        fontSize: '12px',
        fontWeight: '600',
        color: 'var(--text-secondary)',
        marginBottom: '4px',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {label}
    </div>
  );

  const fieldWrap = (children: React.ReactNode, style?: React.CSSProperties) => (
    <div style={{ marginBottom: '16px', ...style }}>{children}</div>
  );

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '7px 10px',
    fontSize: '13px',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    backgroundColor: 'var(--color-bg-secondary)',
    color: 'var(--text-primary)',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const checkboxRow = (label: string, checked: boolean, onChange: () => void) => (
    <label
      key={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        cursor: 'pointer',
        fontSize: '13px',
        color: 'var(--text-primary)',
        userSelect: 'none',
        padding: '2px 0',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ width: '14px', height: '14px', cursor: 'pointer' }}
      />
      {label}
    </label>
  );

  return (
    <SlideInPanel
      isOpen={isOpen}
      onClose={onClose}
      title={form.name}
      subtitle={`${form.category} module · ID: ${form.id.substring(0, 8)}…`}
      width="lg"
      footer={
        <>
          <PanelButton variant="secondary" onClick={onClose}>
            Cancel
          </PanelButton>
          <PanelButton variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Module'}
          </PanelButton>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
        {saveError && (
          <div
            style={{
              marginBottom: '16px',
              padding: '10px 12px',
              borderRadius: '6px',
              fontSize: '13px',
              backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
              color: 'var(--color-error)',
              border: '1px solid color-mix(in srgb, var(--color-error) 20%, transparent)',
            }}
          >
            {saveError}
          </div>
        )}

        {/* Description */}
        {fieldWrap(
          <>
            {fieldLabel('Description')}
            <input
              type="text"
              value={form.description || ''}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Short description of what this module does"
              style={inputStyle}
            />
          </>,
        )}

        {/* Content */}
        {fieldWrap(
          <>
            {fieldLabel('Content')}
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              style={{
                ...inputStyle,
                height: '300px',
                resize: 'vertical',
                fontFamily: 'monospace',
                lineHeight: '1.5',
              }}
            />
          </>,
        )}

        {/* Priority + Token Cost (read-only) */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            {fieldLabel('Priority (1–100)')}
            <input
              type="number"
              min={1}
              max={100}
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: parseInt(e.target.value, 10) || 1 }))}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            {fieldLabel('Est. Token Cost')}
            <input
              type="text"
              value={`~${form.tokenCost} tokens`}
              readOnly
              style={{ ...inputStyle, opacity: 0.6, cursor: 'default' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            {fieldLabel('Enabled')}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                fontSize: '13px',
                color: 'var(--text-primary)',
                padding: '8px 0',
              }}
            >
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                style={{ width: '15px', height: '15px', cursor: 'pointer' }}
              />
              {form.enabled ? 'Enabled' : 'Disabled'}
            </label>
          </div>
        </div>

        {/* Injection Rules */}
        <div
          style={{
            marginBottom: '16px',
            padding: '14px 16px',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            backgroundColor: 'var(--color-bg-secondary)',
          }}
        >
          <div
            style={{
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--text-primary)',
              marginBottom: '12px',
            }}
          >
            Injection Rules
          </div>

          {/* Tool patterns */}
          {fieldWrap(
            <>
              {fieldLabel('Tool Patterns (comma-separated)')}
              <input
                type="text"
                value={(form.injection.toolPatterns || []).join(', ')}
                onChange={(e) => {
                  const patterns = e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  setInjection({ toolPatterns: patterns });
                }}
                placeholder="e.g. azure_*, aws_*, k8s_*"
                style={inputStyle}
              />
            </>,
          )}

          {/* Required Capabilities */}
          {fieldWrap(
            <>
              {fieldLabel('Required Capabilities')}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px 16px',
                  padding: '8px 0',
                }}
              >
                {ALL_CAPABILITIES.map((cap) =>
                  checkboxRow(
                    cap,
                    (form.injection.requiresCapabilities || []).includes(cap),
                    () => handleCapabilityToggle(cap),
                  ),
                )}
              </div>
            </>,
          )}

          {/* Required Modes */}
          {fieldWrap(
            <>
              {fieldLabel('Required Modes')}
              <div style={{ display: 'flex', gap: '16px', padding: '4px 0' }}>
                {ALL_MODES.map((mode) =>
                  checkboxRow(
                    mode,
                    (form.injection.requiresModes || []).includes(mode),
                    () => handleModeToggle(mode),
                  ),
                )}
              </div>
            </>,
          )}

          {/* Flags */}
          <div style={{ display: 'flex', gap: '24px' }}>
            {checkboxRow(
              'Always inject',
              form.injection.alwaysInject ?? false,
              () => setInjection({ alwaysInject: !form.injection.alwaysInject }),
            )}
            {checkboxRow(
              'Semantic match',
              form.injection.semanticMatch ?? false,
              () => setInjection({ semanticMatch: !form.injection.semanticMatch }),
            )}
          </div>
        </div>

        {/* Model Variants */}
        <div
          style={{
            marginBottom: '16px',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            overflow: 'hidden',
          }}
        >
          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-bg-secondary)',
            }}
          >
            {MODEL_VARIANT_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveVariantTab(tab)}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: activeVariantTab === tab ? '600' : '400',
                  color: activeVariantTab === tab ? 'var(--color-primary)' : 'var(--text-secondary)',
                  backgroundColor:
                    activeVariantTab === tab
                      ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)'
                      : 'transparent',
                  border: 'none',
                  borderBottom:
                    activeVariantTab === tab
                      ? '2px solid var(--color-primary)'
                      : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 150ms',
                }}
              >
                {tab}
              </button>
            ))}
          </div>
          {/* Variant textarea */}
          <div style={{ padding: '12px' }}>
            <div
              style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}
            >
              Override content for {activeVariantTab} models (leave blank to use default)
            </div>
            <textarea
              value={(form.variants || {})[VARIANT_KEYS[activeVariantTab]] || ''}
              onChange={(e) => setVariant(VARIANT_KEYS[activeVariantTab], e.target.value)}
              placeholder={`${activeVariantTab}-specific prompt variant...`}
              style={{
                ...inputStyle,
                height: '140px',
                resize: 'vertical',
                fontFamily: 'monospace',
                lineHeight: '1.5',
              }}
            />
          </div>
        </div>

        {/* Version history hint */}
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'right' }}>
          Created:{' '}
          {form.createdAt ? new Date(form.createdAt).toLocaleString() : '—'} · Updated:{' '}
          {form.updatedAt ? new Date(form.updatedAt).toLocaleString() : '—'}
        </div>
      </div>
    </SlideInPanel>
  );
};

export default ModuleEditor;
