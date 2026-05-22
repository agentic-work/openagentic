/**
 * TDD: buildPopoutUrl helper
 *
 * Red → Green cycle:
 *   1. Write this test first (helper does not exist yet → red)
 *   2. Implement buildPopoutUrl in ../utils/popoutUrl.ts → green
 */

import { describe, it, expect } from 'vitest';
import { buildPopoutUrl } from '../utils/popoutUrl';

describe('buildPopoutUrl', () => {
  it('builds the expected URL shape for a normal session id', () => {
    const url = buildPopoutUrl('abc123');
    expect(url).toBe('/openagentic-window?sessionId=abc123');
  });

  it('percent-encodes special characters in the session id', () => {
    // Session IDs are UUIDs in practice but the helper must be safe for
    // any string the caller passes in.
    const url = buildPopoutUrl('id with spaces & stuff');
    expect(url).toBe('/openagentic-window?sessionId=id+with+spaces+%26+stuff');
  });

  it('returns a string starting with /openagentic-window', () => {
    const url = buildPopoutUrl('some-uuid-1234');
    expect(url.startsWith('/openagentic-window')).toBe(true);
  });

  it('is a pure function — same input always gives same output', () => {
    const id = 'ffffffff-0000-1111-2222-333333333333';
    expect(buildPopoutUrl(id)).toEqual(buildPopoutUrl(id));
  });
});
