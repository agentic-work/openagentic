import { describe, it, expect } from 'vitest';
import {
  DISCRIMINATORS,
  RESERVED_GENERIC_NAMES,
  buildAutoDisplayName,
  validateDiscriminator,
  isGenericName,
} from '../ProviderDiscriminatorSchema.js';

describe('ProviderDiscriminatorSchema', () => {
  describe('DISCRIMINATORS', () => {
    it('declares schemas for ollama, aws-bedrock, vertex-ai, azure-ai-foundry, azure-openai, anthropic, openai', () => {
      expect(DISCRIMINATORS.ollama).toBeDefined();
      expect(DISCRIMINATORS['aws-bedrock']).toBeDefined();
      expect(DISCRIMINATORS['vertex-ai']).toBeDefined();
      expect(DISCRIMINATORS['azure-ai-foundry']).toBeDefined();
      expect(DISCRIMINATORS['azure-openai']).toBeDefined();
      expect(DISCRIMINATORS.anthropic).toBeDefined();
      expect(DISCRIMINATORS.openai).toBeDefined();
    });

    it('every schema has required[] + template', () => {
      for (const [type, schema] of Object.entries(DISCRIMINATORS)) {
        expect(Array.isArray(schema.required), `${type} required[]`).toBe(true);
        expect(schema.required.length, `${type} required not empty`).toBeGreaterThan(0);
        expect(typeof schema.template, `${type} template`).toBe('string');
      }
    });
  });

  describe('RESERVED_GENERIC_NAMES', () => {
    it('contains common generic provider words (lowercase)', () => {
      expect(RESERVED_GENERIC_NAMES.has('bedrock')).toBe(true);
      expect(RESERVED_GENERIC_NAMES.has('ollama')).toBe(true);
      expect(RESERVED_GENERIC_NAMES.has('vertex')).toBe(true);
      expect(RESERVED_GENERIC_NAMES.has('aif')).toBe(true);
    });
  });

  describe('buildAutoDisplayName', () => {
    it('ollama: ollama-${env}-${hostname}', () => {
      expect(buildAutoDisplayName('ollama', { env: 'prod', hostname: 'hal' })).toBe(
        'ollama-prod-hal',
      );
    });
    it('aws-bedrock: bedrock-${env}-${account}-${region}', () => {
      expect(
        buildAutoDisplayName('aws-bedrock', { env: 'prod', account: '1234', region: 'us-east-1' }),
      ).toBe('bedrock-prod-1234-us-east-1');
    });
    it('vertex-ai: vertex-${env}-${project}-${region}', () => {
      expect(
        buildAutoDisplayName('vertex-ai', {
          env: 'staging',
          project: 'my-proj',
          region: 'us-central1',
        }),
      ).toBe('vertex-staging-my-proj-us-central1');
    });
    it('azure-ai-foundry: aif-${env}-${tenant}-${resource}', () => {
      expect(
        buildAutoDisplayName('azure-ai-foundry', {
          env: 'prod',
          tenant: 'phatoldsun',
          resource: 'awf-aif-20902',
        }),
      ).toBe('aif-prod-phatoldsun-awf-aif-20902');
    });
    it('unknown type returns the type itself (no template)', () => {
      expect(buildAutoDisplayName('unknown-type', {})).toBe('unknown-type');
    });
    it('missing field renders <fieldName> placeholder for live-preview UX', () => {
      expect(buildAutoDisplayName('ollama', { env: 'prod' })).toBe('ollama-prod-<hostname>');
    });
  });

  describe('validateDiscriminator', () => {
    it('returns ok for complete origin', () => {
      expect(
        validateDiscriminator('aws-bedrock', { env: 'prod', account: '1234', region: 'us-east-1' }),
      ).toEqual({ ok: true });
    });
    it('returns missing array when fields absent', () => {
      const r = validateDiscriminator('aws-bedrock', { env: 'prod' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.missing).toContain('account');
        expect(r.missing).toContain('region');
        expect(r.missing).not.toContain('env');
      }
    });
    it('treats empty string and whitespace-only as missing', () => {
      const r = validateDiscriminator('ollama', { env: '', hostname: '   ' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.missing).toContain('env');
        expect(r.missing).toContain('hostname');
      }
    });
    it('unknown provider type returns ok (no schema = no enforcement)', () => {
      expect(validateDiscriminator('unknown-type', {})).toEqual({ ok: true });
    });
  });

  describe('isGenericName', () => {
    it.each([
      ['Bedrock', true],
      ['bedrock', true],
      ['BEDROCK', true],
      ['  ollama  ', true],
      ['Ollama', true],
      ['AWS', true],
      ['aif', true],
      ['bedrock-prod-1234', false],
      ['ollama-hal', false],
      ['', false],
    ])('isGenericName(%s) → %s', (name, expected) => {
      expect(isGenericName(name)).toBe(expected);
    });
  });
});
