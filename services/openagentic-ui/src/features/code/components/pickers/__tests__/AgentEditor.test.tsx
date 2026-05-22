import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import { AgentEditor } from '../AgentEditor';
import type { AgentEntry } from '../AgentsPicker';

afterEach(() => {
  cleanup();
});

describe('AgentEditor — create mode', () => {
  it('renders empty fields and a Save button', () => {
    const { getByLabelText, getByRole } = render(
      <AgentEditor mode="create" onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    const nameInput = getByLabelText(/name/i) as HTMLInputElement;
    expect(nameInput.value).toBe('');
    expect(getByRole('button', { name: /save/i })).toBeTruthy();
  });

  it('Save click submits collected fields with create=true', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { getByLabelText, getByRole } = render(
      <AgentEditor mode="create" onSave={onSave} onCancel={vi.fn()} />,
    );

    fireEvent.change(getByLabelText(/name/i), {
      target: { value: 'test-greeter' },
    });
    fireEvent.change(getByLabelText(/description/i), {
      target: { value: 'says hi' },
    });
    fireEvent.change(getByLabelText(/model/i), {
      target: { value: 'gpt-oss:20b' },
    });
    fireEvent.change(getByLabelText(/tools/i), {
      target: { value: 'Bash' },
    });
    fireEvent.change(getByLabelText(/system prompt/i), {
      target: { value: 'You are a friendly greeter' },
    });

    await act(async () => {
      fireEvent.click(getByRole('button', { name: /save/i }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'test-greeter',
        description: 'says hi',
        model: 'gpt-oss:20b',
        tools: ['Bash'],
        systemPrompt: 'You are a friendly greeter',
        scope: expect.stringMatching(/^(user|project)$/),
      }),
      true,
    );
  });

  it('Cancel click fires onCancel', () => {
    const onCancel = vi.fn();
    const { getByRole } = render(
      <AgentEditor mode="create" onSave={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders the rejection message when onSave throws', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('name_taken'));
    const { getByLabelText, getByRole, findByText } = render(
      <AgentEditor mode="create" onSave={onSave} onCancel={vi.fn()} />,
    );
    fireEvent.change(getByLabelText(/name/i), {
      target: { value: 'dup' },
    });
    fireEvent.change(getByLabelText(/system prompt/i), {
      target: { value: 'p' },
    });

    await act(async () => {
      fireEvent.click(getByRole('button', { name: /save/i }));
    });

    await findByText(/name_taken/i);
  });
});

describe('AgentEditor — edit mode', () => {
  const existing: AgentEntry = {
    id: 'reviewer',
    description: 'old desc',
    source: 'userSettings',
    tools: ['Read'],
    model: 'inherit',
    systemPrompt: 'old prompt',
  };

  it('pre-fills fields from the existing agent', () => {
    const { getByLabelText } = render(
      <AgentEditor
        mode="edit"
        existing={existing}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const nameInput = getByLabelText(/name/i) as HTMLInputElement;
    expect(nameInput.value).toBe('reviewer');
    expect((getByLabelText(/description/i) as HTMLInputElement).value).toBe('old desc');
    expect((getByLabelText(/model/i) as HTMLInputElement).value).toBe('inherit');
    expect((getByLabelText(/tools/i) as HTMLInputElement).value).toBe('Read');
    expect((getByLabelText(/system prompt/i) as HTMLTextAreaElement).value).toBe('old prompt');
  });

  it('makes the name field read-only in edit mode', () => {
    const { getByLabelText } = render(
      <AgentEditor
        mode="edit"
        existing={existing}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const nameInput = getByLabelText(/name/i) as HTMLInputElement;
    expect(nameInput.readOnly || nameInput.disabled).toBe(true);
  });

  it('Save submits with create=false and the existing name', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { getByLabelText, getByRole } = render(
      <AgentEditor
        mode="edit"
        existing={existing}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(getByLabelText(/description/i), {
      target: { value: 'says hi enthusiastically' },
    });

    await act(async () => {
      fireEvent.click(getByRole('button', { name: /save/i }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'reviewer',
        description: 'says hi enthusiastically',
      }),
      false,
    );
  });
});
