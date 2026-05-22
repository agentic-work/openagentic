import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  cleanup,
  fireEvent,
  act,
  waitFor,
  screen,
} from '@testing-library/react';
import '@testing-library/jest-dom';

import { MemoryModal } from '../CommandModals';
import { DaemonRPCContext } from '../../../hooks/useDaemonRPC';

afterEach(() => {
  cleanup();
});

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

describe('MemoryModal — get_memory load', () => {
  it('issues get_memory({scope:"project"}) on mount and shows the response in the textarea', async () => {
    const call = vi.fn(async (method: string) => {
      if (method === 'get_memory') {
        return {
          scope: 'project',
          path: '/workspace/OPENAGENTIC.md',
          content: '# Project notes\nUse pnpm.\n',
          exists: true,
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const Wrapper = withContext(call);
    render(
      <Wrapper>
        <MemoryModal onClose={() => {}} onSend={() => {}} />
      </Wrapper>,
    );

    expect(call).toHaveBeenCalledWith('get_memory', { scope: 'project' });

    const textarea = (await screen.findByTestId(
      'memory-textarea',
    )) as HTMLTextAreaElement;
    expect(textarea.value).toBe('# Project notes\nUse pnpm.\n');
    expect(screen.getByTestId('memory-path')).toHaveTextContent(
      '/workspace/OPENAGENTIC.md',
    );
  });

  it('renders helpful empty-state hint when the memory file does not exist yet', async () => {
    const call = vi.fn(async () => ({
      scope: 'project',
      path: '/workspace/OPENAGENTIC.md',
      content: '',
      exists: false,
    }));
    const Wrapper = withContext(call);
    render(
      <Wrapper>
        <MemoryModal onClose={() => {}} onSend={() => {}} />
      </Wrapper>,
    );

    const textarea = (await screen.findByTestId(
      'memory-textarea',
    )) as HTMLTextAreaElement;
    expect(textarea.placeholder).toMatch(/no memory/i);
    expect(screen.getByTestId('memory-path')).toHaveTextContent(
      'will be created on save',
    );
  });

  it('shows an error banner when get_memory fails', async () => {
    const call = vi.fn(async () => {
      throw new Error('synthetic failure');
    });
    const Wrapper = withContext(call);
    render(
      <Wrapper>
        <MemoryModal onClose={() => {}} onSend={() => {}} />
      </Wrapper>,
    );

    const err = await screen.findByTestId('memory-error');
    expect(err).toHaveTextContent('synthetic failure');
  });
});

describe('MemoryModal — scope tabs', () => {
  it('switching to user scope re-issues get_memory with scope:user', async () => {
    const call = vi.fn(async (_method: string, args: Record<string, unknown>) => ({
      scope: args.scope ?? 'project',
      path:
        args.scope === 'user'
          ? '/home/u/.openagentic/OPENAGENTIC.md'
          : '/workspace/OPENAGENTIC.md',
      content: args.scope === 'user' ? '# User notes' : '# Project notes',
      exists: true,
    }));
    const Wrapper = withContext(call);
    render(
      <Wrapper>
        <MemoryModal onClose={() => {}} onSend={() => {}} />
      </Wrapper>,
    );

    // Wait for project load
    await waitFor(() =>
      expect(
        (screen.getByTestId('memory-textarea') as HTMLTextAreaElement).value,
      ).toBe('# Project notes'),
    );

    const userTab = screen
      .getByTestId('memory-scope-tabs')
      .querySelector('[data-scope="user"]') as HTMLButtonElement;
    expect(userTab).toBeTruthy();
    fireEvent.click(userTab);

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('get_memory', { scope: 'user' }),
    );
    await waitFor(() =>
      expect(
        (screen.getByTestId('memory-textarea') as HTMLTextAreaElement).value,
      ).toBe('# User notes'),
    );
  });
});

describe('MemoryModal — set_memory save', () => {
  it('Save button issues set_memory with the edited content and clears the dirty flag', async () => {
    const call = vi.fn(async (method: string, args: Record<string, unknown>) => {
      if (method === 'get_memory') {
        return {
          scope: 'project',
          path: '/workspace/OPENAGENTIC.md',
          content: '# Original',
          exists: true,
        };
      }
      if (method === 'set_memory') {
        return {
          scope: 'project',
          path: '/workspace/OPENAGENTIC.md',
          bytesWritten: (args.content as string).length,
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const Wrapper = withContext(call);
    render(
      <Wrapper>
        <MemoryModal onClose={() => {}} onSend={() => {}} />
      </Wrapper>,
    );

    const textarea = (await screen.findByTestId(
      'memory-textarea',
    )) as HTMLTextAreaElement;

    // Save button should be disabled while content matches "original".
    const saveBtn = screen.getByTestId('memory-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Edit → button enables.
    fireEvent.change(textarea, {
      target: { value: '# Edited body' },
    });
    expect(saveBtn.disabled).toBe(false);

    // Click Save → set_memory called with the new content.
    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('set_memory', {
        scope: 'project',
        content: '# Edited body',
      }),
    );

    // After the save resolves, the button should disable again
    // (content === original).
    await waitFor(() => expect(saveBtn.disabled).toBe(true));
  });
});
