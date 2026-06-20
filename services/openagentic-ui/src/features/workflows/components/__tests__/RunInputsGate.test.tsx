/**
 * RunInputsGate — pre-run required-input collection behavior.
 *
 * Proves the exact gate WorkflowsContainer.handleExecute runs before it
 * executes a flow: compute the trigger's required inputs (via the real
 * computeRequiredRunInputs), and if any required field is empty, pop the real
 * RunInputsModal and DO NOT execute. On submit, execute with the collected
 * values threaded into the run `input`. A flow whose inputs are all already
 * bound runs directly with the bound defaults.
 *
 * This is the bug the user reported: instantiating the RAG Knowledge-Base Q&A
 * template (trigger declares input_schema { question, collection }; downstream
 * binds {{trigger.question}}) and clicking Execute ran the flow with an EMPTY
 * input → knowledge_search failed "requires a non-empty query". The gate must
 * ASK for the question first.
 */

import React, { useRef, useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

afterEach(() => cleanup());

import { RunInputsModal, type RunInputDef } from '../RunInputsModal';
import {
  computeRequiredRunInputs,
  hasUnprovidedRequiredInputs,
} from '../../services/computeRequiredRunInputs';

/**
 * Minimal harness that mirrors WorkflowsContainer.handleExecute's run-inputs
 * gate verbatim: compute required inputs, pop the modal if any required field
 * is empty (and DON'T execute), otherwise execute with the collected/bound
 * defaults. `execute` is the seam we spy on (stands in for
 * apiService.executeWorkflow(workflowId, collectedInput, ...)).
 */
const ExecuteHarness: React.FC<{
  nodes: Array<{ id: string; type?: string; data?: any }>;
  execute: (input: Record<string, any>) => void;
}> = ({ nodes, execute }) => {
  const [runInputsOpen, setRunInputsOpen] = useState(false);
  const [pendingInputs, setPendingInputs] = useState<RunInputDef[]>([]);
  const [pendingDefaults, setPendingDefaults] = useState<Record<string, any>>({});
  const collectedRef = useRef<Record<string, any> | null>(null);

  const handleExecute = () => {
    if (!collectedRef.current) {
      const req = computeRequiredRunInputs(nodes);
      if (req.inputs.length > 0 && hasUnprovidedRequiredInputs(req)) {
        setPendingInputs(req.inputs);
        setPendingDefaults(req.defaults);
        setRunInputsOpen(true);
        return; // Wait for the user — do NOT execute.
      }
      collectedRef.current = req.defaults;
    }
    execute(collectedRef.current || {});
    collectedRef.current = null; // reset for next run
  };

  return (
    <div>
      <button onClick={handleExecute}>Execute</button>
      <RunInputsModal
        isOpen={runInputsOpen}
        inputs={pendingInputs}
        defaultValues={pendingDefaults}
        onCancel={() => {
          setRunInputsOpen(false);
          collectedRef.current = null;
        }}
        onSubmit={(values) => {
          collectedRef.current = values;
          setRunInputsOpen(false);
          handleExecute();
        }}
      />
    </div>
  );
};

// Verbatim trigger from seed/templates/rag-knowledge-qa.json
const ragNodes = [
  {
    id: 'trigger',
    type: 'trigger',
    data: {
      triggerType: 'manual',
      label: 'Question',
      input_schema: { question: 'string', collection: 'string' },
    },
  },
  { id: 'search', type: 'knowledge_search', data: { query: '{{trigger.question}}' } },
];

describe('Pre-run required-input gate (RAG template repro)', () => {
  it('clicking Execute with no value pops the dialog and does NOT execute', () => {
    const execute = vi.fn();
    render(<ExecuteHarness nodes={ragNodes} execute={execute} />);

    fireEvent.click(screen.getByRole('button', { name: /execute/i }));

    // Dialog asks for the required input(s)…
    expect(screen.getByTestId('run-inputs-modal')).toBeInTheDocument();
    expect(screen.getByLabelText(/question/i)).toBeInTheDocument();
    // …and the flow did NOT run blind.
    expect(execute).not.toHaveBeenCalled();
  });

  it('filling the question + submit runs with input.question set', () => {
    const execute = vi.fn();
    // Trigger declares only `question` so a single required field gates the run.
    const oneInputNodes = [
      {
        id: 'trigger',
        type: 'trigger',
        data: { triggerType: 'manual', label: 'Question', input_schema: { question: 'string' } },
      },
      { id: 'search', type: 'knowledge_search', data: { query: '{{trigger.question}}' } },
    ];
    render(<ExecuteHarness nodes={oneInputNodes} execute={execute} />);

    fireEvent.click(screen.getByRole('button', { name: /execute/i }));
    fireEvent.change(screen.getByLabelText(/question/i), {
      target: { value: 'What is the Flows engine?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run flow/i }));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({
      question: 'What is the Flows engine?',
    });
  });

  it('RAG template (question + collection both required): asks for both, runs once both filled', () => {
    const execute = vi.fn();
    render(<ExecuteHarness nodes={ragNodes} execute={execute} />);

    fireEvent.click(screen.getByRole('button', { name: /execute/i }));
    // Both declared input_schema fields surface as required.
    fireEvent.change(screen.getByLabelText(/^question$/i), {
      target: { value: 'What is the Flows engine?' },
    });
    fireEvent.change(screen.getByLabelText(/^collection$/i), {
      target: { value: 'shared' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run flow/i }));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({
      question: 'What is the Flows engine?',
      collection: 'shared',
    });
  });

  it('cancelling the dialog does not execute', () => {
    const execute = vi.fn();
    render(<ExecuteHarness nodes={ragNodes} execute={execute} />);

    fireEvent.click(screen.getByRole('button', { name: /execute/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(execute).not.toHaveBeenCalled();
  });

  it('a flow whose required inputs are all already bound runs directly (no dialog)', () => {
    const execute = vi.fn();
    const boundNodes = [
      {
        id: 'trigger',
        type: 'trigger',
        data: {
          input_schema: { namespace: 'string', restart_threshold: 'number' },
          defaultInputs: { namespace: 'openagentic-example', restart_threshold: 3 },
        },
      },
    ];
    render(<ExecuteHarness nodes={boundNodes} execute={execute} />);

    fireEvent.click(screen.getByRole('button', { name: /execute/i }));

    expect(screen.queryByTestId('run-inputs-modal')).not.toBeInTheDocument();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({
      namespace: 'openagentic-example',
      restart_threshold: 3,
    });
  });

  it('a flow with no trigger inputs runs directly with an empty input', () => {
    const execute = vi.fn();
    const noInputNodes = [
      { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
      { id: 'llm', type: 'llm_completion', data: { prompt: 'static' } },
    ];
    render(<ExecuteHarness nodes={noInputNodes} execute={execute} />);

    fireEvent.click(screen.getByRole('button', { name: /execute/i }));

    expect(screen.queryByTestId('run-inputs-modal')).not.toBeInTheDocument();
    expect(execute).toHaveBeenCalledWith({});
  });
});
