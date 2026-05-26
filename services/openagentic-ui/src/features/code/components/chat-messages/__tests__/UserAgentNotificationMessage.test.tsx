import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UserAgentNotificationMessage } from '../UserAgentNotificationMessage';

afterEach(() => {
  cleanup();
});

describe('UserAgentNotificationMessage', () => {
  it('renders summary with completed status (success color)', () => {
    const text =
      '<task-notification><summary>3 tasks completed</summary><status>completed</status></task-notification>';
    const { container } = render(<UserAgentNotificationMessage text={text} />);
    expect(screen.getByText('3 tasks completed')).toBeInTheDocument();
    const wrapper = container.querySelector('[data-part="user_agent_notification"]');
    expect(wrapper?.getAttribute('data-status')).toBe('completed');
  });

  it('renders failed status', () => {
    const text =
      '<task-notification><summary>build failed</summary><status>failed</status></task-notification>';
    const { container } = render(<UserAgentNotificationMessage text={text} />);
    expect(container.querySelector('[data-status="failed"]')).not.toBeNull();
  });

  it('returns null when no summary', () => {
    const text = '<task-notification></task-notification>';
    const { container } = render(<UserAgentNotificationMessage text={text} />);
    expect(container.firstChild).toBeNull();
  });
});
