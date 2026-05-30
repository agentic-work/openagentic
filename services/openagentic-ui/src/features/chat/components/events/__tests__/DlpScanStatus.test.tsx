/**
 * DlpScanStatus — Phase G render test.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DlpScanStatus } from '../DlpScanStatus';

describe('DlpScanStatus', () => {
  it('renders scanning state', () => {
    render(<DlpScanStatus state="scanning" />);
    const s = screen.getByTestId('dlp-scan-status');
    expect(s.getAttribute('data-state')).toBe('scanning');
    expect(s.textContent).toMatch(/DLP: scanning/);
  });

  it('renders blocked with severity + role=alert', () => {
    render(
      <DlpScanStatus
        state="blocked"
        severity="high"
        reason="PII pattern match"
        categories={['email', 'ssn']}
      />
    );
    const s = screen.getByTestId('dlp-scan-status');
    expect(s.getAttribute('role')).toBe('alert');
    expect(s.textContent).toMatch(/DLP: blocked.*severity: high/);
    expect(s.textContent).toMatch(/email/);
  });

  it('renders passed', () => {
    render(<DlpScanStatus state="passed" />);
    expect(screen.getByTestId('dlp-scan-status').textContent).toMatch(/DLP: passed/);
  });

  it('renders redacted with findings count', () => {
    render(<DlpScanStatus state="redacted" findings={2} />);
    const s = screen.getByTestId('dlp-scan-status');
    expect(s.textContent).toMatch(/DLP: redacted 2 finding/);
  });
});
