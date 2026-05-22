import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UserCommandMessage } from '../UserCommandMessage';

afterEach(() => {
  cleanup();
});

describe('UserCommandMessage', () => {
  it('renders a slash command with arguments', () => {
    const text = '<command-message>cost</command-message><command-args></command-args>';
    render(<UserCommandMessage text={text} />);
    expect(screen.getByText('/cost')).toBeInTheDocument();
  });

  it('renders a slash command with arguments included', () => {
    const text =
      '<command-message>compact</command-message><command-args>focus on tests</command-args>';
    render(<UserCommandMessage text={text} />);
    expect(screen.getByText('/compact focus on tests')).toBeInTheDocument();
  });

  it('renders a Skill invocation when skill-format=true', () => {
    const text =
      '<command-message>review</command-message><command-args></command-args><skill-format>true</skill-format>';
    render(<UserCommandMessage text={text} />);
    expect(screen.getByText('Skill(review)')).toBeInTheDocument();
  });

  it('returns null when no command-message tag is present', () => {
    const { container } = render(<UserCommandMessage text="just a normal user message" />);
    expect(container.firstChild).toBeNull();
  });

  it('emits data-part="user_command" for the wrapper', () => {
    const text = '<command-message>help</command-message><command-args></command-args>';
    const { container } = render(<UserCommandMessage text={text} />);
    expect(container.querySelector('[data-part="user_command"]')).not.toBeNull();
  });
});
