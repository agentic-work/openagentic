/**
 * #781 Phase C2 — ReactApp renderer tests.
 *
 * Wraps the existing AppRenderer iframe inside the artifact slide-out.
 * Behavior is fully covered by AppRenderer's own tests; here we just
 * confirm we delegate correctly + show fallback states.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ReactApp } from '../ReactApp.js';

describe('ReactApp renderer — #781 Phase C2', () => {
  it('shows empty state when html is missing', () => {
    render(<ReactApp artifactId="a1" html="" title="x" />);
    expect(screen.getByTestId('react-app-empty')).toBeInTheDocument();
  });

  it('renders an iframe when html is provided', () => {
    const html = '<!doctype html><html><body><div id="app"></div></body></html>';
    const { container } = render(<ReactApp artifactId="a2" html={html} title="Demo" />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  });

  it('threads artifactId through to the iframe data attr', () => {
    const html = '<html><body>x</body></html>';
    const { container } = render(<ReactApp artifactId="abc-123" html={html} title="x" />);
    const wrapper = container.querySelector('[data-artifact-id="abc-123"]');
    expect(wrapper).toBeInTheDocument();
  });
});
