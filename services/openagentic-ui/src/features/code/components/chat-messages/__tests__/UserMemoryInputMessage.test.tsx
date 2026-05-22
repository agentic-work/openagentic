import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UserMemoryInputMessage } from '../UserMemoryInputMessage';

afterEach(() => {
  cleanup();
});

describe('UserMemoryInputMessage', () => {
  it('renders memory contents with the # marker', () => {
    render(
      <UserMemoryInputMessage text="<user-memory-input>prefer pnpm over npm</user-memory-input>" />,
    );
    expect(screen.getByText('#')).toBeInTheDocument();
    expect(screen.getByText('prefer pnpm over npm')).toBeInTheDocument();
  });

  it('shows a saving acknowledgement', () => {
    const { container } = render(
      <UserMemoryInputMessage text="<user-memory-input>foo</user-memory-input>" />,
    );
    expect(container.querySelector('[data-part="memory_ack"]')).not.toBeNull();
  });

  it('returns null without a user-memory-input tag', () => {
    const { container } = render(<UserMemoryInputMessage text="not a memory" />);
    expect(container.firstChild).toBeNull();
  });
});
