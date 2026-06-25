/**
 * isToolArgsEcho — unit tests for the OllamaProvider text-suppression
 * check (#846, 2026-05-14).
 */

import { describe, it, expect } from 'vitest';
import { isToolArgsEcho } from '../isToolArgsEcho.js';

const FAKE_TC = [{ function: { name: 'tool_search', arguments: '{}' } }];

describe('isToolArgsEcho — #846 contract', () => {
  describe('returns false (real text, no suppression) when', () => {
    it('content is null/undefined', () => {
      expect(isToolArgsEcho(null, FAKE_TC)).toBe(false);
      expect(isToolArgsEcho(undefined, FAKE_TC)).toBe(false);
    });

    it('content is empty', () => {
      expect(isToolArgsEcho('', FAKE_TC)).toBe(false);
    });

    it('no tool_calls accompany the content', () => {
      const json = '{"k":5,"query":"azure list_resource_groups"}';
      expect(isToolArgsEcho(json, [])).toBe(false);
      expect(isToolArgsEcho(json, null)).toBe(false);
      expect(isToolArgsEcho(json, undefined)).toBe(false);
    });

    it('content is real prose, not JSON', () => {
      expect(isToolArgsEcho('Here are your Azure subscriptions:', FAKE_TC)).toBe(false);
      expect(isToolArgsEcho('Let me check that for you', FAKE_TC)).toBe(false);
    });

    it('content is a JSON array (not an object literal)', () => {
      expect(isToolArgsEcho('[1, 2, 3]', FAKE_TC)).toBe(false);
    });

    it('content starts with { but is not parseable JSON', () => {
      expect(isToolArgsEcho('{ pseudo-code here }', FAKE_TC)).toBe(false);
      expect(isToolArgsEcho('{broken', FAKE_TC)).toBe(false);
    });

    it('content is a JSON number/string/boolean (not an object)', () => {
      expect(isToolArgsEcho('42', FAKE_TC)).toBe(false);
      expect(isToolArgsEcho('"hello"', FAKE_TC)).toBe(false);
      expect(isToolArgsEcho('true', FAKE_TC)).toBe(false);
    });

    it('content is a markdown code block (real prose wrapping JSON)', () => {
      // Real prose containing JSON in fenced block doesn't start with `{`
      expect(isToolArgsEcho('```json\n{"k":5}\n```', FAKE_TC)).toBe(false);
    });
  });

  describe('returns true (suppress text emit) when', () => {
    it('content is the exact tool_search JSON from live capture', () => {
      const json = '{"k":5,"query":"azure list_resource_groups"}';
      expect(isToolArgsEcho(json, FAKE_TC)).toBe(true);
    });

    it('content is any JSON object literal accompanying tool_calls', () => {
      expect(isToolArgsEcho('{"foo":"bar"}', FAKE_TC)).toBe(true);
      expect(isToolArgsEcho('{}', FAKE_TC)).toBe(true);
    });

    it('content has leading/trailing whitespace but is a JSON object', () => {
      const json = '  \n  {"k":5,"query":"x"}  \n  ';
      expect(isToolArgsEcho(json, FAKE_TC)).toBe(true);
    });

    it('content is a nested JSON object', () => {
      const json = '{"outer":{"inner":"value"}}';
      expect(isToolArgsEcho(json, FAKE_TC)).toBe(true);
    });
  });
});
