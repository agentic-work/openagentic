import { describe, it, expect } from 'vitest';
import { RESERVED_GENERIC_NAMES } from '../../services/llm-providers/ProviderDiscriminatorSchema.js';

describe('Architecture: RESERVED_GENERIC_NAMES set is non-trivial and lowercase', () => {
  it('contains all major provider type root names', () => {
    for (const n of [
      'bedrock',
      'ollama',
      'aws',
      'gcp',
      'azure',
      'anthropic',
      'openai',
      'vertex',
      'aif',
      'aoai',
    ]) {
      expect(RESERVED_GENERIC_NAMES.has(n), `expected ${n} in RESERVED_GENERIC_NAMES`).toBe(true);
    }
  });

  it('all entries are lowercase (case-folding happens at the call site)', () => {
    for (const n of RESERVED_GENERIC_NAMES) {
      expect(n).toBe(n.toLowerCase());
    }
  });

  it('does not accidentally reserve a properly-disambiguated name', () => {
    expect(RESERVED_GENERIC_NAMES.has('bedrock-prod-1234-us-east-1')).toBe(false);
    expect(RESERVED_GENERIC_NAMES.has('ollama-prod-hal')).toBe(false);
  });
});
