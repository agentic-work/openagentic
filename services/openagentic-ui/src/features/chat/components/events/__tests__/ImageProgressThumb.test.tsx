/**
 * Phase H (task #153) — ImageProgressThumb render tests.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ImageProgressThumb } from '../ImageProgressThumb';

describe('ImageProgressThumb', () => {
  it('renders skeleton when no partialUrl', () => {
    render(<ImageProgressThumb imageGenId="img-1" progress={0} />);
    expect(screen.getByTestId('image-progress-thumb-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('image-progress-pct').textContent).toBe('0%');
    expect(screen.getByTestId('image-progress-thumb').getAttribute('aria-busy')).toBe('true');
  });

  it('renders img with opacity proportional to progress', () => {
    render(
      <ImageProgressThumb
        imageGenId="img-2"
        progress={0.5}
        partialUrl="/img/partial.png"
        prompt="a sunset"
      />
    );
    const thumb = screen.getByTestId('image-progress-thumb');
    expect(thumb.getAttribute('data-progress')).toBe('0.50');
    expect(screen.getByTestId('image-progress-pct').textContent).toBe('50%');
    const img = screen.getByTestId('image-progress-thumb-img') as HTMLImageElement;
    expect(img.src).toContain('/img/partial.png');
    expect(img.style.opacity).toBe('0.5');
  });

  it('marks complete + 100% when progress >= 1', () => {
    render(
      <ImageProgressThumb
        imageGenId="img-3"
        progress={1}
        partialUrl="/img/final.png"
      />
    );
    const el = screen.getByTestId('image-progress-thumb');
    expect(el.getAttribute('data-complete')).toBe('true');
    expect(el.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByTestId('image-progress-pct').textContent).toBe('100%');
  });

  it('formats eta as seconds when under a minute', () => {
    render(
      <ImageProgressThumb imageGenId="img-4" progress={0.1} eta={12} />
    );
    expect(screen.getByTestId('image-progress-eta').textContent).toMatch(/12s/);
  });

  it('formats eta as minutes when over a minute', () => {
    render(
      <ImageProgressThumb imageGenId="img-5" progress={0.1} eta={125} />
    );
    expect(screen.getByTestId('image-progress-eta').textContent).toMatch(/3m/);
  });
});
