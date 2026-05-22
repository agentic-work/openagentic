import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { AgentDetailPane } from '../AgentDetailPane';
import type { AgentEntry } from '../AgentsPicker';

afterEach(() => {
  cleanup();
});

const builtin: AgentEntry = {
  id: 'Explore',
  description: 'Read-only exploration',
  source: 'built-in',
  systemPrompt: 'You are an explore agent.',
};

const userAgent: AgentEntry = {
  id: 'reviewer',
  description: 'Reviews diffs',
  source: 'userSettings',
  tools: ['Read', 'Grep'],
  model: 'inherit',
  systemPrompt: 'You review code.',
};

const pluginAgent: AgentEntry = {
  id: 'sp:reviewer',
  description: 'plugin reviewer',
  source: 'plugin',
  plugin: 'superpowers',
  systemPrompt: 'plugin prompt',
};

describe('AgentDetailPane — render', () => {
  it('renders the agent name as the header', () => {
    const { getByText } = render(
      <AgentDetailPane
        agent={userAgent}
        onBack={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(getByText('reviewer')).toBeTruthy();
  });

  it('renders a scope badge with the source label', () => {
    const { getByText } = render(
      <AgentDetailPane agent={userAgent} onBack={() => {}} onEdit={() => {}} onDelete={() => {}} />,
    );
    expect(getByText(/^user$/i)).toBeTruthy();
  });

  it('renders the description', () => {
    const { getByText } = render(
      <AgentDetailPane agent={userAgent} onBack={() => {}} onEdit={() => {}} onDelete={() => {}} />,
    );
    expect(getByText(/reviews diffs/i)).toBeTruthy();
  });

  it('renders model and tool chips', () => {
    const { getByText } = render(
      <AgentDetailPane agent={userAgent} onBack={() => {}} onEdit={() => {}} onDelete={() => {}} />,
    );
    expect(getByText(/inherit/i)).toBeTruthy();
    expect(getByText(/^read$/i)).toBeTruthy();
    expect(getByText(/^grep$/i)).toBeTruthy();
  });

  it('renders the system prompt', () => {
    const { getByText } = render(
      <AgentDetailPane agent={userAgent} onBack={() => {}} onEdit={() => {}} onDelete={() => {}} />,
    );
    expect(getByText(/you review code/i)).toBeTruthy();
  });
});

describe('AgentDetailPane — buttons', () => {
  it('built-in: hides Edit and Delete buttons', () => {
    const { queryByRole } = render(
      <AgentDetailPane agent={builtin} onBack={() => {}} onEdit={() => {}} onDelete={() => {}} />,
    );
    expect(queryByRole('button', { name: /edit/i })).toBeNull();
    expect(queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('plugin: hides Edit and Delete buttons', () => {
    const { queryByRole } = render(
      <AgentDetailPane agent={pluginAgent} onBack={() => {}} onEdit={() => {}} onDelete={() => {}} />,
    );
    expect(queryByRole('button', { name: /edit/i })).toBeNull();
    expect(queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('custom (user): shows Edit and Delete buttons', () => {
    const { getByRole } = render(
      <AgentDetailPane agent={userAgent} onBack={() => {}} onEdit={() => {}} onDelete={() => {}} />,
    );
    expect(getByRole('button', { name: /edit/i })).toBeTruthy();
    expect(getByRole('button', { name: /delete/i })).toBeTruthy();
  });

  it('Edit click fires onEdit', () => {
    const onEdit = vi.fn();
    const { getByRole } = render(
      <AgentDetailPane agent={userAgent} onBack={() => {}} onEdit={onEdit} onDelete={() => {}} />,
    );
    fireEvent.click(getByRole('button', { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('Delete click fires onDelete', () => {
    const onDelete = vi.fn();
    const { getByRole } = render(
      <AgentDetailPane agent={userAgent} onBack={() => {}} onEdit={() => {}} onDelete={onDelete} />,
    );
    fireEvent.click(getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('Back click fires onBack', () => {
    const onBack = vi.fn();
    const { getByRole } = render(
      <AgentDetailPane agent={userAgent} onBack={onBack} onEdit={() => {}} onDelete={() => {}} />,
    );
    fireEvent.click(getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
