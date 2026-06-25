/**
 * MultiAgentSlotEditor — extracted from the inline renderMultiAgentConfig
 * block so per-slot config (agent picker, task description, model
 * override) is testable in isolation.
 *
 * What this component must do:
 *   - render the Slot N + agent display name header
 *   - let the user pick an agentId from `agentOptions`
 *   - let the user enter a taskDescription
 *   - render a Model select; default value is `(agent default)` (empty
 *     string), and changing it calls onChange with `{ model: <id> }`
 *   - call onRemove when the Remove button is clicked
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MultiAgentSlotEditor } from '../MultiAgentSlotEditor';

const agentOptions = [
  { id: 'a1', display_name: 'Researcher', agent_type: 'research', model: 'gpt-4' },
  { id: 'a2', display_name: 'Writer', agent_type: 'writing', model: 'claude-sonnet' },
];

const availableModels = ['gpt-4', 'claude-sonnet', 'claude-haiku', 'gemini-2.5-flash'];

describe('MultiAgentSlotEditor', () => {
  it('renders the slot header with agent display name', () => {
    render(
      <MultiAgentSlotEditor
        index={0}
        spec={{ agentId: 'a1', taskDescription: 'Find sources' }}
        agentOptions={agentOptions}
        availableModels={availableModels}
        onChange={() => {}}
        onRemove={() => {}}
      />,
    );
    // Header reads "Slot 1 · Researcher" — match the combined string
    // exactly so we don't collide with the agent picker's <option>.
    expect(screen.getByText(/Slot 1 · Researcher/)).toBeTruthy();
  });

  it('calls onChange with new agentId when picker changes', () => {
    const onChange = vi.fn();
    render(
      <MultiAgentSlotEditor
        index={0}
        spec={{ agentId: 'a1' }}
        agentOptions={agentOptions}
        availableModels={availableModels}
        onChange={onChange}
        onRemove={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/agent/i), { target: { value: 'a2' } });
    expect(onChange).toHaveBeenCalledWith({ agentId: 'a2' });
  });

  it('renders model select with "(agent default)" option + each available model', () => {
    render(
      <MultiAgentSlotEditor
        index={0}
        spec={{ agentId: 'a1' }}
        agentOptions={agentOptions}
        availableModels={availableModels}
        onChange={() => {}}
        onRemove={() => {}}
      />,
    );
    const modelSelect = screen.getByLabelText(/model/i) as HTMLSelectElement;
    const optionTexts = Array.from(modelSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionTexts).toContain('(agent default)');
    expect(optionTexts).toContain('gpt-4');
    expect(optionTexts).toContain('claude-sonnet');
    expect(optionTexts).toContain('gemini-2.5-flash');
  });

  it('calls onChange with new model when picker changes', () => {
    const onChange = vi.fn();
    render(
      <MultiAgentSlotEditor
        index={1}
        spec={{ agentId: 'a1' }}
        agentOptions={agentOptions}
        availableModels={availableModels}
        onChange={onChange}
        onRemove={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'claude-haiku' } });
    expect(onChange).toHaveBeenCalledWith({ model: 'claude-haiku' });
  });

  it('clears the model override when "(agent default)" is picked', () => {
    const onChange = vi.fn();
    render(
      <MultiAgentSlotEditor
        index={0}
        spec={{ agentId: 'a1', model: 'gpt-4' }}
        agentOptions={agentOptions}
        availableModels={availableModels}
        onChange={onChange}
        onRemove={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/model/i), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ model: undefined });
  });

  it('calls onRemove when Remove is clicked', () => {
    const onRemove = vi.fn();
    render(
      <MultiAgentSlotEditor
        index={0}
        spec={{ agentId: 'a1' }}
        agentOptions={agentOptions}
        availableModels={availableModels}
        onChange={() => {}}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalled();
  });
});
