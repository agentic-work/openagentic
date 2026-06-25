/**
 * AvatarCrumb — v2 chatmode primitive (#502).
 *
 * Letter-in-tinted-circle avatar shown next to assistant / sub-agent
 * turns. Variants: asst (gradient), c/g/s/k (tinted), user (neutral).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AvatarCrumb } from '../AvatarCrumb';

describe('AvatarCrumb', () => {
  it('renders a <span role="img"> with the letter inside', () => {
    render(<AvatarCrumb variant="asst" />);
    const el = screen.getByRole('img');
    expect(el.tagName).toBe('SPAN');
    expect(el.textContent).toBe('A');
  });

  it('uses the variant-default letter when none is provided', () => {
    const { rerender } = render(<AvatarCrumb variant="asst" />);
    expect(screen.getByRole('img').textContent).toBe('A');

    rerender(<AvatarCrumb variant="c" />);
    expect(screen.getByRole('img').textContent).toBe('C');

    rerender(<AvatarCrumb variant="g" />);
    expect(screen.getByRole('img').textContent).toBe('G');

    rerender(<AvatarCrumb variant="s" />);
    expect(screen.getByRole('img').textContent).toBe('S');

    rerender(<AvatarCrumb variant="k" />);
    expect(screen.getByRole('img').textContent).toBe('K');

    rerender(<AvatarCrumb variant="user" />);
    expect(screen.getByRole('img').textContent).toBe('U');
  });

  it('lets the caller override the default letter', () => {
    render(<AvatarCrumb variant="c" letter="X" />);
    expect(screen.getByRole('img').textContent).toBe('X');
  });

  it('size "sm" applies 18px width/height', () => {
    render(<AvatarCrumb variant="asst" size="sm" />);
    const el = screen.getByRole('img') as HTMLSpanElement;
    expect(el.style.width).toBe('18px');
    expect(el.style.height).toBe('18px');
  });

  it('size "md" applies 24px width/height', () => {
    render(<AvatarCrumb variant="asst" size="md" />);
    const el = screen.getByRole('img') as HTMLSpanElement;
    expect(el.style.width).toBe('24px');
    expect(el.style.height).toBe('24px');
  });

  it('size "lg" applies 32px width/height', () => {
    render(<AvatarCrumb variant="asst" size="lg" />);
    const el = screen.getByRole('img') as HTMLSpanElement;
    expect(el.style.width).toBe('32px');
    expect(el.style.height).toBe('32px');
  });

  it('variant "asst" applies the linear-gradient background', () => {
    render(<AvatarCrumb variant="asst" />);
    const el = screen.getByRole('img') as HTMLSpanElement;
    expect(el.style.background).toContain('linear-gradient');
  });

  it('variant "c" applies amber color', () => {
    render(<AvatarCrumb variant="c" />);
    const el = screen.getByRole('img') as HTMLSpanElement;
    expect(el.style.color).toBe('rgb(245, 158, 11)');
  });

  it('variant "user" applies neutral background with border', () => {
    render(<AvatarCrumb variant="user" />);
    const el = screen.getByRole('img') as HTMLSpanElement;
    expect(el.style.background).toContain('var(--bg-3');
    expect(el.style.border).toContain('1px solid');
  });

  it('default ARIA label is "Avatar: {variant}"', () => {
    render(<AvatarCrumb variant="g" />);
    expect(screen.getByLabelText('Avatar: g')).toBeInTheDocument();
  });

  it('honors a custom ariaLabel', () => {
    render(<AvatarCrumb variant="g" ariaLabel="GitHub agent" />);
    expect(screen.getByLabelText('GitHub agent')).toBeInTheDocument();
  });
});
