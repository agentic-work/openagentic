import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '../../routes/admin/llm-providers.ts'),
  'utf8',
);

describe('Architecture: provider POST/PUT enforce discriminator', () => {
  it('llm-providers.ts calls validateDiscriminator', () => {
    expect(SRC).toMatch(/validateDiscriminator\s*\(/);
  });
  it('llm-providers.ts calls isGenericName', () => {
    expect(SRC).toMatch(/isGenericName\s*\(/);
  });
  it('llm-providers.ts calls buildAutoDisplayName for the suggested rename', () => {
    expect(SRC).toMatch(/buildAutoDisplayName\s*\(/);
  });
  it('error code GENERIC_NAME_REJECTED is emitted', () => {
    expect(SRC).toMatch(/GENERIC_NAME_REJECTED/);
  });
  it('error code DISCRIMINATOR_MISSING is emitted', () => {
    expect(SRC).toMatch(/DISCRIMINATOR_MISSING/);
  });
  it('discriminator gate is feature-flagged via PROVIDER_DISCRIMINATOR_ENFORCED env', () => {
    expect(SRC).toMatch(/PROVIDER_DISCRIMINATOR_ENFORCED/);
  });
  it('discriminator gate fires in BOTH POST and PUT handlers (env check appears at least twice)', () => {
    const matches = SRC.match(/PROVIDER_DISCRIMINATOR_ENFORCED/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
