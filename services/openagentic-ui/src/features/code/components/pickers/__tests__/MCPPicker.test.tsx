import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { MCPPicker } from '../MCPPicker';
import { DaemonRPCContext } from '../../../hooks/useDaemonRPC';

afterEach(() => {
  cleanup();
});

interface McpEntry {
  name: string;
  type?: string;
  scope?: string;
  command?: string;
  args?: string[];
  url?: string;
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

describe('MCPPicker — render gating', () => {
  it('renders nothing when open=false', () => {
    const call = vi.fn();
    const Wrapper = withContext(call);
    const { container } = render(
      <Wrapper>
        <MCPPicker open={false} onClose={() => {}} />
      </Wrapper>,
    );
    expect(container.querySelector('[data-testid="mcp-picker"]')).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('renders the loading state immediately when open=true', () => {
    let _resolve: ((v: { mcps: McpEntry[] }) => void) | null = null;
    const call = vi.fn(
      () =>
        new Promise<{ mcps: McpEntry[] }>((resolve) => {
          _resolve = resolve;
        }),
    );
    const Wrapper = withContext(call as never);
    const { getByTestId, getByText } = render(
      <Wrapper>
        <MCPPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    expect(getByTestId('mcp-picker')).toBeTruthy();
    expect(getByText(/loading mcp servers/i)).toBeTruthy();
    expect(call).toHaveBeenCalledWith('list_mcps');
  });
});

describe('MCPPicker — resolved data', () => {
  it('renders one row per configured MCP server, alphabetised', async () => {
    const mcps: McpEntry[] = [
      { name: 'github', type: 'stdio', scope: 'user', command: 'gh-mcp', args: ['--readonly'] },
      { name: 'aws', type: 'http', scope: 'project', url: 'https://aws.example/mcp' },
      { name: 'broken', type: 'disabled', scope: 'local' },
    ];
    const call = vi.fn().mockResolvedValue({ mcps });
    const Wrapper = withContext(call as never);

    const { getByText, getAllByTestId } = render(
      <Wrapper>
        <MCPPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(getByText('aws')).toBeTruthy();
    });

    // Three rows.
    const rows = getAllByTestId(/^mcp-row-/);
    expect(rows.length).toBe(3);

    // Alphabetical order: aws, broken, github.
    expect(rows[0]).toHaveTextContent('aws');
    expect(rows[1]).toHaveTextContent('broken');
    expect(rows[2]).toHaveTextContent('github');

    // Connection details rendered for command-style and url-style.
    expect(getByText(/gh-mcp --readonly/)).toBeTruthy();
    expect(getByText(/https:\/\/aws.example\/mcp/)).toBeTruthy();

    // Type/scope chips.
    expect(getByText('stdio')).toBeTruthy();
    expect(getByText('http')).toBeTruthy();
    expect(getByText('user')).toBeTruthy();
  });

  it('selects first row by default; Arrow keys move selection', async () => {
    const mcps: McpEntry[] = [
      { name: 'a-server', type: 'stdio' },
      { name: 'b-server', type: 'stdio' },
      { name: 'c-server', type: 'stdio' },
    ];
    const call = vi.fn().mockResolvedValue({ mcps });
    const Wrapper = withContext(call as never);

    const { findByTestId, getByTestId } = render(
      <Wrapper>
        <MCPPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    await findByTestId('mcp-row-0');
    expect(getByTestId('mcp-row-0').getAttribute('data-selected')).toBe('true');

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });
    expect(getByTestId('mcp-row-1').getAttribute('data-selected')).toBe('true');
    expect(getByTestId('mcp-row-0').getAttribute('data-selected')).toBe('false');

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });
    expect(getByTestId('mcp-row-0').getAttribute('data-selected')).toBe('true');
  });

  it('Escape calls onClose', async () => {
    const call = vi.fn().mockResolvedValue({
      mcps: [{ name: 'x', type: 'stdio' }],
    });
    const onClose = vi.fn();
    const Wrapper = withContext(call as never);

    const { findByText } = render(
      <Wrapper>
        <MCPPicker open={true} onClose={onClose} />
      </Wrapper>,
    );
    await findByText('x');

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Enter on the selected row calls onClose (details deferred)', async () => {
    const call = vi.fn().mockResolvedValue({
      mcps: [{ name: 'foo', type: 'stdio' }],
    });
    const onClose = vi.fn();
    const Wrapper = withContext(call as never);

    const { findByText } = render(
      <Wrapper>
        <MCPPicker open={true} onClose={onClose} />
      </Wrapper>,
    );
    await findByText('foo');

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('MCPPicker — empty state', () => {
  it('renders empty-state copy when zero MCP servers come back', async () => {
    const call = vi.fn().mockResolvedValue({ mcps: [] });
    const Wrapper = withContext(call as never);

    const { findByText } = render(
      <Wrapper>
        <MCPPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText(/no mcp servers configured/i);
  });
});

describe('MCPPicker — error state', () => {
  it('renders the error message and a retry button on rejection', async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error('daemon offline'));
    const Wrapper = withContext(call as never);

    const { findByText, findByRole } = render(
      <Wrapper>
        <MCPPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    await findByText(/daemon offline/i);
    const retry = await findByRole('button', { name: /retry/i });
    expect(retry).toBeTruthy();
  });

  it('clicking retry re-issues list_mcps', async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ mcps: [{ name: 'r', type: 'stdio' }] });
    const Wrapper = withContext(call as never);

    const { findByRole, findByText } = render(
      <Wrapper>
        <MCPPicker open={true} onClose={() => {}} />
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

describe('MCPPicker — open transition', () => {
  it('does NOT call list_mcps again when open stays true and parent re-renders', async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ mcps: [{ name: 'x', type: 'stdio' }] });
    const Wrapper = withContext(call as never);
    const { rerender, findByText } = render(
      <Wrapper>
        <MCPPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('x');

    rerender(
      <Wrapper>
        <MCPPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('calls list_mcps again on the next open=true transition (close → reopen)', async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ mcps: [{ name: 'x', type: 'stdio' }] });
    const Wrapper = withContext(call as never);
    const { rerender, findByText, queryByTestId } = render(
      <Wrapper>
        <MCPPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('x');

    rerender(
      <Wrapper>
        <MCPPicker open={false} onClose={() => {}} />
      </Wrapper>,
    );
    expect(queryByTestId('mcp-picker')).toBeNull();

    rerender(
      <Wrapper>
        <MCPPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('x');
    expect(call).toHaveBeenCalledTimes(2);
  });
});
