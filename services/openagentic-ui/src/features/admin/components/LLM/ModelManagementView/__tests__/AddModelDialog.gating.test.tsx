/**
 * Task 3 test — AddModelDialog's provider dropdown must distinguish
 * explicit-add providers (Bedrock / Vertex / OpenAI / Anthropic /
 * Azure OpenAI) from auto-sync providers (AIF / Ollama).
 *
 * Auto-sync providers are still listed (so admin sees the full picture)
 * but are disabled with a tooltip explaining they're auto-synced. This
 * is the UI-side enforcement of the durable rule in
 * feedback_registry_explicit_add.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { AddModelDialog } from '../AddModelDialog';
import type { DbProvider } from '../constants';

// Stub network + sync emitter so the dialog can render without side effects.
vi.mock('@/utils/api', () => ({
  apiRequest: vi.fn(async () => new Response(JSON.stringify({ modelDetails: [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })),
  apiEndpoint: (p: string) => p,
}));
vi.mock('@/utils/modelSync', () => ({
  emitModelsChanged: vi.fn(),
}));

const mkProvider = (type: string, name = `p-${type}`): DbProvider => ({
  id: `id-${type}`,
  name,
  display_name: `${type} display`,
  provider_type: type,
  enabled: true,
  priority: 1,
  model_config: {},
  provider_config: {},
  capabilities: {},
});

describe('AddModelDialog provider gating (task #311 / task 3)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('auto-sync providers (AIF / Ollama) appear as disabled options with the tooltip explanation', () => {
    const providers: DbProvider[] = [
      mkProvider('aws-bedrock'),
      mkProvider('ollama'),
      mkProvider('azure-ai-foundry'),
    ];

    render(
      <AddModelDialog
        isOpen={true}
        onClose={() => {}}
        providers={providers}
        existingModels={[]}
        onModelAdded={() => {}}
      />
    );

    // Provider <select> should be rendered
    const selects = screen.getAllByRole('combobox');
    const providerSelect = selects[0] as HTMLSelectElement;
    expect(providerSelect).toBeDefined();

    const options = Array.from(providerSelect.querySelectorAll('option'));

    // Assert ollama + AIF options are present but disabled
    const ollama = options.find(o => o.value.includes('ollama'));
    const aif = options.find(o => o.value.includes('azure-ai-foundry'));
    const bedrock = options.find(o => o.value.includes('aws-bedrock'));

    expect(ollama).toBeDefined();
    expect(ollama!.disabled).toBe(true);
    expect(ollama!.textContent).toMatch(/auto-synced/i);

    expect(aif).toBeDefined();
    expect(aif!.disabled).toBe(true);
    expect(aif!.textContent).toMatch(/auto-synced/i);

    // Bedrock is explicit-add → selectable
    expect(bedrock).toBeDefined();
    expect(bedrock!.disabled).toBe(false);
  });

  it('explicit-add providers (Bedrock / Vertex / OpenAI / Anthropic / Azure OpenAI) remain selectable', () => {
    const providers: DbProvider[] = [
      mkProvider('aws-bedrock'),
      mkProvider('vertex-ai'),
      mkProvider('openai'),
      mkProvider('anthropic'),
      mkProvider('azure-openai'),
    ];

    render(
      <AddModelDialog
        isOpen={true}
        onClose={() => {}}
        providers={providers}
        existingModels={[]}
        onModelAdded={() => {}}
      />
    );

    const selects = screen.getAllByRole('combobox');
    const providerSelect = selects[0] as HTMLSelectElement;
    const options = Array.from(providerSelect.querySelectorAll('option'));
    for (const o of options) {
      expect(o.disabled).toBe(false);
    }
    expect(options.length).toBeGreaterThanOrEqual(5);
  });

  it('default selection is the first explicit-add provider (not the first AIF/Ollama)', () => {
    // Ollama is listed first but should NOT be auto-selected — the dialog
    // should skip over it and land on the first explicit-add provider.
    const providers: DbProvider[] = [
      mkProvider('ollama', 'ollama-first'),
      mkProvider('aws-bedrock', 'bedrock-second'),
      mkProvider('vertex-ai', 'vertex-third'),
    ];

    render(
      <AddModelDialog
        isOpen={true}
        onClose={() => {}}
        providers={providers}
        existingModels={[]}
        onModelAdded={() => {}}
      />
    );

    const selects = screen.getAllByRole('combobox');
    const providerSelect = selects[0] as HTMLSelectElement;
    // The auto-selected value must be an explicit-add provider, not ollama.
    expect(providerSelect.value).not.toBe('ollama-first');
  });
});
