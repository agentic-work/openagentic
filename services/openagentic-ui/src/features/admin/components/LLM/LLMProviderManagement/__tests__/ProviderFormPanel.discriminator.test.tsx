import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ProviderFormPanel } from '../ProviderFormPanel';

const noop = () => {};
const renderForm = (overrides: Record<string, unknown> = {}) =>
  render(
    <ProviderFormPanel
      provider={null}
      onSave={vi.fn()}
      onCancel={noop}
      saving={false}
      providerDefaults={{}}
      {...overrides}
    />,
  );

/**
 * The base form does not associate <label> with <input> via htmlFor/id, so
 * RTL's getByLabelText only works for inputs we explicitly tag with
 * aria-label. The discriminator block adds aria-label + data-testid; the
 * legacy "Provider Name" / "Display Name" fields are reached by walking
 * from the visible label text to the sibling input.
 */
function inputForLabelText(labelText: RegExp): HTMLInputElement {
  const labelEl = screen.getByText(labelText, { selector: 'label' });
  const wrapper = labelEl.parentElement!;
  const input = wrapper.querySelector('input');
  if (!input) throw new Error(`No input near label ${labelText}`);
  return input as HTMLInputElement;
}

describe('<ProviderFormPanel/> — discriminator origin fields', () => {
  it('aws-bedrock shows env + account + region required origin inputs', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /AWS Bedrock/i }));
    expect(screen.getByTestId('origin-env')).toBeDefined();
    expect(screen.getByTestId('origin-account')).toBeDefined();
    expect(screen.getByTestId('origin-region')).toBeDefined();
  });

  it('ollama shows env + hostname required origin inputs', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /Ollama/i }));
    expect(screen.getByTestId('origin-env')).toBeDefined();
    expect(screen.getByTestId('origin-hostname')).toBeDefined();
  });

  it('renders live display-name preview that updates as origin fields are filled', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /AWS Bedrock/i }));
    fireEvent.change(screen.getByTestId('origin-env'), { target: { value: 'prod' } });
    fireEvent.change(screen.getByTestId('origin-account'), { target: { value: '1234' } });
    fireEvent.change(screen.getByTestId('origin-region'), { target: { value: 'us-east-1' } });
    expect(screen.getByTestId('display-name-preview').textContent).toMatch(
      /bedrock-prod-1234-us-east-1/,
    );
  });

  it('blocks save and shows inline error when display name is generic', () => {
    const onSave = vi.fn();
    renderForm({ onSave });
    fireEvent.click(screen.getByRole('button', { name: /AWS Bedrock/i }));
    fireEvent.change(inputForLabelText(/^Provider Name$/), {
      target: { value: 'bedrock-prod-1234-us-east-1' },
    });
    fireEvent.change(inputForLabelText(/^Display Name$/), {
      target: { value: 'Bedrock' },
    });
    // Fill origin so we isolate the generic-name path.
    fireEvent.change(screen.getByTestId('origin-env'), { target: { value: 'prod' } });
    fireEvent.change(screen.getByTestId('origin-account'), { target: { value: '1234' } });
    fireEvent.change(screen.getByTestId('origin-region'), { target: { value: 'us-east-1' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/too generic/i)).toBeDefined();
  });

  it('blocks save when origin fields are missing for the selected type', () => {
    const onSave = vi.fn();
    renderForm({ onSave });
    fireEvent.click(screen.getByRole('button', { name: /AWS Bedrock/i }));
    fireEvent.change(inputForLabelText(/^Provider Name$/), {
      target: { value: 'bedrock-prod' },
    });
    fireEvent.change(inputForLabelText(/^Display Name$/), {
      target: { value: 'Bedrock prod' },
    });
    // Leave origin empty.
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/missing required origin fields/i)).toBeDefined();
  });
});
