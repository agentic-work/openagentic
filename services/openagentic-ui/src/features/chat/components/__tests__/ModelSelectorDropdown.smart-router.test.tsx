/**
 * ModelSelectorDropdown — Smart Router visibility contract.
 *
 * User-locked behavior 2026-04-22: Smart Router is a routing CHOICE. When
 * the Registry contains >1 chat models, the user can meaningfully pick
 * between "let the router choose" vs a specific model. With 0 or 1 chat
 * models the routing decision is vacuous — showing Smart Router would be a
 * lie and regresses trust.
 *
 * Contract:
 *   registry chat-models | Smart Router row
 *   --------------------- | -----------------
 *   0                     | hidden (empty state handled elsewhere)
 *   1                     | hidden — the sole model is the only option
 *   2+                    | shown — user picks router OR a specific model
 */
import React, { useRef } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelSelectorDropdown, type ModelOption } from '../ModelSelectorDropdown';

const chatModel = (id: string, provider = 'ollama'): ModelOption => ({
  id,
  name: id,
  type: 'chat',
  provider,
});

function renderDropdown(models: ModelOption[]) {
  function Wrapper() {
    const buttonRef = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={buttonRef}>anchor</button>
        <ModelSelectorDropdown
          selectedModel=""
          availableModels={models}
          onModelChange={() => {}}
          onClose={() => {}}
          buttonRef={buttonRef}
        />
      </>
    );
  }
  return render(<Wrapper />);
}

describe('ModelSelectorDropdown — Smart Router visibility', () => {
  it('hides Smart Router when Registry has zero chat models', () => {
    renderDropdown([]);
    expect(screen.queryByText('Auto-Routing')).toBeNull();
  });

  it('hides Smart Router when Registry has exactly one chat model', () => {
    renderDropdown([chatModel('gpt-oss:20b')]);
    expect(screen.queryByText('Auto-Routing')).toBeNull();
    expect(screen.getByText('gpt-oss:20b')).toBeTruthy();
  });

  it('shows Smart Router when Registry has two or more chat models', () => {
    renderDropdown([
      chatModel('gpt-oss:20b', 'ollama'),
      chatModel('us.anthropic.claude-sonnet-4-6', 'aws-bedrock'),
    ]);
    expect(screen.getByText('Auto-Routing')).toBeTruthy();
  });

  it('ignores non-chat models when counting', () => {
    // One chat + one embedding should STILL hide Smart Router.
    renderDropdown([
      chatModel('gpt-oss:20b'),
      { id: 'nomic-embed-text', name: 'nomic-embed-text', type: 'embedding', provider: 'ollama' } as ModelOption,
    ]);
    expect(screen.queryByText('Auto-Routing')).toBeNull();
  });
});
