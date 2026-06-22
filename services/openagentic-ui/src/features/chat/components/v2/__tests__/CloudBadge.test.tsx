/**
 * CloudBadge — pinned to mocks/UX/AI/Chatmode/end-state-07-tri-cloud-cost-
 * spikes.html lines 111-113. The badge renders a per-cloud accent pill
 * that drives colours via the [data-cloud] CSS selectors in
 * chatmode-v2.css. No hex / rgb literals expected in the component output.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CloudBadge } from '../CloudBadge';

describe('CloudBadge (mock-07 §111-113)', () => {
  it('renders a data-testid="cloud-badge" span with data-cloud attribute', () => {
    const { getByTestId } = render(<CloudBadge cloud="aws" />);
    const badge = getByTestId('cloud-badge');
    expect(badge.tagName).toBe('SPAN');
    expect(badge.getAttribute('data-cloud')).toBe('aws');
    expect(badge).toHaveClass('cm-cloud-badge');
  });

  it('renders the cloud key as default label', () => {
    const { getByTestId } = render(<CloudBadge cloud="azure" />);
    expect(getByTestId('cloud-badge').textContent).toBe('azure');
  });

  it('respects an explicit label prop', () => {
    const { getByTestId } = render(<CloudBadge cloud="gcp" label="Google" />);
    expect(getByTestId('cloud-badge').textContent).toBe('Google');
  });

  it.each([['aws'], ['azure'], ['gcp']] as const)(
    'paints %s via [data-cloud] (no inline hex)',
    (cloud) => {
      const { getByTestId } = render(<CloudBadge cloud={cloud} />);
      const badge = getByTestId('cloud-badge');
      expect(badge.getAttribute('data-cloud')).toBe(cloud);
      // No inline `style` attribute → colour resolution lives entirely in CSS.
      expect(badge.getAttribute('style')).toBeNull();
    },
  );
});
