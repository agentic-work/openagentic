/**
 * SchemaDrivenConfig — the generic fallback renderer used for any node type
 * without an explicit config group. Loops `schema.settings[]` and emits the
 * right input per declared setting type, with required-field markers pulled
 * from the schema registry. Closes the gap users hit when the validator says
 * "X is required" but no explicit panel input exists for X.
 */

import React from 'react';
import { FormInput, FormTextarea, FormSelect } from '../FormControls';
import type { NodeConfigContext } from '../types';

export const SchemaDrivenConfig: React.FC<NodeConfigContext> = ({ editor, schemaSettings, nodeType }) => {
  const { nodeData, updateData } = editor;

  if (!schemaSettings.hasSchema || schemaSettings.settings.length === 0) {
    return (
      <div className="glass-surface-subtle" style={{
        padding: '12px',
        border: '1px solid var(--glass-border)',
        borderRadius: 8,
        fontSize: 12,
        color: 'var(--color-text-tertiary)',
      }}>
        No schema definition available for <code>{nodeType}</code>. This
        node type isn't yet migrated to the schema-driven plugin
        registry — its data fields can still be edited via the JSON
        inspector below.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {schemaSettings.settings.map((setting) => {
        const value = (nodeData as Record<string, unknown>)[setting.name] ?? '';
        const isRequired = setting.required === true;
        const hasError = isRequired && (value === '' || value == null);
        const labelText = setting.label || setting.name;
        const helpText = setting.description;

        if (setting.type === 'enum' && Array.isArray(setting.values)) {
          return (
            <FormSelect
              key={setting.name}
              label={labelText + (isRequired ? ' *' : '')}
              value={String(value || setting.default || '')}
              onChange={(v) => updateData(setting.name, v)}
              options={setting.values.map((v) => ({ value: v, label: v }))}
              helpText={helpText}
            />
          );
        }
        if (setting.type === 'boolean') {
          return (
            <div key={setting.name} className="glass-surface-subtle flex items-center justify-between p-3 rounded-lg" style={{ border: '1px solid var(--glass-border)' }}>
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{labelText}</div>
                {helpText && <div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{helpText}</div>}
              </div>
              <input
                type="checkbox"
                checked={!!value}
                onChange={(e) => updateData(setting.name, e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
            </div>
          );
        }
        if (setting.type === 'number') {
          return (
            <FormInput
              key={setting.name}
              label={labelText}
              value={value as number}
              onChange={(v) => updateData(setting.name, Number(v))}
              type="number"
              placeholder={setting.placeholder}
              helpText={helpText}
              min={setting.min}
              max={setting.max}
              required={isRequired}
              error={hasError}
            />
          );
        }
        if (setting.type === 'json' || setting.type === 'object') {
          return (
            <FormTextarea
              key={setting.name}
              label={labelText}
              value={typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
              onChange={(v) => updateData(setting.name, v)}
              rows={6}
              placeholder={setting.placeholder || '{ }'}
              helpText={helpText}
              monospace
              required={isRequired}
              error={hasError}
            />
          );
        }
        if (setting.type === 'code') {
          return (
            <FormTextarea
              key={setting.name}
              label={labelText}
              value={String(value || '')}
              onChange={(v) => updateData(setting.name, v)}
              rows={8}
              placeholder={setting.placeholder}
              helpText={helpText}
              monospace
              required={isRequired}
              error={hasError}
            />
          );
        }
        if (setting.type === 'secret_ref') {
          return (
            <FormInput
              key={setting.name}
              label={labelText}
              value={String(value || '')}
              onChange={(v) => updateData(setting.name, v)}
              placeholder={setting.placeholder || '{{secret:NAME}}'}
              helpText={helpText || 'Reference a secret with `{{secret:NAME}}` syntax — never paste literal credentials.'}
              required={isRequired}
              error={hasError}
            />
          );
        }
        // Default: plain string input. Long fields go to a textarea
        // so the user can edit prompts comfortably.
        const isLong = (setting.placeholder || '').length > 80
          || setting.name.toLowerCase().includes('prompt')
          || setting.name.toLowerCase().includes('description')
          || setting.name.toLowerCase().includes('query');
        if (isLong) {
          return (
            <FormTextarea
              key={setting.name}
              label={labelText}
              value={String(value || '')}
              onChange={(v) => updateData(setting.name, v)}
              rows={4}
              placeholder={setting.placeholder}
              helpText={helpText}
              required={isRequired}
              error={hasError}
            />
          );
        }
        return (
          <FormInput
            key={setting.name}
            label={labelText}
            value={String(value || '')}
            onChange={(v) => updateData(setting.name, v)}
            placeholder={setting.placeholder}
            helpText={helpText}
            required={isRequired}
            error={hasError}
          />
        );
      })}
    </div>
  );
};
