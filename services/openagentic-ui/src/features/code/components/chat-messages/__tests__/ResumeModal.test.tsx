import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';

import { ResumeModal } from '../CommandModals';
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

describe('ResumeModal — list_sessions load', () => {
  it('shows loading state, then renders sessions returned by list_sessions', async () => {
    const call = vi.fn(async (method: string) => {
      expect(method).toBe('list_sessions');
      return {
        sessions: [
          {
            sessionId: 'sess-aaa-111',
            summary: 'Refactor model picker keyboard nav',
            lastModified: Date.now() - 30 * 60 * 1000,
            cwd: '/workspace',
          },
          {
            sessionId: 'sess-bbb-222',
            summary: 'Investigate OOM in hal pod',
            lastModified: Date.now() - 2 * 60 * 60 * 1000,
            cwd: '/workspace',
          },
        ],
      };
    });
    const Wrapper = withContext(call);
    render(
      <Wrapper>
        <ResumeModal onClose={() => {}} onSend={() => {}} />
      </Wrapper>,
    );

    expect(screen.getByTestId('resume-loading')).toBeInTheDocument();

    await waitFor(() => screen.getByTestId('resume-list'));

    expect(screen.getByTestId('resume-row-sess-aaa-111')).toHaveTextContent(
      'Refactor model picker keyboard nav',
    );
    expect(screen.getByTestId('resume-row-sess-bbb-222')).toHaveTextContent(
      'Investigate OOM in hal pod',
    );
  });

  it('shows empty-state copy when list_sessions returns []', async () => {
    const call = vi.fn(async () => ({ sessions: [] }));
    const Wrapper = withContext(call);
    render(
      <Wrapper>
        <ResumeModal onClose={() => {}} onSend={() => {}} />
      </Wrapper>,
    );

    const empty = await screen.findByTestId('resume-empty');
    expect(empty).toHaveTextContent(/no sessions/i);
    expect(empty).toHaveTextContent(/save/i);
  });

  it('shows error message when list_sessions throws', async () => {
    const call = vi.fn(async () => {
      throw new Error('synthetic listSessions failure');
    });
    const Wrapper = withContext(call);
    render(
      <Wrapper>
        <ResumeModal onClose={() => {}} onSend={() => {}} />
      </Wrapper>,
    );

    const err = await screen.findByTestId('resume-error');
    expect(err).toHaveTextContent('synthetic listSessions failure');
  });

  it('clicking a session row sends "/resume <sessionId>" and closes', async () => {
    const onClose = vi.fn();
    const onSend = vi.fn();
    const call = vi.fn(async () => ({
      sessions: [
        {
          sessionId: 'sess-xyz',
          summary: 'Greet world',
          lastModified: Date.now(),
        },
      ],
    }));
    const Wrapper = withContext(call);
    render(
      <Wrapper>
        <ResumeModal onClose={onClose} onSend={onSend} />
      </Wrapper>,
    );

    const row = await screen.findByTestId('resume-row-sess-xyz');
    fireEvent.click(row);

    expect(onSend).toHaveBeenCalledWith('/resume sess-xyz');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
