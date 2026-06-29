/**
 * B8 (chatmode punch-list, 2026-05-12) — ContentFilterBanner render tests.
 *
 * The banner is the compliance signal a user sees when Azure RAI /
 * Vertex SAFETY / Vertex RECITATION trips on the assistant's output.
 * Before B8 these trips silently truncated as canonical end_turn and
 * the UI rendered an empty bubble — hiding a SAFETY event from the
 * audit. These tests pin the contract: testid, headline-by-kind,
 * verbatim server message, optional model row.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ContentFilterBanner } from '../ContentFilterBanner';

describe('ContentFilterBanner (B8)', () => {
  it('renders the server-supplied message verbatim with the testid', () => {
    render(
      <ContentFilterBanner
        kind="content_filter"
        model="gpt-5.4-2026-03-05"
        message="Response was redacted by safety filters. The assistant cannot return this content."
      />,
    );
    const el = screen.getByTestId('content-filter-banner');
    expect(el).toBeInTheDocument();
    expect(el.getAttribute('data-kind')).toBe('content_filter');
    expect(el.getAttribute('data-model')).toBe('gpt-5.4-2026-03-05');
    const message = screen.getByTestId('content-filter-banner-message');
    expect(message.textContent).toContain(
      'Response was redacted by safety filters',
    );
  });

  it('uses "Responsible AI filter triggered" headline for kind=content_filter', () => {
    render(
      <ContentFilterBanner
        kind="content_filter"
        model="gpt-5.4"
        message="filtered"
      />,
    );
    const h = screen.getByTestId('content-filter-banner-headline');
    expect(h.textContent).toBe('Responsible AI filter triggered');
  });

  it('switches headline to "Safety filter triggered" for kind=safety (Vertex SAFETY)', () => {
    render(
      <ContentFilterBanner
        kind="safety"
        model="gemini-2.5-flash"
        message="redacted by safety"
      />,
    );
    const h = screen.getByTestId('content-filter-banner-headline');
    expect(h.textContent).toBe('Safety filter triggered');
  });

  it('switches headline to "Recitation filter triggered" for kind=recitation', () => {
    render(
      <ContentFilterBanner
        kind="recitation"
        model="gemini-2.5-flash"
        message="redacted by recitation"
      />,
    );
    const h = screen.getByTestId('content-filter-banner-headline');
    expect(h.textContent).toBe('Recitation filter triggered');
  });

  it('renders model attribution row when model is provided', () => {
    render(
      <ContentFilterBanner
        kind="safety"
        model="gemini-2.5-flash"
        message="redacted"
      />,
    );
    const modelRow = screen.getByTestId('content-filter-banner-model');
    expect(modelRow.textContent).toContain('gemini-2.5-flash');
  });

  it('omits model row when model is empty', () => {
    render(
      <ContentFilterBanner
        kind="content_filter"
        model=""
        message="redacted"
      />,
    );
    expect(screen.queryByTestId('content-filter-banner-model')).not.toBeInTheDocument();
  });

  it('defaults kind to content_filter when omitted', () => {
    render(<ContentFilterBanner message="redacted" />);
    const el = screen.getByTestId('content-filter-banner');
    expect(el.getAttribute('data-kind')).toBe('content_filter');
  });
});
