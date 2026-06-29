/**
 * UniversalAdvancedConfig — the "Advanced Configuration" section shown for
 * every node type (disabled flag, timeout, on-error + retry policy, pinned
 * test output, output format, persist-to-KB, notes). Owns its own collapse
 * state (independent of the per-group "Show Advanced" toggle).
 */

import React from 'react';
import { ChevronDown } from '@/shared/icons';
import type { NodeData } from '../../../types/workflow.types';
import { FormInput, FormTextarea, FormSelect } from '../FormControls';
import type { UniversalAdvancedConfigProps } from '../types';

export const UniversalAdvancedConfig: React.FC<UniversalAdvancedConfigProps> = ({
  editor, isDark, showUniversalAdvanced, setShowUniversalAdvanced,
}) => {
  const { fieldStr, fieldNum, fieldBool, fieldRaw, asField, updateData } = editor;
  type RetryPolicy = NonNullable<NodeData['retryPolicy']>;
  const retryPolicy: Partial<RetryPolicy> =
    (fieldRaw('retryPolicy') as Partial<RetryPolicy> | undefined) ?? {};
  // Merge a patch onto the current policy, filling required fields with the
  // same defaults the inputs display, so the result satisfies NodeData['retryPolicy'].
  const writeRetryPolicy = (patch: Partial<RetryPolicy>) =>
    updateData('retryPolicy', {
      maxRetries: 3,
      delayMs: 1000,
      backoff: 'fixed',
      ...retryPolicy,
      ...patch,
    });
  const onError = fieldStr('onError', 'stop');

  return (
    <div className="pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
      <button
        onClick={() => setShowUniversalAdvanced(!showUniversalAdvanced)}
        className="w-full flex items-center justify-between py-3 text-sm font-medium"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        <span>Advanced Configuration</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${showUniversalAdvanced ? '' : '-rotate-90'}`} />
      </button>
      {showUniversalAdvanced && (
        <div className="space-y-4 pb-2">
          {/* Disabled toggle */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="node-disabled"
              checked={fieldBool('disabled')}
              onChange={(e) => updateData('disabled', e.target.checked)}
              className="rounded"
            />
            <label htmlFor="node-disabled" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Disabled (skip during execution)
            </label>
          </div>

          {/* Timeout */}
          <FormInput
            label="Timeout (seconds)"
            value={fieldNum('timeoutMs', 0) ? Math.round(fieldNum('timeoutMs', 0) / 1000) : ''}
            onChange={(v) => updateData('timeoutMs', v ? Number.parseInt(v) * 1000 : undefined)}
            type="number"
            placeholder="30"
            isDark={isDark}
            min={1}
            helpText="Max time before node is killed. Leave empty for workflow default."
          />

          {/* On Error */}
          <FormSelect
            label="On Error"
            value={onError}
            onChange={(v) => updateData('onError', asField(v, 'onError'))}
            options={[
              { value: 'stop', label: 'Stop Workflow' },
              { value: 'continue', label: 'Continue' },
              { value: 'retry', label: 'Retry' },
              { value: 'error_handler', label: 'Route to Error Handler' },
            ]}
            isDark={isDark}
          />

          {/* Retry Policy */}
          {onError === 'retry' && (
            <div className="space-y-3 pl-3 border-l-2" style={{ borderColor: 'var(--color-border)' }}>
              <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                Retry Policy
              </div>
              <FormInput
                label="Max Retries"
                value={retryPolicy.maxRetries ?? 3}
                onChange={(v) => writeRetryPolicy({ maxRetries: Number.parseInt(v) || 3 })}
                type="number"
                isDark={isDark}
                min={1}
                max={10}
              />
              <FormInput
                label="Delay (ms)"
                value={retryPolicy.delayMs ?? 1000}
                onChange={(v) => writeRetryPolicy({ delayMs: Number.parseInt(v) || 1000 })}
                type="number"
                isDark={isDark}
                min={100}
              />
              <FormSelect
                label="Backoff Strategy"
                value={retryPolicy.backoff || 'fixed'}
                onChange={(v) => writeRetryPolicy({ backoff: v as RetryPolicy['backoff'] })}
                options={[
                  { value: 'fixed', label: 'Fixed' },
                  { value: 'exponential', label: 'Exponential' },
                ]}
                isDark={isDark}
              />
            </div>
          )}

          {/* Pinned Test Output */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <input
                type="checkbox"
                id="use-pinned-data"
                checked={fieldBool('usePinnedData')}
                onChange={(e) => updateData('usePinnedData', e.target.checked)}
                className="rounded"
              />
              <label htmlFor="use-pinned-data" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Use pinned data instead of executing
              </label>
            </div>
            <FormTextarea
              label="Pinned Test Output"
              value={fieldStr('pinnedData')}
              onChange={(v) => updateData('pinnedData', v)}
              rows={4}
              placeholder='{"result": "sample output"}'
              isDark={isDark}
              monospace
              helpText="JSON data returned when pinned mode is active. Useful for testing downstream nodes."
            />
          </div>

          {/* Output Format */}
          <FormSelect
            label="Output Format"
            value={fieldStr('outputFormat', 'auto')}
            onChange={(v) => updateData('outputFormat', v === 'auto' ? undefined : v)}
            options={[
              { value: 'auto', label: 'Auto-detect' },
              { value: 'markdown', label: 'Markdown' },
              { value: 'html', label: 'HTML' },
              { value: 'json', label: 'JSON' },
              { value: 'table', label: 'Table' },
            ]}
            isDark={isDark}
            helpText="How this node's output should be formatted in the results panel."
          />

          {/* Persist to Milvus */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="persist-to-milvus"
              checked={fieldBool('persistToMilvus')}
              onChange={(e) => updateData('persistToMilvus', e.target.checked)}
              className="rounded"
            />
            <label htmlFor="persist-to-milvus" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Save output to Knowledge Base
            </label>
          </div>

          {/* Notes */}
          <FormTextarea
            label="Notes"
            value={fieldStr('notes')}
            onChange={(v) => updateData('notes', v)}
            rows={3}
            placeholder="Internal documentation about this node..."
            isDark={isDark}
            helpText="Freeform notes for documentation. Not used during execution."
          />
        </div>
      )}
    </div>
  );
};
