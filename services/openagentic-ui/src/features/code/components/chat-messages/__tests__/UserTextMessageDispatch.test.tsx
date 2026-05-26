import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UserTextMessageDispatch } from '../UserTextMessageDispatch';

afterEach(() => {
  cleanup();
});

describe('UserTextMessageDispatch', () => {
  it('routes <command-message> to UserCommandMessage', () => {
    const text = '<command-message>cost</command-message><command-args></command-args>';
    const { container } = render(<UserTextMessageDispatch text={text} />);
    expect(container.querySelector('[data-part="user_command"]')).not.toBeNull();
    expect(screen.getByText('/cost')).toBeInTheDocument();
  });

  it('routes <bash-input> to UserBashInputMessage', () => {
    const { container } = render(
      <UserTextMessageDispatch text="<bash-input>ls</bash-input>" />,
    );
    expect(container.querySelector('[data-part="user_bash_input"]')).not.toBeNull();
  });

  it('routes <bash-stdout> to UserBashOutputMessage', () => {
    const { container } = render(
      <UserTextMessageDispatch text="<bash-stdout>file.txt</bash-stdout>" />,
    );
    expect(container.querySelector('[data-part="user_bash_output"]')).not.toBeNull();
  });

  it('routes <bash-stderr> to UserBashOutputMessage', () => {
    const { container } = render(
      <UserTextMessageDispatch text="<bash-stderr>oops</bash-stderr>" />,
    );
    expect(container.querySelector('[data-part="user_bash_output"]')).not.toBeNull();
  });

  it('routes <local-command-stdout> to UserLocalCommandOutputMessage', () => {
    const { container } = render(
      <UserTextMessageDispatch text="<local-command-stdout>output</local-command-stdout>" />,
    );
    expect(container.querySelector('[data-part="local_command_output"]')).not.toBeNull();
  });

  it('routes <user-memory-input> to UserMemoryInputMessage', () => {
    const { container } = render(
      <UserTextMessageDispatch text="<user-memory-input>foo</user-memory-input>" />,
    );
    expect(container.querySelector('[data-part="user_memory_input"]')).not.toBeNull();
  });

  it('routes <task-notification> to UserAgentNotificationMessage', () => {
    const text =
      '<task-notification><summary>done</summary><status>completed</status></task-notification>';
    const { container } = render(<UserTextMessageDispatch text={text} />);
    expect(
      container.querySelector('[data-part="user_agent_notification"]'),
    ).not.toBeNull();
  });

  it('routes <mcp-resource-update> to UserResourceUpdateMessage', () => {
    const text =
      '<mcp-resource-update server="x" uri="file:///a.txt"></mcp-resource-update>';
    const { container } = render(<UserTextMessageDispatch text={text} />);
    expect(
      container.querySelector('[data-part="user_resource_update"]'),
    ).not.toBeNull();
  });

  it('routes <channel> to UserChannelMessage', () => {
    const text = '<channel source="slack" user="alice">hi</channel>';
    const { container } = render(<UserTextMessageDispatch text={text} />);
    expect(container.querySelector('[data-part="user_channel"]')).not.toBeNull();
  });

  it('returns null when text is INTERRUPT_MESSAGE', () => {
    const { container } = render(
      <UserTextMessageDispatch text="[Request interrupted by user]" />,
    );
    // Renders the interrupted indicator data-part
    expect(container.querySelector('[data-part="interrupted"]')).not.toBeNull();
  });

  it('returns null when text is NO_CONTENT_MESSAGE', () => {
    const { container } = render(<UserTextMessageDispatch text="(no content)" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when no tag and not handled (caller falls back to plain text)', () => {
    const { container } = render(
      <UserTextMessageDispatch text="just some plain user text" />,
    );
    // Dispatcher only handles tagged content; plain text returns null so
    // the caller can render the user bubble instead.
    expect(container.firstChild).toBeNull();
  });
});
