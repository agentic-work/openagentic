/**
 * ProviderCard.toggle.test.tsx — StateMachineToggle integration tests
 *
 * Verifies that ProviderCard uses StateMachineToggle for enable/disable with
 * full optimistic-UI feedback: idle → optimistic → busy → confirmed | rollback.
 * Regression for "click toggle, nothing happens" bug.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ProviderCard } from '../ProviderCard';
import type { DbProvider } from '../types';

function makeProvider(overrides: Partial<DbProvider> = {}): DbProvider {
  return {
    id: 'aif-1',
    name: 'azure-ai-foundry-prod',
    display_name: 'Azure AI Foundry (awf-aif-20900)',
    provider_type: 'azure-ai-foundry',
    enabled: true,
    priority: 1,
    auth_config: {},
    provider_config: {},
    model_config: {},
    capabilities: { chat: true, tools: true, streaming: true },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

describe('ProviderCard StateMachineToggle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseProps = {
    isExpanded: false,
    onToggleExpand: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onTest: vi.fn(),
    onPauseResume: vi.fn(),
    onRotateCredentials: vi.fn(),
    onCapabilityToggle: vi.fn(),
    testing: false,
  };

  it('calls onCommit(true) when clicking toggle on a disabled provider', async () => {
    const onCommit = vi.fn(async () => true);
    const provider = makeProvider({ enabled: false });
    render(
      <ProviderCard provider={provider} {...baseProps} onCommit={onCommit} />,
    );

    fireEvent.click(screen.getByRole('switch'));

    expect(onCommit).toHaveBeenCalledWith(true);
  });

  it('calls onCommit(false) when clicking toggle on an enabled provider', async () => {
    const onCommit = vi.fn(async () => true);
    const provider = makeProvider({ enabled: true });
    render(
      <ProviderCard provider={provider} {...baseProps} onCommit={onCommit} />,
    );

    fireEvent.click(screen.getByRole('switch'));

    expect(onCommit).toHaveBeenCalledWith(false);
  });

  it('does not call onCommit when provider is env-managed (isEnv=true)', async () => {
    const onCommit = vi.fn(async () => true);
    const provider = makeProvider({ id: 'env-bedrock', enabled: false });
    render(
      <ProviderCard provider={provider} {...baseProps} onCommit={onCommit} />,
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('disabled');

    fireEvent.click(toggle);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('shows optimistic feedback when toggle is clicked', async () => {
    let resolver!: (v: boolean) => void;
    const onCommit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolver = resolve;
        }),
    );
    const provider = makeProvider({ enabled: false });
    render(
      <ProviderCard provider={provider} {...baseProps} onCommit={onCommit} />,
    );

    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);

    // Optimistic flip happens immediately
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    // Resolve the request
    await act(async () => {
      resolver(true);
      await Promise.resolve();
      vi.advanceTimersByTime(100);
    });

    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('rolls back on commit failure', async () => {
    const onCommit = vi.fn(async () => false);
    const provider = makeProvider({ enabled: false });
    render(
      <ProviderCard provider={provider} {...baseProps} onCommit={onCommit} />,
    );

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(100);
    });

    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });
});
