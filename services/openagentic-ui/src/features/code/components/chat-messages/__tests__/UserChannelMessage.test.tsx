import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UserChannelMessage } from '../UserChannelMessage';

afterEach(() => {
  cleanup();
});

describe('UserChannelMessage', () => {
  it('parses source, user, and body', () => {
    const text =
      '<channel source="slack" user="alice" chat_id="C01">hello world</channel>';
    render(<UserChannelMessage text={text} />);
    expect(screen.getByText(/slack/)).toBeInTheDocument();
    expect(screen.getByText(/alice/)).toBeInTheDocument();
    expect(screen.getByText(/hello world/)).toBeInTheDocument();
  });

  it('shows the source name without user when user attr missing', () => {
    const text = '<channel source="discord">message body</channel>';
    render(<UserChannelMessage text={text} />);
    expect(screen.getByText(/discord/)).toBeInTheDocument();
    expect(screen.getByText(/message body/)).toBeInTheDocument();
  });

  it('truncates the body at 60 chars', () => {
    const long = 'a'.repeat(200);
    const text = `<channel source="x">${long}</channel>`;
    const { container } = render(<UserChannelMessage text={text} />);
    const visible = container.textContent ?? '';
    // 60 char visible body cap, then ellipsis
    expect(visible.length).toBeLessThan(150);
  });

  it('returns null when no channel tag', () => {
    const { container } = render(<UserChannelMessage text="no channel here" />);
    expect(container.firstChild).toBeNull();
  });

  it('strips plugin scope from server name (everything after last colon)', () => {
    const text =
      '<channel source="plugin:slack-channel:slack" user="alice">hi</channel>';
    render(<UserChannelMessage text={text} />);
    // Display name is just the leaf 'slack', not the full plugin string.
    expect(screen.getByText(/^slack/)).toBeInTheDocument();
  });
});
