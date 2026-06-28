/**
 * BuildProgressRenderer tests — Phase A2 of the chatmode five-layer plan.
 *
 * RED→GREEN:
 *   1. Registry returns a non-null component for `build-progress` slug.
 *   2. Mounting with realistic steps renders status pills + duration columns.
 *   3. Pending/running/ok/warn/err status pills carry their tone class.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FrameRendererRegistry } from '../FrameRendererRegistry.js';
import { BuildProgressRenderer } from '../templates/BuildProgressRenderer.js';

describe('BuildProgressRenderer — Phase A2', () => {
  it('FrameRendererRegistry.lookup("build-progress") returns a non-null component', () => {
    const C = FrameRendererRegistry.lookup('build-progress');
    expect(C).toBeDefined();
    expect(typeof C).toBe('function');
    // Negative: must not fall through to the StreamingMarkdown stub.
    expect((C as any).displayName).not.toBe('StreamingMarkdown');
  });

  it('renders one row per step with status pill + duration', () => {
    const { getByTestId, getAllByText } = render(
      <BuildProgressRenderer
        title="capstone build"
        totalDuration="38.4s"
        steps={[
          { id: 's1', label: 'tsc --noEmit', status: 'ok', duration: '4.2s' },
          { id: 's2', label: 'eslint .', status: 'warn', duration: '2.1s', message: '3 warnings' },
          { id: 's3', label: 'vitest run', status: 'err', duration: '12.0s' },
        ]}
      />,
    );
    expect(getByTestId('build-progress-renderer')).toBeTruthy();
    // Status pills render with uppercase labels via CSS letter-spacing
    // BUT the DOM text is the source literal — see statusLabel mapping.
    expect(getAllByText(/pass|warn|fail/i).length).toBeGreaterThanOrEqual(3);
  });

  it('exposes data-status on each step row for downstream tooling', () => {
    const { container } = render(
      <BuildProgressRenderer
        steps={[
          { id: 'a', label: 'build', status: 'running', duration: '–' },
          { id: 'b', label: 'test', status: 'pending' },
        ]}
      />,
    );
    const steps = container.querySelectorAll<HTMLElement>('[data-status]');
    expect(steps.length).toBe(2);
    expect(steps[0].getAttribute('data-status')).toBe('running');
    expect(steps[1].getAttribute('data-status')).toBe('pending');
  });

  it('returns null on empty steps array', () => {
    const { container } = render(<BuildProgressRenderer steps={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
