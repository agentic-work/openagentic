import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { ModelPicker } from '../ModelPicker';
import { DaemonRPCContext } from '../../../hooks/useDaemonRPC';

afterEach(() => {
  cleanup();
});

interface ModelEntry {
  id: string;
  name?: string;
  provider?: string;
  currentlyActive: boolean;
  isDefault?: boolean;
}

interface ListModelsResult {
  models: ModelEntry[];
  currentId?: string;
}

/**
 * Build a mock `call` that routes by method name. Each test case wires
 * its own list_models / set_model behavior; everything else throws so a
 * surprise call surfaces immediately.
 */
function makeCall(
  handlers: Partial<Record<string, (args: Record<string, unknown>) => Promise<unknown>>>,
): (method: string, args?: Record<string, unknown>) => Promise<unknown> {
  return async (method: string, args: Record<string, unknown> = {}) => {
    const h = handlers[method];
    if (!h) throw new Error(`unexpected daemon RPC: ${method}`);
    return h(args);
  };
}

function withContext(
  call: (method: string, args?: Record<string, unknown>) => Promise<unknown>,
) {
  return ({ children }: { children: React.ReactNode }) => (
    <DaemonRPCContext.Provider
      value={{
        call: call as <T = unknown>(
          m: string,
          a?: Record<string, unknown>,
        ) => Promise<T>,
        onResponse: () => {},
      }}
    >
      {children}
    </DaemonRPCContext.Provider>
  );
}

describe('ModelPicker — render gating', () => {
  it('renders nothing when open=false', () => {
    const call = vi.fn();
    const Wrapper = withContext(call);
    const { container } = render(
      <Wrapper>
        <ModelPicker open={false} onClose={() => {}} />
      </Wrapper>,
    );
    expect(container.querySelector('[data-testid="model-picker"]')).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('renders the loading state immediately when open=true', () => {
    let _resolve: ((v: ListModelsResult) => void) | null = null;
    const call = vi.fn(
      (method: string) =>
        new Promise<ListModelsResult>((resolve) => {
          if (method !== 'list_models') throw new Error('unexpected method');
          _resolve = resolve;
        }),
    );
    const Wrapper = withContext(call as never);
    const { getByTestId, getByText } = render(
      <Wrapper>
        <ModelPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    expect(getByTestId('model-picker')).toBeTruthy();
    expect(getByText(/loading models/i)).toBeTruthy();
    expect(call).toHaveBeenCalledWith('list_models');
  });
});

describe('ModelPicker — resolved data', () => {
  it('renders one row per model with active glyph for currentlyActive', async () => {
    const models: ModelEntry[] = [
      { id: 'gpt-oss:20b', name: 'gpt-oss-20b', provider: 'OpenAI', currentlyActive: true },
      {
        id: 'us.anthropic.claude-sonnet-4-6',
        name: 'Sonnet',
        provider: 'Anthropic',
        currentlyActive: false,
        isDefault: true,
      },
    ];
    const call = makeCall({
      list_models: async () => ({ models, currentId: 'gpt-oss:20b' }),
    });
    const Wrapper = withContext(call);

    const { findByTestId, getAllByTestId } = render(
      <Wrapper>
        <ModelPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    const row0 = await findByTestId('model-row-0');
    expect(row0.getAttribute('data-active')).toBe('true');
    const row1 = await findByTestId('model-row-1');
    expect(row1.getAttribute('data-active')).toBe('false');

    // Both ids must appear in the DOM.
    expect(row0.textContent).toContain('gpt-oss:20b');
    expect(row1.textContent).toContain('us.anthropic.claude-sonnet-4-6');
    // Provider tags appear too.
    expect(row0.textContent).toContain('OpenAI');
    expect(row1.textContent).toContain('Anthropic');
    expect(getAllByTestId(/^model-row-/).length).toBe(2);
  });

  it('exposes the current model id in the header', async () => {
    const call = makeCall({
      list_models: async () => ({
        models: [
          { id: 'gpt-oss:20b', currentlyActive: true },
          { id: 'us.anthropic.claude-sonnet-4-6', currentlyActive: false },
        ],
        currentId: 'gpt-oss:20b',
      }),
    });
    const Wrapper = withContext(call);
    const { findByTestId } = render(
      <Wrapper>
        <ModelPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    const header = await findByTestId('model-picker-header');
    expect(header.textContent).toContain('gpt-oss:20b');
  });

  it('selection starts at row 0 and ↑/↓ moves it', async () => {
    const call = makeCall({
      list_models: async () => ({
        models: [
          { id: 'a', currentlyActive: true },
          { id: 'b', currentlyActive: false },
          { id: 'c', currentlyActive: false },
        ],
      }),
    });
    const Wrapper = withContext(call);
    const { findByTestId, getByTestId } = render(
      <Wrapper>
        <ModelPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    await findByTestId('model-row-0');
    expect(getByTestId('model-row-0').getAttribute('data-selected')).toBe('true');
    expect(getByTestId('model-row-1').getAttribute('data-selected')).toBe('false');

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });
    expect(getByTestId('model-row-1').getAttribute('data-selected')).toBe('true');
    expect(getByTestId('model-row-0').getAttribute('data-selected')).toBe('false');

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });
    expect(getByTestId('model-row-0').getAttribute('data-selected')).toBe('true');
  });
});

describe('ModelPicker — set_model on activation', () => {
  it('clicking a row calls set_model with that row id', async () => {
    const setModel = vi.fn().mockResolvedValue({ ok: true, id: 'us.anthropic.claude-sonnet-4-6' });
    const call = makeCall({
      list_models: async () => ({
        models: [
          { id: 'gpt-oss:20b', currentlyActive: true },
          { id: 'us.anthropic.claude-sonnet-4-6', currentlyActive: false },
        ],
      }),
      set_model: setModel,
    });
    const Wrapper = withContext(call);
    const { findByTestId } = render(
      <Wrapper>
        <ModelPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    const row1 = await findByTestId('model-row-1');
    act(() => {
      fireEvent.click(row1);
    });
    await waitFor(() => {
      expect(setModel).toHaveBeenCalledWith({ id: 'us.anthropic.claude-sonnet-4-6' });
    });
  });

  it('Enter on the selected row also calls set_model', async () => {
    const setModel = vi.fn().mockResolvedValue({ ok: true, id: 'gpt-oss:20b' });
    const call = makeCall({
      list_models: async () => ({
        models: [
          { id: 'gpt-oss:20b', currentlyActive: false },
          { id: 'us.anthropic.claude-sonnet-4-6', currentlyActive: true },
        ],
      }),
      set_model: setModel,
    });
    const Wrapper = withContext(call);
    const { findByTestId } = render(
      <Wrapper>
        <ModelPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    await findByTestId('model-row-0');
    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    await waitFor(() => {
      expect(setModel).toHaveBeenCalledWith({ id: 'gpt-oss:20b' });
    });
  });

  it('successful set_model closes the picker via onClose', async () => {
    const onClose = vi.fn();
    const call = makeCall({
      list_models: async () => ({
        models: [
          { id: 'gpt-oss:20b', currentlyActive: true },
          { id: 'sonnet', currentlyActive: false },
        ],
      }),
      set_model: async () => ({ ok: true, id: 'sonnet' }),
    });
    const Wrapper = withContext(call);
    const { findByTestId } = render(
      <Wrapper>
        <ModelPicker open={true} onClose={onClose} />
      </Wrapper>,
    );
    const row1 = await findByTestId('model-row-1');
    act(() => {
      fireEvent.click(row1);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('failed set_model surfaces an inline error and keeps the picker open', async () => {
    const onClose = vi.fn();
    const call = makeCall({
      list_models: async () => ({
        models: [
          { id: 'gpt-oss:20b', currentlyActive: true },
          { id: 'ghost-model', currentlyActive: false },
        ],
      }),
      set_model: async () => {
        throw new Error('"ghost-model" not in registry for role=code.');
      },
    });
    const Wrapper = withContext(call);
    const { findByTestId, findByText } = render(
      <Wrapper>
        <ModelPicker open={true} onClose={onClose} />
      </Wrapper>,
    );
    const row1 = await findByTestId('model-row-1');
    act(() => {
      fireEvent.click(row1);
    });
    await findByText(/not in registry/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a "Switching to <id>…" indicator while set_model is in flight', async () => {
    let resolveSet: ((v: { ok: true; id: string }) => void) | null = null;
    const call = makeCall({
      list_models: async () => ({
        models: [
          { id: 'gpt-oss:20b', currentlyActive: true },
          { id: 'sonnet', currentlyActive: false },
        ],
      }),
      set_model: () =>
        new Promise<{ ok: true; id: string }>((res) => {
          resolveSet = res;
        }),
    });
    const Wrapper = withContext(call);
    const { findByTestId, findByText } = render(
      <Wrapper>
        <ModelPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    const row1 = await findByTestId('model-row-1');
    act(() => {
      fireEvent.click(row1);
    });
    await findByText(/switching to sonnet/i);
    // Resolve so the test doesn't leave a dangling promise.
    act(() => {
      resolveSet?.({ ok: true, id: 'sonnet' });
    });
  });
});

describe('ModelPicker — empty state', () => {
  it('renders empty-state copy when zero models come back', async () => {
    const call = makeCall({
      list_models: async () => ({ models: [] }),
    });
    const Wrapper = withContext(call);
    const { findByText } = render(
      <Wrapper>
        <ModelPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText(/no models/i);
  });
});

describe('ModelPicker — error state', () => {
  it('renders the error message and a retry button on rejection', async () => {
    const call = makeCall({
      list_models: async () => {
        throw new Error('registry unreachable');
      },
    });
    const Wrapper = withContext(call);
    const { findByText, findByRole } = render(
      <Wrapper>
        <ModelPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText(/registry unreachable/i);
    const retry = await findByRole('button', { name: /retry/i });
    expect(retry).toBeTruthy();
  });

  it('clicking retry re-issues list_models', async () => {
    let attempts = 0;
    const call = makeCall({
      list_models: async () => {
        attempts++;
        if (attempts === 1) throw new Error('registry unreachable');
        return { models: [{ id: 'gpt-oss:20b', currentlyActive: true }] };
      },
    });
    const Wrapper = withContext(call);
    const { findByRole, findByText } = render(
      <Wrapper>
        <ModelPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    const retry = await findByRole('button', { name: /retry/i });
    act(() => {
      fireEvent.click(retry);
    });
    await findByText('gpt-oss:20b');
    expect(attempts).toBe(2);
  });
});

describe('ModelPicker — Esc closes', () => {
  it('Esc dismisses the picker via onClose', async () => {
    const onClose = vi.fn();
    const call = makeCall({
      list_models: async () => ({
        models: [{ id: 'gpt-oss:20b', currentlyActive: true }],
      }),
    });
    const Wrapper = withContext(call);
    const { findByText } = render(
      <Wrapper>
        <ModelPicker open={true} onClose={onClose} />
      </Wrapper>,
    );
    await findByText('gpt-oss:20b');
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
