import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UserToolResultMessageDispatch } from '../UserToolResultMessageDispatch';
import {
  CANCEL_MESSAGE,
  REJECT_MESSAGE,
  REJECT_MESSAGE_WITH_REASON_PREFIX,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  PLAN_REJECTION_PREFIX,
  AUTO_MODE_REJECTION_PREFIX,
} from '../../../utils/messageSentinels';

afterEach(() => {
  cleanup();
});

describe('UserToolResultMessageDispatch', () => {
  it('renders the canceled banner when content starts with CANCEL_MESSAGE', () => {
    const { container } = render(
      <UserToolResultMessageDispatch content={CANCEL_MESSAGE} isError={false} />,
    );
    expect(
      container.querySelector('[data-part="tool_result_canceled"]'),
    ).not.toBeNull();
    expect(screen.getByText(/Interrupted by user/i)).toBeInTheDocument();
  });

  it('renders the rejected banner when content starts with REJECT_MESSAGE', () => {
    const { container } = render(
      <UserToolResultMessageDispatch content={REJECT_MESSAGE} isError={false} />,
    );
    expect(
      container.querySelector('[data-part="tool_result_rejected"]'),
    ).not.toBeNull();
    expect(screen.getByText(/Tool use rejected/i)).toBeInTheDocument();
  });

  it('renders the rejected banner for INTERRUPT_MESSAGE_FOR_TOOL_USE', () => {
    const { container } = render(
      <UserToolResultMessageDispatch
        content={INTERRUPT_MESSAGE_FOR_TOOL_USE}
        isError={false}
      />,
    );
    expect(
      container.querySelector('[data-part="tool_result_rejected"]'),
    ).not.toBeNull();
  });

  it('routes is_error=true with REJECT_MESSAGE_WITH_REASON_PREFIX to RejectedToolUse', () => {
    const text = REJECT_MESSAGE_WITH_REASON_PREFIX + 'no thanks';
    const { container } = render(
      <UserToolResultMessageDispatch content={text} isError={true} />,
    );
    expect(
      container.querySelector('[data-part="tool_result_rejected"]'),
    ).not.toBeNull();
  });

  it('routes is_error=true with PLAN_REJECTION_PREFIX to RejectedPlan', () => {
    const planContent = '## Plan\n1. Step one\n2. Step two';
    const text = PLAN_REJECTION_PREFIX + planContent;
    const { container } = render(
      <UserToolResultMessageDispatch content={text} isError={true} />,
    );
    expect(
      container.querySelector('[data-part="tool_result_plan_rejected"]'),
    ).not.toBeNull();
    // Verify the plan body is included.
    expect(screen.getByText(/Step one/)).toBeInTheDocument();
  });

  it('routes is_error=true with classifier denial prefix to a short denial pill', () => {
    const text = AUTO_MODE_REJECTION_PREFIX + 'matched a deny rule';
    const { container } = render(
      <UserToolResultMessageDispatch content={text} isError={true} />,
    );
    expect(
      container.querySelector('[data-part="tool_result_classifier_denial"]'),
    ).not.toBeNull();
  });

  it('routes is_error=true with INTERRUPT_MESSAGE_FOR_TOOL_USE substring to interrupted banner', () => {
    const text = `oops ${INTERRUPT_MESSAGE_FOR_TOOL_USE}`;
    const { container } = render(
      <UserToolResultMessageDispatch content={text} isError={true} />,
    );
    expect(
      container.querySelector('[data-part="tool_result_interrupted"]'),
    ).not.toBeNull();
  });

  it('falls back to generic error rendering for plain is_error=true content', () => {
    const { container } = render(
      <UserToolResultMessageDispatch
        content={'something blew up'}
        isError={true}
      />,
    );
    expect(
      container.querySelector('[data-part="tool_result_generic_error"]'),
    ).not.toBeNull();
    expect(screen.getByText(/something blew up/)).toBeInTheDocument();
  });

  it('returns null when there is no special sentinel and is_error is false', () => {
    const { container } = render(
      <UserToolResultMessageDispatch content="ok" isError={false} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
