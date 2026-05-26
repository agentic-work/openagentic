import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UserBashInputMessage } from '../UserBashInputMessage';

afterEach(() => {
  cleanup();
});

describe('UserBashInputMessage', () => {
  it('renders the bash command with the ! marker', () => {
    render(<UserBashInputMessage text="<bash-input>ls -la</bash-input>" />);
    expect(screen.getByText('!')).toBeInTheDocument();
    expect(screen.getByText('ls -la')).toBeInTheDocument();
  });

  it('returns null without a bash-input tag', () => {
    const { container } = render(<UserBashInputMessage text="not a bash input" />);
    expect(container.firstChild).toBeNull();
  });

  it('emits data-part="user_bash_input"', () => {
    const { container } = render(
      <UserBashInputMessage text="<bash-input>echo hi</bash-input>" />,
    );
    expect(container.querySelector('[data-part="user_bash_input"]')).not.toBeNull();
  });
});
