import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { MessageRow } from '../MessageTree';
import type { ChatMessage } from '../../../types/uiState';

afterEach(() => {
  cleanup();
});

function userMsg(text: string): ChatMessage {
  return {
    id: 'u-1',
    role: 'user',
    text,
    createdAt: 0,
  };
}

describe('MessageRow user dispatch wiring', () => {
  it('routes <command-message> to UserCommandMessage', () => {
    const m = userMsg('<command-message>cost</command-message><command-args></command-args>');
    const { container } = render(<MessageRow message={m} />);
    expect(container.querySelector('[data-part="user_command"]')).not.toBeNull();
  });

  it('routes <bash-input> to UserBashInputMessage', () => {
    const m = userMsg('<bash-input>ls -la</bash-input>');
    const { container } = render(<MessageRow message={m} />);
    expect(container.querySelector('[data-part="user_bash_input"]')).not.toBeNull();
  });

  it('routes <bash-stdout> to UserBashOutputMessage', () => {
    const m = userMsg('<bash-stdout>files</bash-stdout>');
    const { container } = render(<MessageRow message={m} />);
    expect(container.querySelector('[data-part="user_bash_output"]')).not.toBeNull();
  });

  it('routes <local-command-stdout> to UserLocalCommandOutputMessage', () => {
    const m = userMsg('<local-command-stdout>output</local-command-stdout>');
    const { container } = render(<MessageRow message={m} />);
    expect(
      container.querySelector('[data-part="local_command_output"]'),
    ).not.toBeNull();
  });

  it('routes <user-memory-input> to UserMemoryInputMessage', () => {
    const m = userMsg('<user-memory-input>foo</user-memory-input>');
    const { container } = render(<MessageRow message={m} />);
    expect(
      container.querySelector('[data-part="user_memory_input"]'),
    ).not.toBeNull();
  });

  it('routes <task-notification> to UserAgentNotificationMessage', () => {
    const m = userMsg(
      '<task-notification><summary>done</summary><status>completed</status></task-notification>',
    );
    const { container } = render(<MessageRow message={m} />);
    expect(
      container.querySelector('[data-part="user_agent_notification"]'),
    ).not.toBeNull();
  });

  it('routes <mcp-resource-update> to UserResourceUpdateMessage', () => {
    const m = userMsg(
      '<mcp-resource-update server="x" uri="file:///a.txt"></mcp-resource-update>',
    );
    const { container } = render(<MessageRow message={m} />);
    expect(
      container.querySelector('[data-part="user_resource_update"]'),
    ).not.toBeNull();
  });

  it('routes <channel> to UserChannelMessage', () => {
    const m = userMsg('<channel source="slack" user="a">hi</channel>');
    const { container } = render(<MessageRow message={m} />);
    expect(container.querySelector('[data-part="user_channel"]')).not.toBeNull();
  });

  it('renders interrupt sentinel as the interrupted indicator', () => {
    const m = userMsg('[Request interrupted by user]');
    const { container } = render(<MessageRow message={m} />);
    expect(container.querySelector('[data-part="interrupted"]')).not.toBeNull();
  });

  it('falls through to UserRow for plain user text', () => {
    const m = userMsg('hello world without any tags');
    const { container } = render(<MessageRow message={m} />);
    // No dispatch tag means none of the data-part="user_*" attributes fire.
    expect(container.querySelector('[data-part="user_command"]')).toBeNull();
    expect(container.querySelector('[data-part="user_bash_input"]')).toBeNull();
    // The plain user bubble text is still visible.
    expect(container.textContent).toContain('hello world without any tags');
  });

  // C.2 P1 — user prompt rendering matches mocks/codemode-mockup.html.
  // Mock structure: <div class="msg-user">
  //   <span class="prompt-marker">❯</span>
  //   <span class="content">…</span>
  // </div>
  // Mapped to scoped CSS: .cm-msg-user, .cm-prompt-marker, .cm-prompt-content.
  describe('UserRow mock parity (P1)', () => {
    it('renders user text with prompt marker and content classes', () => {
      const m = userMsg('Create a file called hello.txt');
      const { container } = render(<MessageRow message={m} />);
      const row = container.querySelector('[data-part="user-prompt"]');
      expect(row).not.toBeNull();
      expect(row?.classList.contains('cm-msg-user')).toBe(true);
      const marker = row?.querySelector('.cm-prompt-marker');
      expect(marker?.textContent).toBe('❯');
      const content = row?.querySelector('.cm-prompt-content');
      expect(content?.textContent).toBe('Create a file called hello.txt');
    });

    it('does NOT render a teal/blue rounded pill bubble', () => {
      const m = userMsg('plain text');
      const { container } = render(<MessageRow message={m} />);
      const row = container.querySelector('[data-part="user-prompt"]');
      expect(row).not.toBeNull();
      const inlineStyle = row?.getAttribute('style') ?? '';
      // Pre-fix UserRow set border-radius: 14, background: color-mix accent.
      // Mock-styled UserRow has neither.
      expect(inlineStyle).not.toMatch(/border-radius:\s*14/i);
      expect(inlineStyle).not.toMatch(/color-mix.*accent/i);
    });
  });
});
