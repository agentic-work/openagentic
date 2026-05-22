/**
 * CodeModeStatusLine — Phase 5d TDD.
 *
 * Status bar under the codemode composer, Claude-Code-style:
 *   normal · 2 shells · 3 tasks · 45 tools · /help /model Tab ⌘P ⌘↵
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { CodeModeStatusLine } from '../CodeModeStatusLine';
import { useCodeModeStore } from '@/stores/useCodeModeStore';

function mkStep(name: string, status: string) {
  return { id: `s-${Math.random()}`, name, status, content: '', output: '', isCollapsed: false, isStreaming: false };
}

function mkTodo(status: string) {
  return { id: `t-${Math.random()}`, content: 'do it', status, priority: 'medium' };
}

function mkAgent(status: string) {
  return { id: `a-${Math.random()}`, taskId: `ta-${Math.random()}`, name: 'sub', status, toolsCalled: [], background: false, children: [] };
}

beforeEach(() => {
  useCodeModeStore.setState({
    interactionMode: 'normal',
    currentSteps: [],
    currentTodos: [],
    agentTree: [],
  } as any, false);
});

afterEach(() => {
  cleanup();
});

describe('CodeModeStatusLine', () => {
  it('renders mode segment when no other counters are non-zero', () => {
    render(<CodeModeStatusLine toolCount={0} />);
    const line = screen.getByTestId('codemode-status-line');
    expect(line).toBeInTheDocument();
    const mode = screen.getByTestId('status-mode');
    expect(mode.textContent).toBe('normal');
    // shells/tasks/tools are hidden when zero
    expect(screen.queryByTestId('status-shells')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-tasks')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-tools')).not.toBeInTheDocument();
    // hints always present
    expect(screen.getByTestId('status-hints')).toBeInTheDocument();
    // full text sanity
    expect(line.textContent).toContain('normal');
    expect(line.textContent).toContain('/help');
  });

  it('renders "1 shell" (singular) when one Bash step is executing', () => {
    useCodeModeStore.setState({
      currentSteps: [mkStep('Bash', 'executing')],
    } as any, false);
    render(<CodeModeStatusLine toolCount={0} />);
    const shells = screen.getByTestId('status-shells');
    expect(shells.textContent).toBe('1 shell');
  });

  it('renders "3 shells" when three Bash steps are executing; non-Bash steps excluded', () => {
    useCodeModeStore.setState({
      currentSteps: [
        mkStep('Bash', 'executing'),
        mkStep('Bash', 'executing'),
        mkStep('Bash', 'executing'),
        mkStep('Read', 'executing'),   // not Bash — excluded
        mkStep('Bash', 'success'),     // not executing — excluded
      ],
    } as any, false);
    render(<CodeModeStatusLine toolCount={0} />);
    const shells = screen.getByTestId('status-shells');
    expect(shells.textContent).toBe('3 shells');
  });

  it('renders "2 tasks" from 1 in_progress todo + 1 running agent node', () => {
    useCodeModeStore.setState({
      currentTodos: [mkTodo('in_progress'), mkTodo('completed')],
      agentTree: [mkAgent('running'), mkAgent('completed')],
    } as any, false);
    render(<CodeModeStatusLine toolCount={0} />);
    const tasks = screen.getByTestId('status-tasks');
    expect(tasks.textContent).toBe('2 tasks');
  });

  it('renders all four segments when all counts are non-zero', () => {
    useCodeModeStore.setState({
      interactionMode: 'plan',
      currentSteps: [mkStep('Bash', 'executing'), mkStep('Bash', 'executing')],
      currentTodos: [mkTodo('in_progress')],
      agentTree: [mkAgent('running')],
    } as any, false);
    render(<CodeModeStatusLine toolCount={45} />);
    expect(screen.getByTestId('status-mode').textContent).toBe('plan');
    expect(screen.getByTestId('status-shells').textContent).toBe('2 shells');
    expect(screen.getByTestId('status-tasks').textContent).toBe('2 tasks');
    expect(screen.getByTestId('status-tools').textContent).toBe('45 tools');
    expect(screen.getByTestId('status-hints')).toBeInTheDocument();
  });

  it('hides shells/tasks/tools segments when their count is 0', () => {
    useCodeModeStore.setState({
      currentSteps: [],
      currentTodos: [],
      agentTree: [],
    } as any, false);
    render(<CodeModeStatusLine toolCount={0} />);
    expect(screen.queryByTestId('status-shells')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-tasks')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-tools')).not.toBeInTheDocument();
  });

  it('always renders slash hints', () => {
    render(<CodeModeStatusLine toolCount={0} />);
    const hints = screen.getByTestId('status-hints');
    expect(hints.textContent).toBe('/help /model Tab ⌘P ⌘↵');
  });

  it('reflects interactionMode changes (plan, yolo)', () => {
    useCodeModeStore.setState({ interactionMode: 'plan' } as any, false);
    const { unmount } = render(<CodeModeStatusLine toolCount={0} />);
    expect(screen.getByTestId('status-mode').textContent).toBe('plan');
    unmount();

    useCodeModeStore.setState({ interactionMode: 'yolo' } as any, false);
    render(<CodeModeStatusLine toolCount={0} />);
    expect(screen.getByTestId('status-mode').textContent).toBe('yolo');
  });
});
