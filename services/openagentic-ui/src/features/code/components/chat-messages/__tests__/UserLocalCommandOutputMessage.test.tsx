import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UserLocalCommandOutputMessage } from '../UserLocalCommandOutputMessage';

afterEach(() => {
  cleanup();
});

describe('UserLocalCommandOutputMessage', () => {
  it('renders local-command-stdout body', () => {
    render(
      <UserLocalCommandOutputMessage text="<local-command-stdout>hello world</local-command-stdout>" />,
    );
    expect(screen.getByText(/hello world/)).toBeInTheDocument();
  });

  it('renders both stdout and stderr', () => {
    render(
      <UserLocalCommandOutputMessage text="<local-command-stdout>ok</local-command-stdout><local-command-stderr>warn</local-command-stderr>" />,
    );
    expect(screen.getByText(/ok/)).toBeInTheDocument();
    expect(screen.getByText(/warn/)).toBeInTheDocument();
  });

  it('renders the no-content placeholder when both stdout and stderr are empty', () => {
    const { container } = render(<UserLocalCommandOutputMessage text="" />);
    expect(container.querySelector('[data-part="local_command_output"]')).not.toBeNull();
    // Placeholder shown
    expect(container.textContent).toMatch(/\(no content\)/);
  });
});
