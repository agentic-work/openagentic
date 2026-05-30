/**
 * ProviderCard tests — model-count badge.
 *
 * Regression for #362: AIF auto-discovery wrote `gpt-5.3-codex` to
 * `provider_config.models[]`, but the card badge read `model_config` via
 * `countModels(mc)` and showed nothing. Badge must reflect the catalog the
 * admin actually has access to.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const cardProps = {
  isExpanded: false,
  onToggleExpand: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onTest: vi.fn(),
  onToggleEnabled: vi.fn(),
  onPauseResume: vi.fn(),
  onRotateCredentials: vi.fn(),
  onCapabilityToggle: vi.fn(),
  testing: false,
};

describe('ProviderCard model-count badge', () => {
  it('shows "1 model" when provider_config.models has one entry (post-discovery shape)', () => {
    const provider = makeProvider({
      provider_config: { models: [{ id: 'gpt-5.3-codex', displayName: 'gpt-5.3-codex' }] },
      model_config: {},
    });
    render(<ProviderCard provider={provider} {...cardProps} />);
    expect(screen.getByText(/1 model$/)).toBeInTheDocument();
  });

  it('shows "2 models" when provider_config.models has two entries', () => {
    const provider = makeProvider({
      provider_config: {
        models: [
          { id: 'us.anthropic.claude-sonnet-4-6' },
          { id: 'amazon.titan-embed-text-v2:0' },
        ],
      },
      model_config: {},
    });
    render(<ProviderCard provider={provider} {...cardProps} />);
    expect(screen.getByText(/2 models$/)).toBeInTheDocument();
  });

  it('falls back to legacy role-key count when provider_config.models is empty', () => {
    const provider = makeProvider({
      provider_config: {},
      model_config: { chatModel: 'gpt-oss:20b', embeddingModel: 'nomic-embed-text:latest' },
    });
    render(<ProviderCard provider={provider} {...cardProps} />);
    expect(screen.getByText(/2 models$/)).toBeInTheDocument();
  });

  it('omits the badge when neither source has any models', () => {
    const provider = makeProvider({ provider_config: {}, model_config: {} });
    render(<ProviderCard provider={provider} {...cardProps} />);
    expect(screen.queryByText(/\d+ models?$/)).not.toBeInTheDocument();
  });
});
