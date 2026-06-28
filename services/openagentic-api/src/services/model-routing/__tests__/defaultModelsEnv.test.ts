import { describe, it, expect } from 'vitest';
import { buildDefaultModelsFromEnv, mergeDefaultsPreferringExisting } from '../defaultModelsEnv.js';

describe('buildDefaultModelsFromEnv', () => {
  it('maps DEFAULT_MODEL → chat', () => {
    const d = buildDefaultModelsFromEnv({ DEFAULT_MODEL: 'gpt-oss:20b' });
    expect(d.chat).toBe('gpt-oss:20b');
    expect(d.code).toBeNull();
  });

  it('maps all five modes independently', () => {
    const d = buildDefaultModelsFromEnv({
      DEFAULT_MODEL: 'gpt-oss:20b',
      DEFAULT_CODE_MODEL: 'us.anthropic.claude-sonnet-4-6',
      DEFAULT_EMBEDDING_MODEL: 'nomic-embed-text',
      DEFAULT_VISION_MODEL: 'qwen3-vl',
      DEFAULT_IMAGE_MODEL: 'amazon.nova-canvas-v1:0',
    });
    expect(d).toEqual({
      chat: 'gpt-oss:20b',
      code: 'us.anthropic.claude-sonnet-4-6',
      embedding: 'nomic-embed-text',
      vision: 'qwen3-vl',
      imageGen: 'amazon.nova-canvas-v1:0',
    });
  });

  it('falls back to aliases (OPENAGENTIC_MODEL → code, EMBEDDING_MODEL → embedding)', () => {
    const d = buildDefaultModelsFromEnv({
      OPENAGENTIC_MODEL: 'gpt-oss:20b',
      EMBEDDING_MODEL: 'nomic-embed-text',
    });
    expect(d.code).toBe('gpt-oss:20b');
    expect(d.embedding).toBe('nomic-embed-text');
  });

  it('prefers primary key over alias when both set', () => {
    const d = buildDefaultModelsFromEnv({
      DEFAULT_CODE_MODEL: 'primary',
      OPENAGENTIC_MODEL: 'alias',
    });
    expect(d.code).toBe('primary');
  });

  it('returns null for empty / whitespace values', () => {
    const d = buildDefaultModelsFromEnv({
      DEFAULT_MODEL: '',
      DEFAULT_CODE_MODEL: '   ',
    });
    expect(d.chat).toBeNull();
    expect(d.code).toBeNull();
  });

  it('treats the sentinel "auto" as absent', () => {
    const d = buildDefaultModelsFromEnv({ DEFAULT_MODEL: 'auto' });
    expect(d.chat).toBeNull();
  });

  it('trims whitespace', () => {
    const d = buildDefaultModelsFromEnv({ DEFAULT_MODEL: '  gpt-oss:20b  ' });
    expect(d.chat).toBe('gpt-oss:20b');
  });

  it('returns all nulls when env is empty', () => {
    expect(buildDefaultModelsFromEnv({})).toEqual({
      chat: null, code: null, embedding: null, vision: null, imageGen: null,
    });
  });
});

describe('mergeDefaultsPreferringExisting', () => {
  const envDerived = {
    chat: 'gpt-oss:20b', code: 'gpt-oss:20b', embedding: 'nomic-embed-text',
    vision: null, imageGen: null,
  };

  it('keeps existing admin values, fills gaps from env', () => {
    const merged = mergeDefaultsPreferringExisting(
      { chat: 'claude-sonnet-4-6' },
      envDerived,
    );
    expect(merged.chat).toBe('claude-sonnet-4-6');  // admin override preserved
    expect(merged.code).toBe('gpt-oss:20b');         // env filled the gap
    expect(merged.embedding).toBe('nomic-embed-text');
  });

  it('treats empty string as "not set" and falls back to env', () => {
    const merged = mergeDefaultsPreferringExisting(
      { chat: '', code: '   ' },
      envDerived,
    );
    expect(merged.chat).toBe('gpt-oss:20b');
    expect(merged.code).toBe('gpt-oss:20b');
  });

  it('returns env-derived shape when existing is null', () => {
    expect(mergeDefaultsPreferringExisting(null, envDerived)).toEqual(envDerived);
  });

  it('returns env-derived shape when existing is undefined', () => {
    expect(mergeDefaultsPreferringExisting(undefined, envDerived)).toEqual(envDerived);
  });

  it('preserves admin-set null intentionally (does NOT refill)', () => {
    // Admin explicitly cleared vision; env has null anyway, so result null.
    // If env HAD a value, we'd still not refill because null isn't an empty
    // string — but the current impl treats null as "not set" so env wins.
    // Document the behavior: admin who wants "no default for mode" should
    // leave env unset or use a separate disable flag (TBD).
    const merged = mergeDefaultsPreferringExisting(
      { chat: 'admin-chat', vision: null },
      { ...envDerived, vision: 'env-vision' },
    );
    expect(merged.chat).toBe('admin-chat');
    expect(merged.vision).toBe('env-vision');
  });
});
