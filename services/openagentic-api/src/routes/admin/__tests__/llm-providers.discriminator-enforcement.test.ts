import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  validateDiscriminator,
  isGenericName,
} from '../../../services/llm-providers/ProviderDiscriminatorSchema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The POST + PUT /llm-providers handlers (discriminator gate) moved into the
// provider-CRUD sub-module during the routes/admin/llm-providers.ts split.
const ROUTE_SRC = readFileSync(join(__dirname, '../llm-providers/providers-crud.routes.ts'), 'utf8');

describe('POST /llm-providers — discriminator enforcement (unit-level)', () => {
  it('rejects generic name "Bedrock"', () => {
    expect(isGenericName('Bedrock')).toBe(true);
  });
  it('accepts disambiguated name "bedrock-prod-1234-us-east-1"', () => {
    expect(isGenericName('bedrock-prod-1234-us-east-1')).toBe(false);
  });
  it('rejects aws-bedrock without account+region', () => {
    const r = validateDiscriminator('aws-bedrock', { env: 'prod' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.length).toBeGreaterThan(0);
  });
  it('accepts aws-bedrock with full origin', () => {
    const r = validateDiscriminator('aws-bedrock', {
      env: 'prod',
      account: '1234',
      region: 'us-east-1',
    });
    expect(r.ok).toBe(true);
  });
});

describe('Architecture: POST/PUT handlers invoke the discriminator gate', () => {
  it('llm-providers.ts imports validateDiscriminator', () => {
    expect(ROUTE_SRC).toMatch(/import\s+\{[^}]*validateDiscriminator[^}]*\}/);
  });
  it('llm-providers.ts imports isGenericName', () => {
    expect(ROUTE_SRC).toMatch(/import\s+\{[^}]*isGenericName[^}]*\}/);
  });
  it('llm-providers.ts emits GENERIC_NAME_REJECTED error code', () => {
    expect(ROUTE_SRC).toMatch(/GENERIC_NAME_REJECTED/);
  });
  it('llm-providers.ts emits DISCRIMINATOR_MISSING error code', () => {
    expect(ROUTE_SRC).toMatch(/DISCRIMINATOR_MISSING/);
  });
  it('discriminator gate is feature-flagged via PROVIDER_DISCRIMINATOR_ENFORCED env', () => {
    expect(ROUTE_SRC).toMatch(/PROVIDER_DISCRIMINATOR_ENFORCED/);
  });
});
