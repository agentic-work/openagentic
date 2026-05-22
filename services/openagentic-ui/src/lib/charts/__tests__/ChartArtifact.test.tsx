import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { ChartArtifact, REGISTERED_TEMPLATES } from '../ChartArtifact';

afterEach(() => cleanup());

const SANKEY_DATA = {
  nodes: [
    { id: 'a', label: 'A', kind: 'source' as const },
    { id: 'b', label: 'B', kind: 'sink' as const },
  ],
  links: [{ source: 'a', target: 'b', value: 100 }],
};

describe('<ChartArtifact>', () => {
  it('renders a Sankey when template="sankey"', () => {
    const { container } = render(<ChartArtifact template="sankey" data={SANKEY_DATA} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelectorAll('linearGradient').length).toBeGreaterThan(0);
  });

  it('renders an UnknownTemplateError for an unregistered template', () => {
    const { container } = render(<ChartArtifact template="nope" data={{}} />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain('unknown template');
    expect(container.textContent).toContain('nope');
  });

  it('does NOT throw when passed a bogus template (model can produce noise)', () => {
    expect(() => render(<ChartArtifact template="garbage_template_xyz" data={null} />)).not.toThrow();
  });

  it('REGISTERED_TEMPLATES always includes "sankey" (smoke)', () => {
    expect(REGISTERED_TEMPLATES).toContain('sankey');
  });

  // #816 — compose_visual emits `caption` alongside the chart payload. The
  // dispatcher must render that caption as a <figcaption> under the chart so
  // every template inherits caption support from one site (instead of relying
  // on each chart leaf to thread it through — Sankey.tsx:64 etc drop it via
  // their rest-pattern destructure).
  describe('#816 caption render', () => {
    it('renders a <figure> with a <figcaption> when caption is provided (sankey)', () => {
      const { container } = render(
        <ChartArtifact
          template="sankey"
          data={SANKEY_DATA}
          caption="Cost flow across providers (Q1 2026)"
        />,
      );
      const figure = container.querySelector('figure');
      expect(figure).not.toBeNull();
      // chart still renders inside
      expect(figure?.querySelector('svg')).not.toBeNull();
      const figcaption = container.querySelector('figcaption');
      expect(figcaption).not.toBeNull();
      expect(figcaption?.textContent ?? '').toContain('Cost flow across providers');
      expect(figcaption?.className ?? '').toContain('aw-chart-caption');
    });

    it('does NOT render a <figcaption> when caption is absent', () => {
      const { container } = render(<ChartArtifact template="sankey" data={SANKEY_DATA} />);
      // No caption ⇒ no figcaption element, no empty wrapper.
      expect(container.querySelector('figcaption')).toBeNull();
    });

    it('does NOT render a <figcaption> for empty/whitespace caption', () => {
      const { container } = render(
        <ChartArtifact template="sankey" data={SANKEY_DATA} caption="   " />,
      );
      expect(container.querySelector('figcaption')).toBeNull();
    });

    it('renders caption for the UnknownTemplateError branch too (caption survives error path)', () => {
      // If the model emits a bad template but a real caption, the caption
      // should still render — the user shouldn't lose narrative because of a
      // typo in the slug.
      const { container } = render(
        <ChartArtifact template="bogus_slug" data={{}} caption="explanatory text" />,
      );
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      const figcaption = container.querySelector('figcaption');
      expect(figcaption).not.toBeNull();
      expect(figcaption?.textContent ?? '').toContain('explanatory text');
    });
  });
});
