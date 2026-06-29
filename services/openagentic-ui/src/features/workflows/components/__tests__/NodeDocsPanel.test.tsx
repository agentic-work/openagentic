/**
 * NodeDocsPanel — TDD-driven, written one test at a time.
 *
 * Renders schema.ai.shortDescription + whenToUse + I/O ports +
 * outputAssertions for the currently-selected node. Pure presentation:
 * receives a RegistryNodeSchema and renders nothing else from the engine.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...p }: any) => <div {...p}>{children}</div> },
}));

afterEach(() => cleanup());

import { NodeDocsPanel } from '../NodeDocsPanel';

describe('NodeDocsPanel — TDD', () => {
  it('RED 1: renders an empty-state notice when schema is null', () => {
    render(<NodeDocsPanel schema={null} />);
    expect(screen.getByTestId('node-docs-empty')).toBeInTheDocument();
  });

  it('RED 3: lists each outputAssertion by name + errorMessage', () => {
    const schema = {
      type: 'openagentic_chat',
      category: 'ai',
      label: 'OpenAgentic Chat',
      description: 'Conversational LLM via Smart Router.',
      ai: { shortDescription: 'Smart-Router LLM chat.', whenToUse: 'Conversational output.' },
      outputAssertions: [
        { name: 'non_empty_content', expression: 'result && result.content', errorMessage: 'OpenAgentic Chat returned an empty completion.' },
        { name: 'agent_substantive_output', expression: 'true', errorMessage: 'LLM returned a refusal pattern.' },
      ],
    } as any;
    render(<NodeDocsPanel schema={schema} />);
    expect(screen.getByText('non_empty_content')).toBeInTheDocument();
    expect(screen.getByText('agent_substantive_output')).toBeInTheDocument();
    expect(screen.getByText('OpenAgentic Chat returned an empty completion.')).toBeInTheDocument();
  });

  it('RED 4: lists input + output ports with type', () => {
    const schema = {
      type: 'http_request',
      category: 'action',
      label: 'HTTP Request',
      description: 'Make HTTP calls.',
      ai: { shortDescription: 'HTTP call.', whenToUse: 'Calling APIs.' },
      ports: {
        inputs: [{ name: 'input', type: 'any', required: false }],
        outputs: [{ name: 'response', type: 'json', required: true }],
      },
    } as any;
    render(<NodeDocsPanel schema={schema} />);
    // Each port appears with its name + type label somewhere in the panel
    expect(screen.getByText(/input/)).toBeInTheDocument();
    expect(screen.getByText(/response/)).toBeInTheDocument();
  });

  it('RED 2: shows ai.shortDescription and ai.whenToUse', () => {
    const schema = {
      type: 'data_source_query',
      category: 'data',
      label: 'Data Source Query',
      description: 'Run a query against a configured DataSource.',
      ai: {
        shortDescription: 'Query a configured DataSource (SQL / REST / NL → SQL).',
        whenToUse: 'When a workflow needs structured data from a DB or REST endpoint.',
      },
    } as any;
    render(<NodeDocsPanel schema={schema} />);
    expect(screen.getByText('Query a configured DataSource (SQL / REST / NL → SQL).')).toBeInTheDocument();
    expect(screen.getByText('When a workflow needs structured data from a DB or REST endpoint.')).toBeInTheDocument();
  });
});
