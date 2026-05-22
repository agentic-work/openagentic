/**
 * SavingsCard — #502 P0 chatmode UX rebuild RED→GREEN contract.
 *
 * 3-cell KPI tile rendered inline below right-sizing / cost-analysis
 * output so the user sees the headline savings number at a glance.
 *
 * Reference: /home/trent/openagentic/agentic/mocks/UX/01-cloud-ops.html
 * lines 1142-1155 (the `.savings-card` block — 3 cells, each with a
 * `.k` label + a `.v.g` big-number value with optional `<small>` tail).
 *
 * Inline styles (vs chatmode-v2.css) so parallel-agent rebuild does not
 * collide on the shared stylesheet — see SAVINGS_CARD_STYLES in the .tsx.
 *
 * Contract:
 *   - Renders one `.cm-sc-cell` per `cells` prop entry.
 *   - Each cell exposes its label inside `.cm-sc-k` and its value inside
 *     `.cm-sc-v` (with the tone class `.cm-sc-tone-(g|r|n)` appended).
 *   - When `suffix` is supplied, it renders inside a `<small>` nested in
 *     the `.cm-sc-v` div (the small-decimal-tail mock pattern).
 *   - tone='g' applies green (#22c55e), tone='r' applies red (#ef4444),
 *     and the default (no tone) is neutral (var(--fg-0, #f8fafc)).
 *   - Root carries role="group" + the supplied `aria-label` when given.
 *   - Accepts 2..4 cells (mock 01 always uses 3 but the component is
 *     flexible by design).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SavingsCard, type SavingsCardCell } from '../SavingsCard.js';

const MOCK_01_CELLS: SavingsCardCell[] = [
  { label: 'Monthly savings', value: '$2,847', suffix: '.12', tone: 'g' },
  { label: 'Annual savings', value: '$34,165', suffix: '.44', tone: 'g' },
  { label: '% reduction', value: '46.0', suffix: '%' },
];

describe('SavingsCard — #502 P0 chatmode KPI tile', () => {
  it('renders one .cm-sc-cell per cells prop entry', () => {
    const { container } = render(<SavingsCard cells={MOCK_01_CELLS} />);
    const cells = container.querySelectorAll('.cm-sc-cell');
    expect(cells.length).toBe(3);
  });

  it('renders the label and value text exactly', () => {
    render(<SavingsCard cells={MOCK_01_CELLS} />);
    expect(screen.getByText('Monthly savings')).toBeInTheDocument();
    expect(screen.getByText('Annual savings')).toBeInTheDocument();
    expect(screen.getByText('% reduction')).toBeInTheDocument();
    // value text — the "$2,847" big-number stem is the cell's primary value
    expect(screen.getByText('$2,847')).toBeInTheDocument();
    expect(screen.getByText('$34,165')).toBeInTheDocument();
    expect(screen.getByText('46.0')).toBeInTheDocument();
  });

  it('renders suffix inside a <small> nested in the value div', () => {
    const { container } = render(<SavingsCard cells={MOCK_01_CELLS} />);
    const valueDivs = container.querySelectorAll('.cm-sc-v');
    expect(valueDivs.length).toBe(3);
    // First cell — "$2,847" + <small>.12</small>
    const firstSmall = valueDivs[0].querySelector('small');
    expect(firstSmall).not.toBeNull();
    expect(firstSmall?.textContent).toBe('.12');
    // Third cell — "46.0" + <small>%</small>
    const thirdSmall = valueDivs[2].querySelector('small');
    expect(thirdSmall).not.toBeNull();
    expect(thirdSmall?.textContent).toBe('%');
  });

  it('omits <small> when suffix is not provided', () => {
    const { container } = render(
      <SavingsCard
        cells={[{ label: 'Total', value: '$100' }]}
      />,
    );
    const valueDiv = container.querySelector('.cm-sc-v');
    expect(valueDiv?.querySelector('small')).toBeNull();
  });

  it("tone='g' applies the green color (#22c55e)", () => {
    const { container } = render(
      <SavingsCard cells={[{ label: 'Saved', value: '$100', tone: 'g' }]} />,
    );
    const v = container.querySelector('.cm-sc-v') as HTMLElement;
    expect(v).not.toBeNull();
    expect(v.className).toContain('cm-sc-tone-g');
    expect(v.style.color).toBe('rgb(34, 197, 94)'); // #22c55e
  });

  it("tone='r' applies the red color (#ef4444)", () => {
    const { container } = render(
      <SavingsCard cells={[{ label: 'Over', value: '$50', tone: 'r' }]} />,
    );
    const v = container.querySelector('.cm-sc-v') as HTMLElement;
    expect(v).not.toBeNull();
    expect(v.className).toContain('cm-sc-tone-r');
    expect(v.style.color).toBe('rgb(239, 68, 68)'); // #ef4444
  });

  it('default tone (no tone prop) is neutral', () => {
    const { container } = render(
      <SavingsCard cells={[{ label: 'Pct', value: '46.0' }]} />,
    );
    const v = container.querySelector('.cm-sc-v') as HTMLElement;
    expect(v).not.toBeNull();
    // Neutral tone class — explicitly NOT the green or red one
    expect(v.className).toContain('cm-sc-tone-n');
    expect(v.className).not.toContain('cm-sc-tone-g');
    expect(v.className).not.toContain('cm-sc-tone-r');
  });

  it('respects ariaLabel prop on the root (role="group" + aria-label)', () => {
    render(
      <SavingsCard
        cells={MOCK_01_CELLS}
        ariaLabel="Monthly and annual savings summary"
      />,
    );
    const root = screen.getByRole('group', {
      name: 'Monthly and annual savings summary',
    });
    expect(root).toBeInTheDocument();
  });

  it('accepts 2 cells', () => {
    const { container } = render(
      <SavingsCard
        cells={[
          { label: 'A', value: '1' },
          { label: 'B', value: '2' },
        ]}
      />,
    );
    expect(container.querySelectorAll('.cm-sc-cell').length).toBe(2);
  });

  it('accepts 4 cells', () => {
    const { container } = render(
      <SavingsCard
        cells={[
          { label: 'A', value: '1' },
          { label: 'B', value: '2' },
          { label: 'C', value: '3' },
          { label: 'D', value: '4' },
        ]}
      />,
    );
    expect(container.querySelectorAll('.cm-sc-cell').length).toBe(4);
  });

  it('applies user-supplied className to the root', () => {
    const { container } = render(
      <SavingsCard cells={MOCK_01_CELLS} className="custom-savings" />,
    );
    const root = container.querySelector('.cm-savings-card');
    expect(root?.className).toContain('custom-savings');
  });
});
