/**
 * Z.3 — .cm-streaming-table CSS ruleset
 *
 * The mock-07 (end-state-07-tri-cloud-cost-spikes.html §95-110) uses
 * `.cm-streaming-table` as the root class. Sprint Z adds the full ruleset
 * to chatmode-v2.css and adds the class to the StreamingTable component so
 * both .streaming-table and .cm-streaming-table apply.
 *
 * Tests assert: CSS file contains the full .cm-streaming-table ruleset with
 * the key properties from the mock (sticky th, tabular-nums td, mono class,
 * hover state).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CSS_PATH = resolve(__dirname, '../chatmode-v2.css');

describe('.cm-streaming-table CSS ruleset (Z.3)', () => {
  it('has root .cm-streaming-table block with background and border', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toContain('.cm-streaming-table');
    expect(css).toMatch(/\.cm-streaming-table\s*\{[^}]*background:\s*var\(--cm-bg-1\)/);
    expect(css).toMatch(/\.cm-streaming-table\s*\{[^}]*border:/);
  });

  it('has .cm-streaming-table th with position:sticky and top:0', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toMatch(/\.cm-streaming-table\s+th\s*\{[^}]*position:\s*sticky/);
    expect(css).toMatch(/\.cm-streaming-table\s+th\s*\{[^}]*top:\s*0/);
  });

  it('has .cm-streaming-table td with font-variant-numeric:tabular-nums', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toMatch(/\.cm-streaming-table\s+td\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  it('has .cm-streaming-table td.mono and td.num rules', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toContain('.cm-streaming-table td.mono');
    expect(css).toContain('.cm-streaming-table td.num');
  });

  it('has .cm-streaming-table .st-wrap with max-height scroll', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toContain('.cm-streaming-table .st-wrap');
    expect(css).toMatch(/\.cm-streaming-table\s+\.st-wrap\s*\{[^}]*max-height/);
  });

  it('has row hover state rule', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toContain('.cm-streaming-table tbody tr:hover td');
  });

  it('has colored cell rules (red / amber / green)', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toContain('.cm-streaming-table td.red');
    expect(css).toContain('.cm-streaming-table td.amber');
    expect(css).toContain('.cm-streaming-table td.green');
  });
});
