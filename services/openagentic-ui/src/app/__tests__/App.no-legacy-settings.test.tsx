/**
 * 2026-05-07 — rip legacy `/settings` page (1135-line "OpenAgenticCode"
 * Settings.tsx that survived the v3 admin redesign). User direction:
 * "get rid of that shit". Architecture: tenant config moves to
 * /admin#integrations, per-user GitHub OAuth surfaces inside codemode.
 *
 * Pin the rip with a source-content arch test:
 *   1. App.tsx must NOT import the legacy Settings component.
 *   2. App.tsx must NOT mount <Settings/> on a /settings route.
 *   3. The legacy file `Settings.tsx` must be deleted from features/settings.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const APP_TSX = join(__dirname, '..', 'App.tsx');
const LEGACY_SETTINGS = join(
  __dirname,
  '..',
  '..',
  'features',
  'settings',
  'components',
  'Settings.tsx',
);

function fileExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

describe('App.tsx — legacy /settings ripped (2026-05-07)', () => {
  it('does not import the legacy Settings component', () => {
    const src = readFileSync(APP_TSX, 'utf8');
    expect(src).not.toMatch(
      /import\s+Settings\s+from\s+['"]@\/features\/settings\/components\/Settings['"]/,
    );
  });

  it('does not mount Settings on a /settings Route', () => {
    const src = readFileSync(APP_TSX, 'utf8');
    expect(src).not.toMatch(/<Route\s+path="\/settings"\s+element=\{<Settings\b/);
  });

  it('legacy Settings.tsx file is deleted', () => {
    expect(fileExists(LEGACY_SETTINGS)).toBe(false);
  });
});
