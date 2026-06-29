/**
 * Regression test — slider-rip final phase (2026-04-21).
 *
 * This is the strong regression gate for the complete removal of the
 * Global Intelligence Slider. It forbids every slider-related literal
 * (field names, helper function names, type names, and user-facing
 * strings) from appearing in live API source code.
 *
 * The original task #144 rip left several residual shapes behind
 * (ModelConfigurationService.sliderConfig, SmartModelRouter's
 * getModelForSliderPosition, TieredFunctionCallingService's mapping
 * helpers, etc.). This expanded gate asserts that those ALSO go away.
 *
 * The only places slider-like strings are intentionally allowed:
 *   - comments describing the rip
 *   - workflows.ts — migration shim that strips legacy field names off
 *     wire-level node-data JSON during a transition window
 *   - this test file itself
 *
 * Subsequent commits will delete offending code until this test is
 * green. Until then, it is EXPECTED TO FAIL — that's the point.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const API_SRC = join(__dirname, '..', '..', 'src');

// Strings the caller listed in the task directive. These must not appear
// as live code — only inside comments / strings / the migration shim.
const FORBIDDEN_LITERALS = [
  'sliderPosition',
  'sliderConfig',
  'Slider config received',
  'getModelForSliderPosition',
  'sliderValue',
  'sliderOverride',
  'mapSliderToEffort',
  'intelligenceLevel',
  'Global Intelligence Slider',
  'configureSlider',
  'getSliderTier',
  'SliderControl',
  'SliderTier',
];

/**
 * Walk the API src tree and collect every .ts file.
 */
function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectTsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip single-line and multi-line comments from TS source. We only
 * enforce the rule in LIVE code; comments about the rip are fine.
 */
function stripComments(src: string): string {
  // Remove /* ... */ blocks
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove // ... to end of line
  return noBlock.replace(/^\s*\/\/.*$/gm, '').replace(/\s+\/\/.*$/gm, '');
}

describe('no-slider regression guard (slider-rip final phase)', () => {
  const files = collectTsFiles(API_SRC);

  // Known-allowed offenders:
  //   - workflows.ts strips legacy slider* fields off the wire — the
  //     migration shim, kept during a transition window so older
  //     clients don't break.
  //   - this file itself.
  const WHITELIST_FILES = [
    'no-slider.test.ts',
    'workflows.ts', // migration shim
  ];

  for (const literal of FORBIDDEN_LITERALS) {
    it(`\`${literal}\` has no live occurrences outside whitelist`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        if (WHITELIST_FILES.some((allowed) => file.endsWith(allowed))) continue;
        const raw = readFileSync(file, 'utf8');
        const code = stripComments(raw);
        if (code.includes(literal)) {
          // Find the first line so the test message is useful
          const lines = raw.split('\n');
          const idx = lines.findIndex((l) => l.includes(literal));
          offenders.push(`${file}:${idx + 1}: ${lines[idx]?.trim()}`);
        }
      }
      if (offenders.length > 0) {
        throw new Error(
          `Forbidden literal "${literal}" found in live code (slider-rip final phase):\n` +
            offenders.join('\n'),
        );
      }
      expect(offenders).toEqual([]);
    });
  }
});
