import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { AttachmentMessage } from '../AttachmentMessage';

afterEach(() => {
  cleanup();
});

describe('AttachmentMessage', () => {
  it('renders a teammate_mailbox with task_assignment entries', () => {
    const json = JSON.stringify({
      type: 'task_assignment',
      taskId: '7',
      subject: 'do the thing',
      assignedBy: 'leader',
    });
    const { container } = render(
      <AttachmentMessage
        attachment={{
          type: 'teammate_mailbox',
          messages: [{ from: 'leader', text: json }],
        }}
      />,
    );
    expect(container.querySelector('[data-part="task_assignment"]')).not.toBeNull();
  });

  it('renders a plan-approval-request mailbox entry', () => {
    const json = JSON.stringify({
      type: 'plan_approval_request',
      from: 'leader',
      planContent: 'do thing',
      planFilePath: '/p.md',
    });
    const { container } = render(
      <AttachmentMessage
        attachment={{
          type: 'teammate_mailbox',
          messages: [{ from: 'leader', text: json }],
        }}
      />,
    );
    expect(container.querySelector('[data-part="plan_approval_request"]')).not.toBeNull();
  });

  it('renders a shutdown_request mailbox entry', () => {
    const json = JSON.stringify({
      type: 'shutdown_request',
      from: 'leader',
      reason: 'cleanup',
    });
    const { container } = render(
      <AttachmentMessage
        attachment={{
          type: 'teammate_mailbox',
          messages: [{ from: 'leader', text: json }],
        }}
      />,
    );
    expect(container.querySelector('[data-part="shutdown_request"]')).not.toBeNull();
  });

  it('returns null for an empty teammate_mailbox', () => {
    const { container } = render(
      <AttachmentMessage attachment={{ type: 'teammate_mailbox', messages: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders an image attachment', () => {
    const { container } = render(
      <AttachmentMessage attachment={{ type: 'image', imageId: 5 }} />,
    );
    expect(container.querySelector('[data-part="user_image"]')).not.toBeNull();
  });

  it('renders a diagnostics attachment with the count and severity', () => {
    const { container } = render(
      <AttachmentMessage
        attachment={{
          type: 'diagnostics',
          diagnostics: [
            { severity: 'error', message: 'TS error', file: 'a.ts' },
            { severity: 'warning', message: 'unused var', file: 'b.ts' },
          ],
        }}
      />,
    );
    expect(container.querySelector('[data-part="diagnostics"]')).not.toBeNull();
    expect(screen.getByText(/TS error/)).toBeInTheDocument();
  });

  it('renders nothing for unknown attachment type', () => {
    const { container } = render(
      <AttachmentMessage attachment={{ type: 'unknown_kind' as any }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
