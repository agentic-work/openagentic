/**
 * Regression test for the live-bug 2026-05-14: stacked-area charts disappeared
 * from admin because xLabels like "10:00" / "Jan 1" were being passed to
 * new Date() inside <Area>'s normalize step, producing Invalid Date which
 * then borked the layout (NaN coordinates everywhere → no path).
 *
 * Contract: <Area> + categorical xLabels must render real <path> elements
 * with finite coordinates.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Area, type AreaData } from '../components/Area';

afterEach(() => cleanup());

const CATEGORICAL_XLABELS = ['10:00', '10:15', '10:30', '10:45', '11:00'];

const SAMPLE_STACKED: AreaData = {
  mode: 'stacked',
  xLabels: CATEGORICAL_XLABELS,
  series: [
    { name: 'OpenAI', data: CATEGORICAL_XLABELS.map((t, i) => ({ t, v: 100 + i * 20 })) },
    { name: 'Anthropic', data: CATEGORICAL_XLABELS.map((t, i) => ({ t, v: 80 + i * 15 })) },
    { name: 'Bedrock', data: CATEGORICAL_XLABELS.map((t, i) => ({ t, v: 40 + i * 5 })) },
  ],
};

describe('<Area> — categorical xLabels regression', () => {
  it('renders stacked paths with FINITE coordinates (not NaN) when t is "HH:MM" strings', () => {
    const { container } = render(<Area data={SAMPLE_STACKED} />);
    const paths = container.querySelectorAll('path[fill-opacity="0.7"]');
    expect(paths.length).toBe(3);
    for (const p of Array.from(paths)) {
      const d = p.getAttribute('d') ?? '';
      expect(d.length).toBeGreaterThan(0);
      expect(d).not.toContain('NaN');
    }
  });

  it('preserves string t for "Jan 1" categorical labels (no Invalid Date)', () => {
    const data: AreaData = {
      mode: 'stacked',
      xLabels: ['Jan 1', 'Jan 2', 'Jan 3'],
      series: [
        { name: 'A', data: [{ t: 'Jan 1', v: 10 }, { t: 'Jan 2', v: 20 }, { t: 'Jan 3', v: 30 }] },
      ],
    };
    const { container } = render(<Area data={data} />);
    const paths = container.querySelectorAll('path[fill-opacity="0.7"]');
    expect(paths.length).toBe(1);
    const d = paths[0].getAttribute('d') ?? '';
    expect(d).not.toContain('NaN');
  });

  it('still works for ISO date strings (converts to real Dates)', () => {
    const data: AreaData = {
      mode: 'overlay',
      series: [
        { name: 'X', data: [
          { t: '2026-05-13T10:00:00Z', v: 100 },
          { t: '2026-05-13T11:00:00Z', v: 200 },
          { t: '2026-05-13T12:00:00Z', v: 150 },
        ] },
      ],
    };
    const { container } = render(<Area data={data} />);
    const path = container.querySelector('path[fill-opacity="0.35"]');
    expect(path?.getAttribute('d') ?? '').not.toContain('NaN');
  });
});
