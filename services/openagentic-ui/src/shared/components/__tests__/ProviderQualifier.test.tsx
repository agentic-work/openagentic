import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ProviderQualifier } from '../ProviderQualifier';

describe('<ProviderQualifier/>', () => {
  it('renders type · displayName · modelId in fixed order on a single line', () => {
    render(
      <ProviderQualifier
        providerType="ollama"
        providerDisplayName="hal"
        modelId="gpt-oss:20b"
      />,
    );
    const text = screen.getByTestId('provider-qualifier').textContent || '';
    expect(text).toMatch(/ollama/);
    expect(text).toMatch(/hal/);
    expect(text).toMatch(/gpt-oss:20b/);
    expect(text.indexOf('ollama')).toBeLessThan(text.indexOf('hal'));
    expect(text.indexOf('hal')).toBeLessThan(text.indexOf('gpt-oss:20b'));
  });

  it('uses · separator between pieces', () => {
    render(
      <ProviderQualifier
        providerType="bedrock"
        providerDisplayName="prod-1234-us-east-1"
        modelId="sonnet-4-6"
      />,
    );
    expect(screen.getByTestId('provider-qualifier').textContent).toContain('·');
  });

  it('falls back to providerType when displayName is empty', () => {
    render(
      <ProviderQualifier
        providerType="anthropic"
        providerDisplayName=""
        modelId="opus-4-7"
      />,
    );
    const text = screen.getByTestId('provider-qualifier').textContent || '';
    expect(text).toMatch(/anthropic.*opus-4-7/);
  });

  it('handles null/undefined displayName the same as empty string', () => {
    render(
      <ProviderQualifier
        providerType="anthropic"
        providerDisplayName={null}
        modelId="opus-4-7"
      />,
    );
    const text = screen.getByTestId('provider-qualifier').textContent || '';
    expect(text).toMatch(/anthropic.*opus-4-7/);
  });

  it('stacked variant renders modelId as the strong primary line', () => {
    render(
      <ProviderQualifier
        providerType="aws-bedrock"
        providerDisplayName="bedrock-prod-1234-us-east-1"
        modelId="claude-sonnet-4-6"
        variant="stacked"
      />,
    );
    const node = screen.getByTestId('provider-qualifier');
    expect(node.querySelector('strong')?.textContent).toBe('claude-sonnet-4-6');
  });
});
