/**
 * Z.4 — .badge-azure / .badge-aws / .badge-gcp cloud chips
 *
 * Mock SoT (end-state-07-tri-cloud-cost-spikes.html §111-113):
 *   .badge-aws  { background: rgba(245,158,11,0.10); color: var(--cm-fs);    border: 1px solid rgba(245,158,11,0.25) }
 *   .badge-azure{ background: rgba(56,189,248,0.10); color: var(--cm-cloud); border: 1px solid rgba(56,189,248,0.25) }
 *   .badge-gcp  { background: rgba(167,139,250,0.10);color: var(--cm-k8s);   border: 1px solid rgba(167,139,250,0.25) }
 * All three use: display:inline-block; padding:2px 7px; border-radius:4px;
 *   font-size:10px; font-family:'JetBrains Mono',monospace.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CSS_PATH = resolve(__dirname, '../chatmode-v2.css');

describe('cloud badge chip CSS (Z.4)', () => {
  it('has .badge-aws rule with orange colors', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toContain('.badge-aws');
    expect(css).toMatch(/\.badge-aws\s*\{[^}]*color:\s*var\(--cm-fs\)/);
    expect(css).toMatch(/\.badge-aws\s*\{[^}]*background:/);
    expect(css).toMatch(/\.badge-aws\s*\{[^}]*border:/);
  });

  it('has .badge-azure rule with blue (cloud) colors', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toContain('.badge-azure');
    expect(css).toMatch(/\.badge-azure\s*\{[^}]*color:\s*var\(--cm-cloud\)/);
    expect(css).toMatch(/\.badge-azure\s*\{[^}]*background:/);
    expect(css).toMatch(/\.badge-azure\s*\{[^}]*border:/);
  });

  it('has .badge-gcp rule with violet (k8s) colors', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toContain('.badge-gcp');
    expect(css).toMatch(/\.badge-gcp\s*\{[^}]*color:\s*var\(--cm-k8s\)/);
    expect(css).toMatch(/\.badge-gcp\s*\{[^}]*background:/);
    expect(css).toMatch(/\.badge-gcp\s*\{[^}]*border:/);
  });

  it('all three badges use JetBrains Mono font', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    // Extract the badge block area for a rough check
    const idx = css.indexOf('.badge-aws');
    const snippet = css.slice(idx, idx + 600);
    expect(snippet).toContain('JetBrains Mono');
  });
});
