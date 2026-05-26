import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { CodeModeBanner } from '../CodeModeBanner';

afterEach(() => cleanup());

describe('CodeModeBanner', () => {
  it('renders the pixel banner exactly as in mock-2', () => {
    const { container } = render(<CodeModeBanner />);
    const el = container.querySelector('[data-testid="cm-banner"]');
    expect(el).not.toBeNull();
    expect(el?.classList.contains('cm-banner')).toBe(true);

    const pixel = el?.querySelector('.cm-banner-pixel');
    expect(pixel).not.toBeNull();
    // Exact characters from the mock — sequence with single-space
    // separators, surrounded by the bracket pair.
    expect(pixel?.textContent || '').toBe('[ A G E N T I C W O R K ]');
  });

  it('hides when visible=false', () => {
    const { container } = render(<CodeModeBanner visible={false} />);
    expect(container.querySelector('[data-testid="cm-banner"]')).toBeNull();
  });

  it('is rendered as decoration (aria-hidden + pointer-events:none)', () => {
    const { container } = render(<CodeModeBanner />);
    const el = container.querySelector('[data-testid="cm-banner"]') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.pointerEvents).toBe('none');
  });
});
