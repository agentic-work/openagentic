/**
 * UI slider-zombie regression guard (task #341).
 *
 * Mirrors services/openagentic-api/src/tests/no-slider.test.ts on the
 * API side. The Global Intelligence Slider was ripped from the
 * backend in task #144, but UI zombies remained:
 *   - SystemSettingsView.tsx still fetched dead /admin/settings/slider
 *     and rendered a <SliderControl> labeled "Global Intelligence Slider"
 *   - Shared/SliderControl.tsx + its export in Shared/index.tsx
 *   - AgentManagementView.tsx copy: "blank = slider" / "Auto (slider-based)"
 *   - SynthService.ts (api-side, but UI-related knob): useSliderModelSelection
 *
 * This test forbids the zombie literals from appearing in live UI source
 * code. Comments about the rip are fine.
 *
 * ALLOWED: multi-model.ts style `slider_min_position` / `slider_max_position`
 * — that's the multi-model *range* slider (different feature, still in use).
 * We only forbid the *intelligence* slider / global slider literals.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const UI_SRC = join(__dirname, '..');

const FORBIDDEN_LITERALS = [
  'SliderControl',
  'SliderTier',
  'SliderDisplay',
  'getSliderTier',
  'getSliderTierInfo',
  'GlobalSliderData',
  'globalSlider',
  'Global Intelligence Slider',
  'handleSliderSave',
  '/admin/settings/slider',
  'intelligenceLevel',
  'useSliderModelSelection',
  'Auto (slider-based)',
  'Auto (slider)',
  'blank = slider',
  'slider-based',
];

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (
      entry === 'node_modules' ||
      entry === 'dist' ||
      entry === '__tests__' ||
      entry.startsWith('.')
    ) {
      continue;
    }
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock.replace(/^\s*\/\/.*$/gm, '').replace(/\s+\/\/.*$/gm, '');
}

describe('no-slider-ui regression guard (task #341)', () => {
  const files = collectSourceFiles(UI_SRC);

  for (const literal of FORBIDDEN_LITERALS) {
    it(`\`${literal}\` has no live occurrences in UI source`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        const raw = readFileSync(file, 'utf8');
        const code = stripComments(raw);
        if (code.includes(literal)) {
          const lines = raw.split('\n');
          const idx = lines.findIndex((l) => l.includes(literal));
          offenders.push(`${file}:${idx + 1}: ${lines[idx]?.trim()}`);
        }
      }
      if (offenders.length > 0) {
        throw new Error(
          `Forbidden slider literal "${literal}" still in live UI code:\n` +
            offenders.join('\n'),
        );
      }
      expect(offenders).toEqual([]);
    });
  }
});
