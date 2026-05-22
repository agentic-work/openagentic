import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  TaskAssignmentDisplay,
  tryRenderTaskAssignmentMessage,
  getTaskAssignmentSummary,
} from '../TaskAssignmentMessage';

afterEach(() => {
  cleanup();
});

describe('TaskAssignmentDisplay', () => {
  it('renders task id, subject, and description', () => {
    const { container } = render(
      <TaskAssignmentDisplay
        assignment={{
          type: 'task_assignment',
          taskId: '42',
          subject: 'Wire feature X',
          assignedBy: 'leader',
          description: 'do the thing',
        }}
      />,
    );
    expect(container.querySelector('[data-part="task_assignment"]')).not.toBeNull();
    expect(screen.getByText(/Task #42 assigned by leader/)).toBeInTheDocument();
    expect(screen.getByText('Wire feature X')).toBeInTheDocument();
    expect(screen.getByText('do the thing')).toBeInTheDocument();
  });
});

describe('tryRenderTaskAssignmentMessage', () => {
  it('returns a node for valid task_assignment JSON', () => {
    const json = JSON.stringify({
      type: 'task_assignment',
      taskId: '7',
      subject: 'do the thing',
      assignedBy: 'leader',
    });
    expect(tryRenderTaskAssignmentMessage(json)).not.toBeNull();
  });

  it('returns null for unrelated content', () => {
    expect(tryRenderTaskAssignmentMessage('plain text')).toBeNull();
  });
});

describe('getTaskAssignmentSummary', () => {
  it('returns a short summary for valid content', () => {
    const json = JSON.stringify({
      type: 'task_assignment',
      taskId: '5',
      subject: 'thing',
      assignedBy: 'a',
    });
    expect(getTaskAssignmentSummary(json)).toMatch(/Task Assigned/);
  });
});
