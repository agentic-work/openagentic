import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  AgentsModal,
  ConfigModal,
  PermissionsModal,
  SkillsModal,
} from '../RichModals';
import { MemoryModal } from '../CommandModals';
import { DaemonRPCContext } from '../../../hooks/useDaemonRPC';

afterEach(() => {
  cleanup();
});

// ── /agents ─────────────────────────────────────────────────────────
//
// TUI capture: tui-agents.txt — section headers "Plugin agents" and
// "Built-in agents (always available)" with a "Create new agent" first
// row + "6 agents" count.
//
// Codemode AgentsModal currently labels groups as "Built-in" / "Plugin"
// (TUI uses "Plugin agents" / "Built-in agents"). Bring the labels into
// parity. The dedicated AgentsPicker (live route) has its own test
// suite — this targets the AgentsModal which lives on the openModal
// fallback path.

describe('TUI parity — /agents AgentsModal sections + create row', () => {
  const agents = [
    { name: 'general-purpose', description: 'jack-of-all-trades', source: 'built-in', model: 'inherit' },
    { name: 'openagentic-guide', description: 'help', source: 'built-in', model: 'inherit' },
    { name: 'statusline-setup', description: 'sl', source: 'built-in', model: 'sonnet' },
    { name: 'agent-sdk-verifier-py', description: 'verify py', source: 'plugin', plugin: 'agent-sdk-dev', model: 'sonnet' },
    { name: 'agent-sdk-verifier-ts', description: 'verify ts', source: 'plugin', plugin: 'agent-sdk-dev', model: 'sonnet' },
    { name: 'code-reviewer', description: 'reviews', source: 'plugin', plugin: 'superpowers', model: 'inherit' },
  ];

  it('renders a "Plugin agents" section header (matches TUI capture)', () => {
    render(
      <AgentsModal
        agents={agents as never}
        fallbackAgents={[]}
        onClose={() => {}}
        onSend={() => {}}
      />,
    );
    expect(screen.getByText(/plugin agents/i)).toBeInTheDocument();
  });

  it('renders a "Built-in agents" section header (matches TUI capture)', () => {
    render(
      <AgentsModal
        agents={agents as never}
        fallbackAgents={[]}
        onClose={() => {}}
        onSend={() => {}}
      />,
    );
    expect(screen.getByText(/built-in agents/i)).toBeInTheDocument();
  });

  it('renders a "Create new agent" first row (matches TUI capture)', () => {
    render(
      <AgentsModal
        agents={agents as never}
        fallbackAgents={[]}
        onClose={() => {}}
        onSend={() => {}}
      />,
    );
    expect(screen.getByText(/create new agent/i)).toBeInTheDocument();
  });

  it('total count matches the agent list size (TUI shows "6 agents")', () => {
    render(
      <AgentsModal
        agents={agents as never}
        fallbackAgents={[]}
        onClose={() => {}}
        onSend={() => {}}
      />,
    );
    // Match the TUI's "<N> agents" phrasing rather than "<N> available".
    expect(screen.getByText(/6 agents/i)).toBeInTheDocument();
  });
});

// ── /config ─────────────────────────────────────────────────────────
//
// TUI capture: tui-config.txt — three tabs (Status / Config / Usage),
// search box, toggle list of settings (Auto-compact, Show tips,
// Theme, etc). Codemode currently shows read-only Session/Resources/
// Actions. Bring tabs and toggle rows in line.

describe('TUI parity — /config ConfigModal tabs + toggles', () => {
  const baseProps = {
    model: 'gpt-oss:20b',
    permissionMode: 'default',
    cwd: '/workspace',
    version: '0.7.0',
    toolCount: 56,
    mcpServerCount: 2,
    agentCount: 6,
    pluginCount: 3,
    skillCount: 22,
    onClose: () => {},
    onSend: () => {},
  };

  it('renders Status / Config / Usage tabs (matches TUI capture)', () => {
    render(<ConfigModal {...baseProps} />);
    expect(screen.getByRole('button', { name: /^status$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^config$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^usage$/i })).toBeInTheDocument();
  });

  it('renders an Auto-compact toggle row (matches TUI capture)', () => {
    render(<ConfigModal {...baseProps} />);
    // Switch to Config tab if needed (default may be Status)
    const configTab = screen.getByRole('button', { name: /^config$/i });
    fireEvent.click(configTab);
    expect(screen.getByText(/auto-compact/i)).toBeInTheDocument();
  });

  it('renders a Show tips toggle row (matches TUI capture)', () => {
    render(<ConfigModal {...baseProps} />);
    const configTab = screen.getByRole('button', { name: /^config$/i });
    fireEvent.click(configTab);
    expect(screen.getByText(/show tips/i)).toBeInTheDocument();
  });

  it('renders a Theme setting (matches TUI capture)', () => {
    render(<ConfigModal {...baseProps} />);
    const configTab = screen.getByRole('button', { name: /^config$/i });
    fireEvent.click(configTab);
    expect(screen.getByText(/^theme$/i)).toBeInTheDocument();
  });
});

// ── /memory ─────────────────────────────────────────────────────────
//
// TUI capture: tui-memory.txt — picker shows "Auto-memory: on" and
// "Auto-dream: off · never" toggles plus 3 actions (User memory,
// Project memory, Open auto-memory folder).

function withRpc(call: (m: string, a?: Record<string, unknown>) => Promise<unknown>) {
  return ({ children }: { children: React.ReactNode }) => (
    <DaemonRPCContext.Provider
      value={{
        call: call as <T = unknown>(m: string, a?: Record<string, unknown>) => Promise<T>,
        onResponse: () => {},
      }}
    >
      {children}
    </DaemonRPCContext.Provider>
  );
}

describe('TUI parity — /memory MemoryModal toggles', () => {
  it('renders an Auto-memory toggle (matches TUI capture)', async () => {
    const call = vi.fn().mockResolvedValue({
      scope: 'project',
      path: '/workspace/OPENAGENTIC.md',
      content: '',
      exists: false,
    });
    const Wrapper = withRpc(call);
    render(
      <Wrapper>
        <MemoryModal onClose={() => {}} onSend={() => {}} />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/auto-memory/i)).toBeInTheDocument();
    });
  });

  it('renders an Auto-dream toggle (matches TUI capture)', async () => {
    const call = vi.fn().mockResolvedValue({
      scope: 'project',
      path: '/workspace/OPENAGENTIC.md',
      content: '',
      exists: false,
    });
    const Wrapper = withRpc(call);
    render(
      <Wrapper>
        <MemoryModal onClose={() => {}} onSend={() => {}} />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/auto-dream/i)).toBeInTheDocument();
    });
  });
});

// ── /permissions ────────────────────────────────────────────────────
//
// TUI capture: tui-permissions.txt — tabs `Recently denied / Allow /
// Ask / Deny / Workspace`, search box, and "Add a new rule…" first
// row. Codemode currently shows mode switcher + tool grid. Bring tabs
// and add-rule row in line.

describe('TUI parity — /permissions PermissionsModal tabs + add rule', () => {
  const tools = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'];

  it('renders Allow / Ask / Deny tabs (matches TUI capture)', () => {
    render(
      <PermissionsModal
        permissionMode="default"
        tools={tools}
        onClose={() => {}}
        onSend={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /^allow$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ask$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^deny$/i })).toBeInTheDocument();
  });

  it('renders an "Add new rule" row (matches TUI capture)', () => {
    render(
      <PermissionsModal
        permissionMode="default"
        tools={tools}
        onClose={() => {}}
        onSend={() => {}}
      />,
    );
    expect(screen.getByText(/add (a )?new rule/i)).toBeInTheDocument();
  });

  it('renders a search input (matches TUI capture)', () => {
    render(
      <PermissionsModal
        permissionMode="default"
        tools={tools}
        onClose={() => {}}
        onSend={() => {}}
      />,
    );
    const searchInputs = screen.getAllByPlaceholderText(/search/i);
    expect(searchInputs.length).toBeGreaterThan(0);
  });
});

// ── /skills ─────────────────────────────────────────────────────────
//
// TUI capture: tui-skills.txt — sections labelled "User skills
// (~/.openagentic/skills)" and "Plugin skills (plugin)" with
// "~<N> description tokens" annotations on each row.

describe('TUI parity — /skills SkillsModal user/plugin grouping + token cost', () => {
  const skills = [
    { name: 'synth', description: 'synthesizes', loadedFrom: 'userSettings', source: 'userSettings', tokenCost: 173 },
    { name: 'brainstorming', description: 'ideate', loadedFrom: 'plugin', source: 'plugin', tokenCost: 56 },
    { name: 'frontend-design', description: 'design', loadedFrom: 'plugin', source: 'plugin', tokenCost: 67 },
  ];

  it('renders a User skills section header (matches TUI capture)', () => {
    render(
      <SkillsModal
        skills={skills as never}
        fallbackSkills={[]}
        onClose={() => {}}
        onSend={() => {}}
      />,
    );
    expect(screen.getByText(/user skills/i)).toBeInTheDocument();
  });

  it('renders a Plugin skills section header (matches TUI capture)', () => {
    render(
      <SkillsModal
        skills={skills as never}
        fallbackSkills={[]}
        onClose={() => {}}
        onSend={() => {}}
      />,
    );
    expect(screen.getByText(/plugin skills/i)).toBeInTheDocument();
  });

  it('renders ~N description tokens annotation when tokenCost is present', () => {
    render(
      <SkillsModal
        skills={skills as never}
        fallbackSkills={[]}
        onClose={() => {}}
        onSend={() => {}}
      />,
    );
    // ~173 description tokens annotation on synth
    expect(screen.getByText(/173/)).toBeInTheDocument();
    expect(screen.getAllByText(/description tokens/i).length).toBeGreaterThan(0);
  });
});
