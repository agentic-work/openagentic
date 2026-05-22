import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { AdvisorMessage } from '../AdvisorMessage';

afterEach(() => {
  cleanup();
});

describe('AdvisorMessage', () => {
  it('renders the "Advising" loader for server_tool_use blocks', () => {
    const { container } = render(
      <AdvisorMessage
        block={{
          type: 'server_tool_use',
          id: 'srv-1',
          input: { topic: 'tests' },
        }}
        advisorModel="claude-opus-4-5"
        isUnresolved={true}
        isError={false}
      />,
    );
    expect(container.querySelector('[data-part="advisor_calling"]')).not.toBeNull();
    expect(screen.getByText(/Advising/)).toBeInTheDocument();
  });

  it('renders the success "Advisor has reviewed" line for advisor_result', () => {
    const { container } = render(
      <AdvisorMessage
        block={{
          type: 'tool_result',
          id: 'r-1',
          content: { type: 'advisor_result', text: 'feedback body' },
        }}
        verbose={false}
      />,
    );
    expect(container.querySelector('[data-part="advisor_result"]')).not.toBeNull();
    expect(container.textContent).toMatch(/Advisor has reviewed/);
  });

  it('renders the verbose body when verbose=true', () => {
    render(
      <AdvisorMessage
        block={{
          type: 'tool_result',
          id: 'r-1',
          content: { type: 'advisor_result', text: 'feedback body' },
        }}
        verbose={true}
      />,
    );
    expect(screen.getByText(/feedback body/)).toBeInTheDocument();
  });

  it('renders an error banner for advisor_tool_result_error', () => {
    const { container } = render(
      <AdvisorMessage
        block={{
          type: 'tool_result',
          id: 'r-2',
          content: {
            type: 'advisor_tool_result_error',
            error_code: 'rate_limited',
          },
        }}
      />,
    );
    expect(container.querySelector('[data-part="advisor_error"]')).not.toBeNull();
    expect(screen.getByText(/rate_limited/)).toBeInTheDocument();
  });
});
