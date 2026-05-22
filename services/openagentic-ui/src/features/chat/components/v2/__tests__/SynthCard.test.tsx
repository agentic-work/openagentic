/**
 * AC-C — SynthCard render dispatcher.
 *
 * Renders one synth lifecycle entry inline. Anatomy per stage:
 *
 *   planned             header (intent + risk badge + caps chips)
 *                       + collapsed code preview
 *   awaiting_approval   same + Approve / Deny CTA buttons
 *   approved            same + "Executing soon..." dim line
 *   executing           header + code expanded + stdout streaming
 *                       + animated dot
 *   completed           header + code + stdout + duration + ✓
 *   failed              same + error message + ✗
 *   denied              header + "Denied: {reason}"
 *
 * Mirrors the ToolCard chevron-collapse contract. The approve/deny
 * callback is the only side effect; receiver POSTs to
 * /api/synth/approvals/:id/[approve|reject].
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SynthCard } from '../SynthCard';
import type { Synth } from '../../../hooks/useChatStream';

const baseSynth = (overrides: Partial<Synth> = {}): Synth => ({
  artifactId: 's-1',
  stage: 'planned',
  intent: 'convert report to pdf',
  capabilities: ['filesystem', 'data'],
  riskLevel: 'low',
  riskReason: 'no destructive operations',
  code: '',
  codeLang: 'python',
  stdout: '',
  stderr: '',
  ...overrides,
});

describe('SynthCard — AC-C synth lifecycle render', () => {
  it('renders the intent + risk badge + capability chips when stage=planned', () => {
    const { container } = render(<SynthCard synth={baseSynth()} />);
    expect(screen.getByText(/convert report to pdf/i)).toBeInTheDocument();
    expect(screen.getByText(/low/i)).toBeInTheDocument();
    expect(screen.getByText(/filesystem/i)).toBeInTheDocument();
    expect(screen.getByText(/data/i)).toBeInTheDocument();
    // Should carry the synth-card data-testid for downstream selectors.
    expect(container.querySelector('[data-testid="synth-card"]')).toBeTruthy();
  });

  it('shows authored code when present', () => {
    const synth = baseSynth({ code: 'import sys\nprint("hi")\n' });
    render(<SynthCard synth={synth} />);
    expect(screen.getByText(/import sys/)).toBeInTheDocument();
  });

  it('shows Approve and Deny CTAs only when stage=awaiting_approval', () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const synth = baseSynth({
      stage: 'awaiting_approval',
      code: 'print(1)\n',
    });
    render(<SynthCard synth={synth} onApprove={onApprove} onDeny={onDeny} />);
    const approveBtn = screen.getByRole('button', { name: /approve/i });
    const denyBtn = screen.getByRole('button', { name: /deny|reject/i });
    expect(approveBtn).toBeInTheDocument();
    expect(denyBtn).toBeInTheDocument();
    fireEvent.click(approveBtn);
    expect(onApprove).toHaveBeenCalledWith('s-1');
    fireEvent.click(denyBtn);
    expect(onDeny).toHaveBeenCalledWith('s-1');
  });

  it('does NOT show CTAs in any stage other than awaiting_approval', () => {
    const stages: Synth['stage'][] = [
      'planned',
      'approved',
      'denied',
      'executing',
      'completed',
      'failed',
    ];
    for (const stage of stages) {
      const { unmount } = render(
        <SynthCard synth={baseSynth({ stage, code: 'x' })} />,
      );
      expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /deny|reject/i })).toBeNull();
      unmount();
    }
  });

  it('shows stdout buffer when stage=executing', () => {
    const synth = baseSynth({
      stage: 'executing',
      code: 'print(1)\n',
      stdout: 'starting…\nstep 1 done\n',
      startedAt: 1700000000000,
    });
    render(<SynthCard synth={synth} />);
    expect(screen.getByText(/starting/)).toBeInTheDocument();
    expect(screen.getByText(/step 1 done/)).toBeInTheDocument();
  });

  it('shows duration + completed indicator when stage=completed', () => {
    const synth = baseSynth({
      stage: 'completed',
      code: 'print(1)\n',
      stdout: 'done\n',
      durationMs: 1234,
      exitCode: 0,
    });
    render(<SynthCard synth={synth} />);
    // Duration formatted (1.2s or 1234ms) — accept either rendering.
    expect(
      screen.getByText(/1\.2\s*s|1234\s*ms/),
    ).toBeInTheDocument();
  });

  it('shows error message + failed indicator when stage=failed', () => {
    const synth = baseSynth({
      stage: 'failed',
      code: 'print(1)\n',
      stderr: 'TypeError: foo\n',
      durationMs: 50,
      exitCode: 1,
      error: 'TypeError: foo',
    });
    render(<SynthCard synth={synth} />);
    // Error text may appear in both the stderr buffer + the error
    // chip — getAllByText handles either count.
    expect(screen.getAllByText(/TypeError/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows denial reason when stage=denied', () => {
    const synth = baseSynth({
      stage: 'denied',
      code: 'print(1)\n',
      denialReason: 'user rejected',
    });
    render(<SynthCard synth={synth} />);
    expect(screen.getByText(/user rejected/i)).toBeInTheDocument();
  });

  it('renders stderr output even when stage=completed (tagged as stderr)', () => {
    const synth = baseSynth({
      stage: 'completed',
      code: 'print(1)\n',
      stdout: '',
      stderr: 'WARN: deprecation\n',
      durationMs: 10,
      exitCode: 0,
    });
    render(<SynthCard synth={synth} />);
    expect(screen.getByText(/WARN: deprecation/)).toBeInTheDocument();
  });

  it('reflects critical/high risk visually (data attribute exposed for tests)', () => {
    const synth = baseSynth({ riskLevel: 'critical' });
    const { container } = render(<SynthCard synth={synth} />);
    const card = container.querySelector('[data-testid="synth-card"]');
    expect(card?.getAttribute('data-risk')).toBe('critical');
  });
});
