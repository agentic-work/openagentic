import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  CompactModal,
  HooksModal,
  PlanModal,
  SaveModal,
  SystemPromptModal,
  TaskModal,
  VersionModal,
  StatusModal as CommandStatusModal,
} from '../CommandModals';
import { StatusModal } from '../StatusModal';
import { StatsModal } from '../StatsModal';
import { SessionInfoModal } from '../SessionInfoModal';
import {
  ConfigModal,
  PermissionsModal,
  AgentsModal,
  SkillsModal,
} from '../RichModals';

afterEach(() => {
  cleanup();
});

function dispatchEsc() {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  });
}

describe('CommandModals: document-level Esc closes the modal', () => {
  it('CompactModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(<CompactModal onClose={onClose} onSend={() => {}} />);
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('HooksModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(<HooksModal onClose={onClose} onSend={() => {}} />);
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('PlanModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(
      <PlanModal
        currentMode="default"
        onClose={onClose}
        onSend={() => {}}
        onCycleMode={() => {}}
      />,
    );
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('SaveModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(<SaveModal onClose={onClose} onSend={() => {}} />);
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('SystemPromptModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(<SystemPromptModal onClose={onClose} onSend={() => {}} />);
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('TaskModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(<TaskModal onClose={onClose} onSend={() => {}} />);
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('VersionModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(
      <VersionModal
        version="0.6.7"
        model="gpt-oss:20b"
        permissionMode="default"
        sessionId="abc123def456"
        onClose={onClose}
      />,
    );
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('CommandStatusModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(
      <CommandStatusModal
        model="gpt-oss:20b"
        permissionMode="default"
        sessionId="abc123def456"
        contextTokens={1000}
        totalOutputTokens={500}
        totalCostUsd={0.01}
        lastTurnMs={1500}
        version="0.6.7"
        toolCount={42}
        mcpCount={3}
        onClose={onClose}
      />,
    );
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('RichModals: document-level Esc closes the modal', () => {
  it('ConfigModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(
      <ConfigModal
        model="gpt-oss:20b"
        permissionMode="default"
        cwd="/workspace"
        version="0.6.7"
        toolCount={42}
        mcpServerCount={3}
        agentCount={5}
        pluginCount={2}
        skillCount={10}
        onClose={onClose}
        onSend={() => {}}
      />,
    );
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('PermissionsModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(
      <PermissionsModal
        permissionMode="default"
        tools={['Read', 'Write']}
        onClose={onClose}
        onSend={() => {}}
      />,
    );
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('AgentsModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(
      <AgentsModal
        agents={[]}
        fallbackAgents={[]}
        onClose={onClose}
        onSend={() => {}}
      />,
    );
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('SkillsModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(
      <SkillsModal
        skills={[]}
        fallbackSkills={[]}
        onClose={onClose}
        onSend={() => {}}
      />,
    );
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Other modals: document-level Esc closes the modal', () => {
  it('StatusModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(
      <StatusModal
        model="gpt-oss:20b"
        permissionMode="default"
        sessionId="abc"
        contextTokens={1000}
        contextLimit={200000}
        totalOutputTokens={500}
        totalCostUsd={0.01}
        version="0.6.7"
        cwd="/workspace"
        toolCount={42}
        mcpServers={[]}
        agents={[]}
        plugins={[]}
        skills={[]}
        onClose={onClose}
        onSend={() => {}}
      />,
    );
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('StatsModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(
      <StatsModal
        model="gpt-oss:20b"
        permissionMode="default"
        sessionId="abc"
        contextTokens={1000}
        contextLimit={200000}
        totalOutputTokens={500}
        totalCostUsd={0.01}
        lastTurnMs={1500}
        version="0.6.7"
        toolCount={42}
        mcpCount={3}
        messages={[]}
        onClose={onClose}
      />,
    );
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('SessionInfoModal closes on document Esc', () => {
    const onClose = vi.fn();
    render(
      <SessionInfoModal
        title="Tools"
        items={[]}
        onClose={onClose}
      />,
    );
    dispatchEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
