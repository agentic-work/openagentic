import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { SkillsPicker } from '../SkillsPicker';
import { DaemonRPCContext } from '../../../hooks/useDaemonRPC';

afterEach(() => {
  cleanup();
});

interface SkillEntry {
  name: string;
  description?: string;
  source:
    | 'policySettings'
    | 'userSettings'
    | 'projectSettings'
    | 'plugin'
    | 'mcp'
    | 'bundled'
    | 'commands_DEPRECATED';
  path?: string;
  whenToUse?: string;
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

describe('SkillsPicker — render gating', () => {
  it('renders nothing when open=false', () => {
    const call = vi.fn();
    const Wrapper = withContext(call);
    const { container } = render(
      <Wrapper>
        <SkillsPicker open={false} onClose={() => {}} />
      </Wrapper>,
    );
    expect(container.querySelector('[data-testid="skills-picker"]')).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('renders the loading state immediately when open=true', () => {
    let _resolve: ((v: { skills: SkillEntry[] }) => void) | null = null;
    const call = vi.fn(
      () =>
        new Promise<{ skills: SkillEntry[] }>((resolve) => {
          _resolve = resolve;
        }),
    );
    const Wrapper = withContext(call as never);
    const { getByTestId, getByText } = render(
      <Wrapper>
        <SkillsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    expect(getByTestId('skills-picker')).toBeTruthy();
    expect(getByText(/loading skills/i)).toBeTruthy();
    expect(call).toHaveBeenCalledWith('list_skills');
  });
});

describe('SkillsPicker — resolved data', () => {
  it('groups resolved skills by source with section headers', async () => {
    const skills: SkillEntry[] = [
      { name: 'simplify', description: 'Review code', source: 'userSettings' },
      { name: 'frontend-design', description: 'UI design', source: 'plugin' },
      { name: 'init', description: 'Initialize CLAUDE.md', source: 'bundled' },
      { name: 'helper', description: 'Project helper', source: 'projectSettings' },
    ];
    const call = vi.fn().mockResolvedValue({ skills });
    const Wrapper = withContext(call as never);

    const { getByText, getAllByTestId } = render(
      <Wrapper>
        <SkillsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(getByText('simplify')).toBeTruthy();
    });

    // Section headers — labels match SOURCE_LABELS in the picker.
    expect(getByText(/project skills/i)).toBeTruthy();
    expect(getByText(/user skills/i)).toBeTruthy();
    expect(getByText(/plugin skills/i)).toBeTruthy();
    expect(getByText(/built-?in/i)).toBeTruthy();

    // All four skill rows are in the DOM.
    expect(getAllByTestId(/^skill-row-/).length).toBe(4);
  });

  it('highlights the first row by default and moves selection on ArrowDown / ArrowUp', async () => {
    const skills: SkillEntry[] = [
      { name: 'a-skill', source: 'userSettings' },
      { name: 'b-skill', source: 'userSettings' },
      { name: 'c-skill', source: 'userSettings' },
    ];
    const call = vi.fn().mockResolvedValue({ skills });
    const Wrapper = withContext(call as never);

    const { findByTestId, getByTestId } = render(
      <Wrapper>
        <SkillsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    await findByTestId('skill-row-0');

    expect(getByTestId('skill-row-0').getAttribute('data-selected')).toBe('true');
    expect(getByTestId('skill-row-1').getAttribute('data-selected')).toBe('false');

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });
    expect(getByTestId('skill-row-1').getAttribute('data-selected')).toBe('true');
    expect(getByTestId('skill-row-0').getAttribute('data-selected')).toBe('false');

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      // already at last, should clamp at 2
    });
    expect(getByTestId('skill-row-2').getAttribute('data-selected')).toBe('true');

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });
    expect(getByTestId('skill-row-1').getAttribute('data-selected')).toBe('true');
  });

  it('Escape calls onClose', async () => {
    const call = vi.fn().mockResolvedValue({
      skills: [{ name: 'foo', source: 'userSettings' }],
    });
    const onClose = vi.fn();
    const Wrapper = withContext(call as never);

    const { findByText } = render(
      <Wrapper>
        <SkillsPicker open={true} onClose={onClose} />
      </Wrapper>,
    );
    await findByText('foo');

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Enter on a selected row calls onClose (Slice 1: details deferred to later slice)', async () => {
    const call = vi.fn().mockResolvedValue({
      skills: [{ name: 'foo', source: 'userSettings' }],
    });
    const onClose = vi.fn();
    const Wrapper = withContext(call as never);

    const { findByText } = render(
      <Wrapper>
        <SkillsPicker open={true} onClose={onClose} />
      </Wrapper>,
    );
    await findByText('foo');

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SkillsPicker — empty state', () => {
  it('renders empty-state copy when zero skills come back', async () => {
    const call = vi.fn().mockResolvedValue({ skills: [] });
    const Wrapper = withContext(call as never);

    const { findByText } = render(
      <Wrapper>
        <SkillsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText(/no skills found/i);
  });
});

describe('SkillsPicker — error state', () => {
  it('renders the error message and a retry button on rejection', async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error('daemon offline'));
    const Wrapper = withContext(call as never);

    const { findByText, findByRole } = render(
      <Wrapper>
        <SkillsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    await findByText(/daemon offline/i);
    const retry = await findByRole('button', { name: /retry/i });
    expect(retry).toBeTruthy();
  });

  it('clicking retry re-issues list_skills', async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error('daemon offline'))
      .mockResolvedValueOnce({
        skills: [{ name: 'r-skill', source: 'userSettings' }],
      });
    const Wrapper = withContext(call as never);

    const { findByRole, findByText } = render(
      <Wrapper>
        <SkillsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    const retry = await findByRole('button', { name: /retry/i });
    act(() => {
      fireEvent.click(retry);
    });

    await findByText('r-skill');
    expect(call).toHaveBeenCalledTimes(2);
  });
});

describe('SkillsPicker — open transition', () => {
  it('does NOT call list_skills again when open stays true and parent re-renders', async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ skills: [{ name: 'x', source: 'userSettings' }] });
    const Wrapper = withContext(call as never);
    const { rerender, findByText } = render(
      <Wrapper>
        <SkillsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('x');

    rerender(
      <Wrapper>
        <SkillsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('calls list_skills again on the next open=true transition (close → reopen)', async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ skills: [{ name: 'x', source: 'userSettings' }] });
    const Wrapper = withContext(call as never);
    const { rerender, findByText, queryByTestId } = render(
      <Wrapper>
        <SkillsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('x');

    rerender(
      <Wrapper>
        <SkillsPicker open={false} onClose={() => {}} />
      </Wrapper>,
    );
    expect(queryByTestId('skills-picker')).toBeNull();

    rerender(
      <Wrapper>
        <SkillsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('x');
    expect(call).toHaveBeenCalledTimes(2);
  });
});
