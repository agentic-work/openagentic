/**
 * MultiAgentSlotEditor — one row of the multi_agent node's per-slot
 * config: agent picker + task description + per-slot model override.
 *
 * The model override is the meaningful new piece (#63). Empty value
 * means "use the agent's default model from the SOT registry"; a
 * concrete id means override just for this run, threaded through
 * openagentic-proxy via the `model` field in the agent spec.
 *
 * Extracted from NodePropertiesPanel so the slot logic is testable
 * without mounting the entire properties panel + its hook tree.
 */

import React from 'react';

export interface MultiAgentAgentSpec {
  agentId?: string;
  taskDescription?: string;
  /** Per-slot override for the model. Undefined → use agent default. */
  model?: string;
  // Other fields (systemPrompt, tools, …) carried through verbatim by
  // callers; this component only exposes the three editable surfaces.
  [k: string]: unknown;
}

export interface AgentOption {
  id: string;
  display_name: string;
  agent_type: string;
  model?: string;
}

export interface MultiAgentSlotEditorProps {
  index: number;
  spec: MultiAgentAgentSpec;
  agentOptions: AgentOption[];
  availableModels: string[];
  onChange: (patch: Partial<MultiAgentAgentSpec>) => void;
  onRemove: () => void;
}

const cellStyle: React.CSSProperties = {
  width: '100%',
  padding: 6,
  fontSize: 12,
  background: 'var(--color-bg-secondary, #1a1a1a)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border, #2a2a2a)',
  borderRadius: 4,
};

export const MultiAgentSlotEditor: React.FC<MultiAgentSlotEditorProps> = ({
  index,
  spec,
  agentOptions,
  availableModels,
  onChange,
  onRemove,
}) => {
  const selectedAgent = agentOptions.find((a) => a.id === spec.agentId);
  const slotLabel = `Slot ${index + 1}${selectedAgent ? ` · ${selectedAgent.display_name}` : ''}`;
  const agentSelectId = `slot-${index}-agent`;
  const modelSelectId = `slot-${index}-model`;

  return (
    <div
      style={{
        padding: 8,
        border: '1px solid var(--color-border, #2a2a2a)',
        borderRadius: 6,
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {slotLabel}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs"
          style={{ color: 'var(--color-error)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          title="Remove this agent slot"
        >
          Remove
        </button>
      </div>

      <label htmlFor={agentSelectId} className="sr-only">
        Agent
      </label>
      <select
        id={agentSelectId}
        aria-label="Agent"
        value={spec.agentId || ''}
        onChange={(e) => onChange({ agentId: e.target.value })}
        style={{ ...cellStyle, marginBottom: 6 }}
      >
        <option value="">— Pick a registered agent —</option>
        {agentOptions.map((a) => (
          <option key={a.id} value={a.id}>
            {a.display_name} ({a.agent_type})
          </option>
        ))}
      </select>

      <input
        type="text"
        value={(spec.taskDescription as string) || ''}
        onChange={(e) => onChange({ taskDescription: e.target.value })}
        placeholder="What should this agent do? (templated against upstream input)"
        style={{ ...cellStyle, marginBottom: 6 }}
      />

      <label
        htmlFor={modelSelectId}
        className="block text-xs"
        style={{ color: 'var(--color-text-tertiary, #6e7681)', marginBottom: 2 }}
      >
        Model
      </label>
      <select
        id={modelSelectId}
        aria-label="Model"
        value={spec.model || ''}
        onChange={(e) => {
          const v = e.target.value;
          onChange({ model: v ? v : undefined });
        }}
        style={cellStyle}
      >
        <option value="">(agent default)</option>
        {availableModels.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
};
