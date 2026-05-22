import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { AgentsPicker } from '../AgentsPicker';
import { DaemonRPCContext } from '../../../hooks/useDaemonRPC';

afterEach(() => {
  cleanup();
});

interface AgentEntry {
  id: string;
  description: string;
  source:
    | 'built-in'
    | 'plugin'
    | 'userSettings'
    | 'projectSettings'
    | 'policySettings'
    | 'localSettings'
    | 'flagSettings';
  tools?: string[];
  model?: string;
  plugin?: string;
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

describe('AgentsPicker — render gating', () => {
  it('renders nothing when open=false', () => {
    const call = vi.fn();
    const Wrapper = withContext(call);
    const { container } = render(
      <Wrapper>
        <AgentsPicker open={false} onClose={() => {}} />
      </Wrapper>,
    );
    expect(container.querySelector('[data-testid="agents-picker"]')).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('renders the loading state immediately when open=true', () => {
    let _resolve: ((v: { agents: AgentEntry[] }) => void) | null = null;
    const call = vi.fn(
      () =>
        new Promise<{ agents: AgentEntry[] }>((resolve) => {
          _resolve = resolve;
        }),
    );
    const Wrapper = withContext(call as never);
    const { getByTestId, getByText } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    expect(getByTestId('agents-picker')).toBeTruthy();
    expect(getByText(/loading agents/i)).toBeTruthy();
    expect(call).toHaveBeenCalledWith('list_agents');
  });
});

describe('AgentsPicker — resolved data', () => {
  it('groups resolved agents by source with Built-in / User / Plugin section headers', async () => {
    const agents: AgentEntry[] = [
      {
        id: 'general-purpose',
        description: 'A jack-of-all-trades agent',
        source: 'built-in',
      },
      {
        id: 'Explore',
        description: 'Read-only code exploration',
        source: 'built-in',
      },
      {
        id: 'reviewer',
        description: 'Reviews diffs',
        source: 'userSettings',
        tools: ['Read', 'Grep'],
      },
      {
        id: 'superpowers:code-reviewer',
        description: 'Plugin reviewer',
        source: 'plugin',
        plugin: 'superpowers',
      },
    ];
    const call = vi.fn().mockResolvedValue({ agents });
    const Wrapper = withContext(call as never);

    const { getByText, getAllByTestId } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(getByText('general-purpose')).toBeTruthy();
    });

    // Section headers (case-insensitive match — picker uppercases them).
    expect(getByText(/built-?in/i)).toBeTruthy();
    expect(getByText(/^user$/i)).toBeTruthy();
    expect(getByText(/^plugin$/i)).toBeTruthy();

    // All four agent rows are in the DOM.
    expect(getAllByTestId(/^agent-row-/).length).toBe(4);
  });

  it('shows the agent count in the header (e.g. "4 available")', async () => {
    const agents: AgentEntry[] = [
      { id: 'a', description: 'A', source: 'built-in' },
      { id: 'b', description: 'B', source: 'userSettings' },
    ];
    const call = vi.fn().mockResolvedValue({ agents });
    const Wrapper = withContext(call as never);

    const { findByText } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText(/2 available/i);
  });

  it('selects the first row by default and moves selection on ArrowDown / ArrowUp', async () => {
    const agents: AgentEntry[] = [
      { id: 'a-agent', description: 'A', source: 'userSettings' },
      { id: 'b-agent', description: 'B', source: 'userSettings' },
      { id: 'c-agent', description: 'C', source: 'userSettings' },
    ];
    const call = vi.fn().mockResolvedValue({ agents });
    const Wrapper = withContext(call as never);

    const { findByTestId, getByTestId } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    await findByTestId('agent-row-0');

    expect(getByTestId('agent-row-0').getAttribute('data-selected')).toBe('true');
    expect(getByTestId('agent-row-1').getAttribute('data-selected')).toBe('false');

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });
    expect(getByTestId('agent-row-1').getAttribute('data-selected')).toBe('true');
    expect(getByTestId('agent-row-0').getAttribute('data-selected')).toBe('false');

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      // already at last, should clamp at 2
    });
    expect(getByTestId('agent-row-2').getAttribute('data-selected')).toBe('true');

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });
    expect(getByTestId('agent-row-1').getAttribute('data-selected')).toBe('true');
  });

  it('Escape calls onClose', async () => {
    const call = vi.fn().mockResolvedValue({
      agents: [{ id: 'foo', description: 'Foo', source: 'built-in' }],
    });
    const onClose = vi.fn();
    const Wrapper = withContext(call as never);

    const { findByText } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={onClose} />
      </Wrapper>,
    );
    await findByText('foo');

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Enter on a selected row opens the detail pane (does NOT close)', async () => {
    const call = vi.fn().mockResolvedValue({
      agents: [
        {
          id: 'foo',
          description: 'Foo description',
          source: 'built-in',
        },
      ],
    });
    const onClose = vi.fn();
    const Wrapper = withContext(call as never);

    const { findByText } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={onClose} />
      </Wrapper>,
    );
    await findByText('foo');

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    // Detail pane shows the description text — picker did NOT close.
    await findByText(/foo description/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders the description, model and tools chip when present', async () => {
    const agents: AgentEntry[] = [
      {
        id: 'reviewer',
        description: 'Reviews staged diffs',
        source: 'userSettings',
        tools: ['Read', 'Grep'],
        model: 'inherit',
      },
    ];
    const call = vi.fn().mockResolvedValue({ agents });
    const Wrapper = withContext(call as never);

    const { findByText } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    await findByText('reviewer');
    // Description shown under name
    await findByText(/reviews staged diffs/i);
    // Chips for model + tool count
    await findByText(/inherit/i);
    await findByText(/2 tools|tools: 2/i);
  });
});

describe('AgentsPicker — empty state', () => {
  it('renders empty-state copy when zero agents come back', async () => {
    const call = vi.fn().mockResolvedValue({ agents: [] });
    const Wrapper = withContext(call as never);

    const { findByText } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText(/no agents found/i);
  });
});

describe('AgentsPicker — error state', () => {
  it('renders the error message and a retry button on rejection', async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error('agents dir unreadable'));
    const Wrapper = withContext(call as never);

    const { findByText, findByRole } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    await findByText(/agents dir unreadable/i);
    const retry = await findByRole('button', { name: /retry/i });
    expect(retry).toBeTruthy();
  });

  it('clicking retry re-issues list_agents', async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        agents: [{ id: 'r', description: 'R', source: 'built-in' }],
      });
    const Wrapper = withContext(call as never);

    const { findByRole, findByText } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    const retry = await findByRole('button', { name: /retry/i });
    act(() => {
      fireEvent.click(retry);
    });

    await findByText('r');
    expect(call).toHaveBeenCalledTimes(2);
  });
});

describe('AgentsPicker — detail / edit / create / delete flow', () => {
  const userAgent: AgentEntry = {
    id: 'reviewer',
    description: 'Reviews diffs',
    source: 'userSettings',
    tools: ['Read', 'Grep'],
    model: 'inherit',
  };
  const builtinAgent: AgentEntry = {
    id: 'Explore',
    description: 'Read-only exploration',
    source: 'built-in',
  };

  it('renders a "+ New Agent" button at the top of the picker', async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ agents: [userAgent] });
    const Wrapper = withContext(call as never);

    const { findByRole } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByRole('button', { name: /new agent/i });
  });

  it('Enter on a selected built-in agent opens the detail pane (no edit/delete)', async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ agents: [builtinAgent] });
    const Wrapper = withContext(call as never);

    const { findByText, queryByRole } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('Explore');

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    // Detail-pane copy: description shows under header
    await findByText(/read-only exploration/i);
    // No edit / delete buttons for built-ins
    expect(queryByRole('button', { name: /^edit$/i })).toBeNull();
    expect(queryByRole('button', { name: /^delete$/i })).toBeNull();
  });

  it('Enter on a custom agent opens detail pane WITH edit/delete buttons', async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ agents: [userAgent] });
    const Wrapper = withContext(call as never);

    const { findByText, findByRole } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('reviewer');

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    await findByRole('button', { name: /^edit$/i });
    await findByRole('button', { name: /^delete$/i });
  });

  it('clicking + New Agent opens the editor in create mode', async () => {
    const call = vi.fn().mockResolvedValue({ agents: [userAgent] });
    const Wrapper = withContext(call as never);

    const { findByRole, findByLabelText } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    const newBtn = await findByRole('button', { name: /new agent/i });
    act(() => {
      fireEvent.click(newBtn);
    });
    // Editor: name input is empty + editable
    const nameInput = (await findByLabelText(/name/i)) as HTMLInputElement;
    expect(nameInput.value).toBe('');
    expect(nameInput.readOnly).toBe(false);
  });

  it('Save in create-mode editor calls create_agent and refreshes the list', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ agents: [] }) // initial list
      .mockResolvedValueOnce({ ok: true, path: '/agents/test-greeter.md' }) // create_agent
      .mockResolvedValueOnce({
        agents: [
          {
            id: 'test-greeter',
            description: 'says hi',
            source: 'userSettings',
            systemPrompt: 'You are a greeter',
          } as AgentEntry,
        ],
      }); // refresh
    const Wrapper = withContext(call as never);

    const { findByRole, findByLabelText, findByText } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    const newBtn = await findByRole('button', { name: /new agent/i });
    act(() => {
      fireEvent.click(newBtn);
    });

    fireEvent.change(await findByLabelText(/name/i), {
      target: { value: 'test-greeter' },
    });
    fireEvent.change(await findByLabelText(/description/i), {
      target: { value: 'says hi' },
    });
    fireEvent.change(await findByLabelText(/system prompt/i), {
      target: { value: 'You are a greeter' },
    });

    const save = await findByRole('button', { name: /save/i });
    await act(async () => {
      fireEvent.click(save);
    });

    // RPC called with the right method + args
    await waitFor(() => {
      expect(
        call.mock.calls.some(
          ([m, a]) =>
            m === 'create_agent' &&
            a &&
            (a as Record<string, unknown>).name === 'test-greeter',
        ),
      ).toBe(true);
    });
    // List refreshed → row visible
    await findByText('test-greeter');
  });

  it('Delete on a custom agent calls delete_agent and refreshes the list', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ agents: [userAgent] }) // initial
      .mockResolvedValueOnce({ ok: true }) // delete_agent
      .mockResolvedValueOnce({ agents: [] }); // refresh
    const Wrapper = withContext(call as never);

    const { findByText, findByRole } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('reviewer');

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    const del = await findByRole('button', { name: /^delete$/i });
    act(() => {
      fireEvent.click(del);
    });
    // Confirmation dialog
    const confirm = await findByRole('button', { name: /confirm/i });
    await act(async () => {
      fireEvent.click(confirm);
    });

    await waitFor(() => {
      expect(
        call.mock.calls.some(
          ([m, a]) =>
            m === 'delete_agent' &&
            (a as Record<string, unknown>).name === 'reviewer',
        ),
      ).toBe(true);
    });
    // After delete, list refreshes — empty state shown
    await findByText(/no agents found/i);
  });
});

describe('AgentsPicker — open transition', () => {
  it('does NOT call list_agents again when open stays true and parent re-renders', async () => {
    const call = vi
      .fn()
      .mockResolvedValue({
        agents: [{ id: 'x', description: 'X', source: 'built-in' }],
      });
    const Wrapper = withContext(call as never);
    const { rerender, findByText } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('x');

    rerender(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('calls list_agents again on the next open=true transition (close → reopen)', async () => {
    const call = vi
      .fn()
      .mockResolvedValue({
        agents: [{ id: 'x', description: 'X', source: 'built-in' }],
      });
    const Wrapper = withContext(call as never);
    const { rerender, findByText, queryByTestId } = render(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('x');

    rerender(
      <Wrapper>
        <AgentsPicker open={false} onClose={() => {}} />
      </Wrapper>,
    );
    expect(queryByTestId('agents-picker')).toBeNull();

    rerender(
      <Wrapper>
        <AgentsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('x');
    expect(call).toHaveBeenCalledTimes(2);
  });
});
