/**
 * Core flow-control node config groups: trigger, code, condition, transform,
 * loop, merge, switch, parallel, wait, webhook-response, user-context, text note.
 * Each is a thin presentational component over the shared NodeDataEditor.
 */

import React from 'react';
import { X } from '@/shared/icons';
import { isFieldRequired } from '../../../utils/workflowValidator';
import { FormInput, FormTextarea, FormSelect } from '../FormControls';
import type { NodeConfigContext } from '../types';

export const TriggerConfig: React.FC<NodeConfigContext> = ({ editor }) => {
  const { nodeData, updateData, selectValue } = editor;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="node-trigger-type" className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Trigger Type
        </label>
        <select
          id="node-trigger-type"
          value={nodeData.triggerType || 'manual'}
          onChange={(e) => updateData('triggerType', selectValue(e, 'triggerType'))}
          className="glass-field px-3 py-2 focus:outline-none"
        >
          <option value="manual">Manual</option>
          <option value="schedule">Schedule (Cron)</option>
          <option value="chat_message">Chat Message</option>
          <option value="file_upload">File Upload</option>
          <option value="webhook">Webhook</option>
          <option value="admin_action">Admin Action</option>
        </select>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          How the workflow is started. Manual requires user action; Schedule uses cron; Webhook listens for HTTP calls.
        </p>
      </div>

      {nodeData.triggerType === 'schedule' && (
        <div>
          <label htmlFor="node-trigger-cron" className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Cron Expression
          </label>
          <input
            id="node-trigger-cron"
            type="text"
            value={nodeData.triggerConfig?.cron || ''}
            onChange={(e) => updateData('triggerConfig', { ...nodeData.triggerConfig, cron: e.target.value })}
            placeholder="0 */6 * * *"
            className="glass-field px-3 py-2 focus:outline-none"
          />
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Example: 0 */6 * * * (every 6 hours)
          </p>
        </div>
      )}

      {nodeData.triggerType === 'chat_message' && (
        <div>
          <label htmlFor="node-trigger-message-pattern" className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Message Pattern (optional)
          </label>
          <input
            id="node-trigger-message-pattern"
            type="text"
            value={nodeData.triggerConfig?.messagePattern || ''}
            onChange={(e) => updateData('triggerConfig', { ...nodeData.triggerConfig, messagePattern: e.target.value })}
            placeholder="e.g., /workflow.*"
            className="glass-field px-3 py-2 focus:outline-none"
          />
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Regex pattern to match incoming messages. Leave empty to trigger on any message.
          </p>
        </div>
      )}
    </div>
  );
};

export const CodeConfig: React.FC<NodeConfigContext> = ({ editor }) => {
  const { nodeData, updateData, selectValue } = editor;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="node-code-language" className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Language
        </label>
        <select
          id="node-code-language"
          value={nodeData.language || 'javascript'}
          onChange={(e) => updateData('language', selectValue(e, 'language'))}
          className="glass-field px-3 py-2 focus:outline-none"
        >
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="bash">Bash</option>
        </select>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Runtime language for the code block. JavaScript runs in a sandboxed V8 environment.
        </p>
      </div>

      <FormTextarea
        label="Code"
        value={nodeData.code || ''}
        onChange={(v) => updateData('code', v)}
        rows={12}
        placeholder={`// Access input data:\nconst input = $input;\n\n// Return output:\nreturn { result: input };`}
        monospace
        helpText="Use $input to access previous node's output. The return value becomes this node's output."
        required={isFieldRequired('code', 'code')}
        error={isFieldRequired('code', 'code') && !nodeData.code?.trim()}
      />
    </div>
  );
};

export const ConditionConfig: React.FC<NodeConfigContext> = ({ editor }) => {
  const { nodeData, updateData, selectValue, fieldStr } = editor;
  return (
    <div className="space-y-4">
      <FormInput
        label="Condition Expression"
        value={nodeData.condition || ''}
        onChange={(v) => updateData('condition', v)}
        placeholder="e.g., $input.value > 100"
        helpText="Expression evaluated against the input data. Use $input to reference the previous node's output."
        required={isFieldRequired('condition', 'condition')}
        error={isFieldRequired('condition', 'condition') && !(nodeData.condition || fieldStr('expression'))}
      />

      <div>
        <label htmlFor="node-condition-operator" className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Operator
        </label>
        <select
          id="node-condition-operator"
          value={nodeData.operator || 'equals'}
          onChange={(e) => updateData('operator', selectValue(e, 'operator'))}
          className="glass-field px-3 py-2 focus:outline-none"
        >
          <option value="equals">Equals</option>
          <option value="contains">Contains</option>
          <option value="greater_than">Greater Than</option>
          <option value="less_than">Less Than</option>
          <option value="regex">Regex Match</option>
        </select>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Comparison operator. True branch follows when condition matches; false branch otherwise.
        </p>
      </div>
    </div>
  );
};

export const TransformConfig: React.FC<NodeConfigContext> = ({ editor }) => {
  const { nodeData, updateData, selectValue, fieldStr } = editor;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="node-transform-type" className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Transform Type
        </label>
        <select
          id="node-transform-type"
          value={nodeData.transformType || 'map'}
          onChange={(e) => updateData('transformType', selectValue(e, 'transformType'))}
          className="glass-field px-3 py-2 focus:outline-none"
        >
          <option value="map">Map</option>
          <option value="filter">Filter</option>
          <option value="reduce">Reduce</option>
          <option value="jsonpath">JSONPath</option>
        </select>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Map transforms each item; Filter keeps matching items; Reduce aggregates into one value; JSONPath extracts data.
        </p>
      </div>

      <FormTextarea
        label="Expression"
        value={nodeData.transformExpression || ''}
        onChange={(v) => updateData('transformExpression', v)}
        rows={4}
        placeholder={nodeData.transformType === 'jsonpath' ? '$.data[*].name' : 'item => item.value * 2'}
        monospace
        helpText={nodeData.transformType === 'jsonpath'
          ? 'JSONPath expression to extract data. Example: $.data.results[0].name'
          : 'JavaScript arrow function. Example: item => item.value * 2'}
        required={isFieldRequired('transform', 'transform')}
        error={isFieldRequired('transform', 'transform') && !(nodeData.transformExpression || fieldStr('transform') || fieldStr('expression') || fieldStr('template') || nodeData.code)}
      />
    </div>
  );
};

export const LoopConfig: React.FC<NodeConfigContext> = ({ editor, isDark }) => {
  const { fieldStr, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormInput
        label="Iterate Over"
        value={fieldStr('iterateOver')}
        onChange={(v) => updateData('iterateOver', v)}
        placeholder="$input.items"
        isDark={isDark}
        helpText="Expression that resolves to an array to iterate over"
      />
      <FormInput
        label="Item Variable Name"
        value={fieldStr('itemVariable', 'item')}
        onChange={(v) => updateData('itemVariable', v)}
        placeholder="item"
        isDark={isDark}
        helpText="Variable name to reference each item (e.g. $item)"
      />
    </div>
  );
};

export const MergeConfig: React.FC<NodeConfigContext> = ({ editor, isDark }) => {
  const { fieldStr, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormSelect
        label="Merge Strategy"
        value={fieldStr('mergeStrategy', 'array')}
        onChange={(v) => updateData('mergeStrategy', v)}
        options={[
          { value: 'array', label: 'Array - Collect into array' },
          { value: 'object', label: 'Object - Merge key-value pairs' },
          { value: 'concat', label: 'Concat - Concatenate strings' },
        ]}
        isDark={isDark}
        helpText="How to combine inputs from multiple branches"
      />
    </div>
  );
};

export const SwitchConfig: React.FC<NodeConfigContext> = ({ editor }) => {
  const { fieldStr, fieldRaw, updateData } = editor;
  const cases = (fieldRaw('cases') as Array<{ value: string; label: string }> | undefined) ?? [];
  return (
    <div className="space-y-4">
      <FormInput label="Expression" value={fieldStr('expression')}
        onChange={(v) => updateData('expression', v)}
        placeholder="$input.status"
        helpText="Expression to evaluate. Each case matches against this value."
        required error={!fieldStr('expression').trim()} />
      <div>
        <span className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Cases
        </span>
        <div className="space-y-2">
          {cases.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={c.value}
                onChange={(e) => {
                  const updated = [...cases];
                  updated[i] = { ...updated[i], value: e.target.value };
                  updateData('cases', updated);
                }}
                placeholder="Value"
                className="glass-field flex-1 px-2 py-1.5 text-sm focus:outline-none"
              />
              <input
                type="text"
                value={c.label}
                onChange={(e) => {
                  const updated = [...cases];
                  updated[i] = { ...updated[i], label: e.target.value };
                  updateData('cases', updated);
                }}
                placeholder="Label"
                className="glass-field flex-1 px-2 py-1.5 text-sm focus:outline-none"
              />
              <button
                onClick={() => {
                  const updated = cases.filter((_, idx) => idx !== i);
                  updateData('cases', updated);
                }}
                className="p-1 rounded hover:bg-[color-mix(in_srgb,var(--color-error)_20%,transparent)] transition-colors"
                style={{ color: 'var(--color-error)' }}
                title="Remove case"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            const updated = [...cases, { value: `case_${cases.length + 1}`, label: `Case ${cases.length + 1}` }];
            updateData('cases', updated);
          }}
          className="mt-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          + Add Case
        </button>
        <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
          Each case creates an output port. Add a "default" case for unmatched values.
        </p>
      </div>
    </div>
  );
};

export const ParallelConfig: React.FC<NodeConfigContext> = ({ editor }) => {
  const { fieldStr, fieldNum, fieldRaw, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormSelect label="Mode" value={fieldStr('mode', 'split')}
        onChange={(v) => updateData('mode', v)}
        options={[
          { value: 'split', label: 'Split - Fan-out to parallel branches' },
          { value: 'join', label: 'Join - Fan-in and aggregate results' },
        ]}
        helpText="Split distributes input to branches; Join waits for all branches to complete." />
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={fieldRaw('waitForAll') !== false}
            onChange={(e) => updateData('waitForAll', e.target.checked)}
            className="rounded"
          />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Wait for All</span>
        </label>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          When enabled, waits for all branches before continuing. When disabled, continues when any branch completes.
        </p>
      </div>
      <FormInput label="Timeout (ms)" value={fieldNum('timeoutMs', 60000)}
        onChange={(v) => updateData('timeoutMs', Number.parseInt(v) || 60000)} type="number"
        min={1000} max={600000} helpText="Max time to wait for branches to complete." />
    </div>
  );
};

export const WaitConfig: React.FC<NodeConfigContext> = ({ editor, isDark }) => {
  const { fieldNum, fieldStr, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormInput
        label="Duration"
        value={fieldNum('duration', 5)}
        onChange={(v) => updateData('duration', v)}
        type="number"
        isDark={isDark}
        min={1}
        helpText="How long to wait before continuing"
      />
      <FormSelect
        label="Unit"
        value={fieldStr('durationUnit', 'seconds')}
        onChange={(v) => updateData('durationUnit', v)}
        options={[
          { value: 'ms', label: 'Milliseconds' },
          { value: 'seconds', label: 'Seconds' },
          { value: 'minutes', label: 'Minutes' },
          { value: 'hours', label: 'Hours' },
        ]}
        isDark={isDark}
        helpText="Time unit for the wait duration"
      />
    </div>
  );
};

export const WebhookResponseConfig: React.FC<NodeConfigContext> = ({ editor }) => {
  const { fieldNum, fieldStr, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormInput label="Status Code" value={fieldNum('statusCode', 200)}
        onChange={(v) => updateData('statusCode', Number.parseInt(v) || 200)} type="number"
        min={100} max={599} helpText="HTTP status code to return (e.g. 200, 201, 400)." />
      <FormTextarea label="Headers (JSON)" value={fieldStr('headers', '{}')}
        onChange={(v) => updateData('headers', v)} rows={3} monospace
        placeholder='{"Content-Type": "application/json"}'
        helpText="Response headers as JSON object." />
      <FormTextarea label="Body Template" value={fieldStr('bodyTemplate')}
        onChange={(v) => updateData('bodyTemplate', v)} rows={4} monospace
        placeholder='{"result": "{{input}}"}'
        helpText="Response body. Supports {{input}} template variables." />
    </div>
  );
};

export const UserContextConfig: React.FC<NodeConfigContext> = ({ editor }) => {
  const { fieldStr, fieldNum, updateData } = editor;
  return (
    <div className="space-y-4">
      <div className="p-2.5 rounded-lg text-xs" style={{ background: 'color-mix(in srgb, var(--color-info) 8%, transparent)', color: 'var(--color-info)', border: '1px solid color-mix(in srgb, var(--color-info) 20%, transparent)' }}>
        Loads cross-mode user context (chat history, preferences, recent interactions) to enrich downstream nodes.
      </div>
      <FormSelect label="Context Scope" value={fieldStr('contextScope', 'recent')}
        onChange={(v) => updateData('contextScope', v)}
        options={[
          { value: 'recent', label: 'Recent - Last 24h interactions' },
          { value: 'session', label: 'Session - Current session only' },
          { value: 'full', label: 'Full - All available context' },
        ]}
        helpText="How much user context to load." />
      <FormInput label="Max Items" value={fieldNum('maxItems', 10)}
        onChange={(v) => updateData('maxItems', Number.parseInt(v) || 10)} type="number"
        min={1} max={100} helpText="Maximum context items to include." />
    </div>
  );
};

export const TextNoteConfig: React.FC<NodeConfigContext> = ({ editor, isDark }) => {
  const { fieldStr, fieldNum, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormTextarea
        label="Text Content"
        value={fieldStr('text')}
        onChange={(v) => updateData('text', v)}
        rows={6}
        placeholder="Describe what this part of the flow does..."
        isDark={isDark}
        helpText="Markdown-style text that appears on the canvas as an annotation"
      />
      <FormInput
        label="Font Size"
        value={fieldNum('fontSize', 13)}
        onChange={(v) => updateData('fontSize', v)}
        type="number"
        isDark={isDark}
        min={10}
        max={24}
        helpText="Text size in pixels (10-24)"
      />
      <FormInput
        label="Text Color"
        value={fieldStr('textColor', 'var(--color-fg)')}
        onChange={(v) => updateData('textColor', v)}
        isDark={isDark}
        helpText="Hex color for the text (e.g., #c9d1d9)"
      />
      <FormInput
        label="Background Color"
        value={fieldStr('bgColor', 'transparent')}
        onChange={(v) => updateData('bgColor', v)}
        isDark={isDark}
        helpText="Background color. Use 'transparent' for no background."
      />
    </div>
  );
};
