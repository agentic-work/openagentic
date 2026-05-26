import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  PlanApprovalRequestDisplay,
  PlanApprovalResponseDisplay,
  tryRenderPlanApprovalMessage,
  formatTeammateMessageContent,
} from '../PlanApprovalMessage';

afterEach(() => {
  cleanup();
});

describe('PlanApprovalRequestDisplay', () => {
  it('renders plan content and the requesting teammate name', () => {
    const { container } = render(
      <PlanApprovalRequestDisplay
        request={{
          type: 'plan_approval_request',
          from: 'leader',
          planContent: 'Step 1\nStep 2',
          planFilePath: '/tmp/plan.md',
        }}
      />,
    );
    expect(container.querySelector('[data-part="plan_approval_request"]')).not.toBeNull();
    expect(screen.getByText(/Plan Approval Request from leader/)).toBeInTheDocument();
    expect(screen.getByText(/Step 1/)).toBeInTheDocument();
    expect(screen.getByText(/\/tmp\/plan\.md/)).toBeInTheDocument();
  });
});

describe('PlanApprovalResponseDisplay', () => {
  it('renders the approved card with green tone', () => {
    const { container } = render(
      <PlanApprovalResponseDisplay
        response={{ type: 'plan_approval_response', approved: true }}
        senderName="alice"
      />,
    );
    expect(container.querySelector('[data-part="plan_approval_approved"]')).not.toBeNull();
    expect(screen.getByText(/Plan Approved by alice/)).toBeInTheDocument();
  });

  it('renders the rejected card with feedback', () => {
    const { container } = render(
      <PlanApprovalResponseDisplay
        response={{
          type: 'plan_approval_response',
          approved: false,
          feedback: 'add tests',
        }}
        senderName="alice"
      />,
    );
    expect(container.querySelector('[data-part="plan_approval_rejected"]')).not.toBeNull();
    expect(screen.getByText(/Plan Rejected by alice/)).toBeInTheDocument();
    expect(screen.getByText(/add tests/)).toBeInTheDocument();
  });
});

describe('tryRenderPlanApprovalMessage', () => {
  it('returns null for non-plan content', () => {
    expect(tryRenderPlanApprovalMessage('hello', 'alice')).toBeNull();
  });

  it('renders the request display for a plan_approval_request JSON message', () => {
    const json = JSON.stringify({
      type: 'plan_approval_request',
      from: 'leader',
      planContent: 'do thing',
      planFilePath: '/p.md',
    });
    const node = tryRenderPlanApprovalMessage(json, 'leader');
    expect(node).not.toBeNull();
  });
});

describe('formatTeammateMessageContent', () => {
  it('returns a short summary for a plan_approval_request', () => {
    const json = JSON.stringify({
      type: 'plan_approval_request',
      from: 'leader',
      planContent: 'p',
      planFilePath: '/p.md',
    });
    expect(formatTeammateMessageContent(json)).toMatch(/Plan Approval Request/);
  });

  it('passes through unknown content unchanged', () => {
    expect(formatTeammateMessageContent('plain text')).toBe('plain text');
  });
});
