/**
 * Tests for formatToolInputDelta (Phase F.1).
 *
 * The preview under a running tool row shows `input_json_delta` bytes as they
 * arrive. While the JSON is mid-flight it stays plain; once it parses we
 * pretty-print so the user sees the final shape. Overflow truncates at a cap.
 */

import { describe, it, expect } from 'vitest';
import { formatToolInputDelta } from '../toolInputDelta';

describe('formatToolInputDelta', () => {
  it('returns empty display for blank input', () => {
    expect(formatToolInputDelta('')).toEqual({ display: '', truncated: false, parsed: false });
    expect(formatToolInputDelta('   \n\t')).toEqual({ display: '', truncated: false, parsed: false });
  });

  it('returns raw string when JSON is incomplete (still streaming)', () => {
    const out = formatToolInputDelta('{"query": "list');
    expect(out.parsed).toBe(false);
    expect(out.display).toBe('{"query": "list');
    expect(out.truncated).toBe(false);
  });

  it('pretty-prints once JSON parses', () => {
    const out = formatToolInputDelta('{"query":"list pods","namespace":"kube-system"}');
    expect(out.parsed).toBe(true);
    // Two-space indent
    expect(out.display).toContain('  "query": "list pods"');
    expect(out.display).toContain('  "namespace": "kube-system"');
  });

  it('truncates parsed JSON past the cap and flags it', () => {
    const big = { data: Array.from({ length: 300 }, (_, i) => `item-${i}`) };
    const out = formatToolInputDelta(JSON.stringify(big));
    expect(out.parsed).toBe(true);
    expect(out.truncated).toBe(true);
    expect(out.display.endsWith('\u2026')).toBe(true);
  });

  it('truncates still-streaming raw text past the cap and marks unparsed', () => {
    const longRaw = '{"q": "' + 'a'.repeat(600); // no closing quote/brace yet
    const out = formatToolInputDelta(longRaw);
    expect(out.parsed).toBe(false);
    expect(out.truncated).toBe(true);
    expect(out.display.endsWith('\u2026')).toBe(true);
  });

  it('parses empty-object JSON (smallest valid shape)', () => {
    const out = formatToolInputDelta('{}');
    expect(out.parsed).toBe(true);
    expect(out.display).toBe('{}');
    expect(out.truncated).toBe(false);
  });

  it('handles JSON arrays at the top level', () => {
    const out = formatToolInputDelta('[1, 2, 3]');
    expect(out.parsed).toBe(true);
    expect(out.display).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('handles non-JSON plaintext that may arrive from low-FCA models', () => {
    const out = formatToolInputDelta('calling kubectl get pods');
    expect(out.parsed).toBe(false);
    expect(out.display).toBe('calling kubectl get pods');
  });
});
