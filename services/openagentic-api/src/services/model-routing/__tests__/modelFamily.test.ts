import { describe, it, expect } from 'vitest';
import { modelFamily, sameFamily, findFamilyConflict } from '../modelFamily.js';

describe('modelFamily', () => {
  describe('anthropic', () => {
    it('classifies bedrock Sonnet 4.6 as sonnet', () => {
      expect(modelFamily('us.anthropic.claude-sonnet-4-6')).toBe('anthropic:sonnet');
    });
    it('classifies bedrock Sonnet 4.5 as sonnet', () => {
      expect(modelFamily('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('anthropic:sonnet');
    });
    it('classifies bare claude-sonnet-4-6 (AIF alias) as sonnet', () => {
      expect(modelFamily('claude-sonnet-4-6')).toBe('anthropic:sonnet');
    });
    it('classifies Opus 4.6 as opus', () => {
      expect(modelFamily('us.anthropic.claude-opus-4-6-v1')).toBe('anthropic:opus');
    });
    it('classifies Haiku 4.5 as haiku', () => {
      expect(modelFamily('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('anthropic:haiku');
    });
    it('classifies claude-3-5-sonnet as sonnet (legacy naming)', () => {
      expect(modelFamily('anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe('anthropic:sonnet');
    });
    it('classifies global inference profile as sonnet', () => {
      expect(modelFamily('global.anthropic.claude-sonnet-4-6')).toBe('anthropic:sonnet');
    });
  });

  describe('openai', () => {
    it('classifies gpt-5.2 as gpt-5', () => {
      expect(modelFamily('gpt-5.2')).toBe('openai:gpt-5');
    });
    it('classifies gpt-5.3-codex as gpt-5 (same major)', () => {
      expect(modelFamily('gpt-5.3-codex')).toBe('openai:gpt-5');
    });
    it('classifies gpt-4o as gpt-4', () => {
      expect(modelFamily('gpt-4o')).toBe('openai:gpt-4');
    });
    it('keeps gpt-oss distinct from gpt-5/gpt-4', () => {
      expect(modelFamily('gpt-oss:20b')).toBe('openai:gpt-oss');
      expect(modelFamily('gpt-oss')).toBe('openai:gpt-oss');
    });
  });

  describe('other providers', () => {
    it('classifies gemini', () => {
      expect(modelFamily('gemini-2.5-pro')).toBe('google:gemini');
    });
    it('classifies imagen as a SEPARATE family from gemini', () => {
      // Bug 2026-05-06: imagen and gemini collapsed into google:gemini
      // → adding any Vertex chat model when imagen-4 existed in the
      // registry triggered MODEL_FAMILY_CONFLICT 409 ("already in
      // registry"). Image-gen and chat LLMs are not interchangeable;
      // they MUST be in different families.
      expect(modelFamily('imagen-4.0-generate-001')).toBe('google:imagen');
      expect(modelFamily('imagen-3.0-generate-001')).toBe('google:imagen');
    });
    it('classifies qwen', () => {
      expect(modelFamily('qwen3.5:latest')).toBe('qwen:qwen');
    });
    it('classifies llama', () => {
      expect(modelFamily('llama3.2:70b')).toBe('meta:llama');
    });
    it('classifies nomic-embed as embedding family', () => {
      expect(modelFamily('nomic-embed-text')).toBe('ollama:embed');
    });
  });

  describe('edge cases', () => {
    it('returns null for empty or null input', () => {
      expect(modelFamily('')).toBeNull();
      expect(modelFamily(null as any)).toBeNull();
      expect(modelFamily(undefined as any)).toBeNull();
    });
    it('returns null for unknown model ids (never false-positive dedupe)', () => {
      expect(modelFamily('totally-made-up-model-id')).toBeNull();
    });
    it('is case-insensitive', () => {
      expect(modelFamily('US.ANTHROPIC.CLAUDE-SONNET-4-6')).toBe('anthropic:sonnet');
    });
  });
});

describe('sameFamily', () => {
  it('returns true for two different Sonnet versions on Bedrock', () => {
    expect(sameFamily(
      'us.anthropic.claude-sonnet-4-6',
      'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    )).toBe(true);
  });
  it('returns true for Bedrock Sonnet and bare AIF Sonnet alias', () => {
    expect(sameFamily('us.anthropic.claude-sonnet-4-6', 'claude-sonnet-4-6')).toBe(true);
  });
  it('returns false for Sonnet vs Haiku', () => {
    expect(sameFamily(
      'us.anthropic.claude-sonnet-4-6',
      'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    )).toBe(false);
  });
  it('returns false when either side is unknown (avoid false positives)', () => {
    expect(sameFamily('gpt-oss:20b', 'made-up-model')).toBe(false);
  });
  it('treats gpt-5.2 and gpt-5.3-codex as same family', () => {
    expect(sameFamily('gpt-5.2', 'gpt-5.3-codex')).toBe(true);
  });
});

describe('sameFamily — Vertex regression (2026-05-06)', () => {
  it('returns false when adding gemini chat model with imagen-4 already on the provider', () => {
    // The actual live failure: bootstrap-seeded vertex provider has
    // imagen-4.0-generate-001 in admin.model_role_assignments, admin
    // tries to add gemini-2.5-flash via Add-Model wizard, family
    // collapse erroneously matched both as google:gemini → 409.
    expect(sameFamily('gemini-2.5-flash', 'imagen-4.0-generate-001')).toBe(false);
  });
  it('still returns true between two gemini chat models (real conflict preserved)', () => {
    expect(sameFamily('gemini-2.5-flash', 'gemini-2.5-pro')).toBe(true);
  });
  it('still returns true between two imagen versions (real conflict preserved)', () => {
    expect(sameFamily('imagen-3.0-generate-001', 'imagen-4.0-generate-001')).toBe(true);
  });
});

describe('findFamilyConflict', () => {
  it('returns the existing Sonnet when adding a second Sonnet', () => {
    const existing = ['us.anthropic.claude-sonnet-4-6', 'us.anthropic.claude-haiku-4-5-20251001-v1:0'];
    expect(findFamilyConflict('us.anthropic.claude-sonnet-4-5-20250929-v1:0', existing))
      .toBe('us.anthropic.claude-sonnet-4-6');
  });
  it('returns null when no family conflict', () => {
    const existing = ['us.anthropic.claude-sonnet-4-6', 'gpt-oss:20b'];
    expect(findFamilyConflict('us.anthropic.claude-opus-4-6-v1', existing)).toBeNull();
  });
  it('returns null on empty existing list', () => {
    expect(findFamilyConflict('us.anthropic.claude-sonnet-4-6', [])).toBeNull();
  });
  it('skips the exact same id (exact dedupe is handled upstream)', () => {
    const existing = ['us.anthropic.claude-sonnet-4-6'];
    expect(findFamilyConflict('us.anthropic.claude-sonnet-4-6', existing)).toBeNull();
  });
  it('returns null for unknown candidate family (never false-positive)', () => {
    const existing = ['us.anthropic.claude-sonnet-4-6'];
    expect(findFamilyConflict('mystery-model-id', existing)).toBeNull();
  });
  it('returns null when adding gemini-flash to provider that already has imagen-4 (Vertex regression)', () => {
    // Smoking-gun reproduction of the live "any model says already in
    // registry" bug. imagen-4 lives on the bootstrap-seeded Vertex
    // provider; adding gemini-2.5-flash MUST be allowed.
    const existing = ['imagen-4.0-generate-001'];
    expect(findFamilyConflict('gemini-2.5-flash', existing)).toBeNull();
  });
});
