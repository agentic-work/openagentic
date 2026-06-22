import { describe, it, expect } from 'vitest';
import { escapeMilvusFilterValue, assertSafeMilvusFilterValue } from '../milvusFilter.js';

describe('escapeMilvusFilterValue', () => {
  it('passes through a normal id unchanged', () => {
    expect(escapeMilvusFilterValue('user-123')).toBe('user-123');
  });

  it('escapes a double quote so it cannot break out of the literal', () => {
    // Injection attempt: `x" || user_id == "y` would widen the filter.
    const malicious = 'x" || user_id == "y';
    const escaped = escapeMilvusFilterValue(malicious);
    expect(escaped).toBe('x\\" || user_id == \\"y');
    // The full predicate stays a single quoted literal — no unescaped quote.
    const predicate = `user_id == "${escaped}"`;
    expect(predicate.match(/(?<!\\)"/g)?.length).toBe(2); // only the outer pair
  });

  it('escapes backslashes before quotes', () => {
    expect(escapeMilvusFilterValue('a\\b"c')).toBe('a\\\\b\\"c');
  });

  it('strips control characters', () => {
    expect(escapeMilvusFilterValue('a\nb\tc')).toBe('abc');
  });

  it('coerces null/undefined to empty string', () => {
    expect(escapeMilvusFilterValue(null)).toBe('');
    expect(escapeMilvusFilterValue(undefined)).toBe('');
  });
});

describe('assertSafeMilvusFilterValue', () => {
  it('returns the value when safe', () => {
    expect(assertSafeMilvusFilterValue('srv-azure', 'serverName')).toBe('srv-azure');
  });

  it('throws on a double quote', () => {
    expect(() => assertSafeMilvusFilterValue('a"b', 'id')).toThrow(/Unsafe id/);
  });

  it('throws on a backslash', () => {
    expect(() => assertSafeMilvusFilterValue('a\\b')).toThrow(/Unsafe value/);
  });
});
