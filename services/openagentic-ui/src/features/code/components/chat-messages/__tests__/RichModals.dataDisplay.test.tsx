import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  ConfigModal,
  PermissionsModal,
} from '../RichModals';
import { VersionModal } from '../CommandModals';

afterEach(() => {
  cleanup();
});

describe('PermissionsModal — populated tool list', () => {
  it('renders the count of available tools next to the "Available Tools" header when tools is populated', () => {
    const tools = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'];
    render(
      <PermissionsModal
        permissionMode="default"
        tools={tools}
        onClose={() => {}}
        onSend={() => {}}
      />,
    );
    // The count appears in the section header — find by combining header
    // text "Available Tools" with a sibling number node.
    expect(screen.getByText(/Available Tools/i)).toBeInTheDocument();
    expect(screen.getByText(String(tools.length))).toBeInTheDocument();
    // And each tool name should appear at least once.
    for (const t of tools) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it('renders 0 in the count when tools list is empty (regression guard for the "blank" state)', () => {
    render(
      <PermissionsModal
        permissionMode="default"
        tools={[]}
        onClose={() => {}}
        onSend={() => {}}
      />,
    );
    expect(screen.getByText(/Available Tools/i)).toBeInTheDocument();
    // The empty count is "0" in the header — make sure that path renders.
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

describe('ConfigModal — populated model + version', () => {
  // 2026-05-02 TUI parity refactor: ConfigModal now has Status / Config /
  // Usage tabs (was a single read-only Session/Resources/Actions block).
  // Status tab shows version + model + cwd; Usage tab shows resource
  // counts. Test must walk both tabs to assert the full payload.
  it('renders the model id and openagentic version verbatim when populated', () => {
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
        onClose={() => {}}
        onSend={() => {}}
      />,
    );
    // Status tab is the default — version / model / cwd render here.
    expect(screen.getByText('gpt-oss:20b')).toBeInTheDocument();
    expect(screen.getByText('0.6.7')).toBeInTheDocument();
    expect(screen.getByText('/workspace')).toBeInTheDocument();
    // Switch to Usage tab to assert the resource counts.
    fireEvent.click(screen.getByRole('button', { name: /^usage$/i }));
    expect(screen.getByText('42 available')).toBeInTheDocument();
  });
});

describe('VersionModal — populated version + model', () => {
  it('renders neither "(unknown)" nor "(default)" when version + model are populated', () => {
    render(
      <VersionModal
        version="0.6.7"
        model="gpt-oss:20b"
        permissionMode="default"
        sessionId="abc123def456"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('0.6.7')).toBeInTheDocument();
    expect(screen.getByText('gpt-oss:20b')).toBeInTheDocument();
    expect(screen.queryByText('(unknown)')).toBeNull();
    expect(screen.queryByText('(default)')).toBeNull();
  });

  it('falls back to "(unknown)" / "(default)" when fields are empty (existing behavior)', () => {
    render(
      <VersionModal
        version=""
        model=""
        permissionMode="default"
        sessionId=""
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('(unknown)')).toBeInTheDocument();
    expect(screen.getByText('(default)')).toBeInTheDocument();
  });
});
