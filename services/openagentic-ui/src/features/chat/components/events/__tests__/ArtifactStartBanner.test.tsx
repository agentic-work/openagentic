/**
 * Phase H (task #153) — ArtifactStartBanner render tests.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ArtifactStartBanner } from '../ArtifactStartBanner';

describe('ArtifactStartBanner', () => {
  it('renders kind + title + drafting state by default', () => {
    render(
      <ArtifactStartBanner
        artifactId="art-1"
        kind="markdown"
        title="Cluster health report"
      />
    );
    const el = screen.getByTestId('artifact-start-banner');
    expect(el).toBeInTheDocument();
    expect(el.getAttribute('data-artifact-id')).toBe('art-1');
    expect(el.getAttribute('data-kind')).toBe('markdown');
    expect(el.textContent).toMatch(/Drafting/);
    expect(el.textContent).toContain('Cluster health report');
  });

  it('flips to "Drafted" and shows checkmark when complete', () => {
    render(
      <ArtifactStartBanner
        artifactId="art-2"
        kind="code"
        title="App.tsx"
        language="typescript"
        fileName="App.tsx"
        complete
      />
    );
    const el = screen.getByTestId('artifact-start-banner');
    expect(el.getAttribute('data-complete')).toBe('true');
    expect(el.textContent).toMatch(/Drafted/);
    expect(screen.getByTestId('artifact-complete-check')).toBeInTheDocument();
  });

  it('falls back to "code" kind icon for unknown kinds', () => {
    // Intentionally cast so the kind fallback path is exercised.
    render(
      <ArtifactStartBanner
        artifactId="art-3"
        kind={'totally-unknown' as any}
        title="x"
      />
    );
    expect(screen.getByTestId('artifact-start-banner')).toBeInTheDocument();
  });

  it('renders fileName as the subtitle when provided', () => {
    render(
      <ArtifactStartBanner
        artifactId="art-4"
        kind="code"
        title="project"
        fileName="package.json"
        language="json"
      />
    );
    expect(screen.getByTestId('artifact-start-banner').textContent).toContain('package.json');
  });
});
