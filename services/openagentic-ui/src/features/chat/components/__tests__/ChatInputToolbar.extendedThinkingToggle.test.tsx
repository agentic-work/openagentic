/**
 * Z.ET.2 — ExtendedThinkingToggleButton tests (2026-05-19).
 *
 * Confirms:
 * - Renders null when model does NOT support thinking (no button in DOM)
 * - Renders button when model DOES support thinking
 * - Button initial state: data-enabled="true" (ON by default)
 * - Clicking toggles the store and flips data-enabled
 * - aria-pressed reflects enabled state
 *
 * RED: these tests should FAIL before the component is created.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { useExtendedThinkingStore } from '@/stores/useExtendedThinkingStore';
import { useModelStore } from '@/stores/useModelStore';

// We import the component under test
import { ExtendedThinkingToggleButton } from '@/features/chat/components/ExtendedThinkingToggleButton';

// Minimal ModelInfo shape for tests (with thinking field)
const thinkingModel = {
  id: 'us.anthropic.claude-sonnet-4-5',
  name: 'Claude Sonnet 4.5',
  thinking: true,
  type: 'chat' as const,
};

const nonThinkingModel = {
  id: 'gpt-4o-mini',
  name: 'GPT-4o Mini',
  thinking: false,
  type: 'chat' as const,
};

const unknownThinkingModel = {
  id: 'some-new-model',
  name: 'Some New Model',
  // thinking field absent — should treat as false
  type: 'chat' as const,
};

describe('ExtendedThinkingToggleButton — visibility gate', () => {
  beforeEach(() => {
    useExtendedThinkingStore.setState({ enabled: true });
    useModelStore.setState({ selectedModel: thinkingModel.id, availableModels: [thinkingModel as any] });
  });

  it('renders null when selected model does NOT support thinking', () => {
    useModelStore.setState({ selectedModel: nonThinkingModel.id, availableModels: [nonThinkingModel as any] });
    const { container } = render(<ExtendedThinkingToggleButton />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when model has no thinking field (falsy default)', () => {
    useModelStore.setState({ selectedModel: unknownThinkingModel.id, availableModels: [unknownThinkingModel as any] });
    const { container } = render(<ExtendedThinkingToggleButton />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when no model is selected (auto-routing)', () => {
    useModelStore.setState({ selectedModel: '', availableModels: [thinkingModel as any] });
    const { container } = render(<ExtendedThinkingToggleButton />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a button when selected model DOES support thinking', () => {
    render(<ExtendedThinkingToggleButton />);
    expect(screen.getByTestId('chat-extended-thinking-toggle')).toBeInTheDocument();
  });
});

describe('ExtendedThinkingToggleButton — toggle behaviour', () => {
  beforeEach(() => {
    useExtendedThinkingStore.setState({ enabled: true });
    useModelStore.setState({ selectedModel: thinkingModel.id, availableModels: [thinkingModel as any] });
  });

  it('initial data-enabled is "true" when store is enabled', () => {
    render(<ExtendedThinkingToggleButton />);
    expect(screen.getByTestId('chat-extended-thinking-toggle')).toHaveAttribute('data-enabled', 'true');
  });

  it('initial aria-pressed is "true" when store is enabled', () => {
    render(<ExtendedThinkingToggleButton />);
    expect(screen.getByTestId('chat-extended-thinking-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking flips data-enabled to "false"', () => {
    render(<ExtendedThinkingToggleButton />);
    const btn = screen.getByTestId('chat-extended-thinking-toggle');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('data-enabled', 'false');
  });

  it('clicking twice returns data-enabled to "true"', () => {
    render(<ExtendedThinkingToggleButton />);
    const btn = screen.getByTestId('chat-extended-thinking-toggle');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('data-enabled', 'true');
  });

  it('data-enabled="false" when store is initially disabled', () => {
    useExtendedThinkingStore.setState({ enabled: false });
    render(<ExtendedThinkingToggleButton />);
    expect(screen.getByTestId('chat-extended-thinking-toggle')).toHaveAttribute('data-enabled', 'false');
  });

  it('disabled prop prevents click', () => {
    render(<ExtendedThinkingToggleButton disabled />);
    const btn = screen.getByTestId('chat-extended-thinking-toggle');
    expect(btn).toBeDisabled();
  });
});
