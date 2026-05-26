import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UserResourceUpdateMessage } from '../UserResourceUpdateMessage';

afterEach(() => {
  cleanup();
});

describe('UserResourceUpdateMessage', () => {
  it('parses an mcp-resource-update with reason', () => {
    const text =
      '<mcp-resource-update server="github" uri="file:///repo/CHANGELOG.md"><reason>file changed</reason></mcp-resource-update>';
    render(<UserResourceUpdateMessage text={text} />);
    expect(screen.getByText(/github/)).toBeInTheDocument();
    expect(screen.getByText(/CHANGELOG\.md/)).toBeInTheDocument();
    expect(screen.getByText(/file changed/)).toBeInTheDocument();
  });

  it('parses a polling-update with tool name', () => {
    const text =
      '<mcp-polling-update type="tool" server="slack" tool="get_messages"><reason>new replies</reason></mcp-polling-update>';
    render(<UserResourceUpdateMessage text={text} />);
    expect(screen.getByText(/slack/)).toBeInTheDocument();
    expect(screen.getByText(/get_messages/)).toBeInTheDocument();
    expect(screen.getByText(/new replies/)).toBeInTheDocument();
  });

  it('renders multiple updates', () => {
    const text =
      '<mcp-resource-update server="github" uri="file:///a.txt"></mcp-resource-update>' +
      '<mcp-resource-update server="github" uri="file:///b.txt"></mcp-resource-update>';
    const { container } = render(<UserResourceUpdateMessage text={text} />);
    expect(container.querySelectorAll('[data-update]').length).toBe(2);
  });

  it('returns null when no update tags present', () => {
    const { container } = render(<UserResourceUpdateMessage text="nothing to see" />);
    expect(container.firstChild).toBeNull();
  });
});
