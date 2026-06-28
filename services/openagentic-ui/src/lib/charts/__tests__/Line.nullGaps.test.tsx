/**
 * Live-bug 2026-05-14 part 2: even after categorical xLabels were fixed,
 * the TPOT-by-model chart still rendered NaN paths. Root cause: when a
 * model has no data for a particular bucket (v=null/undefined), layout.y
 * returned NaN and the entire path string was broken.
 *
 * Contract: <Line> must use .defined() to skip non-finite v values.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Line, type LineData } from '../components/Line';

afterEach(() => cleanup());

describe('<Line> — null / undefined / NaN v values', () => {
  it('emits a finite path even when some series have gaps', () => {
    const data: LineData = {
      series: [
        { name: 'model-with-gap', data: [
          { t: '23:00', v: 100 },
          { t: '23:15', v: null as any },
          { t: '23:30', v: 150 },
          { t: '23:45', v: undefined as any },
          { t: '24:00', v: 200 },
        ] },
      ],
    };
    const { container } = render(<Line data={data} />);
    const paths = container.querySelectorAll('path[stroke-width="2"]');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('d') ?? '').not.toContain('NaN');
  });

  it('handles every-value-null gracefully (no path or empty path, no NaN)', () => {
    const data: LineData = {
      series: [{ name: 'empty', data: [
        { t: 'a', v: null as any },
        { t: 'b', v: null as any },
      ] }],
    };
    const { container } = render(<Line data={data} />);
    // Path may be empty or skipped — either way: no NaN in any path
    for (const p of Array.from(container.querySelectorAll('path'))) {
      expect(p.getAttribute('d') ?? '').not.toContain('NaN');
    }
  });
});
