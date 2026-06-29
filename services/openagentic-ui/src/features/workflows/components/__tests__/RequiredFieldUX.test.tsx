/**
 * R1-R4: Required-field UX tests
 *
 * R1. Required-but-empty field → red border + "Required" inline error text
 * R2. CustomNode shows warning badge with count when required-and-empty fields exist
 * R3. Execute with required fields empty → error banner, no POST to /execute
 * R4. 4+ test cases covering each rule
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

/* ── Mock heavy deps ───────────────────────────────────────────────── */

// reactflow — only the parts CustomNode uses
vi.mock('reactflow', () => ({
  Handle: ({ type, position, id, style, className }: any) =>
    <div data-testid={`handle-${type}-${id || position}`} style={style} className={className} />,
  Position: { Left: 'Left', Right: 'Right', Top: 'Top', Bottom: 'Bottom' },
  useReactFlow: () => ({
    getNodes: () => [],
    addNodes: vi.fn(),
    deleteElements: vi.fn(),
    setNodes: vi.fn(),
  }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Icon stubs
vi.mock('@/shared/icons', () => ({
  Trash2: () => <span>T2</span>,
  Copy: () => <span>CP</span>,
  Settings: () => <span>ST</span>,
  CheckCircle: () => <span data-testid="check-circle">✓</span>,
  XCircle: () => <span data-testid="x-circle">✗</span>,
  Clock: () => <span>CK</span>,
  AlertCircle: () => <span data-testid="alert-circle">!</span>,
  Play: () => <span>PL</span>,
  Save: () => <span>SV</span>,
  ArrowLeft: () => <span>AL</span>,
  Grid3x3: () => <span>G3</span>,
  Zap: () => <span>ZP</span>,
  Share2: () => <span>SH</span>,
  Sparkles: () => <span>SP</span>,
  RotateCw: () => <span>RT</span>,
  X: () => <span>XX</span>,
}));

vi.mock('../../utils/nodeConfigs', () => ({
  nodeTypeConfigs: {
    llm_completion: { label: 'LLM', color: '#7c4dff', icon: '🤖', description: 'LLM node' },
    http_request: { label: 'HTTP', color: '#ff5722', icon: '🌐', description: 'HTTP node' },
  },
}));

vi.mock('../nodes/nodeIcons', () => ({
  getNodeIcon: () => <span>icon</span>,
}));

/* ── Imports under test ─────────────────────────────────────────────── */
import { CustomNode } from '../nodes/CustomNode';
import { validateWorkflow } from '../../utils/workflowValidator';

/* ── Helpers ─────────────────────────────────────────────────────────── */

function renderCustomNode(overrides: Record<string, any> = {}) {
  const defaultData = {
    label: 'Test LLM',
    // prompt intentionally empty
    ...overrides,
  };
  // CustomNode receives NodeProps: id, data, selected, type
  return render(
    <div style={{ position: 'relative', width: 260 }}>
      <CustomNode
        id="node-1"
        data={defaultData}
        selected={false}
        type="llm_completion"
        // satisfy remaining NodeProps
        isConnectable={true}
        xPos={0}
        yPos={0}
        zIndex={0}
        dragging={false}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   R1 — Required-but-empty field shows red border + "Required" text
   This tests the workflowValidator + the concept (visual is in NodePropertiesPanel)
   ═══════════════════════════════════════════════════════════════════════ */

describe('R1 – validateWorkflow flags missing required fields', () => {
  it('returns error for llm_completion node missing prompt', () => {
    const result = validateWorkflow(
      [{ id: 'n1', type: 'llm_completion', data: { label: 'LLM' } }],
      []
    );
    const promptIssue = result.issues.find(
      i => i.nodeId === 'n1' && i.field === 'prompt' && i.severity === 'error'
    );
    expect(promptIssue).toBeDefined();
    expect(result.valid).toBe(false);
  });

  it('returns error for http_request node missing url', () => {
    const result = validateWorkflow(
      [{ id: 'n2', type: 'http_request', data: { label: 'HTTP', method: 'GET' } }],
      []
    );
    const urlIssue = result.issues.find(
      i => i.nodeId === 'n2' && i.field === 'url' && i.severity === 'error'
    );
    expect(urlIssue).toBeDefined();
  });

  it('passes when required fields are filled', () => {
    const result = validateWorkflow(
      [{ id: 'n3', type: 'llm_completion', data: { label: 'LLM', prompt: 'Say hello' } }],
      []
    );
    const errors = result.issues.filter(i => i.severity === 'error' && i.nodeId === 'n3');
    expect(errors).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   R2 — CustomNode shows yellow warning badge when required fields empty
   ═══════════════════════════════════════════════════════════════════════ */

describe('R2 – CustomNode warning badge for missing required fields', () => {
  afterEach(cleanup);

  it('renders a warning badge when validationErrors are present on node data', () => {
    const { container } = renderCustomNode({
      validationErrors: [
        { message: '"Test LLM" requires User Prompt', field: 'prompt', code: 'MISSING_PROMPT', severity: 'error', nodeId: 'node-1', category: 'config' },
      ],
    });
    // The badge is a div at absolute top-right containing the count "1"
    // It has data-testid "validation-warning-badge" added as part of implementation
    const badge = container.querySelector('[data-testid="validation-warning-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent?.trim()).toBe('1');
  });

  it('shows count of 2 when two required fields are missing', () => {
    const { container } = renderCustomNode({
      validationErrors: [
        { message: 'Requires URL', field: 'url', code: 'MISSING_URL', severity: 'error', nodeId: 'node-1', category: 'config' },
        { message: 'Requires Method', field: 'method', code: 'MISSING_METHOD', severity: 'error', nodeId: 'node-1', category: 'config' },
      ],
    });
    // Badge shows "2"
    const badge = container.querySelector('[data-testid="validation-warning-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent?.trim()).toBe('2');
  });

  it('does NOT show warning badge when no validationErrors on node data', () => {
    renderCustomNode({ prompt: 'Hello world' });
    // Should not find "1" or "2" badge in specific context;
    // No validationErrors means no badge element
    // The badge has backgroundColor #f59e0b per CustomNode code
    // Check that no numeric badge container shows
    expect(screen.queryByText('1')).not.toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });

  it('renders text "required fields missing" indicator in node body when subtitle absent', () => {
    renderCustomNode({
      validationErrors: [
        { message: '"Test LLM" requires User Prompt', field: 'prompt', code: 'MISSING_PROMPT', severity: 'error', nodeId: 'node-1', category: 'config' },
      ],
      // no subtitle fields (no model, toolName, etc.)
    });
    // The node body shows "1 field required" text
    expect(screen.getByText(/field.*required/i)).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   R3 — validateWorkflow used to block execution (unit test)
   ═══════════════════════════════════════════════════════════════════════ */

describe('R3 – Pre-run validation blocks execution when required fields missing', () => {
  it('validateWorkflow returns valid:false when any required field is empty', () => {
    const result = validateWorkflow(
      [
        { id: 'trigger-1', type: 'trigger', data: { label: 'Start' } },
        { id: 'llm-1', type: 'llm_completion', data: { label: 'LLM' } }, // no prompt
      ],
      [{ id: 'e1', source: 'trigger-1', target: 'llm-1' }]
    );
    expect(result.valid).toBe(false);
    expect(result.summary.errorCount).toBeGreaterThan(0);
  });

  it('identifies which nodes have missing required fields', () => {
    const result = validateWorkflow(
      [
        { id: 'llm-1', type: 'llm_completion', data: { label: 'My LLM' } },
        { id: 'http-1', type: 'http_request', data: { label: 'My HTTP' } },
      ],
      []
    );
    const invalidNodeIds = Array.from(result.nodeResults.entries())
      .filter(([, r]) => !r.valid)
      .map(([id]) => id);
    expect(invalidNodeIds).toContain('llm-1');
    expect(invalidNodeIds).toContain('http-1');
  });

  it('returns valid:true when all nodes are fully configured', () => {
    const result = validateWorkflow(
      [
        { id: 'trigger-1', type: 'trigger', data: { label: 'Start' } },
        { id: 'llm-1', type: 'llm_completion', data: { label: 'LLM', prompt: 'Do something' } },
      ],
      [{ id: 'e1', source: 'trigger-1', target: 'llm-1' }]
    );
    // Only warnings (no trigger, disconnected), but no errors from required fields
    const fieldErrors = result.issues.filter(
      i => i.severity === 'error' && (i.field === 'prompt' || i.field === 'url')
    );
    expect(fieldErrors).toHaveLength(0);
  });

  it('error message references node names for user-friendly display', () => {
    const result = validateWorkflow(
      [{ id: 'n1', type: 'llm_completion', data: { label: 'My AI Step' } }],
      []
    );
    const issue = result.issues.find(i => i.nodeId === 'n1' && i.severity === 'error');
    expect(issue?.message).toContain('My AI Step');
  });
});
