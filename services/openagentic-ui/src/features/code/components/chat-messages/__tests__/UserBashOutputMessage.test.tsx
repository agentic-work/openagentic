import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UserBashOutputMessage } from '../UserBashOutputMessage';

afterEach(() => {
  cleanup();
});

describe('UserBashOutputMessage', () => {
  it('renders bash stdout content', () => {
    render(<UserBashOutputMessage text="<bash-stdout>file1.txt\nfile2.txt</bash-stdout>" />);
    expect(screen.getByText(/file1\.txt/)).toBeInTheDocument();
    expect(screen.getByText(/file2\.txt/)).toBeInTheDocument();
  });

  it('renders stderr content with error styling', () => {
    const { container } = render(
      <UserBashOutputMessage text="<bash-stderr>command not found</bash-stderr>" />,
    );
    expect(screen.getByText(/command not found/)).toBeInTheDocument();
    expect(container.querySelector('[data-bash-stream="stderr"]')).not.toBeNull();
  });

  it('unwraps persisted-output wrapper inside bash-stdout', () => {
    render(
      <UserBashOutputMessage text='<bash-stdout><persisted-output>/tmp/run.log\nhello</persisted-output></bash-stdout>' />,
    );
    expect(screen.getByText(/\/tmp\/run\.log/)).toBeInTheDocument();
    expect(screen.getByText(/hello/)).toBeInTheDocument();
  });

  it('returns null when no bash output tags are present', () => {
    const { container } = render(<UserBashOutputMessage text="normal text" />);
    expect(container.firstChild).toBeNull();
  });
});
