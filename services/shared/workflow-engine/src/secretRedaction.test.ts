import { describe, it, expect } from 'vitest';
import { redactSecrets, redactString, redactLogMeta } from './secretRedaction.js';

const mkCtx = (entries: [string, string][]) => ({
  resolvedSecrets: new Map(entries),
});

describe('redactSecrets', () => {
  // 1. Empty / undefined resolvedSecrets → passthrough
  it('returns string unchanged when resolvedSecrets is undefined', () => {
    expect(redactSecrets('hello', {})).toBe('hello');
  });

  it('returns string unchanged when resolvedSecrets is empty Map', () => {
    expect(redactSecrets('hello', { resolvedSecrets: new Map() })).toBe('hello');
  });

  // 2. String containing a secret
  it('redacts a secret inside a string', () => {
    const ctx = mkCtx([['api_key', 'SUPERSECRET123']]);
    expect(redactSecrets('Bearer SUPERSECRET123', ctx)).toBe('Bearer [redacted:api_key]');
  });

  // 3. Object with a field containing a secret
  it('redacts secret inside an object string field', () => {
    const ctx = mkCtx([['api_key', 'SUPERSECRET']]);
    const result = redactSecrets({ prompt: 'key=SUPERSECRET', model: 'x' }, ctx);
    expect(result).toEqual({ prompt: 'key=[redacted:api_key]', model: 'x' });
  });

  // 4. Deeply nested object
  it('redacts secret in deeply nested object', () => {
    const ctx = mkCtx([['api_key', 'SUPERSECRET']]);
    const result = redactSecrets({ a: { b: { c: 'SUPERSECRET' } } }, ctx);
    expect(result).toEqual({ a: { b: { c: '[redacted:api_key]' } } });
  });

  // 5. Array
  it('redacts secret inside an array', () => {
    const ctx = mkCtx([['api_key', 'SUPERSECRET']]);
    const result = redactSecrets(['SUPERSECRET', 'other'], ctx);
    expect(result).toEqual(['[redacted:api_key]', 'other']);
  });

  // 6. Multiple secrets, both present in string
  it('redacts multiple secrets in one string', () => {
    const ctx = mkCtx([['a', 'AAAA'], ['b', 'BBBB']]);
    const result = redactSecrets('foo=AAAA bar=BBBB', ctx);
    expect(result).toBe('foo=[redacted:a] bar=[redacted:b]');
  });

  // 7. Overlapping secrets — longer wins
  it('replaces longer secret first when one is a substring of another', () => {
    const ctx = mkCtx([['short', 'SUPER'], ['long', 'SUPERSECRET']]);
    const result = redactSecrets('value=SUPERSECRET', ctx);
    // SUPERSECRET (longer) should be replaced, not just SUPER
    expect(result).toBe('value=[redacted:long]');
    expect(result).not.toContain('SUPER');
  });

  // 8. Short secret (< 4 chars) should NOT be redacted
  it('does NOT redact secrets shorter than MIN_SECRET_LENGTH (4)', () => {
    const ctx = mkCtx([['tiny', 'ok']]);
    expect(redactSecrets('ok this is fine', ctx)).toBe('ok this is fine');
  });

  it('does NOT redact secrets of exactly 3 chars', () => {
    const ctx = mkCtx([['three', 'abc']]);
    expect(redactSecrets('abc is common', ctx)).toBe('abc is common');
  });

  // 9. Cycle in input — must not infinite-loop
  it('handles cyclic objects without infinite-looping', () => {
    const ctx = mkCtx([['api_key', 'SUPERSECRET']]);
    const x: any = { value: 'SUPERSECRET' };
    x.self = x;
    // Should not throw or hang; returned object must have value redacted
    const result: any = redactSecrets(x, ctx);
    expect(result.value).toBe('[redacted:api_key]');
  });

  // 10. null input
  it('returns null as-is', () => {
    const ctx = mkCtx([['api_key', 'SUPERSECRET']]);
    expect(redactSecrets(null, ctx)).toBeNull();
  });

  // 11. undefined input
  it('returns undefined as-is', () => {
    const ctx = mkCtx([['api_key', 'SUPERSECRET']]);
    expect(redactSecrets(undefined, ctx)).toBeUndefined();
  });

  // 12. Non-object primitives (number, boolean)
  it('returns number unchanged', () => {
    const ctx = mkCtx([['api_key', 'SUPERSECRET']]);
    expect(redactSecrets(42, ctx)).toBe(42);
  });

  it('returns boolean unchanged', () => {
    const ctx = mkCtx([['api_key', 'SUPERSECRET']]);
    expect(redactSecrets(true, ctx)).toBe(true);
  });

  // 13. Original input is NOT mutated
  it('does not mutate the original input object', () => {
    const ctx = mkCtx([['api_key', 'SECRETVAL']]);
    const original = { a: 'SECRETVAL' };
    redactSecrets(original, ctx);
    expect(original.a).toBe('SECRETVAL');
  });

  // 14. Original input array is NOT mutated
  it('does not mutate the original input array', () => {
    const ctx = mkCtx([['api_key', 'SECRETVAL']]);
    const original = ['SECRETVAL', 'safe'];
    redactSecrets(original, ctx);
    expect(original[0]).toBe('SECRETVAL');
  });

  // 15. Idempotency — placeholder string is not a secret value
  it('returns placeholder unchanged (idempotency: placeholder is not a secret)', () => {
    const ctx = mkCtx([['api_key', 'SUPERSECRET']]);
    expect(redactSecrets('[redacted:api_key]', ctx)).toBe('[redacted:api_key]');
  });

  // 16. Idempotency — running redaction twice is a no-op
  it('is idempotent — running redactSecrets twice yields same result as once', () => {
    const ctx = mkCtx([['api_key', 'SUPERSECRET']]);
    const once = redactSecrets('Bearer SUPERSECRET', ctx);
    const twice = redactSecrets(once, ctx);
    expect(twice).toBe(once);
  });

  // 17. Same value shared by two secret names
  it('redacts a value shared between two secret names (first wins)', () => {
    const ctx = mkCtx([['name_a', 'sharedval123'], ['name_b', 'sharedval123']]);
    const out = redactSecrets('foo sharedval123 bar', ctx);
    // Either [redacted:name_a] or [redacted:name_b] is acceptable, but the
    // cleartext must be gone and only ONE replacement happens.
    expect(out).toMatch(/foo \[redacted:name_[ab]\] bar/);
    expect(out).not.toContain('sharedval123');
  });
});

describe('redactString', () => {
  it('redacts a secret in a string', () => {
    const ctx = mkCtx([['key', 'MYSECRET']]);
    expect(redactString('Authorization: MYSECRET', ctx)).toBe('Authorization: [redacted:key]');
  });

  it('returns the string unchanged when no secrets match', () => {
    const ctx = mkCtx([['key', 'MYSECRET']]);
    expect(redactString('no secret here', ctx)).toBe('no secret here');
  });

  it('returns string unchanged when resolvedSecrets is undefined', () => {
    expect(redactString('hello', {})).toBe('hello');
  });
});

describe('redactLogMeta', () => {
  // 18. Redacts string fields in meta
  it('redacts secret values in string fields of a meta object', () => {
    const ctx = mkCtx([['api_key', 'TOPSECRET']]);
    const meta = { url: 'https://api.example.com?key=TOPSECRET', nodeId: 'n1' };
    const result = redactLogMeta(meta, ctx);
    expect(result).toEqual({ url: 'https://api.example.com?key=[redacted:api_key]', nodeId: 'n1' });
  });

  // 19. Handles null/undefined meta gracefully
  it('returns null as-is when meta is null', () => {
    const ctx = mkCtx([['api_key', 'TOPSECRET']]);
    expect(redactLogMeta(null as any, ctx)).toBeNull();
  });

  it('returns undefined as-is when meta is undefined', () => {
    const ctx = mkCtx([['api_key', 'TOPSECRET']]);
    expect(redactLogMeta(undefined as any, ctx)).toBeUndefined();
  });

  // 20. Passes through fields that don't contain secrets
  it('passes through fields without secret values unchanged', () => {
    const ctx = mkCtx([['api_key', 'TOPSECRET']]);
    const meta = { nodeId: 'n42', status: 'ok', count: 3 };
    const result = redactLogMeta(meta, ctx);
    expect(result).toEqual({ nodeId: 'n42', status: 'ok', count: 3 });
  });
});
