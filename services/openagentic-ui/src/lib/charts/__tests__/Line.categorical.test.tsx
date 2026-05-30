/**
 * Live-bug 2026-05-14 sibling regression. Same root cause as
 * Area.categorical.test.tsx: <Line> was calling `new Date("10:00")` which
 * produced Invalid Date, then scaleTime(extent([invalid,...])) → NaN
 * coordinates → empty path.
 *
 * Contract: <Line> + categorical xLabels (strings that aren't ISO dates)
 * uses scalePoint and emits a finite-coords path.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Line, type LineData } from '../components/Line';

afterEach(() => cleanup());

const CATEGORICAL: LineData = {
  series: [
    { name: 'OpenAI', data: ['10:00', '10:15', '10:30', '10:45', '11:00'].map((t, i) => ({ t, v: 100 + i * 20 })) },
    { name: 'Anthropic', data: ['10:00', '10:15', '10:30', '10:45', '11:00'].map((t, i) => ({ t, v: 60 + i * 10 })) },
  ],
};

describe('<Line> — categorical x labels', () => {
  it('renders paths with finite coordinates for "HH:MM" categorical xs', () => {
    const { container } = render(<Line data={CATEGORICAL} />);
    const paths = container.querySelectorAll('path[stroke-width="2"]');
    expect(paths.length).toBe(2);
    for (const p of Array.from(paths)) {
      const d = p.getAttribute('d') ?? '';
      expect(d.length).toBeGreaterThan(0);
      expect(d).not.toContain('NaN');
    }
  });

  it('still uses scaleTime for ISO-date strings', () => {
    const data: LineData = {
      series: [{
        name: 'X',
        data: [
          { t: '2026-05-13T10:00:00Z', v: 100 },
          { t: '2026-05-13T11:00:00Z', v: 200 },
        ],
      }],
    };
    const { container } = render(<Line data={data} />);
    const path = container.querySelector('path[stroke-width="2"]');
    expect(path?.getAttribute('d') ?? '').not.toContain('NaN');
  });
});
