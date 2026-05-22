/**
 * CodeModeStatusLine — Phase 5d.
 *
 * Single-row status bar under the codemode composer, mirroring the
 * Claude Code TUI status bar format:
 *
 *   normal · 2 shells · 3 tasks · 45 tools · /help /model Tab ⌘P ⌘↵
 *
 * Counter sources:
 *   mode     — interactionMode from store
 *   shells   — Bash steps currently executing
 *   tasks    — in_progress todos + running agent nodes
 *   tools    — total from sessionMeta (passed as prop from parent)
 */

import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useCodeModeStore } from '@/stores/useCodeModeStore';

interface CodeModeStatusLineProps {
  toolCount: number;
}

const DOT = ' · ';
const HINTS = '/help /model Tab ⌘P ⌘↵';

export const CodeModeStatusLine: React.FC<CodeModeStatusLineProps> = ({ toolCount }) => {
  const { interactionMode, currentSteps, currentTodos, agentTree } = useCodeModeStore(
    useShallow((st) => ({
      interactionMode: st.interactionMode,
      currentSteps: st.currentSteps,
      currentTodos: st.currentTodos,
      agentTree: st.agentTree,
    })),
  );

  const shellCount = currentSteps.filter(
    (s) => s.name === 'Bash' && s.status === 'executing',
  ).length;

  const taskCount =
    currentTodos.filter((t) => t.status === 'in_progress').length +
    agentTree.filter((n) => n.status === 'running').length;

  const segments: React.ReactNode[] = [];

  // Mode — always first
  segments.push(
    <span key="mode" data-testid="status-mode">
      {interactionMode}
    </span>,
  );

  if (shellCount > 0) {
    segments.push(
      <span key="shells" data-testid="status-shells">
        {shellCount} {shellCount === 1 ? 'shell' : 'shells'}
      </span>,
    );
  }

  if (taskCount > 0) {
    segments.push(
      <span key="tasks" data-testid="status-tasks">
        {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
      </span>,
    );
  }

  if (toolCount > 0) {
    segments.push(
      <span key="tools" data-testid="status-tools">
        {toolCount} {toolCount === 1 ? 'tool' : 'tools'}
      </span>,
    );
  }

  return (
    <div
      data-testid="codemode-status-line"
      style={{
        fontSize: 11,
        lineHeight: 1.4,
        color: 'var(--cm-text-muted, #6e7681)',
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'nowrap',
        gap: 0,
        userSelect: 'none',
      }}
    >
      {segments.map((seg, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span aria-hidden>{DOT}</span>}
          {seg}
        </React.Fragment>
      ))}
      <span aria-hidden>{DOT}</span>
      <span
        data-testid="status-hints"
        style={{ opacity: 0.55 }}
      >
        {HINTS}
      </span>
    </div>
  );
};

export default CodeModeStatusLine;
